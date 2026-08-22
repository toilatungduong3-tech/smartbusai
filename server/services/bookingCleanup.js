'use strict';
const logger = require('../utils/logger');
/**
 * SmartBusAI — Sprint 3: abandoned-checkout cleanup.
 *
 * A booking left in PENDING status (started checkout, never paid) has no
 * other release path — trip_seat_hold (Phase 1's migrate_v9.sql DB-level
 * seat-uniqueness backstop) only frees a seat when a booking is explicitly
 * CANCELED. Without this job, an abandoned checkout permanently locks that
 * seat out of inventory forever.
 *
 * Auto-cancels any PENDING booking older than ABANDONED_THRESHOLD_MINUTES,
 * releasing its held seat(s) via the same atomic UPDATE+DELETE pattern
 * already used by the manual cancel endpoints (bookingController.js /
 * adminController.js updateBookingStatus).
 */
const db = require('../config/db');

const ABANDONED_THRESHOLD_MINUTES = 15;

async function cancelAbandonedBookings() {
    const [rows] = await db.query(
        `SELECT booking_id FROM booking
         WHERE status = 'PENDING' AND booking_time < NOW() - INTERVAL ? MINUTE`,
        [ABANDONED_THRESHOLD_MINUTES]
    );
    if (!rows.length) return { canceled: 0, skipped: 0 };

    let canceled = 0, skipped = 0;
    for (const { booking_id } of rows) {
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            /* Atomic guard, same pattern as bookingController.payBooking —
               if the booking was paid or already canceled by the user in
               the instant between the SELECT above and this UPDATE,
               affectedRows is 0 and we skip it rather than clobbering a
               real state transition. */
            const [upd] = await conn.query(
                "UPDATE booking SET status='CANCELED' WHERE booking_id=? AND status='PENDING'",
                [booking_id]
            );
            if (upd.affectedRows === 1) {
                await conn.query("DELETE FROM trip_seat_hold WHERE booking_id=?", [booking_id]);
                await conn.commit();
                canceled++;
            } else {
                await conn.rollback();
                skipped++;
            }
        } catch (err) {
            await conn.rollback();
            skipped++;
            logger.error(`[BookingCleanup] Failed to cancel abandoned booking_id=${booking_id}:`, err.message);
        } finally {
            conn.release();
        }
    }
    if (canceled > 0) {
        logger.info(`🧹 [BookingCleanup] Auto-canceled ${canceled} abandoned PENDING booking(s) (>${ABANDONED_THRESHOLD_MINUTES}min old), released their seat holds`);
    }
    return { canceled, skipped };
}

module.exports = { cancelAbandonedBookings, ABANDONED_THRESHOLD_MINUTES };
