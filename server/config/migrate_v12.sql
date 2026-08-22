-- migrate_v12.sql
-- Sprint 5 — Database Optimization & Query Performance.
--
-- Audited every SQL statement in tripController.js, bookingController.js,
-- bookingConcierge.js, and transitRouter.js against the real schema and
-- real data (13,401 trip rows, 1,095 routes, 102 bookings at audit time),
-- using EXPLAIN and a rollback-safe synthetic-load test (90,000 extra trip
-- rows inserted inside an uncommitted transaction, distributed across the
-- real 1,095 routes to match the existing ~12-trips-per-route density,
-- then rolled back) to prove behavior at >100,000 total trip rows without
-- polluting real data. Only indexes with a real, measured query pattern
-- behind them are added here — route.status, for example, is never
-- filtered by any of the four audited files, so no index was added for it.
--
-- 1) booking(status, booking_time) — server/services/bookingCleanup.js's
--    cancelAbandonedBookings() runs every 5 minutes:
--      WHERE status = 'PENDING' AND booking_time < NOW() - INTERVAL ? MINUTE
--    `booking` had no index touching either column — EXPLAIN showed
--    type=ALL over all 102 rows. After this index: type=range over
--    idx_booking_status_time, ~1 row examined. At 100,000+ bookings this
--    is the difference between a full-table scan every 5 minutes and an
--    indexed range scan touching only the (small) PENDING subset.
--
-- 2) trip(route_id, departure_time) — replaces the old single-column
--    `route_id` index (auto-created to support the trip_ibfk_2 FOREIGN KEY
--    to route.route_id). tripController.runTripSearch /
--    server/ai/bookingConcierge.js (same code path, Sprint 4) and
--    transitRouter.loadAvailableTrips all join trip to route and then
--    filter trip.departure_time — this composite index lets that filter
--    apply as part of the index range scan instead of a post-join row
--    check. Confirmed via EXPLAIN that InnoDB automatically retires the
--    old single-column route_id index in favor of this one (it still
--    satisfies the FK's indexing requirement as its leading column) — no
--    redundant index left behind, zero extra write-side maintenance cost.
--
--    Live-measured, real search queries (tripController.runTripSearch's
--    exact SQL shape) at 103,401 total trip rows (90,000 synthetic rows
--    added inside a transaction, rolled back after measuring — see
--    SPRINT5_FINAL_REPORT.md for the full methodology and numbers):
--      Hà Nội → Đà Nẵng:        13 ms  (target: <50ms)
--      Hà Nội → Hồ Chí Minh:     8 ms
--      Sơn La → Nam Định:        5 ms
--    All three comfortably clear the sprint's <50ms target at >100,000
--    rows. NOT claimed: transitRouter.js's own broad candidate-fetch query
--    (up to 8,000 rows, feeding its BFS) is a different, deliberately
--    wide query — it measured ~1.76s at this same 103,401-row scale, which
--    is consistent with (not a regression from) Sprint 3's already-tested
--    and reported ~1.5s end-to-end transit-search budget; it is not the
--    (origin, destination, departure_time, status) point-search pattern
--    this migration targets, and no index changes that pattern's
--    fundamental cost (it deliberately reads a wide time window).

ALTER TABLE booking
  ADD INDEX idx_booking_status_time (status, booking_time);

ALTER TABLE trip
  ADD INDEX idx_trip_route_departure (route_id, departure_time);
