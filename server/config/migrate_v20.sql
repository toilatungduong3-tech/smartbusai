-- migrate_v20.sql
-- Sprint 12 — Golden Master Release: DB Indexing Hardening.
--
-- Audited existing indexes first (schema_base.sql + migrate_v2..v19)
-- rather than blindly adding everything the brief listed:
--   - user_behavior(user_id, event_type, created_at) ALREADY EXISTS —
--     added by migrate_v19.sql (idx_user_behavior_profiling) for
--     aiUserProfilingService.js's own 30-day lookback query. Not
--     duplicated here.
--   - trip already has idx_trip_route_departure(route_id, departure_time)
--     (migrate_v12.sql) and idx_trip_status_departure(status,
--     departure_time) (migrate_v10.sql) — this migration ADDS status as
--     a third column to the route+departure index, since
--     tripController.js's runTripSearch filters origin/destination/date
--     THEN typically also excludes CANCELED/COMPLETED trips; the 2-column
--     index already covers the route+time range scan but a query that
--     also filters status still needs a row lookup per candidate without
--     it.
--   - booking has idx_booking_status_time(status, booking_time) but nothing
--     keyed on user_id first — "my bookings" (bookingController.getMyBookings)
--     and aiUserProfilingService's per-user 30-day booking-history query
--     both filter user_id+status+time together and were doing a KEY
--     `user_id` index scan followed by a filesort. Also nothing composite
--     on (trip_id, status) — bookingController's seat-availability and
--     tripController's conflict checks filter both together.

ALTER TABLE booking
  ADD INDEX idx_booking_user_status_time (user_id, status, booking_time),
  ADD INDEX idx_booking_trip_status (trip_id, status);

ALTER TABLE trip
  ADD INDEX idx_trip_route_departure_status (route_id, departure_time, status);
