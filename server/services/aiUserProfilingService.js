'use strict';
const db = require('../config/db');

/* ═══════════════════════════════════════════════════════════
   aiUserProfilingService.js — Sprint 11: real behavior-derived
   preference vectors. No fabricated defaults: every field is either a
   real aggregate over the user's own last-30-day history, or null when
   there isn't enough history to say anything ("no data" is reported
   honestly rather than backfilled with a fake average).

   Data sources, exactly as the brief specifies: user_behavior (event
   log), search_log (what they searched even when they didn't book),
   booking + booking_detail + trip + bus (what they actually paid for —
   the strongest signal, weighted accordingly by using it as the primary
   source for price/time/vehicle stats; search_log only feeds route
   frequency, since a search without a booking says "interested in this
   route", not "prefers this price/time/vehicle").
═══════════════════════════════════════════════════════════ */

const WINDOW_DAYS = 30;
const CACHE_TTL_MINUTES = 60;
const MIN_SAMPLE_SIZE = 2; // fewer than this and a "preference" is just noise

/* bus.bus_type is free-text (confirmed live: "EXPRESS", "Ghế ngồi 45
   chỗ", "Giường nằm 34/40 chỗ", "LIMOUSINE", "SLEEPER", "STANDARD", "VIP
   Limousine 16/22 chỗ" — see tripController.js's runTripSearch for the
   same keyword-match precedent this reuses). Priority: LIMOUSINE keyword
   wins over a bare "VIP" (a "VIP Limousine" bus is a limousine, not
   merely a nicer seat); GIƯỜNG/NẰM/SLEEPER is the sleeper-bed bucket;
   everything else (EXPRESS, STANDARD, "Ghế ngồi ...") is seated. */
function classifyVehicleType(busType) {
    const t = (busType || '').toUpperCase();
    if (t.includes('LIMOUSINE')) return 'LIMOUSINE';
    if (t.includes('GIƯỜNG') || t.includes('NẰM') || t.includes('SLEEPER')) return 'GIUONG_NAM';
    return 'GHE_NGOI';
}

/* Departure-hour buckets for "khung giờ xuất phát ưa thích" — uses
   trip.departure_time (when they chose to travel), not booking_time
   (when they happened to click "buy"), since the brief's own wording is
   about departure-time preference. */
function timeBucket(hour) {
    if (hour >= 5 && hour < 11) return 'morning';
    if (hour >= 11 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 22) return 'evening';
    return 'night';
}

function emptyProfile(userId) {
    return {
        user_id: userId,
        has_data: false,
        sample_size: 0,
        price: null,
        time_weights: null,
        time_counts: null,
        vehicle_pref: null,
        vehicle_counts: null,
        frequent_routes: [],
        computed_at: new Date(),
    };
}

async function computeProfile(userId) {
    const [bookedTrips] = await db.query(
        `SELECT t.departure_time, t.base_price, bs.bus_type, r.origin, r.destination, bd.price AS seat_price
         FROM booking b
         JOIN trip t          ON b.trip_id = t.trip_id
         JOIN bus bs           ON t.bus_id = bs.bus_id
         JOIN route r          ON t.route_id = r.route_id
         LEFT JOIN booking_detail bd ON bd.booking_id = b.booking_id
         WHERE b.user_id = ? AND b.status = 'PAID' AND b.booking_time >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
        [userId, WINDOW_DAYS]
    );

    const [searchRows] = await db.query(
        `SELECT origin, destination, COUNT(*) AS cnt
         FROM search_log
         WHERE user_id = ? AND search_time >= DATE_SUB(NOW(), INTERVAL ? DAY)
         GROUP BY origin, destination
         ORDER BY cnt DESC LIMIT 10`,
        [userId, WINDOW_DAYS]
    );

    if (bookedTrips.length < MIN_SAMPLE_SIZE && searchRows.length === 0) {
        return emptyProfile(userId);
    }

    // ── Price preference — real prices actually paid, not the trip's list price when a seat price exists.
    const prices = bookedTrips
        .map(r => Number(r.seat_price != null ? r.seat_price : r.base_price))
        .filter(p => Number.isFinite(p) && p >= 0);
    const price = prices.length > 0 ? {
        min: Math.min(...prices),
        max: Math.max(...prices),
        avg: Math.round(prices.reduce((s, p) => s + p, 0) / prices.length),
    } : null;

    // ── Time-of-day weights — normalized so the four buckets sum to 1.
    const bucketCounts = { morning: 0, afternoon: 0, evening: 0, night: 0 };
    bookedTrips.forEach(r => {
        const hour = new Date(r.departure_time).getHours();
        bucketCounts[timeBucket(hour)]++;
    });
    const totalTimeSamples = bookedTrips.length;
    const time_weights = totalTimeSamples > 0 ? {
        morning: Math.round((bucketCounts.morning / totalTimeSamples) * 1000) / 1000,
        afternoon: Math.round((bucketCounts.afternoon / totalTimeSamples) * 1000) / 1000,
        evening: Math.round((bucketCounts.evening / totalTimeSamples) * 1000) / 1000,
        night: Math.round((bucketCounts.night / totalTimeSamples) * 1000) / 1000,
    } : null;

    // ── Vehicle-type ratio.
    const vehicleCounts = { GIUONG_NAM: 0, LIMOUSINE: 0, GHE_NGOI: 0 };
    bookedTrips.forEach(r => { vehicleCounts[classifyVehicleType(r.bus_type)]++; });
    const totalVehicleSamples = bookedTrips.length;
    const vehicle_pref = totalVehicleSamples > 0 ? {
        GIUONG_NAM: Math.round((vehicleCounts.GIUONG_NAM / totalVehicleSamples) * 1000) / 1000,
        LIMOUSINE: Math.round((vehicleCounts.LIMOUSINE / totalVehicleSamples) * 1000) / 1000,
        GHE_NGOI: Math.round((vehicleCounts.GHE_NGOI / totalVehicleSamples) * 1000) / 1000,
    } : null;

    // Raw counts alongside the normalized weights — the personalized-search
    // popover ("Dựa trên 8 lần bạn chọn...") cites a real count, not the
    // 0-1 weight, so both need to survive out of this function.
    const time_counts = totalTimeSamples > 0 ? { ...bucketCounts } : null;
    const vehicle_counts = totalVehicleSamples > 0 ? { ...vehicleCounts } : null;

    // ── Route frequency — blend booking history (weight 2, real commitment) with search-only interest (weight 1).
    const routeFreq = new Map();
    bookedTrips.forEach(r => {
        const key = `${r.origin}|${r.destination}`;
        routeFreq.set(key, (routeFreq.get(key) || 0) + 2);
    });
    searchRows.forEach(r => {
        const key = `${r.origin}|${r.destination}`;
        routeFreq.set(key, (routeFreq.get(key) || 0) + Number(r.cnt));
    });
    const frequent_routes = [...routeFreq.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([key, weight]) => {
            const [origin, destination] = key.split('|');
            return { origin, destination, weight };
        });

    return {
        user_id: userId,
        has_data: true,
        sample_size: bookedTrips.length,
        price,
        time_weights,
        time_counts,
        vehicle_pref,
        vehicle_counts,
        frequent_routes,
        computed_at: new Date(),
    };
}

async function readCache(userId) {
    const [[row]] = await db.query(
        `SELECT * FROM user_profiles_ai WHERE user_id = ?`, [userId]
    );
    if (!row) return null;
    const ageMinutes = (Date.now() - new Date(row.computed_at).getTime()) / 60000;
    if (ageMinutes > CACHE_TTL_MINUTES) return null;
    return {
        user_id: row.user_id,
        has_data: row.sample_size >= MIN_SAMPLE_SIZE,
        sample_size: row.sample_size,
        price: row.price_avg != null ? { min: Number(row.price_min), max: Number(row.price_max), avg: Number(row.price_avg) } : null,
        time_weights: row.weight_morning != null ? {
            morning: Number(row.weight_morning), afternoon: Number(row.weight_afternoon),
            evening: Number(row.weight_evening), night: Number(row.weight_night),
        } : null,
        time_counts: row.time_counts ? JSON.parse(row.time_counts) : null,
        vehicle_pref: row.vehicle_pref ? JSON.parse(row.vehicle_pref) : null,
        vehicle_counts: row.vehicle_counts ? JSON.parse(row.vehicle_counts) : null,
        frequent_routes: row.frequent_routes ? JSON.parse(row.frequent_routes) : [],
        computed_at: row.computed_at,
    };
}

async function writeCache(profile) {
    await db.query(
        `INSERT INTO user_profiles_ai
           (user_id, price_min, price_max, price_avg, weight_morning, weight_afternoon, weight_evening, weight_night, time_counts, vehicle_pref, vehicle_counts, frequent_routes, sample_size, computed_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())
         ON DUPLICATE KEY UPDATE
           price_min=VALUES(price_min), price_max=VALUES(price_max), price_avg=VALUES(price_avg),
           weight_morning=VALUES(weight_morning), weight_afternoon=VALUES(weight_afternoon),
           weight_evening=VALUES(weight_evening), weight_night=VALUES(weight_night),
           time_counts=VALUES(time_counts), vehicle_pref=VALUES(vehicle_pref), vehicle_counts=VALUES(vehicle_counts),
           frequent_routes=VALUES(frequent_routes),
           sample_size=VALUES(sample_size), computed_at=NOW()`,
        [
            profile.user_id,
            profile.price ? profile.price.min : null,
            profile.price ? profile.price.max : null,
            profile.price ? profile.price.avg : null,
            profile.time_weights ? profile.time_weights.morning : null,
            profile.time_weights ? profile.time_weights.afternoon : null,
            profile.time_weights ? profile.time_weights.evening : null,
            profile.time_weights ? profile.time_weights.night : null,
            profile.time_counts ? JSON.stringify(profile.time_counts) : null,
            profile.vehicle_pref ? JSON.stringify(profile.vehicle_pref) : null,
            profile.vehicle_counts ? JSON.stringify(profile.vehicle_counts) : null,
            JSON.stringify(profile.frequent_routes || []),
            profile.sample_size,
        ]
    );
}

/**
 * Returns the user's behavior-derived preference vector. Serves from the
 * user_profiles_ai cache when fresh (< CACHE_TTL_MINUTES old); otherwise
 * recomputes from real history and writes the cache through. Best-effort:
 * a cache-write failure never breaks the read path — profiling still
 * returns a correct answer, just without persisting it this time.
 */
async function getUserProfile(userId, { skipCache = false } = {}) {
    if (!userId) return emptyProfile(null);

    if (!skipCache) {
        try {
            const cached = await readCache(userId);
            if (cached) return cached;
        } catch (e) { /* cache table not ready / transient error — fall through to live compute */ }
    }

    const profile = await computeProfile(userId);
    try { await writeCache(profile); } catch (e) { /* best-effort cache write */ }
    return profile;
}

module.exports = { getUserProfile, classifyVehicleType, timeBucket, MIN_SAMPLE_SIZE, WINDOW_DAYS };
