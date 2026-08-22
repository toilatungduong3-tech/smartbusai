'use strict';
/**
 * Phase 2I Step 3 — cleanup of all disposable test data created during
 * Step 3 runtime/concurrency/forensic testing. Deletes only rows scoped to
 * the test user_ids (55,56,57,58) and test booking_ids (102-109), in FK-safe
 * order, with before/after row-count verification at every step. Protected
 * historical records and backup tables are never touched.
 */
const db = require('../server/config/db');

const TEST_USER_IDS = [55, 56, 57, 58];
const TEST_BOOKING_IDS = [102, 103, 104, 105, 106, 107, 108, 109];

async function scalar(sql, params) {
    const [rows] = await db.query(sql, params);
    return rows[0].c;
}
async function exec(sql, params) {
    const [r] = await db.query(sql, params);
    return r.affectedRows;
}

(async () => {
    const uids = TEST_USER_IDS.join(',');
    const bids = TEST_BOOKING_IDS.join(',');
    const report = {};

    // ── PRE-DELETE COUNTS ──
    report.before = {
        loyalty_transactions: await scalar(`SELECT COUNT(*) c FROM loyalty_transactions WHERE user_id IN (${uids})`),
        payment: await scalar(`SELECT COUNT(*) c FROM payment WHERE booking_id IN (${bids})`),
        booking_detail: await scalar(`SELECT COUNT(*) c FROM booking_detail WHERE booking_id IN (${bids})`),
        booking: await scalar(`SELECT COUNT(*) c FROM booking WHERE booking_id IN (${bids}) OR user_id IN (${uids})`),
        review: await scalar(`SELECT COUNT(*) c FROM review WHERE user_id IN (${uids})`),
        support_request: await scalar(`SELECT COUNT(*) c FROM support_request WHERE user_id IN (${uids})`),
        password_reset_tokens: await scalar(`SELECT COUNT(*) c FROM password_reset_tokens WHERE user_id IN (${uids})`),
        users: await scalar(`SELECT COUNT(*) c FROM users WHERE user_id IN (${uids})`),
    };

    // ── PROTECTED RECORDS SANITY (must be unaffected by any of the deletes below) ──
    const protectedBefore = await db.query(
        `SELECT (SELECT COUNT(*) FROM trip WHERE trip_id IN (4,12,15)) AS trips,
                (SELECT COUNT(*) FROM booking WHERE booking_id=37) AS booking37,
                (SELECT COUNT(*) FROM payment WHERE payment_id=37) AS payment37,
                (SELECT COUNT(*) FROM review WHERE review_id=36) AS review36,
                (SELECT COUNT(*) FROM trip_orphan_cleanup_backup_20260815) AS backup1,
                (SELECT COUNT(*) FROM trip_status_recovery_backup_20260815) AS backup2`
    );
    report.protectedBefore = protectedBefore[0][0];

    // ── DELETE, FK-safe order ──
    report.deleted = {};
    report.deleted.loyalty_transactions = await exec(`DELETE FROM loyalty_transactions WHERE user_id IN (${uids})`);
    report.deleted.payment = await exec(`DELETE FROM payment WHERE booking_id IN (${bids})`);
    report.deleted.booking_detail = await exec(`DELETE FROM booking_detail WHERE booking_id IN (${bids})`);
    report.deleted.booking = await exec(`DELETE FROM booking WHERE booking_id IN (${bids}) OR user_id IN (${uids})`);
    report.deleted.review = await exec(`DELETE FROM review WHERE user_id IN (${uids})`);
    report.deleted.support_request = await exec(`DELETE FROM support_request WHERE user_id IN (${uids})`);
    report.deleted.password_reset_tokens = await exec(`DELETE FROM password_reset_tokens WHERE user_id IN (${uids})`);
    report.deleted.users = await exec(`DELETE FROM users WHERE user_id IN (${uids})`);

    // ── POST-DELETE VERIFICATION ──
    report.after = {
        loyalty_transactions: await scalar(`SELECT COUNT(*) c FROM loyalty_transactions WHERE user_id IN (${uids})`),
        payment: await scalar(`SELECT COUNT(*) c FROM payment WHERE booking_id IN (${bids})`),
        booking_detail: await scalar(`SELECT COUNT(*) c FROM booking_detail WHERE booking_id IN (${bids})`),
        booking: await scalar(`SELECT COUNT(*) c FROM booking WHERE booking_id IN (${bids}) OR user_id IN (${uids})`),
        review: await scalar(`SELECT COUNT(*) c FROM review WHERE user_id IN (${uids})`),
        support_request: await scalar(`SELECT COUNT(*) c FROM support_request WHERE user_id IN (${uids})`),
        password_reset_tokens: await scalar(`SELECT COUNT(*) c FROM password_reset_tokens WHERE user_id IN (${uids})`),
        users: await scalar(`SELECT COUNT(*) c FROM users WHERE user_id IN (${uids})`),
    };

    const protectedAfter = await db.query(
        `SELECT (SELECT COUNT(*) FROM trip WHERE trip_id IN (4,12,15)) AS trips,
                (SELECT COUNT(*) FROM booking WHERE booking_id=37) AS booking37,
                (SELECT COUNT(*) FROM payment WHERE payment_id=37) AS payment37,
                (SELECT COUNT(*) FROM review WHERE review_id=36) AS review36,
                (SELECT COUNT(*) FROM trip_orphan_cleanup_backup_20260815) AS backup1,
                (SELECT COUNT(*) FROM trip_status_recovery_backup_20260815) AS backup2`
    );
    report.protectedAfter = protectedAfter[0][0];

    report.allZeroAfterDelete = Object.values(report.after).every(v => v === 0);
    report.protectedUnchanged = JSON.stringify(report.protectedBefore) === JSON.stringify(report.protectedAfter);

    console.log(JSON.stringify(report, null, 2));
    console.log('\nallZeroAfterDelete:', report.allZeroAfterDelete);
    console.log('protectedUnchanged:', report.protectedUnchanged);
    process.exit(0);
})().catch(e => { console.error('CLEANUP ERROR:', e); process.exit(1); });
