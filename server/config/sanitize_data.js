'use strict';
/**
 * SmartBusAI — Sprint 6: data sanitization / integrity scan.
 * Run: npm run db:sanitize   (or: node server/config/sanitize_data.js)
 * Add --dry-run to only report, applying zero writes.
 *
 * Every check below was run against the real dev database before being
 * written, to ground each category in what's actually there rather than
 * a generic checklist:
 *   - Orphaned seats/booking_detail: 0 found currently — the checks stay
 *     in as ongoing guards, not because anything's broken today.
 *   - route_stop junk rows: 67 found (see server/config/
 *     generate_route_stops.js's own cleanup — already fixed there; this
 *     script re-checks the same signature so it stays caught if it ever
 *     recurs, e.g. from a stray manual test insert).
 *   - 3 severely corrupted trip rows (route_id/departure_time/base_price
 *     all NULL) found — each has real PAID bookings attached (7 total,
 *     real revenue). These are NEVER auto-fixed or deleted: there is no
 *     way to recover what their real route/price/date should have been,
 *     and deleting them would silently orphan real paid bookings. Reported
 *     only, for a human to investigate.
 *   - Invalid phone formats: 0 found currently among users.phone and
 *     booking.guest_phone — the check/normalize logic stays in as an
 *     ongoing guard for future bad input (e.g. a spaced/dashed number is
 *     safely auto-normalized; anything that still doesn't match a valid
 *     VN phone shape after normalizing is reported, never guessed at).
 */

const db = require('./db');

const VN_PHONE_RE = /^(0|\+84)[0-9]{9,10}$/;

function normalizePhone(raw) {
    return String(raw || '').replace(/[\s.\-()]/g, '');
}

async function checkOrphanedSeats(fix) {
    const [rows] = await db.query(
        `SELECT s.seat_id FROM seat s LEFT JOIN bus b ON s.bus_id = b.bus_id WHERE b.bus_id IS NULL`
    );
    if (rows.length && fix) {
        await db.query(`DELETE s FROM seat s LEFT JOIN bus b ON s.bus_id = b.bus_id WHERE b.bus_id IS NULL`);
    }
    return { check: 'orphaned_seats', found: rows.length, fixed: fix ? rows.length : 0 };
}

async function checkOrphanedBookingDetail(fix) {
    const [missingSeat] = await db.query(
        `SELECT bd.booking_detail_id FROM booking_detail bd LEFT JOIN seat s ON bd.seat_id = s.seat_id WHERE s.seat_id IS NULL`
    );
    const [missingBooking] = await db.query(
        `SELECT bd.booking_detail_id FROM booking_detail bd LEFT JOIN booking bk ON bd.booking_id = bk.booking_id WHERE bk.booking_id IS NULL`
    );
    const found = missingSeat.length + missingBooking.length;
    if (found && fix) {
        await db.query(`DELETE bd FROM booking_detail bd LEFT JOIN seat s ON bd.seat_id = s.seat_id WHERE s.seat_id IS NULL`);
        await db.query(`DELETE bd FROM booking_detail bd LEFT JOIN booking bk ON bd.booking_id = bk.booking_id WHERE bk.booking_id IS NULL`);
    }
    return { check: 'orphaned_booking_detail', found, fixed: fix ? found : 0 };
}

async function checkRouteStopJunk(fix) {
    const [rows] = await db.query(
        `SELECT stop_id FROM route_stop WHERE lat = 0 AND lng = 0 AND stop_order = 0`
    );
    if (rows.length && fix) {
        await db.query(`DELETE FROM route_stop WHERE lat = 0 AND lng = 0 AND stop_order = 0`);
    }
    return { check: 'route_stop_junk_placeholder_rows', found: rows.length, fixed: fix ? rows.length : 0 };
}

async function checkBrokenTrips() {
    /* Report-only — see file header. Never auto-fixed: no route/price/date
       can be safely reconstructed, and real paid bookings may depend on
       these rows. */
    const [rows] = await db.query(`
        SELECT t.trip_id, t.route_id, t.base_price, t.status,
               (SELECT COUNT(*) FROM booking bk WHERE bk.trip_id = t.trip_id) AS booking_count,
               (SELECT COALESCE(SUM(total_amount),0) FROM booking bk WHERE bk.trip_id = t.trip_id AND bk.status = 'PAID') AS paid_revenue_at_risk
        FROM trip t
        WHERE t.route_id IS NULL OR t.base_price IS NULL OR t.base_price <= 0
    `);
    return { check: 'broken_trips_missing_route_or_price', found: rows.length, fixed: 0, details: rows, requiresHumanReview: rows.length > 0 };
}

async function checkInvalidPhones(fix) {
    const [users] = await db.query("SELECT user_id, phone FROM users WHERE phone IS NOT NULL AND phone != ''");
    const [guests] = await db.query("SELECT booking_id, guest_phone FROM booking WHERE guest_phone IS NOT NULL AND guest_phone != ''");

    let normalized = 0;
    const unfixable = [];

    for (const u of users) {
        const norm = normalizePhone(u.phone);
        if (VN_PHONE_RE.test(norm)) {
            if (norm !== u.phone && fix) {
                await db.query('UPDATE users SET phone=? WHERE user_id=?', [norm, u.user_id]);
                normalized++;
            } else if (norm !== u.phone) {
                normalized++; // would be normalized in fix mode
            }
        } else {
            unfixable.push({ table: 'users', id: u.user_id, value: u.phone });
        }
    }
    for (const b of guests) {
        const norm = normalizePhone(b.guest_phone);
        if (VN_PHONE_RE.test(norm)) {
            if (norm !== b.guest_phone && fix) {
                await db.query('UPDATE booking SET guest_phone=? WHERE booking_id=?', [norm, b.booking_id]);
                normalized++;
            } else if (norm !== b.guest_phone) {
                normalized++;
            }
        } else {
            unfixable.push({ table: 'booking.guest_phone', id: b.booking_id, value: b.guest_phone });
        }
    }

    return {
        check: 'invalid_phone_format',
        found: normalized + unfixable.length,
        fixed: fix ? normalized : 0,
        wouldFix: fix ? undefined : normalized,
        unfixable, // needs human review — not a recognizable VN phone shape at all
    };
}

async function runSanitize({ dryRun = false } = {}) {
    const fix = !dryRun;
    const results = await Promise.all([
        checkOrphanedSeats(fix),
        checkOrphanedBookingDetail(fix),
        checkRouteStopJunk(fix),
        checkBrokenTrips(),
        checkInvalidPhones(fix),
    ]);
    return { dryRun, results };
}

module.exports = { runSanitize };

if (require.main === module) {
    const dryRun = process.argv.includes('--dry-run');
    runSanitize({ dryRun }).then(report => {
        console.log(JSON.stringify(report, null, 2));
        process.exit(0);
    }).catch(err => {
        console.error('sanitize_data FAILED:', err.message);
        process.exit(1);
    });
}
