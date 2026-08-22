'use strict';
/**
 * Phase 2I — Step 4: immutable baseline snapshot, captured before any
 * Step 4 source modifications. Read-only. The DB state here is treated as
 * authoritative for this session (per Step 3's closing principle) — it
 * includes one legitimate real booking (booking_id 110, user_id 1,
 * trip_id 14747) created between the Step 3 and Step 4 sessions, verified
 * to reference a real OPEN trip and to match that account's existing
 * booking-history pattern; not corruption, not modified here.
 */
const fs = require('fs');
const path = require('path');
const db = require('../server/config/db');

const label = process.argv[2] === 'after' ? 'after' : 'before';
const outFile = path.join(__dirname, `phase2i_step4_baseline_${label}.json`);

async function scalar(sql) {
    const [rows] = await db.query(sql);
    return rows[0];
}
async function rows(sql) {
    const [r] = await db.query(sql);
    return r;
}

(async () => {
    const snapshot = { capturedAt: new Date().toISOString(), label };

    snapshot.counts = {
        users:                (await scalar('SELECT COUNT(*) c FROM users')).c,
        trips:                (await scalar('SELECT COUNT(*) c FROM trip')).c,
        routes:               (await scalar('SELECT COUNT(*) c FROM route')).c,
        bookings:             (await scalar('SELECT COUNT(*) c FROM booking')).c,
        payments:             (await scalar('SELECT COUNT(*) c FROM payment')).c,
        reviews:               (await scalar('SELECT COUNT(*) c FROM review')).c,
        operator_reviews:      (await scalar('SELECT COUNT(*) c FROM operator_review')).c,
        loyalty_transactions:  (await scalar('SELECT COUNT(*) c FROM loyalty_transactions')).c,
        support_requests:      (await scalar('SELECT COUNT(*) c FROM support_request')).c,
        password_reset_tokens: (await scalar('SELECT COUNT(*) c FROM password_reset_tokens')).c,
        seats:                 (await scalar('SELECT COUNT(*) c FROM seat')).c,
        buses:                 (await scalar('SELECT COUNT(*) c FROM bus')).c,
        operators:             (await scalar('SELECT COUNT(*) c FROM bus_operator')).c,
    };

    snapshot.bookingStatusDistribution = await rows('SELECT status, COUNT(*) c FROM booking GROUP BY status ORDER BY status');
    snapshot.protectedTrips = await rows('SELECT trip_id, departure_time, arrival_time, status FROM trip WHERE trip_id IN (4,12,15) ORDER BY trip_id');
    snapshot.protectedBooking37 = await rows('SELECT booking_id, status, total_amount FROM booking WHERE booking_id=37');
    snapshot.protectedPayment37 = await rows('SELECT payment_id, status, amount FROM payment WHERE payment_id=37');
    snapshot.protectedReview36  = await rows('SELECT review_id, rating FROM review WHERE review_id=36');
    snapshot.backupTables = {
        trip_orphan_cleanup_backup_20260815:  (await scalar('SELECT COUNT(*) c FROM trip_orphan_cleanup_backup_20260815')).c,
        trip_status_recovery_backup_20260815: (await scalar('SELECT COUNT(*) c FROM trip_status_recovery_backup_20260815')).c,
    };
    snapshot.duplicateSeatPairs = await rows(`
        SELECT bd.seat_id, bk.trip_id, COUNT(*) c
        FROM booking_detail bd JOIN booking bk ON bd.booking_id=bk.booking_id
        WHERE bk.status IN ('PENDING','PAID','CONFIRMED')
        GROUP BY bd.seat_id, bk.trip_id HAVING c>1`);

    fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2));
    console.log(`Baseline (${label}) written to ${outFile}`);
    console.log(JSON.stringify(snapshot.counts, null, 2));
    console.log('bookingStatusDistribution:', snapshot.bookingStatusDistribution);
    console.log('protectedTrips found:', snapshot.protectedTrips.length, '(expect 3)');
    console.log('backupTables:', snapshot.backupTables);
    console.log('duplicateSeatPairs:', snapshot.duplicateSeatPairs);
    process.exit(0);
})().catch(err => { console.error('BASELINE SCRIPT ERROR:', err); process.exit(1); });
