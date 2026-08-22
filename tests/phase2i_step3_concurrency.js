'use strict';
/**
 * Phase 2I Step 3C — REAL concurrency tests against the live server + DB.
 * Uses Promise.all to fire genuinely simultaneous requests, not sequential
 * calls. All test data is disposable and tracked for cleanup.
 */
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:2704/api';
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'phase2i_step3_testdata.json'), 'utf8'));
const { userA, userB } = data;
const createdBookingIds = [];

async function call(method, p, token, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, body: json };
}

async function sql(q) {
    const db = require('../server/config/db');
    const [rows] = await db.query(q);
    return rows;
}

(async () => {
    const report = {};

    // ── A. DOUBLE PAYMENT RACE ──
    const bkA = await call('POST', '/bookings', userA.token, { user_id: userA.user.user_id, trip_id: 38, seats: [257], status: 'PENDING' });
    createdBookingIds.push(bkA.body.booking_id);
    const N = 8;
    const paymentResults = await Promise.all(
        Array.from({ length: N }, () => call('POST', `/bookings/${bkA.body.booking_id}/pay`, userA.token, { method: 'BANK' }))
    );
    const successCount = paymentResults.filter(r => r.status === 200).length;
    const paymentRows = await sql(`SELECT payment_id, status, amount FROM payment WHERE booking_id=${bkA.body.booking_id}`);
    const bookingRow = await sql(`SELECT status FROM booking WHERE booking_id=${bkA.body.booking_id}`);
    report.doublePaymentRace = {
        requestsSent: N,
        successCount,
        statusCodes: paymentResults.map(r => r.status),
        paymentRowCount: paymentRows.length,
        paymentRows,
        finalBookingStatus: bookingRow[0].status,
        PASS: successCount === 1 && paymentRows.length === 1 && bookingRow[0].status === 'PAID',
    };

    // ── B. SEAT RACE — two different users racing for the SAME seat ──
    const seatId = 258;
    const seatRaceResults = await Promise.all([
        call('POST', '/bookings', userA.token, { user_id: userA.user.user_id, trip_id: 38, seats: [seatId], status: 'PENDING' }),
        call('POST', '/bookings', userB.token, { user_id: userB.user.user_id, trip_id: 38, seats: [seatId], status: 'PENDING' }),
        call('POST', '/bookings', userA.token, { user_id: userA.user.user_id, trip_id: 38, seats: [seatId], status: 'PENDING' }),
        call('POST', '/bookings', userB.token, { user_id: userB.user.user_id, trip_id: 38, seats: [seatId], status: 'PENDING' }),
    ]);
    const seatSuccesses = seatRaceResults.filter(r => r.status === 201);
    seatSuccesses.forEach(r => createdBookingIds.push(r.body.booking_id));
    const seatBookings = await sql(
        `SELECT bk.booking_id, bk.status, bd.seat_id FROM booking_detail bd JOIN booking bk ON bd.booking_id=bk.booking_id WHERE bd.seat_id=${seatId} AND bk.status IN ('PENDING','PAID','CONFIRMED')`
    );
    report.seatRace = {
        requestsSent: seatRaceResults.length,
        successCount: seatSuccesses.length,
        statusCodes: seatRaceResults.map(r => r.status),
        activeSeatAssignments: seatBookings.length,
        seatBookings,
        PASS: seatSuccesses.length === 1 && seatBookings.length === 1,
    };

    // ── C. LOYALTY REDEEM RACE ──
    // Give userA enough points via a real paid booking (awardPoints runs post-commit).
    const bkForPoints = await call('POST', '/bookings', userA.token, { user_id: userA.user.user_id, trip_id: 38, seats: [259], status: 'PENDING' });
    createdBookingIds.push(bkForPoints.body.booking_id);
    await call('POST', `/bookings/${bkForPoints.body.booking_id}/pay`, userA.token, { method: 'BANK' });
    await new Promise(r => setTimeout(r, 500)); // let post-commit awardPoints settle
    const beforePts = await sql(`SELECT loyalty_points FROM users WHERE user_id=${userA.user.user_id}`);
    const pointsAvailable = beforePts[0].loyalty_points;
    const redeemAmount = Math.max(10, Math.floor(pointsAvailable / 2)); // each redemption asks for slightly more than half
    const redeemResults = await Promise.all(
        Array.from({ length: 4 }, () => call('POST', `/users/${userA.user.user_id}/redeem-points`, userA.token, { points: redeemAmount }))
    );
    const redeemSuccesses = redeemResults.filter(r => r.status === 200);
    const afterPts = await sql(`SELECT loyalty_points FROM users WHERE user_id=${userA.user.user_id}`);
    const redeemTxRows = await sql(`SELECT id, type, points, balance_after FROM loyalty_transactions WHERE user_id=${userA.user.user_id} AND type='REDEEM' ORDER BY id`);
    report.loyaltyRedeemRace = {
        pointsAvailable,
        redeemAmountPerRequest: redeemAmount,
        requestsSent: redeemResults.length,
        successCount: redeemSuccesses.length,
        statusCodes: redeemResults.map(r => r.status),
        pointsBefore: pointsAvailable,
        pointsAfter: afterPts[0].loyalty_points,
        expectedAfter: pointsAvailable - redeemSuccesses.length * redeemAmount,
        neverNegative: afterPts[0].loyalty_points >= 0,
        redeemTxCount: redeemTxRows.length,
        PASS: afterPts[0].loyalty_points >= 0
            && afterPts[0].loyalty_points === pointsAvailable - redeemSuccesses.length * redeemAmount
            && redeemTxRows.length === redeemSuccesses.length
            && redeemSuccesses.length <= Math.floor(pointsAvailable / redeemAmount),
    };

    // ── D. LOYALTY AWARD RACE — two concurrent paid bookings for the same user ──
    const bk1 = await call('POST', '/bookings', userB.token, { user_id: userB.user.user_id, trip_id: 38, seats: [260], status: 'PENDING' });
    const bk2 = await call('POST', '/bookings', userB.token, { user_id: userB.user.user_id, trip_id: 38, seats: [261], status: 'PENDING' });
    createdBookingIds.push(bk1.body.booking_id, bk2.body.booking_id);
    const beforeAward = await sql(`SELECT loyalty_points FROM users WHERE user_id=${userB.user.user_id}`);
    const awardResults = await Promise.all([
        call('POST', `/bookings/${bk1.body.booking_id}/pay`, userB.token, { method: 'BANK' }),
        call('POST', `/bookings/${bk2.body.booking_id}/pay`, userB.token, { method: 'BANK' }),
    ]);
    await new Promise(r => setTimeout(r, 800)); // let both post-commit awardPoints settle
    const afterAward = await sql(`SELECT loyalty_points FROM users WHERE user_id=${userB.user.user_id}`);
    const earnTxRows = await sql(`SELECT id, points FROM loyalty_transactions WHERE user_id=${userB.user.user_id} AND type='EARN' ORDER BY id`);
    const sumEarned = earnTxRows.reduce((s, r) => s + r.points, 0);
    report.loyaltyAwardRace = {
        awardStatusCodes: awardResults.map(r => r.status),
        pointsBefore: beforeAward[0].loyalty_points,
        pointsAfter: afterAward[0].loyalty_points,
        earnTransactions: earnTxRows,
        sumOfEarnTransactions: sumEarned,
        expectedAfter: beforeAward[0].loyalty_points + sumEarned,
        PASS: afterAward[0].loyalty_points === beforeAward[0].loyalty_points + sumEarned,
    };

    console.log(JSON.stringify(report, null, 2));
    console.log('\n=== SUMMARY ===');
    for (const [k, v] of Object.entries(report)) console.log(`${k}: ${v.PASS ? 'PASS' : 'FAIL'}`);

    fs.writeFileSync(path.join(__dirname, 'phase2i_step3_concurrency_bookings.json'), JSON.stringify(createdBookingIds));
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
