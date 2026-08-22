'use strict';
/**
 * Phase 2I — Step 3: immutable baseline snapshot.
 * Read-only. Captures DB metrics BEFORE any runtime testing so the
 * post-test snapshot can be diffed against it. Run again with
 * `node tests/phase2i_step3_baseline.js after` to capture the AFTER
 * snapshot into a separate file for comparison.
 */
const fs = require('fs');
const path = require('path');
const db = require('../server/config/db');

const label = process.argv[2] === 'after' ? 'after' : 'before';
const outFile = path.join(__dirname, `phase2i_step3_baseline_${label}.json`);

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
        search_logs:           (await scalar('SELECT COUNT(*) c FROM search_log')).c,
    };

    snapshot.bookingStatusDistribution = await rows(
        'SELECT status, COUNT(*) c FROM booking GROUP BY status ORDER BY status'
    );
    snapshot.paymentStatusDistribution = await rows(
        'SELECT status, method, COUNT(*) c FROM payment GROUP BY status, method ORDER BY status, method'
    );
    snapshot.tripStatusDistribution = await rows(
        'SELECT status, COUNT(*) c FROM trip GROUP BY status ORDER BY status'
    );

    snapshot.maxIds = {
        max_user_id:    (await scalar('SELECT MAX(user_id) m FROM users')).m,
        max_trip_id:    (await scalar('SELECT MAX(trip_id) m FROM trip')).m,
        max_booking_id: (await scalar('SELECT MAX(booking_id) m FROM booking')).m,
        max_payment_id: (await scalar('SELECT MAX(payment_id) m FROM payment')).m,
        max_review_id:  (await scalar('SELECT MAX(review_id) m FROM review')).m,
        max_loyalty_tx_id: (await scalar('SELECT MAX(id) m FROM loyalty_transactions')).m,
        max_support_id: (await scalar('SELECT MAX(request_id) m FROM support_request')).m,
        max_reset_token_id: (await scalar('SELECT MAX(id) m FROM password_reset_tokens')).m,
    };

    snapshot.loyaltyPointsTotal = (await scalar('SELECT COALESCE(SUM(loyalty_points),0) s FROM users')).s;
    snapshot.loyaltyTransactionPointsSum = await rows(
        "SELECT type, COUNT(*) c, SUM(points) points_sum FROM loyalty_transactions GROUP BY type ORDER BY type"
    );

    // Protected historical rows from earlier phases — must remain byte-identical.
    snapshot.protectedTrips = await rows(
        'SELECT trip_id, bus_id, route_id, departure_time, arrival_time, base_price, status FROM trip WHERE trip_id IN (4,12,15) ORDER BY trip_id'
    );
    snapshot.protectedBooking37 = await rows('SELECT * FROM booking WHERE booking_id=37');
    snapshot.protectedPayment37 = await rows('SELECT * FROM payment WHERE payment_id=37');
    snapshot.protectedReview36  = await rows('SELECT * FROM review WHERE review_id=36');

    snapshot.backupTables = {
        trip_orphan_cleanup_backup_20260815:
            (await scalar('SELECT COUNT(*) c FROM trip_orphan_cleanup_backup_20260815')).c,
        trip_status_recovery_backup_20260815:
            (await scalar('SELECT COUNT(*) c FROM trip_status_recovery_backup_20260815')).c,
    };

    snapshot.passwordResetTokens = {
        schemaExists: true,
        rows: await rows('SELECT id, user_id, expires_at, used_at, created_at FROM password_reset_tokens ORDER BY id'),
    };

    snapshot.duplicateBookingCodes = await rows(
        'SELECT booking_code, COUNT(*) c FROM booking WHERE booking_code IS NOT NULL GROUP BY booking_code HAVING c > 1'
    );

    const [indexRows] = await db.query(
        `SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME, NON_UNIQUE
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME IN ('booking','payment','users','password_reset_tokens','seat','review')
         ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`
    );
    snapshot.indexes = indexRows;

    const [fkRows] = await db.query(
        `SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
         FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
         ORDER BY TABLE_NAME, COLUMN_NAME`
    );
    snapshot.foreignKeys = fkRows;

    const [triggerRows] = await db.query(
        `SELECT TRIGGER_NAME, EVENT_MANIPULATION, EVENT_OBJECT_TABLE
         FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()`
    );
    snapshot.triggers = triggerRows;

    fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2));
    console.log(`Baseline (${label}) written to ${outFile}`);
    console.log(JSON.stringify(snapshot.counts, null, 2));
    console.log('bookingStatusDistribution:', snapshot.bookingStatusDistribution);
    console.log('paymentStatusDistribution:', snapshot.paymentStatusDistribution);
    console.log('protectedTrips found:', snapshot.protectedTrips.length, '(expect 3)');
    console.log('backupTables:', snapshot.backupTables);
    console.log('duplicateBookingCodes:', snapshot.duplicateBookingCodes);
    console.log('foreignKeys count:', snapshot.foreignKeys.length);
    console.log('triggers count:', snapshot.triggers.length);

    process.exit(0);
})().catch(err => {
    console.error('BASELINE SCRIPT ERROR:', err);
    process.exit(1);
});
