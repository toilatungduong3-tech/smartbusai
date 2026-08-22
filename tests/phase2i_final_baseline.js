'use strict';
/**
 * Phase 2I — Final hardening pass: immutable baseline snapshot, read-only,
 * captured before any Final-pass source modifications.
 */
const fs = require('fs');
const path = require('path');
const db = require('../server/config/db');

const label = process.argv[2] === 'after' ? 'after' : 'before';
const outFile = path.join(__dirname, `phase2i_final_baseline_${label}.json`);

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
    snapshot.paymentStatusDistribution = await rows('SELECT status, method, COUNT(*) c FROM payment GROUP BY status, method ORDER BY status, method');

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

    snapshot.duplicateBookingCodes = await rows(
        `SELECT booking_code, COUNT(*) c FROM booking WHERE booking_code IS NOT NULL GROUP BY booking_code HAVING c>1`
    );

    const [fkRows] = await db.query(
        `SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
         FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
         ORDER BY TABLE_NAME, COLUMN_NAME`
    );
    snapshot.foreignKeys = fkRows;

    const [idxRows] = await db.query(
        `SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME, NON_UNIQUE
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME IN ('booking','payment','users','bus_operator','bus','seat','booking_detail','password_reset_tokens')
         ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`
    );
    snapshot.indexes = idxRows;

    const [triggerRows] = await db.query(
        `SELECT TRIGGER_NAME, EVENT_MANIPULATION, EVENT_OBJECT_TABLE FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()`
    );
    snapshot.triggers = triggerRows;

    // Operator identity architecture check — does users.operator_id exist?
    const [userCols] = await db.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users'`
    );
    snapshot.usersColumns = userCols.map(c => c.COLUMN_NAME);
    snapshot.hasOperatorIdColumn = snapshot.usersColumns.includes('operator_id');

    // Email uniqueness check (relevant to the fragile email-match ownership resolution)
    snapshot.duplicateUserEmails = await rows(
        `SELECT email, COUNT(*) c FROM users WHERE email IS NOT NULL GROUP BY email HAVING c>1`
    );
    snapshot.duplicateOperatorEmails = await rows(
        `SELECT email, COUNT(*) c FROM bus_operator WHERE email IS NOT NULL GROUP BY email HAVING c>1`
    );
    snapshot.operatorRoleUsersWithNoMatch = await rows(
        `SELECT u.user_id, u.username, u.email FROM users u
         WHERE u.role='OPERATOR' AND NOT EXISTS (SELECT 1 FROM bus_operator o WHERE o.email=u.email)`
    );

    fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2));
    console.log(`Baseline (${label}) written to ${outFile}`);
    console.log(JSON.stringify(snapshot.counts, null, 2));
    console.log('bookingStatusDistribution:', snapshot.bookingStatusDistribution);
    console.log('protectedTrips found:', snapshot.protectedTrips.length, '(expect 3)');
    console.log('backupTables:', snapshot.backupTables);
    console.log('duplicateSeatPairs:', snapshot.duplicateSeatPairs);
    console.log('duplicateBookingCodes:', snapshot.duplicateBookingCodes);
    console.log('foreignKeys count:', snapshot.foreignKeys.length);
    console.log('triggers count:', snapshot.triggers.length);
    console.log('hasOperatorIdColumn on users:', snapshot.hasOperatorIdColumn);
    console.log('duplicateUserEmails:', snapshot.duplicateUserEmails);
    console.log('duplicateOperatorEmails:', snapshot.duplicateOperatorEmails);
    console.log('operatorRoleUsersWithNoMatch:', snapshot.operatorRoleUsersWithNoMatch);
    process.exit(0);
})().catch(err => { console.error('BASELINE SCRIPT ERROR:', err); process.exit(1); });
