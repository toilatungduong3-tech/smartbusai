'use strict';
/**
 * Phase 2I Final pass — cleanup of all disposable test data. FK-safe order,
 * before/after row-count verification. Protected historical records
 * (trips 4/12/15, booking 37, backup tables, the 5 historical
 * duplicate-seat pairs, user 45's null-field record, users 46/47/48's
 * operator_id links) are never touched.
 */
const db = require('../server/config/db');

const BUS_IDS = [61];
const OPERATOR_IDS = [14];
const USER_IDS = [70, 71, 72];

async function scalar(sql) { const [r] = await db.query(sql); return r[0].c; }
async function exec(sql) { const [r] = await db.query(sql); return r.affectedRows; }

(async () => {
    const bids = BUS_IDS.join(',');
    const oids = OPERATOR_IDS.join(',');
    const uids = USER_IDS.join(',');
    const report = { before: {}, deleted: {}, after: {} };

    report.before.bus = await scalar(`SELECT COUNT(*) c FROM bus WHERE bus_id IN (${bids})`);
    report.before.bus_operator = await scalar(`SELECT COUNT(*) c FROM bus_operator WHERE operator_id IN (${oids})`);
    report.before.users = await scalar(`SELECT COUNT(*) c FROM users WHERE user_id IN (${uids})`);

    const protectedBefore = (await db.query(
        `SELECT (SELECT COUNT(*) FROM trip WHERE trip_id IN (4,12,15)) AS trips,
                (SELECT COUNT(*) FROM booking WHERE booking_id=37) AS booking37,
                (SELECT COUNT(*) FROM trip_orphan_cleanup_backup_20260815) AS backup1,
                (SELECT COUNT(*) FROM trip_status_recovery_backup_20260815) AS backup2,
                (SELECT operator_id FROM users WHERE user_id=46) AS user46_op,
                (SELECT operator_id FROM users WHERE user_id=47) AS user47_op,
                (SELECT operator_id FROM users WHERE user_id=48) AS user48_op,
                (SELECT full_name FROM users WHERE user_id=45) AS user45_fullname,
                (SELECT COUNT(*) FROM booking_detail bd JOIN booking bk ON bd.booking_id=bk.booking_id
                   WHERE bk.status IN ('PENDING','PAID','CONFIRMED') AND (bd.seat_id,bk.trip_id) IN
                   ((3,30),(122,41),(147,35),(148,35),(290,26))) AS duplicateSeatPairRows`
    ))[0][0];
    report.protectedBefore = protectedBefore;

    report.deleted.bus = await exec(`DELETE FROM bus WHERE bus_id IN (${bids})`);
    report.deleted.bus_operator = await exec(`DELETE FROM bus_operator WHERE operator_id IN (${oids})`);
    report.deleted.users = await exec(`DELETE FROM users WHERE user_id IN (${uids})`);

    report.after.bus = await scalar(`SELECT COUNT(*) c FROM bus WHERE bus_id IN (${bids})`);
    report.after.bus_operator = await scalar(`SELECT COUNT(*) c FROM bus_operator WHERE operator_id IN (${oids})`);
    report.after.users = await scalar(`SELECT COUNT(*) c FROM users WHERE user_id IN (${uids})`);

    const protectedAfter = (await db.query(
        `SELECT (SELECT COUNT(*) FROM trip WHERE trip_id IN (4,12,15)) AS trips,
                (SELECT COUNT(*) FROM booking WHERE booking_id=37) AS booking37,
                (SELECT COUNT(*) FROM trip_orphan_cleanup_backup_20260815) AS backup1,
                (SELECT COUNT(*) FROM trip_status_recovery_backup_20260815) AS backup2,
                (SELECT operator_id FROM users WHERE user_id=46) AS user46_op,
                (SELECT operator_id FROM users WHERE user_id=47) AS user47_op,
                (SELECT operator_id FROM users WHERE user_id=48) AS user48_op,
                (SELECT full_name FROM users WHERE user_id=45) AS user45_fullname,
                (SELECT COUNT(*) FROM booking_detail bd JOIN booking bk ON bd.booking_id=bk.booking_id
                   WHERE bk.status IN ('PENDING','PAID','CONFIRMED') AND (bd.seat_id,bk.trip_id) IN
                   ((3,30),(122,41),(147,35),(148,35),(290,26))) AS duplicateSeatPairRows`
    ))[0][0];
    report.protectedAfter = protectedAfter;

    report.allZeroAfter = Object.values(report.after).every(v => v === 0);
    report.protectedUnchanged = JSON.stringify(protectedBefore) === JSON.stringify(protectedAfter);

    console.log(JSON.stringify(report, null, 2));
    console.log('\nallZeroAfter:', report.allZeroAfter, '| protectedUnchanged:', report.protectedUnchanged);
    process.exit(0);
})().catch(e => { console.error('CLEANUP ERROR:', e); process.exit(1); });
