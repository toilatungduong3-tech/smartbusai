-- migrate_v10.sql
-- Phase 2 hardening — Section 6 (search performance).
--
-- trip has no index on status/departure_time despite being the single
-- most-queried table in the schema — tripController.getTrips (the
-- endpoint the passenger homepage's loadAllTrips() hits on every visit)
-- and searchTrips both filter/order on these columns, forcing a full
-- table scan. Live-measured before this fix: EXPLAIN showed type=ALL over
-- 13,160 rows; GET /api/trips took 1.3s and returned a 4.1MB payload for
-- 7,977 rows on the current (grown-since-Phase-1) dataset.
--
-- This is a purely additive, zero-risk index — no API contract change, no
-- data change, no application code change required to benefit from it.
-- Does NOT address the separate, larger architectural question (should
-- /api/trips be paginated server-side instead of returning everything) —
-- that would be a real frontend/backend contract change and is
-- deliberately NOT done here per this phase's explicit instruction not to
-- make large architecture changes without proven necessity beyond what an
-- index alone can address.

ALTER TABLE trip
  ADD INDEX idx_trip_status_departure (status, departure_time);
