'use strict';
/**
 * Phase 2I Step 3D — read-only forensic DB integrity audit. No mutations.
 */
const db = require('../server/config/db');

async function q(label, sql) {
    const [rows] = await db.query(sql);
    return { label, count: rows.length, sample: rows.slice(0, 10) };
}

(async () => {
    const checks = await Promise.all([
        q('duplicate booking codes', `SELECT booking_code, COUNT(*) c FROM booking WHERE booking_code IS NOT NULL GROUP BY booking_code HAVING c>1`),
        q('duplicate active seat assignments', `
            SELECT bd.seat_id, bk.trip_id, COUNT(*) c
            FROM booking_detail bd JOIN booking bk ON bd.booking_id=bk.booking_id
            WHERE bk.status IN ('PENDING','PAID','CONFIRMED')
            GROUP BY bd.seat_id, bk.trip_id HAVING c>1`),
        q('bookings referencing nonexistent users', `SELECT booking_id, user_id FROM booking b WHERE user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.user_id=b.user_id)`),
        q('bookings referencing nonexistent trips', `SELECT booking_id, trip_id FROM booking b WHERE trip_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM trip t WHERE t.trip_id=b.trip_id)`),
        q('payments referencing nonexistent bookings', `SELECT payment_id, booking_id FROM payment p WHERE booking_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM booking b WHERE b.booking_id=p.booking_id)`),
        q('reviews referencing nonexistent users', `SELECT review_id, user_id FROM review r WHERE user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.user_id=r.user_id)`),
        q('reviews referencing nonexistent trips', `SELECT review_id, trip_id FROM review r WHERE trip_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM trip t WHERE t.trip_id=r.trip_id)`),
        q('operator_reviews referencing nonexistent users', `SELECT review_id, user_id FROM operator_review r WHERE user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.user_id=r.user_id)`),
        q('operator_reviews referencing nonexistent operators', `SELECT review_id, operator_id FROM operator_review r WHERE operator_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM bus_operator o WHERE o.operator_id=r.operator_id)`),
        q('loyalty_transactions referencing nonexistent users', `SELECT id, user_id FROM loyalty_transactions lt WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.user_id=lt.user_id)`),
        q('support_requests referencing nonexistent users', `SELECT request_id, user_id FROM support_request s WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.user_id=s.user_id)`),
        q('password_reset_tokens referencing nonexistent users', `SELECT id, user_id FROM password_reset_tokens t WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.user_id=t.user_id)`),
        q('orphan buses (nonexistent operator)', `SELECT bus_id, operator_id FROM bus b WHERE operator_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM bus_operator o WHERE o.operator_id=b.operator_id)`),
        q('orphan seats (nonexistent bus)', `SELECT seat_id, bus_id FROM seat s WHERE bus_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM bus b WHERE b.bus_id=s.bus_id)`),
        q('orphan trips (nonexistent route)', `SELECT trip_id, route_id FROM trip t WHERE route_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM route r WHERE r.route_id=t.route_id)`),
        q('orphan trips (nonexistent bus)', `SELECT trip_id, bus_id FROM trip t WHERE bus_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM bus b WHERE b.bus_id=t.bus_id)`),
        q('negative/zero booking totals', `SELECT booking_id, total_amount FROM booking WHERE total_amount <= 0`),
        q('negative payment amounts', `SELECT payment_id, amount FROM payment WHERE amount < 0`),
        q('negative trip prices', `SELECT trip_id, base_price FROM trip WHERE base_price < 0`),
        q('PAID booking with no SUCCESS/COMPLETED payment record', `
            SELECT b.booking_id FROM booking b
            WHERE b.status='PAID' AND NOT EXISTS (
                SELECT 1 FROM payment p WHERE p.booking_id=b.booking_id AND p.status IN ('SUCCESS','COMPLETED')
            )`),
        q('CANCELED booking with a SUCCESS/COMPLETED payment', `
            SELECT b.booking_id FROM booking b
            WHERE b.status='CANCELED' AND EXISTS (
                SELECT 1 FROM payment p WHERE p.booking_id=b.booking_id AND p.status IN ('SUCCESS','COMPLETED')
            )`),
        q('multiple SUCCESS/COMPLETED payments for one booking', `
            SELECT booking_id, COUNT(*) c FROM payment WHERE status IN ('SUCCESS','COMPLETED') GROUP BY booking_id HAVING c>1`),
        q('payment amount != booking total_amount (SUCCESS/COMPLETED only)', `
            SELECT p.payment_id, p.booking_id, p.amount, b.total_amount
            FROM payment p JOIN booking b ON p.booking_id=b.booking_id
            WHERE p.status IN ('SUCCESS','COMPLETED') AND ABS(p.amount - b.total_amount) > 0.01`),
        q('PENDING booking with a SUCCESS/COMPLETED payment (should have flipped to PAID)', `
            SELECT b.booking_id FROM booking b
            WHERE b.status='PENDING' AND EXISTS (
                SELECT 1 FROM payment p WHERE p.booking_id=b.booking_id AND p.status IN ('SUCCESS','COMPLETED')
            )`),
        q('impossible booking status (not in enum)', `SELECT booking_id, status FROM booking WHERE status NOT IN ('PENDING','PAID','CANCELED') OR status IS NULL`),
        q('negative loyalty balances', `SELECT user_id, loyalty_points FROM users WHERE loyalty_points < 0`),
        q('expired unused password_reset_tokens', `SELECT id, user_id, expires_at FROM password_reset_tokens WHERE used_at IS NULL AND expires_at < NOW()`),
        q('duplicate active (unused, unexpired) reset tokens per user', `
            SELECT user_id, COUNT(*) c FROM password_reset_tokens
            WHERE used_at IS NULL AND expires_at > NOW() GROUP BY user_id HAVING c>1`),
        q('backup table row count sanity: orphan-cleanup', `SELECT COUNT(*) c FROM trip_orphan_cleanup_backup_20260815`),
        q('backup table row count sanity: status-recovery', `SELECT COUNT(*) c FROM trip_status_recovery_backup_20260815`),
    ]);

    for (const c of checks) {
        console.log(`\n[${c.count === 0 ? 'CLEAN' : 'FOUND ' + c.count}] ${c.label}`);
        if (c.count > 0) console.log(JSON.stringify(c.sample, null, 2));
    }
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
