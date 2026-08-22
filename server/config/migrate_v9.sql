-- migrate_v9.sql
-- Phase 1 hardening — DB-level seat-uniqueness backstop
-- (SMARTBUSAI_MASTER_COMPLETION_MATRIX.md blocker #7).
--
-- Previously the ONLY guarantee against double-booking a seat was
-- application-level (SELECT ... FOR UPDATE inside a transaction in
-- bookingController.createBooking) — sound in principle, but with zero
-- database-level backstop. A live audit found 5 seats already
-- double-booked with two simultaneously-active PAID bookings each.
--
-- trip_seat_hold: one row exists per (trip_id, seat_id) for as long as an
-- active (PENDING or PAID) booking holds that seat. PRIMARY KEY(trip_id,
-- seat_id) makes double-booking impossible at the storage engine level,
-- regardless of any future application-code bug. The row is deleted when
-- the owning booking is canceled (see bookingController.js's and
-- adminController.js's updateBookingStatus), freeing the seat again.

CREATE TABLE IF NOT EXISTS trip_seat_hold (
  trip_id     INT NOT NULL,
  seat_id     INT NOT NULL,
  booking_id  INT NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (trip_id, seat_id),
  KEY idx_tsh_booking (booking_id),
  CONSTRAINT fk_tsh_booking FOREIGN KEY (booking_id) REFERENCES booking(booking_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill from currently-active bookings. INSERT IGNORE is deliberate: if
-- two active bookings already conflict on the same (trip_id, seat_id) —
-- confirmed to exist in this exact database — the first one INSERTed wins
-- the hold-table row and the second is silently skipped (not deleted, not
-- un-booked). This migration does NOT retroactively resolve pre-existing
-- double-bookings; deciding which booking is "the real one" is a business
-- decision outside the scope of a schema migration. See
-- PHASE1_BACKEND_TIME_FINAL_REPORT.md for the known, unresolved
-- pre-existing conflicts this does not silently fix.
INSERT IGNORE INTO trip_seat_hold (trip_id, seat_id, booking_id)
SELECT b.trip_id, bd.seat_id, bd.booking_id
FROM booking_detail bd
JOIN booking b ON bd.booking_id = b.booking_id
WHERE b.status IN ('PENDING', 'PAID');
