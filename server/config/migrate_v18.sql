-- migrate_v18.sql
-- Sprint 10 — Vietnam Real-World Routing Engine.
--
-- route_stop.stop_type was enum('PICKUP','DROPOFF','BOTH') — a real
-- gap: every existing row represents a boarding/alighting STATION near
-- the trip's origin or destination city (average 2.4 rows/route, zero
-- intermediate rows on every route over 500km — confirmed by live query
-- this sprint). The map polyline (resolveRouteStops() in index.html)
-- trusts ALL route_stop rows for a route as "the real path" — so a
-- long-haul route with only origin-city + destination-city stations drew
-- one straight segment connecting them, cutting straight across the
-- country regardless of actual highway geography.
--
-- 'WAYPOINT' is a new, distinct type for the real intercity waypoints
-- seed_vietnam_real_routes.js is about to insert — never a boarding
-- point, so routeStopController.getNearestStops() (the "find pickup
-- station near me" feature) must keep excluding it even when called
-- without an explicit ?type= filter (see routeStopController.js, updated
-- alongside this migration).

ALTER TABLE route_stop
  MODIFY COLUMN stop_type ENUM('PICKUP','DROPOFF','BOTH','WAYPOINT') NULL DEFAULT 'BOTH'
    COMMENT 'WAYPOINT = intercity highway waypoint for map rendering only, never a real boarding/alighting station';
