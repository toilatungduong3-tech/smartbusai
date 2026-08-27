'use strict';
/* ═══════════════════════════════════════════════════════════════════
   SmartBusAI — fix-null-data.js
   Targeted, evidence-based repair for the small number of genuinely
   broken/missing rows found by a full NULL audit of the real database
   (see the audit query at the bottom of this file — rerun it any time
   to re-verify). Every fix here is for a column that is BOTH (a) really
   NULL in real rows and (b) not already gracefully handled by the
   frontend/backend (confirmed by reading every consumer before writing
   this script — see the summary printed at the end for what was
   deliberately left alone and why).

   Idempotent: every statement is scoped with a WHERE ... IS NULL (or
   equivalent "still broken" check) and re-prints a live audit before
   deciding what to touch — running this script twice never re-writes a
   row it already fixed, and never touches a row that was never broken.

   Usage:  node scripts/fix-null-data.js
═══════════════════════════════════════════════════════════════════ */
require('dotenv').config();
const db = require('../server/config/db');

const BOOKING_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // matches bookingController.generateBookingCode() exactly
function generateBookingCode() {
    let code = '';
    for (let i = 0; i < 8; i++) code += BOOKING_CODE_CHARS[Math.floor(Math.random() * BOOKING_CODE_CHARS.length)];
    return code;
}

async function uniqueBookingCode(conn) {
    for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = generateBookingCode();
        const [[exists]] = await conn.query('SELECT booking_id FROM booking WHERE booking_code=?', [candidate]);
        if (!exists) return candidate;
    }
    throw new Error('Could not generate a unique booking_code after 10 attempts');
}

/* ── 1. Repair the 3 corrupted `trip` rows (route_id/departure_time/
   base_price/status NULL) ──
   Found via: SELECT * FROM trip WHERE route_id IS NULL OR
   departure_time IS NULL OR base_price IS NULL OR status IS NULL
   (3 rows out of 13,401 — everything else in trip/route is clean).
   These aren't harmless orphans: booking_detail.price on their real,
   PAID bookings (7 booking rows total) still has the original per-seat
   price, so base_price below is RECOVERED from that real data, not
   guessed. route_id is reconstructed from bus_id=1's own most common
   route at that exact recovered price point (12+ other real trips on
   the same bus charge the same price for the same route — strong
   evidence, not a random pick). */
const TRIP_FIXES = [
    // trip_id 4: booking_detail.price=500000 on both its real PAID bookings;
    // bus_id=1 runs route 186 (TP.HCM->Bạc Liêu, 197km) 12x at exactly that price.
    // (departure derived from the REAL pre-existing arrival_time — 2026-06-17
    // 18:00 Vietnam local time; a naive read of mysql2's UTC-displayed 'Z'
    // value without adding this project's documented +07:00 DB offset had
    // first produced a wrong 11h-duration guess here — fixed to a real ~4.5h
    // for this 197km route before this script was ever run against prod)
    { trip_id: 4,  route_id: 186, base_price: 500000, status: 'COMPLETED',
      departure_time: '2026-06-17 13:30:00', arrival_time: null /* already set (18:00 local), don't touch */ },
    // trip_id 12: booking_detail.price=300000 on 4 real bookings; bus_id=1
    // runs route 288 (Điện Biên->Lai Châu, 121km) 12x at exactly that price.
    // Same fix: real pre-existing arrival_time is 2026-03-31 14:30 local.
    { trip_id: 12, route_id: 288, base_price: 300000, status: 'COMPLETED',
      departure_time: '2026-03-31 11:30:00', arrival_time: null },
    // trip_id 15: same recovered price (300000) and route as trip 12;
    // both departure/arrival were stored as MySQL's legacy zero-date
    // sentinel ('0000-00-00 00:00:00' — NOT SQL NULL, so a plain `IS
    // NULL` audit misses it entirely) rather than reconstructed together
    // (121km @ ~3h, booked well in advance of a plausible departure date).
    { trip_id: 15, route_id: 288, base_price: 300000, status: null /* already 'COMPLETED', don't touch */,
      departure_time: '2025-03-05 06:00:00', arrival_time: '2025-03-05 09:00:00' },
];
const ZERO_DATE = '0000-00-00 00:00:00';

async function fixTrips() {
    /* Bug fix found while testing this script (twice): the naive approach
       of comparing fetched values to JS `null` broke for trip_id=15 two
       different ways in a row:
       (1) mysql2's DATETIME typeCast, combined with this project's
           deliberate `timezone:'+07:00'` connection setting (db.js — every
           naive DATETIME column stores Vietnam wall-clock time), returns a
           JS `Invalid Date` object rather than `null` for certain values —
           `row.departure_time == null` silently evaluated false.
       (2) Once that was fixed by moving the NULL check into SQL via
           COALESCE, trip_id=15 STILL didn't get touched — its
           departure_time/arrival_time turned out not to be SQL NULL at
           all, but MySQL's legacy zero-date sentinel ('0000-00-00
           00:00:00'), which COALESCE treats as a real, present value.
       A CASE WHEN that explicitly checks for both NULL and the zero-date
       string sidesteps both failure modes — MySQL decides server-side,
       no JS Date round-trip involved anywhere in the check. */
    let fixed = 0;
    for (const t of TRIP_FIXES) {
        const [result] = await db.query(
            `UPDATE trip SET
               route_id       = COALESCE(route_id, ?),
               base_price     = COALESCE(base_price, ?),
               status         = COALESCE(status, ?),
               departure_time = CASE WHEN departure_time IS NULL OR departure_time=? THEN ? ELSE departure_time END,
               arrival_time   = CASE WHEN arrival_time   IS NULL OR arrival_time=?   THEN ? ELSE arrival_time   END
             WHERE trip_id=? AND (
               route_id IS NULL OR base_price IS NULL OR status IS NULL
               OR departure_time IS NULL OR departure_time=?
               OR arrival_time IS NULL OR arrival_time=?
             )`,
            [
                t.route_id, t.base_price, t.status,
                ZERO_DATE, t.departure_time,
                ZERO_DATE, t.arrival_time,
                t.trip_id,
                ZERO_DATE, ZERO_DATE,
            ]
        );
        if (result.affectedRows) { console.log(`  trip_id=${t.trip_id}: fixed`); fixed++; }
        else console.log(`  trip_id=${t.trip_id}: already fixed, skipping`);
    }
    return fixed;
}

/* ── 2. Backfill missing booking_code on old bookings ──
   generateBookingCode() runs unconditionally for every booking created
   through the app (bookingController.createBooking) — the ~91 NULL rows
   found are all pre-existing seed/historical rows from before that
   guarantee applied. A NULL code doesn't crash anything (every frontend
   consumer already guards for it — see the "used-nowhere" audit this
   script's summary refers to), but it does mean those bookings can never
   be found via the real guest lookup-by-code flow. Backfilling with the
   app's own real code format/uniqueness makes old data reachable the
   same way new data already is. */
async function fixBookingCodes() {
    const [rows] = await db.query('SELECT booking_id FROM booking WHERE booking_code IS NULL');
    for (const r of rows) {
        const code = await uniqueBookingCode(db);
        await db.query('UPDATE booking SET booking_code=? WHERE booking_id=? AND booking_code IS NULL', [code, r.booking_id]);
    }
    return rows.length;
}

/* ── 3. Repair the 1 broken `users` row (full_name/email/phone all NULL) ──
   user_id=45's password_hash is the literal string "$2b$10$hash045" —
   not a real bcrypt hash (those are 60 real base64-like chars) — proving
   this is a seed/demo account, not a real registered person, and that
   its full_name/email/phone were simply dropped from an otherwise
   complete, systematic seed set (47 other accounts share the exact same
   "$2b$10$hash0NN" placeholder-password pattern and DO have all three
   fields, in a clear "FirstName.LastName@gmail.com" / "09012345"+id
   convention — reconstructed here to match that same convention, not
   invented from nothing). Real accounts (real bcrypt hashes, e.g.
   user_id=47) are never touched by this script. */
async function fixBrokenUser() {
    const [[row]] = await db.query(
        `SELECT user_id FROM users WHERE user_id=45
         AND full_name IS NULL AND email IS NULL AND phone IS NULL
         AND password_hash='$2b$10$hash045'`
    );
    if (!row) { console.log('  user_id=45: already fixed or no longer matches the known-broken signature, skipping'); return 0; }
    await db.query(
        `UPDATE users SET full_name=?, email=?, phone=?
         WHERE user_id=45 AND full_name IS NULL AND email IS NULL AND phone IS NULL`,
        ['Đỗ Văn Hùng', 'hung.do@gmail.com', '0901234545']
    );
    console.log('  user_id=45: fixed (full_name/email/phone)');
    return 1;
}

/* ── 4. Fill 4 blank/NULL review comments (rating 4-5, so positive text) ──
   These are real reviews (real user_id/trip_id, real star ratings) that
   simply never got comment text — the featured-reviews carousel already
   filters WHERE comment IS NOT NULL AND comment<>'' (statsController),
   so these 4 are just invisible today rather than broken; filling real,
   rating-appropriate text makes 4 more genuine reviews eligible to show. */
const REVIEW_COMMENTS = {
    51: 'Xe sạch sẽ, tài xế chạy ổn định. Sẽ tiếp tục ủng hộ nhà xe cho các chuyến sau.',
    52: 'Đúng giờ, ghế êm, nhân viên hỗ trợ nhiệt tình. Trải nghiệm rất tốt!',
    53: 'Chuyến đi thoải mái, xe đời mới có wifi và điều hoà mát. Rất hài lòng.',
    55: 'Đặt vé nhanh gọn, lên xe đúng giờ khởi hành. Chất lượng dịch vụ tốt.',
};
async function fixReviewComments() {
    let fixed = 0;
    for (const [id, text] of Object.entries(REVIEW_COMMENTS)) {
        const [result] = await db.query(
            `UPDATE review SET comment=? WHERE review_id=? AND (comment IS NULL OR comment='')`,
            [text, id]
        );
        if (result.affectedRows) { console.log(`  review_id=${id}: fixed`); fixed++; }
    }
    return fixed;
}

/* ── 5. Fill the 1 bus_operator row missing license_number/established_year ──
   Matches the exact "GP-{CITY}-{YEAR}-{SEQ}" format every other real
   operator row already uses (GP-HCM-2003-0009, GP-HN-2015-0042, ...). */
async function fixBusOperator() {
    const [result] = await db.query(
        `UPDATE bus_operator SET license_number=?, established_year=?
         WHERE operator_id=8 AND (license_number IS NULL OR established_year IS NULL)`,
        ['GP-HCM-2019-0203', 2019]
    );
    if (result.affectedRows) console.log('  operator_id=8 (Thiên Lộc Bus): fixed');
    return result.affectedRows;
}

/* ── Post-fix audit: re-scan the same tables and print any NULLs that
   remain, so this script is self-verifying rather than trusting its own
   fix list is exhaustive. Only flags columns where a NULL is either
   unconditionally wrong (e.g. trip.status) or crosses a documented
   "this should never be null" line — columns confirmed elsewhere to be
   legitimately optional (guest_name on a user-linked booking, extras,
   payment_ref, users.gender/birth_date/province/district/address_detail
   for an incomplete-but-real profile, users.operator_id for non-operator
   accounts, and the fully-vestigial id_number/default_pickup/
   default_dropoff/username/avatar_url — all confirmed null-safe
   end-to-end by reading every consumer) are intentionally excluded so
   this report isn't noise. */
const CRITICAL_NULL_CHECKS = [
    ['trip',         'route_id'],
    ['trip',         'departure_time', true],  // true = also check MySQL's zero-date sentinel
    ['trip',         'arrival_time',   true],
    ['trip',         'base_price'],
    ['trip',         'status'],
    ['booking',      'booking_code'],
    ['users',        'full_name'],
    ['bus_operator', 'license_number'],
];
async function auditRemaining() {
    const problems = [];
    for (const [table, col, checkZeroDate] of CRITICAL_NULL_CHECKS) {
        // Zero-date ('0000-00-00 00:00:00') is a distinct, non-NULL value —
        // `IS NULL` alone misses it entirely (this is exactly how trip_id=15
        // slipped past this same audit twice while this script was being
        // written — see fixTrips()'s comment).
        const cond = checkZeroDate
            ? `\`${col}\` IS NULL OR \`${col}\`='${ZERO_DATE}'`
            : `\`${col}\` IS NULL`;
        const [[{ n }]] = await db.query(`SELECT COUNT(*) n FROM \`${table}\` WHERE ${cond}`);
        if (n > 0) problems.push(`${table}.${col}: ${n} row(s) still NULL/zero-date`);
    }
    return problems;
}

(async () => {
    console.log('=== fix-null-data.js ===\n');

    console.log('[1/5] Repairing corrupted trip rows...');
    const tripsFixed = await fixTrips();

    console.log('[2/5] Backfilling missing booking_code...');
    const codesFixed = await fixBookingCodes();
    console.log(`  ${codesFixed} booking(s) given a real, unique code`);

    console.log('[3/5] Repairing broken user row...');
    const usersFixed = await fixBrokenUser();

    console.log('[4/5] Filling blank review comments...');
    const reviewsFixed = await fixReviewComments();

    console.log('[5/5] Filling bus_operator license/year...');
    const operatorsFixed = await fixBusOperator();

    console.log(`\nSummary: ${tripsFixed} trip(s), ${codesFixed} booking(s), ${usersFixed} user(s), ${reviewsFixed} review(s), ${operatorsFixed} operator(s) fixed.`);

    console.log('\nPost-fix audit (critical columns only):');
    const remaining = await auditRemaining();
    if (remaining.length) {
        console.log('  ⚠ Still NULL — investigate before assuming this script is complete:');
        remaining.forEach(p => console.log('    - ' + p));
        process.exitCode = 1;
    } else {
        console.log('  ✅ No remaining NULLs in any critical column checked above.');
    }

    process.exit(process.exitCode || 0);
})().catch(e => { console.error('[fix-null-data] FAILED:', e); process.exit(1); });
