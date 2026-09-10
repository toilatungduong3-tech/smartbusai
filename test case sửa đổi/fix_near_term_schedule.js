'use strict';
/**
 * Trims the near-term (next NEAR_TERM_DAYS) trip schedule down to what each
 * operator's REAL bus fleet can actually run without any bus being double-
 * booked, while leaving the total trip row count in the DB unchanged
 * (~13,401) — excess trips are pushed forward past the demo window rather
 * than deleted/cancelled.
 *
 * v2 — the first version preserved each route's exact original
 * departure hour and only varied the day; that failed to converge because
 * most routes historically cluster on the same few popular hours (e.g.
 * 139 routes all at 09:00), so buses sat idle most of the day while that
 * one hour-slot was massively oversubscribed — daily capacity was never
 * the real bottleneck, hour-of-day contention was. This version instead
 * greedily fills each bus back-to-back within a realistic operating
 * window (05:00–23:00), picking whichever bus frees up soonest for the
 * next route in a round-robin cycle (diversity first) — this is standard
 * interval-scheduling throughput maximization, and actually reaches each
 * fleet's true achievable capacity instead of an artificial hour-pinned
 * fraction of it.
 *
 * Every trip touched has zero active booking (the 49 PAID/PENDING-booked
 * trips all already have a past departure_time, excluded by the
 * `departure_time > NOW()` filter below).
 *
 * Supports --dry-run: computes and prints the full plan (including a
 * simulated post-fix conflict count) without writing anything, and
 * asserts kept.length + pushed.length === candidates.length for every
 * operator before ever touching the DB.
 */
require('dotenv').config();
const db = require('../server/config/db');

const NEAR_TERM_DAYS = 14;
const PAST_WINDOW_OFFSET_DAYS = 400;
const DAY_MS = 24 * 60 * 60 * 1000;
const OPERATING_START_HOUR = 5;
const OPERATING_END_HOUR = 23;
const DRY_RUN = process.argv.includes('--dry-run');

function fmtDbDateTime(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Rolls a candidate start time forward to the next in-window operating slot. */
function snapToOperatingWindow(ms) {
    const d = new Date(ms);
    if (d.getHours() >= OPERATING_END_HOUR) {
        d.setDate(d.getDate() + 1);
        d.setHours(OPERATING_START_HOUR, 0, 0, 0);
    } else if (d.getHours() < OPERATING_START_HOUR) {
        d.setHours(OPERATING_START_HOUR, 0, 0, 0);
    }
    return d.getTime();
}

(async () => {
    const [buses] = await db.query('SELECT bus_id, operator_id FROM bus');
    const busesByOp = new Map();
    const busToOp = new Map();
    for (const b of buses) {
        busToOp.set(b.bus_id, b.operator_id);
        if (!busesByOp.has(b.operator_id)) busesByOp.set(b.operator_id, []);
        busesByOp.get(b.operator_id).push(b.bus_id);
    }

    const [trips] = await db.query(
        `SELECT trip_id, route_id, bus_id, departure_time, arrival_time
         FROM trip WHERE status IN ('OPEN','FULL') AND departure_time > NOW()`
    );
    console.log(`Candidate near-term trips: ${trips.length}${DRY_RUN ? '  [DRY RUN — no writes]' : ''}`);

    const byOp = new Map();
    for (const t of trips) {
        const op = busToOp.get(t.bus_id);
        if (!byOp.has(op)) byOp.set(op, []);
        byOp.get(op).push(t);
    }

    const windowStart = new Date();
    windowStart.setHours(OPERATING_START_HOUR, 0, 0, 0);
    windowStart.setDate(windowStart.getDate() + 1);
    const windowEndMs = windowStart.getTime() + NEAR_TERM_DAYS * DAY_MS;

    const keepUpdates = [];
    const pushUpdates = [];
    let grandTotalCandidates = 0;

    for (const [op, opTrips] of byOp) {
        grandTotalCandidates += opTrips.length;
        const pool = busesByOp.get(op) || [];

        const byRoute = new Map();
        for (const t of opTrips) {
            if (!byRoute.has(t.route_id)) byRoute.set(t.route_id, []);
            byRoute.get(t.route_id).push(t);
        }
        const routeIds = [...byRoute.keys()];
        const claimed = new Map(routeIds.map(r => [r, 0]));
        const decided = new Set();
        const busyUntil = new Map(pool.map(id => [id, windowStart.getTime()]));

        let opKept = 0;
        let routeCursor = 0;
        let attemptsSinceLastAccept = 0;
        const maxAttemptsBeforeGivingUp = routeIds.length * 2; // one full extra cycle with zero progress = truly done

        while (attemptsSinceLastAccept < maxAttemptsBeforeGivingUp) {
            const routeId = routeIds[routeCursor % routeIds.length];
            routeCursor++;

            const clones = byRoute.get(routeId);
            const idx = claimed.get(routeId);
            if (idx >= clones.length) { attemptsSinceLastAccept++; continue; } // route out of clones

            const t = clones[idx];
            const durationMs = new Date(t.arrival_time).getTime() - new Date(t.departure_time).getTime();

            // Greedy: whichever bus in this operator's pool frees up soonest.
            let bestBus = null, bestFree = Infinity;
            for (const busId of pool) {
                const free = busyUntil.get(busId);
                if (free < bestFree) { bestFree = free; bestBus = busId; }
            }
            const startMs = snapToOperatingWindow(bestFree);
            if (startMs >= windowEndMs) break; // this operator's fleet is fully saturated through the whole window — stop, push the rest

            const endMs = startMs + durationMs;
            busyUntil.set(bestBus, endMs);
            claimed.set(routeId, idx + 1);
            decided.add(t.trip_id);
            keepUpdates.push([t.trip_id, bestBus, fmtDbDateTime(new Date(startMs)), fmtDbDateTime(new Date(endMs))]);
            opKept++;
            attemptsSinceLastAccept = 0;
        }

        let opPushed = 0;
        for (const t of opTrips) {
            if (decided.has(t.trip_id)) continue;
            const dep = new Date(t.departure_time);
            const arr = new Date(t.arrival_time);
            const pushedDep = new Date(dep.getTime() + PAST_WINDOW_OFFSET_DAYS * DAY_MS);
            const pushedArr = new Date(arr.getTime() + PAST_WINDOW_OFFSET_DAYS * DAY_MS);
            pushUpdates.push([t.trip_id, fmtDbDateTime(pushedDep), fmtDbDateTime(pushedArr)]);
            opPushed++;
        }

        console.log(`  operator ${op}: ${pool.length} buses, ${opTrips.length} candidates, ${routeIds.length} distinct routes -> kept ${opKept}, pushed ${opPushed} (sum=${opKept + opPushed}, avg/day=${(opKept / NEAR_TERM_DAYS).toFixed(1)})`);
        if (opKept + opPushed !== opTrips.length) {
            throw new Error(`BOOKKEEPING MISMATCH for operator ${op}: kept(${opKept})+pushed(${opPushed}) != candidates(${opTrips.length})`);
        }
    }

    console.log(`\nTotals: kept=${keepUpdates.length} pushed=${pushUpdates.length} sum=${keepUpdates.length + pushUpdates.length} candidates=${grandTotalCandidates}`);
    if (keepUpdates.length + pushUpdates.length !== grandTotalCandidates) {
        throw new Error('GLOBAL BOOKKEEPING MISMATCH — aborting before any write');
    }

    // Simulate post-fix conflicts among the "kept" set only, purely in memory.
    const byBusPlan = new Map();
    for (const [tripId, busId, depStr, arrStr] of keepUpdates) {
        if (!byBusPlan.has(busId)) byBusPlan.set(busId, []);
        byBusPlan.get(busId).push([new Date(depStr).getTime(), new Date(arrStr).getTime()]);
    }
    let simulatedConflicts = 0;
    for (const intervals of byBusPlan.values()) {
        intervals.sort((a, b) => a[0] - b[0]);
        for (let i = 1; i < intervals.length; i++) {
            if (intervals[i][0] < intervals[i - 1][1]) simulatedConflicts++;
        }
    }
    console.log(`Simulated conflicts in the planned "kept" set: ${simulatedConflicts} (should be 0)`);

    if (DRY_RUN) {
        console.log('\nDry run OK. Re-run without --dry-run to apply.');
        process.exit(0);
    }

    console.log(`\nApplying ${keepUpdates.length} "kept in window" update(s)...`);
    for (const [tripId, busId, depStr, arrStr] of keepUpdates) {
        await db.query('UPDATE trip SET bus_id=?, departure_time=?, arrival_time=? WHERE trip_id=?', [busId, depStr, arrStr, tripId]);
    }
    console.log(`Applying ${pushUpdates.length} "pushed to deep future" update(s)...`);
    for (const [tripId, depStr, arrStr] of pushUpdates) {
        await db.query('UPDATE trip SET departure_time=?, arrival_time=? WHERE trip_id=?', [depStr, arrStr, tripId]);
    }

    const [[pairs]] = await db.query(`
        SELECT COUNT(*) c FROM trip t1
        JOIN trip t2 ON t1.bus_id=t2.bus_id AND t1.trip_id<t2.trip_id
        WHERE t1.status IN ('OPEN','FULL') AND t2.status IN ('OPEN','FULL')
          AND t1.departure_time BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL ${NEAR_TERM_DAYS} DAY)
          AND t2.departure_time BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL ${NEAR_TERM_DAYS} DAY)
          AND t1.departure_time < t2.arrival_time AND t1.arrival_time > t2.departure_time
    `);
    console.log(`\n=== Remaining conflicts WITHIN the ${NEAR_TERM_DAYS}-day window: ${pairs.c} ===`);
    const [[totalNow]] = await db.query('SELECT COUNT(*) c FROM trip');
    console.log(`Total trips in DB (unchanged): ${totalNow.c}`);
    const [byDay] = await db.query(`SELECT DATE(departure_time) d, COUNT(*) c FROM trip WHERE status='OPEN' AND departure_time BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL ${NEAR_TERM_DAYS} DAY) GROUP BY DATE(departure_time) ORDER BY d`);
    console.log('Trips per day in window:', JSON.stringify(byDay));

    process.exit(0);
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
