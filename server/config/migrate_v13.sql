-- migrate_v13.sql
-- Sprint 6 — Data Integrity, Route Map & Seat Map Mastery.
--
-- route_stop had no way to express "how far into the trip is this stop"
-- (in minutes from departure) — needed for the 100% route_stop coverage
-- backfill (server/config/generate_route_stops.js) to honestly label each
-- generated stop's expected timing rather than leaving it unstated.
-- Nullable/additive: existing rows are unaffected, and any code reading
-- route_stop via `SELECT *` (routeStopController.js) picks it up for free.

ALTER TABLE route_stop
  ADD COLUMN estimated_min_from_origin INT NULL
    COMMENT 'Estimated minutes from trip departure this stop is reached — NULL where not computed (legacy rows).';
