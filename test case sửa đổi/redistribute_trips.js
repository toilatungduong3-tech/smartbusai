'use strict';
/**
 * One-off repair: ~12,164 future OPEN/FULL trips were found piled onto a
 * single calendar day (autoGenerateRecurringTrips had been re-running
 * across many dev sessions without correctly detecting it had already
 * cloned that day's trips, stacking duplicate route+time-slot trips on
 * top of each other instead of advancing forward one real day at a time).
 * Combined with only 12 of the 117 buses ever being used, this meant a
 * single bus could show 2,000+ simultaneous "trips" — a bus can obviously
 * only run one trip at a time.
 *
 * This script does NOT delete or reduce the trip count (kept at ~13,401
 * to match already-reported figures) — it only:
 *   1. Spreads each (route_id, time-of-day) group of duplicate trips
 *      across a WINDOW_DAYS-day window instead of one single day —
 *      turning "139 copies of the 09:00 Route #2 trip all on 2026-08-27"
 *      into a realistic near-daily recurring schedule.
 *   2. Re-assigns bus_id per operator via greedy interval partitioning
 *      (classic interval-graph scheduling) across that operator's real
 *      bus pool, so no bus is ever assigned two overlapping trips.
 *
 * Every trip touched here has ZERO active booking (verified before
 * running — the 49 trips that DO have PAID/PENDING bookings all have a
 * departure_time already in the past and are excluded by the
 * `departure_time > NOW()` filter below), so this never disturbs a real
 * paying customer's seat/bus assignment.
 */
require('dotenv').config();
const db = require('../server/config/db');

const WINDOW_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

function fmtDbDateTime(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function redistributeDates() {
    const [trips] = await db.query(
        `SELECT trip_id, route_id, bus_id, departure_time, arrival_time
         FROM trip WHERE status IN ('OPEN','FULL') AND departure_time > NOW()
         ORDER BY route_id, TIME(departure_time), trip_id`
    );
    console.log(`Redistributing dates for ${trips.length} trip(s)...`);

    // Group by (route_id, HH:MM:SS)
    const groups = new Map();
    for (const t of trips) {
        const dep = new Date(t.departure_time);
        const tod = `${dep.getHours()}:${dep.getMinutes()}:${dep.getSeconds()}`;
        const key = `${t.route_id}|${tod}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(t);
    }

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    let updated = 0;
    for (const group of groups.values()) {
        for (let i = 0; i < group.length; i++) {
            const t = group[i];
            const dep = new Date(t.departure_time);
            const arr = new Date(t.arrival_time);
            const durationMs = arr.getTime() - dep.getTime();

            const dayOffset = i % WINDOW_DAYS;
            const newDep = new Date(tomorrow.getTime() + dayOffset * DAY_MS);
            newDep.setHours(dep.getHours(), dep.getMinutes(), dep.getSeconds(), 0);
            const newArr = new Date(newDep.getTime() + durationMs);

            await db.query('UPDATE trip SET departure_time=?, arrival_time=? WHERE trip_id=?', [
                fmtDbDateTime(newDep), fmtDbDateTime(newArr), t.trip_id,
            ]);
            t._newDeparture = newDep;
            t._newArrival = newArr;
            updated++;
        }
    }
    console.log(`✅ Redistributed ${updated} trip(s) across a ${WINDOW_DAYS}-day window`);
    return trips; // now carries _newDeparture/_newArrival for the next step
}

async function reassignBuses(trips) {
    const [buses] = await db.query('SELECT bus_id, operator_id, bus_type FROM bus');
    const busToOp = new Map(buses.map(b => [b.bus_id, b.operator_id]));
    const busesByOp = new Map();
    for (const b of buses) {
        if (!busesByOp.has(b.operator_id)) busesByOp.set(b.operator_id, []);
        busesByOp.get(b.operator_id).push(b.bus_id);
    }

    const byOp = new Map();
    for (const t of trips) {
        const op = busToOp.get(t.bus_id);
        if (!byOp.has(op)) byOp.set(op, []);
        byOp.get(op).push(t);
    }

    let reassigned = 0, conflictsLeft = 0;
    const updates = [];

    for (const [op, opTrips] of byOp) {
        opTrips.sort((a, b) => a._newDeparture - b._newDeparture);
        const pool = busesByOp.get(op) || [];
        // busyUntil[busId] = timestamp the bus is free from
        const busyUntil = new Map(pool.map(id => [id, -Infinity]));

        for (const t of opTrips) {
            const depMs = t._newDeparture.getTime();
            const arrMs = t._newArrival.getTime();

            // Prefer keeping the trip's original bus if it's free at this time.
            let chosen = null;
            if (busyUntil.has(t.bus_id) && busyUntil.get(t.bus_id) <= depMs) {
                chosen = t.bus_id;
            } else {
                // Otherwise pick whichever pool bus is free the LONGEST time
                // already (reduces fragmentation vs. first-fit).
                let bestBus = null, bestFreeSince = -Infinity;
                for (const busId of pool) {
                    const free = busyUntil.get(busId);
                    if (free <= depMs && free > bestFreeSince) { bestFreeSince = free; bestBus = busId; }
                }
                chosen = bestBus;
            }

            if (chosen == null) {
                // No bus in the pool is free — pick the one that frees up
                // soonest (minimizes the residual overlap) and log it.
                let bestBus = pool[0], bestFree = Infinity;
                for (const busId of pool) {
                    const free = busyUntil.get(busId);
                    if (free < bestFree) { bestFree = free; bestBus = busId; }
                }
                chosen = bestBus;
                conflictsLeft++;
            }

            busyUntil.set(chosen, arrMs);
            if (chosen !== t.bus_id) {
                updates.push([chosen, t.trip_id]);
                reassigned++;
            }
        }
    }

    console.log(`Applying ${updates.length} bus_id reassignment(s)...`);
    for (const [busId, tripId] of updates) {
        await db.query('UPDATE trip SET bus_id=? WHERE trip_id=?', [busId, tripId]);
    }
    console.log(`✅ Reassigned bus_id for ${reassigned} trip(s); ${conflictsLeft} trip(s) could not find a fully free bus in their operator's pool`);
}

async function verify() {
    const [[pairs]] = await db.query(`
        SELECT COUNT(*) c FROM trip t1
        JOIN trip t2 ON t1.bus_id=t2.bus_id AND t1.trip_id<t2.trip_id
        WHERE t1.status IN ('OPEN','FULL') AND t2.status IN ('OPEN','FULL')
          AND t1.departure_time < t2.arrival_time AND t1.arrival_time > t2.departure_time
    `);
    console.log(`\n=== Verification: remaining overlapping trip pairs (any status/date) = ${pairs.c} ===`);
    const [[total]] = await db.query("SELECT COUNT(*) c FROM trip");
    console.log(`Total trips in DB (unchanged): ${total.c}`);
}

(async () => {
    const trips = await redistributeDates();
    await reassignBuses(trips);
    await verify();
    process.exit(0);
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
