'use strict';
/**
 * SmartBusAI — Sprint 6: route_stop 100% coverage generator.
 * Run: node server/config/generate_route_stops.js
 *
 * Before this: 181/1,095 routes (16.5%) had any route_stop rows at all —
 * seed_full.js's own stop-seeding block only ever runs once (gated behind
 * `stopCount.cnt < 100`, permanently skipped after the first partial run
 * left the table at 634 rows). This script targets exactly the routes
 * that block missed, using the SAME real, curated data seed_full.js
 * already uses (BUS_STATIONS/PROVINCES, imported — not duplicated) so
 * every route ends up in a consistent style.
 *
 * Grounding rule (same one enforced for the Sprint 4 route map — "never a
 * fabricated coordinate"): a route only gets a stop backed by either (a) a
 * real, named bus station from BUS_STATIONS (62/63 provinces have one —
 * real addresses/coordinates, reused from seed_full.js), or (b) the
 * route's own province-center coordinate from PROVINCES (also real, not
 * invented here) with an honestly generic label ("Điểm đón/trả <city>") —
 * never a specific named station this script can't verify exists. If
 * neither exists for a given origin/destination string, that route is
 * left uncovered and reported, not silently faked.
 *
 * Also cleans up a real, unrelated data-quality issue found while
 * building this: 67 junk route_stop rows on route_id=1 (stop_name
 * literally "Bến xe A", lat=lng=0, stop_order=0) — clearly manual/test
 * artifacts repeatedly inserted between 2026-07-16 and 2026-08-16, not
 * seeded data. Confirmed via `grep` that no current code path hardcodes
 * this value, so it's a one-time cleanup, not an ongoing bug to fix in
 * application code.
 */

const db = require('./db');
const { PROVINCES, BUS_STATIONS } = require('./seed_full');

/* Calibrated against this DB's own real trip data (2,000-row sample of
   TIMESTAMPDIFF(MINUTE, departure_time, arrival_time) vs route.distance_km):
   avg 49.2 km/h, median 47.9 km/h — 50 km/h is not an arbitrary guess. */
const AVG_SPEED_KMH = 50;

/* Multi-stop same-city spacing: successive pickups/dropoffs in one city
   (e.g. 3 Hà Nội bus stations before the highway) realistically take a
   few minutes of city traffic to move between — an order-of-magnitude
   estimate, documented as such, not claimed as precise. */
const MINUTES_BETWEEN_SAME_CITY_STOPS = 10;

async function generateRouteStops({ dryRun = false } = {}) {
    const provMap = {};
    for (const p of PROVINCES) provMap[p.name] = p;

    const stationMap = {};
    for (const s of BUS_STATIONS) {
        if (!stationMap[s.city]) stationMap[s.city] = [];
        stationMap[s.city].push(s);
    }

    /* ── Cleanup: known junk placeholder rows ── */
    const [junk] = await db.query(
        `SELECT stop_id FROM route_stop WHERE stop_name='Bến xe A' AND lat=0 AND lng=0 AND stop_order=0`
    );
    if (junk.length && !dryRun) {
        await db.query(
            `DELETE FROM route_stop WHERE stop_name='Bến xe A' AND lat=0 AND lng=0 AND stop_order=0`
        );
    }

    /* ── Find every route with zero route_stop rows ── */
    const [routes] = await db.query(`
        SELECT r.route_id, r.origin, r.destination, r.distance_km
        FROM route r
        LEFT JOIN route_stop rs ON rs.route_id = r.route_id
        WHERE rs.stop_id IS NULL
    `);

    let stopsCreated = 0, routesFixed = 0;
    const skipped = [];

    for (const route of routes) {
        const originStations = (stationMap[route.origin] || []).slice(0, 3).map(s => ({ ...s }));
        const destStations = (stationMap[route.destination] || []).slice(0, 2).map(s => ({ ...s }));

        if (!originStations.length) {
            const p = provMap[route.origin];
            if (p) originStations.push({ name: `Điểm đón ${route.origin}`, lat: p.lat, lng: p.lng, address: `Trung tâm ${route.origin}` });
        }
        if (!destStations.length) {
            const p = provMap[route.destination];
            if (p) destStations.push({ name: `Điểm trả ${route.destination}`, lat: p.lat, lng: p.lng, address: `Trung tâm ${route.destination}` });
        }

        if (!originStations.length || !destStations.length) {
            /* Neither a curated station nor a known province center exists
               for this origin/destination string — do not fabricate
               coordinates. Reported, not silently skipped. */
            skipped.push({ route_id: route.route_id, origin: route.origin, destination: route.destination });
            continue;
        }

        const distanceKm = Number(route.distance_km) || null;
        const totalMinutes = distanceKm ? Math.round((distanceKm / AVG_SPEED_KMH) * 60) : null;

        for (let i = 0; i < originStations.length; i++) {
            const s = originStations[i];
            const est = i * MINUTES_BETWEEN_SAME_CITY_STOPS;
            if (!dryRun) {
                await db.query(
                    `INSERT INTO route_stop (route_id, stop_name, stop_type, address, lat, lng, stop_order, estimated_min_from_origin, is_active)
                     VALUES (?,?,?,?,?,?,?,?,1)`,
                    [route.route_id, s.name, 'PICKUP', s.address || null, s.lat, s.lng, i + 1, est]
                );
            }
            stopsCreated++;
        }
        for (let i = 0; i < destStations.length; i++) {
            const s = destStations[i];
            const est = totalMinutes != null ? totalMinutes + i * MINUTES_BETWEEN_SAME_CITY_STOPS : null;
            if (!dryRun) {
                await db.query(
                    `INSERT INTO route_stop (route_id, stop_name, stop_type, address, lat, lng, stop_order, estimated_min_from_origin, is_active)
                     VALUES (?,?,?,?,?,?,?,?,1)`,
                    [route.route_id, s.name, 'DROPOFF', s.address || null, s.lat, s.lng, 100 + i, est]
                );
            }
            stopsCreated++;
        }
        routesFixed++;
    }

    return {
        routesConsidered: routes.length,
        routesFixed,
        stopsCreated,
        junkRowsRemoved: junk.length,
        skipped, // routes with no real data available at all — honest, not fabricated
        dryRun,
    };
}

module.exports = { generateRouteStops, AVG_SPEED_KMH };

if (require.main === module) {
    const dryRun = process.argv.includes('--dry-run');
    generateRouteStops({ dryRun }).then(result => {
        console.log(JSON.stringify(result, null, 2));
        process.exit(0);
    }).catch(err => {
        console.error('generate_route_stops FAILED:', err.message);
        process.exit(1);
    });
}
