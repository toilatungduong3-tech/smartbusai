'use strict';
/**
 * Phase 2I — Full authorization sweep: immutable baseline snapshot,
 * read-only, captured before any source modification in this pass.
 */
const fs = require('fs');
const path = require('path');
const db = require('../server/config/db');

const label = process.argv[2] === 'after' ? 'after' : 'before';
const outFile = path.join(__dirname, `phase2i_full_auth_baseline_${label}.json`);

async function scalar(sql) { const [r] = await db.query(sql); return r[0]; }
async function rows(sql) { const [r] = await db.query(sql); return r; }

(async () => {
    const snapshot = { capturedAt: new Date().toISOString(), label };

    snapshot.counts = {
        users:                 (await scalar('SELECT COUNT(*) c FROM users')).c,
        bus_operators:         (await scalar('SELECT COUNT(*) c FROM bus_operator')).c,
        buses:                 (await scalar('SELECT COUNT(*) c FROM bus')).c,
        seats:                 (await scalar('SELECT COUNT(*) c FROM seat')).c,
        routes:                (await scalar('SELECT COUNT(*) c FROM route')).c,
        trips:                 (await scalar('SELECT COUNT(*) c FROM trip')).c,
        bookings:              (await scalar('SELECT COUNT(*) c FROM booking')).c,
        payments:              (await scalar('SELECT COUNT(*) c FROM payment')).c,
        booking_details:       (await scalar('SELECT COUNT(*) c FROM booking_detail')).c,
        reviews:                (await scalar('SELECT COUNT(*) c FROM review')).c,
        operator_reviews:       (await scalar('SELECT COUNT(*) c FROM operator_review')).c,
        loyalty_transactions:   (await scalar('SELECT COUNT(*) c FROM loyalty_transactions')).c,
        support_requests:       (await scalar('SELECT COUNT(*) c FROM support_request')).c,
        password_reset_tokens:  (await scalar('SELECT COUNT(*) c FROM password_reset_tokens')).c,
    };

    snapshot.bookingStatusDistribution = await rows('SELECT status, COUNT(*) c FROM booking GROUP BY status ORDER BY status');
    snapshot.protectedTrips = await rows('SELECT trip_id, status FROM trip WHERE trip_id IN (4,12,15) ORDER BY trip_id');
    snapshot.protectedBooking37 = await rows('SELECT booking_id, status, total_amount FROM booking WHERE booking_id=37');
    snapshot.backupTables = {
        trip_orphan_cleanup_backup_20260815:  (await scalar('SELECT COUNT(*) c FROM trip_orphan_cleanup_backup_20260815')).c,
        trip_status_recovery_backup_20260815: (await scalar('SELECT COUNT(*) c FROM trip_status_recovery_backup_20260815')).c,
    };
    snapshot.duplicateSeatPairs = await rows(`
        SELECT bd.seat_id, bk.trip_id, COUNT(*) c
        FROM booking_detail bd JOIN booking bk ON bd.booking_id=bk.booking_id
        WHERE bk.status IN ('PENDING','PAID','CONFIRMED')
        GROUP BY bd.seat_id, bk.trip_id HAVING c>1`);

    snapshot.operatorIdentity = await rows(
        `SELECT user_id, email, operator_id FROM users WHERE role='OPERATOR' ORDER BY user_id`
    );

    const [fkRows] = await db.query(
        `SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
         FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
         ORDER BY TABLE_NAME, COLUMN_NAME`
    );
    snapshot.foreignKeys = fkRows;

    fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2));
    console.log(`Baseline (${label}) written to ${outFile}`);
    console.log(JSON.stringify(snapshot.counts, null, 2));
    console.log('bookingStatusDistribution:', snapshot.bookingStatusDistribution);
    console.log('protectedTrips found:', snapshot.protectedTrips.length, '(expect 3)');
    console.log('backupTables:', snapshot.backupTables);
    console.log('duplicateSeatPairs:', snapshot.duplicateSeatPairs);
    console.log('operatorIdentity:', snapshot.operatorIdentity);
    console.log('foreignKeys count:', snapshot.foreignKeys.length);
    process.exit(0);
})().catch(err => { console.error('BASELINE SCRIPT ERROR:', err); process.exit(1); });
