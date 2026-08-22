'use strict';
const logger = require('../utils/logger');

/* ═══════════════════════════════════════════════════════════════
   SmartBusAI — Transit Routing Engine
   Thuật toán: BFS có trọng số + Dijkstra-like shortest path
   Tìm hành trình nhiều chặng A→B→C khi không có tuyến trực tiếp.

   Optimize modes:
     "time"  — tổng thời gian ít nhất (bao gồm thời gian chờ)
     "cost"  — tổng chi phí thấp nhất
     "hops"  — ít chặng nhất (BFS thuần)

   Sprint 3 performance hardening — MASTER_COMPLETION_MATRIX.md blocker:
   live-measured before this fix at ~35s/request. Root cause was threefold,
   all fixed below without changing the search semantics (see
   tests/transitRouter.test.js — unchanged, all still pass — and
   tests/phase3-transit-perf.test.js for the new coverage):
     1. loadAvailableTrips projected every real trip forward 16 days with
        no upper bound on the SQL date range either — up to 8,000 real
        trips × 16 = ~128,000 virtual trip objects built from scratch on
        every request. Reduced to a 5-day projection window with a
        matching SQL upper bound (still generous: MAX_HOPS=3 legs +
        2×MAX_TRANSFER_MS=16h waits tops out around 2-3 days of real
        span for any single itinerary).
     2. findTransitRoutes' inner "find onward legs from this city" loop
        linearly rescanned the ENTIRE trips array (real+virtual) on every
        queue pop — O(hops × queue-size × trips-array-size). Replaced with
        a one-time Map index (city -> trips departing there) built before
        the BFS starts; a small (dozens, not thousands) list of distinct
        city names is fuzzy-matched instead of every trip.
     3. queue.sort() re-sorted the entire frontier on every single pop —
        O(n log n) per iteration. Replaced with a binary min-heap
        (O(log n) push/pop).
═══════════════════════════════════════════════════════════════ */

const MAX_HOPS        = 3;   // tối đa 3 chặng (A→B→C→D)
const MIN_TRANSFER_MS = 30 * 60 * 1000;   // tối thiểu 30 phút chờ chuyển
const MAX_TRANSFER_MS = 16 * 60 * 60 * 1000; // tối đa 16 giờ chờ chuyển (hành trình xuyên Việt)
const MAX_RESULTS     = 5;   // trả về tối đa 5 phương án
const PROJECTION_DAYS = 5;   // Sprint 3: was 16 — see header comment

/* ── Haversine distance (km) ── */
function haversine(lat1, lng1, lat2, lng2) {
    if (lat1 == null || lng1 == null || lat2 == null || lng2 == null ||
        !isFinite(lat1) || !isFinite(lng1) || !isFinite(lat2) || !isFinite(lng2)) return Infinity;
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2
            + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180)
            * Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/* ── Normalize tên tỉnh để so sánh gần đúng ── */
function normCity(s) {
    return (s || '')
        .toLowerCase()
        .replace(/tp\.\s*/g, '')
        .replace(/tỉnh\s*/g, '')
        .replace(/thành phố\s*/g, '')
        .replace(/[\s\-]+/g, ' ')
        .trim();
}

function citiesMatch(a, b) {
    const na = normCity(a), nb = normCity(b);
    return na === nb || na.includes(nb) || nb.includes(na);
}

/* ═══════════════════════════════════════════════════
   City index — Sprint 3 perf fix #2.
   Groups trips by their normalized origin city so
   "which trips depart from city X" is a Map lookup against a handful of
   distinct city-name keys (fuzzy-matched via citiesMatch's same
   includes()-based rule) instead of a linear scan of every trip. Results
   are memoized per distinct query city, since the same city is looked up
   repeatedly across different BFS branches that happen to converge there.
═══════════════════════════════════════════════════════════════ */
function buildCityIndex(trips) {
    const byOrigin = new Map();
    for (const t of trips) {
        const key = normCity(t.origin);
        let bucket = byOrigin.get(key);
        if (!bucket) { bucket = []; byOrigin.set(key, bucket); }
        bucket.push(t);
    }
    return { byOrigin, distinctKeys: [...byOrigin.keys()], _cache: new Map() };
}

function tripsFromCity(index, cityName) {
    const nc = normCity(cityName);
    const cached = index._cache.get(nc);
    if (cached) return cached;

    const out = [];
    for (const key of index.distinctKeys) {
        if (key === nc || key.includes(nc) || nc.includes(key)) {
            const bucket = index.byOrigin.get(key);
            for (const t of bucket) out.push(t);
        }
    }
    index._cache.set(nc, out);
    return out;
}

/* ═══════════════════════════════════════════════════
   Min-heap priority queue — Sprint 3 perf fix #3.
   Replaces queue.sort() (O(n log n) on every pop) with O(log n)
   push/pop, keyed by whatever comparator the search mode needs.
═══════════════════════════════════════════════════════════════ */
class MinHeap {
    constructor(compareFn) {
        this._heap = [];
        this._cmp = compareFn;
    }
    get size() { return this._heap.length; }
    push(item) {
        const h = this._heap;
        h.push(item);
        let i = h.length - 1;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this._cmp(h[i], h[parent]) >= 0) break;
            [h[i], h[parent]] = [h[parent], h[i]];
            i = parent;
        }
    }
    pop() {
        const h = this._heap;
        const top = h[0];
        const last = h.pop();
        if (h.length > 0) {
            h[0] = last;
            let i = 0;
            const n = h.length;
            while (true) {
                let smallest = i;
                const l = 2 * i + 1, r = 2 * i + 2;
                if (l < n && this._cmp(h[l], h[smallest]) < 0) smallest = l;
                if (r < n && this._cmp(h[r], h[smallest]) < 0) smallest = r;
                if (smallest === i) break;
                [h[i], h[smallest]] = [h[smallest], h[i]];
                i = smallest;
            }
        }
        return top;
    }
}

/* ═══════════════════════════════════════════════════
   Load toàn bộ chuyến xe trong khoảng ngày tìm kiếm
   (ngày yêu cầu ± vài ngày để có đủ phương án)
═══════════════════════════════════════════════════ */
async function loadAvailableTrips(db, date) {
    const targetDate = date || new Date().toISOString().slice(0, 10);

    /* Sprint 3: added an upper bound (was lower-bound-only + a blanket
       LIMIT 8000, order-dependent rather than tied to the actual search
       window) — matches the reduced PROJECTION_DAYS virtual-projection
       window below, so the real-trip fetch and the virtual-projection
       range stay consistent instead of one silently over-provisioning
       for the other. */
    const [trips] = await db.query(`
        SELECT
            t.trip_id,
            r.route_id,
            r.origin,
            r.destination,
            r.distance_km,
            r.origin_lat,
            r.origin_lng,
            r.dest_lat,
            r.dest_lng,
            t.departure_time,
            t.arrival_time,
            t.base_price,
            t.status,
            b.total_seats,
            o.name AS operator_name,
            o.operator_id,
            b.bus_type,
            COUNT(DISTINCT bd.seat_id) AS booked_seats
        FROM trip t
        JOIN route r ON t.route_id = r.route_id
        JOIN bus b ON t.bus_id = b.bus_id
        JOIN bus_operator o ON b.operator_id = o.operator_id
        LEFT JOIN booking bk ON bk.trip_id = t.trip_id AND bk.status IN ('PAID','PENDING','CONFIRMED')
        LEFT JOIN booking_detail bd ON bd.booking_id = bk.booking_id
        WHERE t.status = 'OPEN'
          AND t.departure_time >= DATE_SUB(?, INTERVAL 3 DAY)
          AND t.departure_time <  DATE_ADD(?, INTERVAL ${PROJECTION_DAYS + 2} DAY)
        GROUP BY t.trip_id
        HAVING (b.total_seats - COUNT(DISTINCT bd.seat_id)) > 0
        ORDER BY t.departure_time ASC
        LIMIT 8000
    `, [targetDate, targetDate]);

    const realTrips = trips.map(t => ({
        ...t,
        departure_ms: new Date(t.departure_time).getTime(),
        arrival_ms:   new Date(t.arrival_time).getTime(),
        available_seats: t.total_seats - t.booked_seats
    }));

    // Virtual projection: repeat each real trip for the next PROJECTION_DAYS
    // days (was 16 — see header comment). Still loads -2 days worth of real
    // trips so yesterday's trips also project into the future search window.
    const targetMs   = new Date(targetDate).getTime();
    const virtualTrips = [];
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    for (const t of realTrips) {
        for (let offset = 1; offset <= PROJECTION_DAYS; offset++) {
            const depMs = t.departure_ms + offset * MS_PER_DAY;
            if (depMs < targetMs) continue; // chỉ giữ virtual trips từ ngày tìm kiếm trở đi
            const arrMs = t.arrival_ms + offset * MS_PER_DAY;
            virtualTrips.push({
                ...t,
                trip_id:        `${t.trip_id}_v${offset}`,
                departure_time: new Date(depMs).toISOString(),
                arrival_time:   new Date(arrMs).toISOString(),
                departure_ms:   depMs,
                arrival_ms:     arrMs,
                available_seats: t.available_seats,
                _virtual:       true,
                _real_trip_id:  t.trip_id
            });
        }
    }

    // Chỉ giữ real trips từ ngày tìm kiếm trở đi
    const filteredReal = realTrips.filter(t => t.departure_ms >= targetMs);

    return [...filteredReal, ...virtualTrips];
}

/* ═══════════════════════════════════════════════════
   Tính weight cho từng chặng
═══════════════════════════════════════════════════ */
function legWeight(trip, mode) {
    if (mode === 'cost') return Number(trip.base_price) || 0;
    if (mode === 'hops') return 1;
    // mode === 'time': tổng thời gian di chuyển (ms)
    return trip.arrival_ms - trip.departure_ms;
}

/* ═══════════════════════════════════════════════════
   CORE: BFS/Dijkstra multi-hop search
═══════════════════════════════════════════════════ */
async function findTransitRoutes(db, origin, destination, date, mode = 'time') {
    const trips = await loadAvailableTrips(db, date);
    if (!trips.length) return [];

    const cityIndex = buildCityIndex(trips);

    const compareFn = mode === 'cost' ? (a, b) => a.totalCost - b.totalCost
                     : mode === 'hops' ? (a, b) => a.hops - b.hops
                     : (a, b) => a.totalTimeMs - b.totalTimeMs;

    /* Node = { city, arrivalMs, legs[], totalCost, totalTimeMs, hops } */
    const heap     = new MinHeap(compareFn);
    const results  = [];
    const visited  = new Set(); // "city|hop" visited guard

    // Seed: tất cả chuyến từ origin
    for (const t of tripsFromCity(cityIndex, origin)) {
        heap.push({
            city:        t.destination,
            arrivalMs:   t.arrival_ms,
            legs:        [t],
            totalCost:   Number(t.base_price) || 0,
            totalTimeMs: t.arrival_ms - t.departure_ms,
            hops:        1
        });
    }

    while (heap.size > 0) {
        const node = heap.pop();

        // Đến đích
        if (citiesMatch(node.city, destination)) {
            results.push(node);
            if (results.length >= MAX_RESULTS) break;
            continue;
        }

        // Cắt tỉa: quá nhiều chặng
        if (node.hops >= MAX_HOPS) continue;

        // Visited guard
        const visitKey = `${normCity(node.city)}|${node.hops}`;
        if (visited.has(visitKey)) continue;
        visited.add(visitKey);

        // Expand: tìm chuyến tiếp theo từ node.city (indexed lookup, not a full scan)
        for (const t of tripsFromCity(cityIndex, node.city)) {
            // Thời gian chờ hợp lệ
            const waitMs = t.departure_ms - node.arrivalMs;
            if (waitMs < MIN_TRANSFER_MS || waitMs > MAX_TRANSFER_MS) continue;

            // Không quay lại thành phố đã đi qua
            const visited_cities = node.legs.map(l => normCity(l.origin));
            if (visited_cities.includes(normCity(t.origin))) continue;

            const waitTimeMs = t.departure_ms - node.arrivalMs;
            heap.push({
                city:        t.destination,
                arrivalMs:   t.arrival_ms,
                legs:        [...node.legs, t],
                totalCost:   node.totalCost + (Number(t.base_price) || 0),
                totalTimeMs: node.totalTimeMs + (t.arrival_ms - t.departure_ms) + waitTimeMs,
                hops:        node.hops + 1
            });
        }
    }

    return results;
}

/* ═══════════════════════════════════════════════════
   Format kết quả trả về client
═══════════════════════════════════════════════════ */
function formatResult(node, origin, destination) {
    const legs = node.legs.map((t, i) => ({
        leg:            i + 1,
        trip_id:        t._real_trip_id || t.trip_id,
        route_id:       t.route_id || null,
        origin:         t.origin,
        destination:    t.destination,
        departure_time: t.departure_time,
        arrival_time:   t.arrival_time,
        base_price:     Number(t.base_price),
        operator_name:  t.operator_name,
        operator_id:    t.operator_id,
        bus_type:       t.bus_type,
        available_seats: t.available_seats,
        distance_km:    t.distance_km || null,
        origin_lat:     t.origin_lat || null,
        origin_lng:     t.origin_lng || null,
        dest_lat:       t.dest_lat || null,
        dest_lng:       t.dest_lng || null,
    }));

    const firstDep  = new Date(node.legs[0].departure_time);
    const lastArr   = new Date(node.legs[node.legs.length - 1].arrival_time);
    const totalMins = Math.round((lastArr - firstDep) / 60000);
    const waitMins  = node.legs.slice(1).reduce((sum, t, i) => {
        const prev = node.legs[i];
        return sum + Math.round((new Date(t.departure_time) - new Date(prev.arrival_time)) / 60000);
    }, 0);

    // Trạm trung chuyển
    const transferPoints = node.legs.slice(0, -1).map(l => l.destination);

    return {
        type:             'TRANSIT',
        hops:             node.hops,
        transfer_points:  transferPoints,
        total_price:      node.totalCost,
        total_mins:       totalMins,
        wait_mins:        waitMins,
        travel_mins:      totalMins - waitMins,
        departure_time:   node.legs[0].departure_time,
        arrival_time:     node.legs[node.legs.length - 1].arrival_time,
        legs
    };
}

/* ═══════════════════════════════════════════════════
   PUBLIC API
   Trả về object { direct: [...], transit: [...] }
═══════════════════════════════════════════════════ */
async function searchWithTransit(db, { origin, destination, date, mode = 'time' }) {
    try {
        const trips = await loadAvailableTrips(db, date);

        // Tuyến trực tiếp
        // Only real trips for direct (not virtual duplicates)
        const direct = trips
            .filter(t => !t._virtual && citiesMatch(t.origin, origin) && citiesMatch(t.destination, destination))
            .map(t => ({
                type:            'DIRECT',
                trip_id:         t.trip_id,
                route_id:        t.route_id || null,
                origin:          t.origin,
                destination:     t.destination,
                departure_time:  t.departure_time,
                arrival_time:    t.arrival_time,
                base_price:      Number(t.base_price),
                operator_name:   t.operator_name,
                operator_id:     t.operator_id,
                bus_type:        t.bus_type,
                available_seats: t.available_seats,
                distance_km:     t.distance_km || null,
                origin_lat:      t.origin_lat || null,
                origin_lng:      t.origin_lng || null,
                dest_lat:        t.dest_lat || null,
                dest_lng:        t.dest_lng || null,
                total_mins:      Math.round((t.arrival_ms - t.departure_ms) / 60000),
                hops:            1
            }));

        // Nếu đã có trực tiếp, vẫn tìm transit (để người dùng so sánh)
        const transitNodes = await findTransitRoutes(db, origin, destination, date, mode);
        const transit = transitNodes.map(n => formatResult(n, origin, destination));

        return { direct, transit };
    } catch (err) {
        logger.error('[TransitRouter] searchWithTransit error:', err.message);
        return { direct: [], transit: [] };
    }
}

/* ─── Gợi ý điểm trung chuyển phổ biến ─── */
async function getPopularTransferPoints(db, limit = 10) {
    try {
        // Các tỉnh thành xuất hiện làm cả điểm đến lẫn điểm đi trên các tuyến khác nhau
        const [rows] = await db.query(`
            SELECT city, COUNT(*) AS freq FROM (
                SELECT origin AS city FROM route
                UNION ALL
                SELECT destination AS city FROM route
            ) t
            GROUP BY city
            ORDER BY freq DESC
            LIMIT ?
        `, [limit]);
        return rows;
    } catch (e) {
        return [];
    }
}

module.exports = {
    searchWithTransit, getPopularTransferPoints, haversine, citiesMatch, normCity,
    // exported for direct unit testing of the Sprint 3 perf-fix internals
    MinHeap, buildCityIndex, tripsFromCity, PROJECTION_DAYS,
};
