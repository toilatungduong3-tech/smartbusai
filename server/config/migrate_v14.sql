-- migrate_v14.sql
-- Sprint 6 — Dynamic Seat Layout Engine.
--
-- bus had no way to describe its physical seat arrangement (floors, rows,
-- columns, aisle position, special-seat badges) — server/controllers/
-- seatController.js's generateSeats/expandSeats always produced a flat
-- single-floor 4-column (A/B/C/D) grid regardless of bus_type, so a real
-- 2-floor sleeper bus or a spacious 2-across Limousine had no accurate
-- seat map at all. seat_layout_config stores the JSON matrix blueprint
-- (server/services/seatLayoutService.js builds/reads it); the existing
-- `seat` table (bus_id, seat_number, seat_type) is intentionally left
-- unchanged — it stays the simple booking-relevant ledger, generated FROM
-- this blueprint, so no existing booking/seat-map code path needs to
-- change shape.

ALTER TABLE bus
  ADD COLUMN seat_layout_config JSON NULL
    COMMENT 'Sprint 6 — floor/row/column/aisle/special-seat blueprint. NULL = not yet generated, falls back to the legacy flat 4-column layout.';
