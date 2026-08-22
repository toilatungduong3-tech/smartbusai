'use strict';
/**
 * TRUTHNODE — PHASE 1, Section E: concurrency proof.
 * Live verification against the REAL running server (localhost:2704) and
 * REAL database — not mocked — because the whole point is to prove an
 * actual race condition is closed at the DB layer, which a mocked test
 * cannot demonstrate (mocks don't have InnoDB row locks or PRIMARY KEY
 * uniqueness).
 *
 * This is a one-off, point-in-time live-verification script (Category C
 * per tests/SMARTBUSAI_MASTER_COMPLETION_MATRIX.md's test taxonomy) — not
 * a permanent Jest suite. It creates and then cleans up its own real rows.
 * NOT safe to re-run against hardcoded IDs from a prior run (it looks up
 * fresh state each time), but re-running it is safe in general since it
 * only touches rows it itself creates.
 *
 * Covers (per PHASE 1 instructions, Section E):
 *   - 2 users booking the same seat concurrently
 *   - 2 concurrent cancel requests for the same booking
 *   - double-click booking (same request fired twice near-simultaneously)
 *   - payment confirmation retry (duplicate concurrent pay requests for the
 *     same PENDING booking — must never insert two payment rows / double-award
 *     loyalty points)
 */
require('dotenv').config();
const db = require('../server/config/db');

const BASE = 'http://localhost:2704/api';
const createdBookingIds = [];

async function findTestTrip() {
    // A future trip with at least 2 genuinely free seats (no active
    // booking_detail row for them), on a bus with >= 2 seats total.
    const [rows] = await db.query(`
        SELECT t.trip_id, b.bus_id
        FROM trip t
        JOIN bus b ON t.bus_id = b.bus_id
        WHERE t.departure_time > NOW() AND t.status = 'OPEN'
        LIMIT 50
    `);
    for (const t of rows) {
        const [seats] = await db.query('SELECT seat_id FROM seat WHERE bus_id=? LIMIT 5', [t.bus_id]);
        if (seats.length < 1) continue;
        const [[{ cnt }]] = await db.query(
            `SELECT COUNT(*) AS cnt FROM trip_seat_hold WHERE trip_id=? AND seat_id=?`,
            [t.trip_id, seats[0].seat_id]
        );
        if (cnt === 0) return { trip_id: t.trip_id, seat_id: seats[0].seat_id };
    }
    return null;
}

async function post(path, body, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, json };
}

async function put(path, body, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${BASE}${path}`, { method: 'PUT', headers, body: JSON.stringify(body) });
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, json };
}

/** Registers a disposable test user and logs in, returning {user_id, token}.
 *  Cancelling a booking requires an authenticated owner/admin (PUT /:id has
 *  `authenticate` middleware) — a guest booking has no login at all, so
 *  Test B needs a real account, unlike Tests A/C which exercise the
 *  unauthenticated guest-booking path on purpose. */
async function makeDisposableUser() {
    const stamp = Date.now();
    const email = `phase1concurrency_${stamp}@test.local`;
    const username = `phase1cc_${stamp}`;
    const password = 'TestPass123!';
    const reg = await post('/auth/register', { username, full_name: 'Phase1 Concurrency Test', email, password, phone: '0900000099' });
    if (reg.status >= 400) throw new Error('register failed: ' + JSON.stringify(reg.json));
    const login = await post('/auth/login', { email, password });
    if (login.status >= 400) throw new Error('login failed: ' + JSON.stringify(login.json));
    return { user_id: login.json.user.user_id, token: login.json.accessToken, email };
}

async function cleanupUser(userId) {
    if (!userId) return;
    try { await db.query('DELETE FROM users WHERE user_id=?', [userId]); } catch (e) { console.warn('user cleanup failed (non-fatal):', e.message); }
}

async function cleanup() {
    if (!createdBookingIds.length) return;
    const conn = await db.getConnection();
    try {
        await conn.query(`DELETE FROM trip_seat_hold WHERE booking_id IN (?)`, [createdBookingIds]);
        await conn.query(`DELETE FROM payment WHERE booking_id IN (?)`, [createdBookingIds]);
        await conn.query(`DELETE FROM booking_detail WHERE booking_id IN (?)`, [createdBookingIds]);
        await conn.query(`DELETE FROM booking WHERE booking_id IN (?)`, [createdBookingIds]);
    } finally {
        conn.release();
    }
}

async function main() {
    const results = { testA_concurrentSameSeat: null, testB_concurrentCancel: null, testC_doubleClick: null, testD_paymentRetry: null };

    // ── TEST A: 2 users booking the same seat concurrently ──
    const target = await findTestTrip();
    if (!target) {
        results.testA_concurrentSameSeat = { skipped: true, reason: 'no suitable free trip/seat found' };
    } else {
        const { trip_id, seat_id } = target;
        const [r1, r2] = await Promise.all([
            post('/bookings', { user_id: null, trip_id, seats: [seat_id], status: 'PENDING', guest_name: 'Race A', guest_phone: '0900000001' }),
            post('/bookings', { user_id: null, trip_id, seats: [seat_id], status: 'PENDING', guest_name: 'Race B', guest_phone: '0900000002' }),
        ]);
        [r1, r2].forEach(r => { if (r.json && r.json.booking_id) createdBookingIds.push(r.json.booking_id); });

        const succeeded = [r1, r2].filter(r => r.status === 201);
        const rejected = [r1, r2].filter(r => r.status === 400 || r.status === 409);

        // Ground truth: query the DB directly, not just trust the HTTP responses.
        const [holdRows] = await db.query('SELECT booking_id FROM trip_seat_hold WHERE trip_id=? AND seat_id=?', [trip_id, seat_id]);
        const [activeBookingDetailRows] = await db.query(
            `SELECT bd.booking_id FROM booking_detail bd JOIN booking b ON bd.booking_id=b.booking_id
             WHERE b.trip_id=? AND bd.seat_id=? AND b.status IN ('PENDING','PAID')`,
            [trip_id, seat_id]
        );

        results.testA_concurrentSameSeat = {
            trip_id, seat_id,
            responses: [r1.status, r2.status],
            succeededCount: succeeded.length,
            rejectedCount: rejected.length,
            dbHoldRowCount: holdRows.length,
            dbActiveBookingDetailRowCount: activeBookingDetailRows.length,
            PASS: succeeded.length === 1 && rejected.length === 1 && holdRows.length === 1 && activeBookingDetailRows.length === 1,
        };
    }

    // ── TEST B: 2 concurrent cancel requests for the same booking ──
    // Needs a real authenticated owner (PUT /bookings/:id requires login) —
    // uses its own disposable user + booking, independent of Test A/C's
    // guest bookings.
    let disposableUserId = null;
    const target3 = await findTestTrip();
    if (!target3) {
        results.testB_concurrentCancel = { skipped: true, reason: 'no suitable free trip/seat found' };
    } else {
        const { user_id, token } = await makeDisposableUser();
        disposableUserId = user_id;
        const created = await post('/bookings', { user_id, trip_id: target3.trip_id, seats: [target3.seat_id], status: 'PENDING' });
        if (created.status !== 201) {
            results.testB_concurrentCancel = { skipped: true, reason: 'setup booking failed: ' + JSON.stringify(created.json) };
        } else {
            const bookingId = created.json.booking_id;
            createdBookingIds.push(bookingId);
            const [c1, c2] = await Promise.all([
                put(`/bookings/${bookingId}`, { status: 'CANCELED' }, token),
                put(`/bookings/${bookingId}`, { status: 'CANCELED' }, token),
            ]);
            const [[finalRow]] = await db.query('SELECT status FROM booking WHERE booking_id=?', [bookingId]);
            const [holdAfter] = await db.query('SELECT * FROM trip_seat_hold WHERE booking_id=?', [bookingId]);
            results.testB_concurrentCancel = {
                bookingId,
                responses: [c1.status, c2.status],
                finalStatus: finalRow ? finalRow.status : null,
                holdRowsRemaining: holdAfter.length,
                // Idempotency: both requests are safe to run concurrently,
                // end state is deterministic (CANCELED) and holds are fully
                // released — regardless of which of the two "wins".
                PASS: finalRow && finalRow.status === 'CANCELED' && holdAfter.length === 0
                    && [c1.status, c2.status].every(s => s === 200),
            };
        }
    }

    // ── TEST D: payment confirmation retry — 2 concurrent pay requests for the same PENDING booking ──
    let disposableUserId2 = null;
    const target4 = await findTestTrip();
    if (!target4) {
        results.testD_paymentRetry = { skipped: true, reason: 'no suitable free trip/seat found' };
    } else {
        const { user_id, token } = await makeDisposableUser();
        disposableUserId2 = user_id;
        const created = await post('/bookings', { user_id, trip_id: target4.trip_id, seats: [target4.seat_id], status: 'PENDING' });
        if (created.status !== 201) {
            results.testD_paymentRetry = { skipped: true, reason: 'setup booking failed: ' + JSON.stringify(created.json) };
        } else {
            const bookingId = created.json.booking_id;
            createdBookingIds.push(bookingId);
            const [p1, p2] = await Promise.all([
                post(`/bookings/${bookingId}/pay`, { method: 'BANK' }, token),
                post(`/bookings/${bookingId}/pay`, { method: 'BANK' }, token),
            ]);
            const [[finalBooking]] = await db.query('SELECT status FROM booking WHERE booking_id=?', [bookingId]);
            const [paymentRows] = await db.query('SELECT payment_id, status FROM payment WHERE booking_id=?', [bookingId]);
            const succeeded = [p1, p2].filter(r => r.status === 200);
            results.testD_paymentRetry = {
                bookingId,
                responses: [p1.status, p2.status],
                finalStatus: finalBooking ? finalBooking.status : null,
                paymentRowCount: paymentRows.length,
                // Exactly one of the two concurrent pay attempts may
                // succeed; the retry must be rejected (409, per the atomic
                // WHERE status='PENDING' guard), never silently insert a
                // second payment row for the same booking.
                PASS: succeeded.length === 1 && finalBooking && finalBooking.status === 'PAID' && paymentRows.length === 1,
            };
        }
    }

    // ── TEST C: double-click booking (fire the identical request twice, near-simultaneously) ──
    const target2 = await findTestTrip();
    if (!target2) {
        results.testC_doubleClick = { skipped: true, reason: 'no suitable free trip/seat found' };
    } else {
        const { trip_id, seat_id } = target2;
        const body = { user_id: null, trip_id, seats: [seat_id], status: 'PENDING', guest_name: 'DoubleClick', guest_phone: '0900000003' };
        const [d1, d2] = await Promise.all([post('/bookings', body), post('/bookings', body)]);
        [d1, d2].forEach(r => { if (r.json && r.json.booking_id) createdBookingIds.push(r.json.booking_id); });
        const succeeded = [d1, d2].filter(r => r.status === 201);
        const [holdRows2] = await db.query('SELECT booking_id FROM trip_seat_hold WHERE trip_id=? AND seat_id=?', [trip_id, seat_id]);
        results.testC_doubleClick = {
            trip_id, seat_id,
            responses: [d1.status, d2.status],
            succeededCount: succeeded.length,
            dbHoldRowCount: holdRows2.length,
            PASS: succeeded.length === 1 && holdRows2.length === 1,
        };
    }

    console.log(JSON.stringify(results, null, 2));

    const allPass = Object.values(results).every(r => r.skipped || r.PASS);
    console.log(allPass ? '\n✅ ALL CONCURRENCY CHECKS PASSED' : '\n❌ SOME CONCURRENCY CHECKS FAILED');

    await cleanup();
    await cleanupUser(disposableUserId);
    await cleanupUser(disposableUserId2);
    const userCount = [disposableUserId, disposableUserId2].filter(Boolean).length;
    console.log(`🧹 Cleaned up ${createdBookingIds.length} test booking(s): [${createdBookingIds.join(', ')}]${userCount ? ` + ${userCount} disposable user(s)` : ''}`);

    process.exit(allPass ? 0 : 1);
}

main().catch(async (e) => {
    console.error('FATAL:', e);
    await cleanup().catch(() => {});
    process.exit(1);
});
