'use strict';

/* ═══════════════════════════════════════════════════════════════
   SmartBusAI — Transit Routing Engine
   Thuật toán: BFS có trọng số + Dijkstra-like shortest path
   Tìm hành trình nhiều chặng A→B→C khi không có tuyến trực tiếp.

   Optimize modes:
     "time"  — tổng thời gian ít nhất (bao gồm thời gian chờ)
     "cost"  — tổng chi phí thấp nhất
     "hops"  — ít chặng nhất (BFS thuần)
═══════════════════════════════════════════════════════════════ */

const MAX_HOPS        = 3;   // tối đa 3 chặng (A→B→C→D)
const MIN_TRANSFER_MS = 30 * 60 * 1000;   // tối thiểu 30 phút chờ chuyển
const MAX_TRANSFER_MS = 16 * 60 * 60 * 1000; // tối đa 16 giờ chờ chuyển (hành trình xuyên Việt)
const MAX_RESULTS     = 5;   // trả về tối đa 5 phương án

/* ── Haversine distance (km) ── */
function haversine(lat1, lng1, lat2, lng2) {
    if (!lat1 || !lng1 || !lat2 || !lng2) return Infinity;
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
   Load toàn bộ chuyến xe trong khoảng ngày tìm kiếm
   (ngày yêu cầu ± 1 ngày để có đủ phương án)
═══════════════════════════════════════════════════ */
async function loadAvailableTrips(db, date) {
    const targetDate = date || new Date().toISOString().slice(0, 10);

    // Load trips for the next 14 days from the target date.
    // The auto-advance system keeps only 1 day at a time, so we also
    // generate virtual repeat-trips by projecting each route forward day by day.
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
        GROUP BY t.trip_id
        HAVING (b.total_seats - COUNT(DISTINCT bd.seat_id)) > 0
        ORDER BY t.departure_time ASC
        LIMIT 8000
    `, [targetDate]);

    const realTrips = trips.map(t => ({
        ...t,
        departure_ms: new Date(t.departure_time).getTime(),
        arrival_ms:   new Date(t.arrival_time).getTime(),
        available_seats: t.total_seats - t.booked_seats
    }));

    // Virtual projection: repeat each real trip for the next 14 days
    // Load -2 days so yesterday's trips also project into the future search window
    const targetMs   = new Date(targetDate).getTime();
    const virtualTrips = [];
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    for (const t of realTrips) {
        for (let offset = 1; offset <= 16; offset++) {
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

    /* Node = { city, arrivalMs, legs[], totalCost, totalTimeMs, hops } */
    const queue    = [];
    const results  = [];
    const visited  = new Set(); // "city|hop" visited guard

    // Seed: tất cả chuyến từ origin
    for (const t of trips) {
        if (citiesMatch(t.origin, origin)) {
            queue.push({
                city:        t.destination,
                arrivalMs:   t.arrival_ms,
                legs:        [t],
                totalCost:   Number(t.base_price) || 0,
                totalTimeMs: t.arrival_ms - t.departure_ms,
                hops:        1
            });
        }
    }

    while (queue.length > 0) {
        // Sắp xếp theo weight để đảm bảo Dijkstra-like
        if (mode === 'cost')      queue.sort((a, b) => a.totalCost - b.totalCost);
        else if (mode === 'hops') queue.sort((a, b) => a.hops - b.hops);
        else                      queue.sort((a, b) => a.totalTimeMs - b.totalTimeMs);

        const node = queue.shift();

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

        // Expand: tìm chuyến tiếp theo từ node.city
        for (const t of trips) {
            if (!citiesMatch(t.origin, node.city)) continue;

            // Thời gian chờ hợp lệ
            const waitMs = t.departure_ms - node.arrivalMs;
            if (waitMs < MIN_TRANSFER_MS || waitMs > MAX_TRANSFER_MS) continue;

            // Không quay lại thành phố đã đi qua
            const visited_cities = node.legs.map(l => normCity(l.origin));
            if (visited_cities.includes(normCity(t.origin))) continue;

            const waitTimeMs = t.departure_ms - node.arrivalMs;
            queue.push({
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
        console.error('[TransitRouter] searchWithTransit error:', err.message);
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

module.exports = { searchWithTransit, getPopularTransferPoints, haversine, citiesMatch };
