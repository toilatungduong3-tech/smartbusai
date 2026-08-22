'use strict';
/**
 * SPRINT 11 — Real Behavioral AI, Preference Learning & Booking Intent
 * Prediction.
 *
 * Mocking strategy: single hoisted jest.mock('../server/config/db', ...)
 * per file, module required after, reused via mockResolvedValueOnce
 * chains (matching phase7/phase10/phase11-login's own documented
 * convention — no jest.resetModules()/doMock() anywhere).
 */

const fs = require('fs');
const path = require('path');

jest.mock('../server/config/db', () => ({ query: jest.fn(), getConnection: jest.fn() }));
const db = require('../server/config/db');

const profiling = require('../server/services/aiUserProfilingService');
const ranking = require('../server/services/aiSearchRanking');
const intent = require('../server/services/aiIntentPredictor');
const forecaster = require('../server/services/aiDemandForecaster');
const passengerAICtrl = require('../server/controllers/passengerAIController');
const tripCtrl = require('../server/controllers/tripController');

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

beforeEach(() => { jest.clearAllMocks(); });

/* ══════════════════════════════════════════
   1. aiUserProfilingService — pure classification helpers
══════════════════════════════════════════ */
describe('aiUserProfilingService — classifyVehicleType (real live bus_type values)', () => {
    test.each([
        ['LIMOUSINE', 'LIMOUSINE'],
        ['VIP Limousine 16 chỗ', 'LIMOUSINE'],      // Limousine keyword wins over bare VIP
        ['VIP Limousine 22 chỗ', 'LIMOUSINE'],
        ['SLEEPER', 'GIUONG_NAM'],
        ['Giường nằm 34 chỗ', 'GIUONG_NAM'],
        ['Giường nằm 40 chỗ', 'GIUONG_NAM'],
        ['STANDARD', 'GHE_NGOI'],
        ['EXPRESS', 'GHE_NGOI'],
        ['Ghế ngồi 45 chỗ', 'GHE_NGOI'],
        [null, 'GHE_NGOI'],
        ['', 'GHE_NGOI'],
    ])('%s -> %s', (input, expected) => {
        expect(profiling.classifyVehicleType(input)).toBe(expected);
    });
});

describe('aiUserProfilingService — timeBucket', () => {
    test.each([
        [5, 'morning'], [10, 'morning'],
        [11, 'afternoon'], [16, 'afternoon'],
        [17, 'evening'], [21, 'evening'],
        [22, 'night'], [0, 'night'], [4, 'night'],
    ])('hour %i -> %s', (hour, bucket) => {
        expect(profiling.timeBucket(hour)).toBe(bucket);
    });
});

/* ══════════════════════════════════════════
   2. aiUserProfilingService.getUserProfile — real preference-vector math
══════════════════════════════════════════ */
describe('aiUserProfilingService.getUserProfile — computed from mocked history', () => {
    test('price/time/vehicle vectors are computed correctly from a known fixture, and normalized weights sum to 1', async () => {
        const bookedTrips = [
            { departure_time: '2026-08-10T20:00:00Z', base_price: 500000, bus_type: 'Giường nằm 40 chỗ', origin: 'Hà Nội', destination: 'Đà Nẵng', seat_price: 500000 },
            { departure_time: '2026-08-11T21:00:00Z', base_price: 600000, bus_type: 'Giường nằm 40 chỗ', origin: 'Hà Nội', destination: 'Đà Nẵng', seat_price: 600000 },
            { departure_time: '2026-08-12T08:00:00Z', base_price: 300000, bus_type: 'LIMOUSINE', origin: 'Hà Nội', destination: 'Huế', seat_price: 300000 },
            { departure_time: '2026-08-13T20:30:00Z', base_price: 550000, bus_type: 'Giường nằm 34 chỗ', origin: 'Hà Nội', destination: 'Đà Nẵng', seat_price: 550000 },
        ];
        db.query
            .mockResolvedValueOnce([bookedTrips])   // booking-history query
            .mockResolvedValueOnce([[]])            // search_log query
            .mockResolvedValueOnce([{}]);           // writeCache INSERT

        const profile = await profiling.getUserProfile(42, { skipCache: true });

        expect(profile.has_data).toBe(true);
        expect(profile.sample_size).toBe(4);
        expect(profile.price).toEqual({ min: 300000, max: 600000, avg: 487500 }); // (500000+600000+300000+550000)/4

        // Local-timezone-agnostic: just assert the weights are a valid
        // probability distribution that sums to 1, and that the bucket
        // holding all 3 "Giường nằm" bookings dominates (>= 0.5).
        const timeSum = Object.values(profile.time_weights).reduce((s, w) => s + w, 0);
        expect(Math.round(timeSum * 100) / 100).toBe(1);

        expect(profile.vehicle_pref.GIUONG_NAM).toBeCloseTo(0.75, 2);
        expect(profile.vehicle_pref.LIMOUSINE).toBeCloseTo(0.25, 2);
        expect(profile.vehicle_pref.GHE_NGOI).toBe(0);
        expect(profile.vehicle_counts).toEqual({ GIUONG_NAM: 3, LIMOUSINE: 1, GHE_NGOI: 0 });

        expect(profile.frequent_routes[0]).toEqual({ origin: 'Hà Nội', destination: 'Đà Nẵng', weight: 6 }); // 3 bookings * weight 2
    });

    test('fewer than MIN_SAMPLE_SIZE bookings and zero searches -> has_data:false, no fabricated averages', async () => {
        db.query
            .mockResolvedValueOnce([[{ departure_time: '2026-08-10T20:00:00Z', base_price: 100000, bus_type: 'STANDARD', origin: 'A', destination: 'B', seat_price: null }]])
            .mockResolvedValueOnce([[]]);

        const profile = await profiling.getUserProfile(7, { skipCache: true });
        expect(profile.has_data).toBe(false);
        expect(profile.price).toBeNull();
        expect(profile.time_weights).toBeNull();
        expect(profile.vehicle_pref).toBeNull();
    });

    test('search-only interest (no bookings) still contributes to frequent_routes but not to price/time/vehicle', async () => {
        db.query
            .mockResolvedValueOnce([[]]) // no bookings
            .mockResolvedValueOnce([[{ origin: 'X', destination: 'Y', cnt: 3 }, { origin: 'A', destination: 'B', cnt: 5 }]]);

        const profile = await profiling.getUserProfile(8, { skipCache: true });
        // 0 bookings + non-empty search rows still counts as "some data" per
        // the emptyProfile() gate (bookedTrips.length < MIN && searchRows.length === 0)
        expect(profile.has_data).toBe(true);
        expect(profile.price).toBeNull();
        expect(profile.frequent_routes[0]).toEqual({ origin: 'A', destination: 'B', weight: 5 });
    });

    test('no user_id -> empty profile immediately, zero DB calls', async () => {
        const profile = await profiling.getUserProfile(null);
        expect(profile.has_data).toBe(false);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('a fresh cache row is served without recomputing (readCache short-circuits before any compute query)', async () => {
        const freshRow = {
            user_id: 5, sample_size: 4,
            price_min: 100000, price_max: 500000, price_avg: 300000,
            weight_morning: 0.25, weight_afternoon: 0.25, weight_evening: 0.25, weight_night: 0.25,
            time_counts: null, vehicle_pref: JSON.stringify({ GIUONG_NAM: 1, LIMOUSINE: 0, GHE_NGOI: 0 }),
            vehicle_counts: null, frequent_routes: JSON.stringify([]),
            computed_at: new Date(), // fresh — 0 minutes old
        };
        db.query.mockResolvedValueOnce([[freshRow]]);

        const profile = await profiling.getUserProfile(5);
        expect(db.query).toHaveBeenCalledTimes(1); // only the cache SELECT — no compute queries
        expect(profile.has_data).toBe(true);
        expect(profile.price).toEqual({ min: 100000, max: 500000, avg: 300000 });
    });

    test('a stale cache row (older than the TTL) is ignored and recomputed', async () => {
        const staleRow = {
            user_id: 5, sample_size: 4, price_min: 1, price_max: 2, price_avg: 1.5,
            weight_morning: 1, weight_afternoon: 0, weight_evening: 0, weight_night: 0,
            time_counts: null, vehicle_pref: null, vehicle_counts: null, frequent_routes: '[]',
            computed_at: new Date(Date.now() - 1000 * 60 * 120), // 2 hours old — TTL is 60 min
        };
        db.query
            .mockResolvedValueOnce([[staleRow]])  // readCache — stale
            .mockResolvedValueOnce([[]])           // recompute: bookings
            .mockResolvedValueOnce([[]])           // recompute: search_log
            .mockResolvedValueOnce([{}]);          // writeCache skipped path not hit since has_data false -> still attempts write

        const profile = await profiling.getUserProfile(5);
        expect(db.query.mock.calls.length).toBeGreaterThan(1); // did not stop at the stale cache read
        expect(profile.has_data).toBe(false); // recomputed from (empty) real data, not the stale cached values
    });
});

/* ══════════════════════════════════════════
   3. aiSearchRanking — S_match scoring + ranking order
══════════════════════════════════════════ */
describe('aiSearchRanking.scoreTrip / rankTrips', () => {
    const nightSleeperLover = {
        has_data: true,
        price: { min: 300000, max: 600000, avg: 450000 },
        time_weights: { morning: 0, afternoon: 0, evening: 0.2, night: 0.8 },
        time_counts: { morning: 0, afternoon: 0, evening: 1, night: 4 },
        vehicle_pref: { GIUONG_NAM: 1, LIMOUSINE: 0, GHE_NGOI: 0 },
        vehicle_counts: { GIUONG_NAM: 5, LIMOUSINE: 0, GHE_NGOI: 0 },
    };

    test('a trip matching price+time+vehicle preference scores near 100', () => {
        const trip = { base_price: 450000, departure_time: '2026-08-19T23:00:00', bus_type: 'Giường nằm 40 chỗ', avg_rating: 4.8 };
        const result = ranking.scoreTrip(trip, nightSleeperLover);
        expect(result).not.toBeNull();
        expect(result.ai_match_score).toBeGreaterThanOrEqual(90);
        expect(result.ai_match_reason).toMatch(/Giường nằm/);
    });

    test('a trip that violates every preference (wrong price/time/vehicle) scores low', () => {
        const trip = { base_price: 2000000, departure_time: '2026-08-19T08:00:00', bus_type: 'STANDARD', avg_rating: 1 };
        const result = ranking.scoreTrip(trip, nightSleeperLover);
        expect(result).not.toBeNull();
        expect(result.ai_match_score).toBeLessThan(40);
    });

    test('rankTrips sorts the matching trip to the top of a mixed list', () => {
        const badTrip = { trip_id: 1, base_price: 2000000, departure_time: '2026-08-19T08:00:00', bus_type: 'STANDARD', avg_rating: 1 };
        const goodTrip = { trip_id: 2, base_price: 450000, departure_time: '2026-08-19T23:00:00', bus_type: 'Giường nằm 40 chỗ', avg_rating: 4.8 };
        const mediumTrip = { trip_id: 3, base_price: 500000, departure_time: '2026-08-19T12:00:00', bus_type: 'LIMOUSINE', avg_rating: 4.0 };

        const ranked = ranking.rankTrips([badTrip, mediumTrip, goodTrip], nightSleeperLover);
        expect(ranked[0].trip_id).toBe(2); // the genuinely preferred trip is first
        expect(ranked[0].ai_match_score).toBeGreaterThan(ranked[1].ai_match_score);
        expect(ranked[1].ai_match_score).toBeGreaterThan(ranked[2].ai_match_score);
    });

    test('no profile / has_data:false -> trips returned completely unchanged (no ai_match_score field at all)', () => {
        const trips = [{ trip_id: 1, base_price: 100 }, { trip_id: 2, base_price: 200 }];
        expect(ranking.rankTrips(trips, null)).toBe(trips); // same reference, zero mutation
        expect(ranking.rankTrips(trips, { has_data: false })).toBe(trips);
        expect(ranking.scoreTrip(trips[0], { has_data: false })).toBeNull();
    });
});

/* ══════════════════════════════════════════
   4. tripController.searchTrips — personalization is additive-only
══════════════════════════════════════════ */
describe('tripController.searchTrips — Sprint 11 personalized ranking integration', () => {
    test('anonymous search (no user_id) returns rows with zero shape change — no ai_match_score field added', async () => {
        const rows = [{ trip_id: 1, origin: 'A', destination: 'B', base_price: 100000, departure_time: '2026-08-19T10:00:00', bus_type: 'STANDARD', avg_rating: 4 }];
        db.query.mockResolvedValueOnce([rows]);
        const req = { query: {} };
        const res = mockRes();
        await tripCtrl.searchTrips(req, res);
        expect(res.json).toHaveBeenCalledWith(rows);
        expect(db.query).toHaveBeenCalledTimes(1); // no extra profiling query fired
    });

    test('an explicit sort param disables personalization even with a user_id present (the user\'s explicit choice wins)', async () => {
        const rows = [{ trip_id: 1, base_price: 100000 }];
        db.query.mockResolvedValueOnce([rows]);
        const req = { query: { user_id: '42', sort: 'asc' } };
        const res = mockRes();
        await tripCtrl.searchTrips(req, res);
        expect(res.json).toHaveBeenCalledWith(rows);
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    test('a resolvable user_id with no explicit sort triggers personalization and can add ai_match_score', async () => {
        const rows = [{ trip_id: 1, origin: 'A', destination: 'B', base_price: 450000, departure_time: '2026-08-19T23:00:00', bus_type: 'Giường nằm 40 chỗ', avg_rating: 4.8 }];
        db.query
            .mockResolvedValueOnce([rows])                                          // runTripSearch
            .mockResolvedValueOnce([[]])                                            // profiling: readCache — no row, falls through to compute
            .mockResolvedValueOnce([[
                { departure_time: '2026-08-10T22:00:00', base_price: 450000, bus_type: 'Giường nằm 40 chỗ', origin: 'A', destination: 'B', seat_price: 450000 },
                { departure_time: '2026-08-11T22:00:00', base_price: 450000, bus_type: 'Giường nằm 40 chỗ', origin: 'A', destination: 'B', seat_price: 450000 },
            ]])                                                                       // profiling: bookings
            .mockResolvedValueOnce([[]])                                            // profiling: search_log
            .mockResolvedValueOnce([{}]);                                           // profiling: writeCache

        const req = { query: { user_id: '42' } };
        const res = mockRes();
        await tripCtrl.searchTrips(req, res);

        const jsonArg = res.json.mock.calls[0][0];
        expect(jsonArg[0].ai_match_score).toBeDefined();
    });

    test('personalization failure never breaks the search response', async () => {
        const rows = [{ trip_id: 1, base_price: 100000 }];
        db.query
            .mockResolvedValueOnce([rows])
            .mockRejectedValueOnce(new Error('profiling DB blew up'));

        const req = { query: { user_id: '42' } };
        const res = mockRes();
        await tripCtrl.searchTrips(req, res);
        expect(res.json).toHaveBeenCalledWith(rows); // falls back to the unranked rows, not a 500
    });
});

/* ══════════════════════════════════════════
   5. aiIntentPredictor — Booking Intent Score
══════════════════════════════════════════ */
describe('aiIntentPredictor.predictIntent', () => {
    test('a fresh, fully-progressed session (search -> views -> seat -> checkout, zero idle) scores HIGH with LOW dropoff risk', () => {
        const now = new Date().toISOString();
        const result = intent.predictIntent({ session_events: [
            { type: 'SEARCH', timestamp: now },
            { type: 'VIEW_TRIP', timestamp: now },
            { type: 'VIEW_TRIP', timestamp: now },
            { type: 'SELECT_SEAT', timestamp: now },
            { type: 'START_PAYMENT', timestamp: now },
        ] });
        expect(result.intent_score).toBe(77); // 5*min(1,4) + 6*min(2,5) + 25 + 35 - 0 = 5+12+25+35
        expect(result.intent_level).toBe('HIGH');
        expect(result.dropoff_risk).toBe('LOW');
        expect(result.recommended_action).toBe('HOLD_SEAT');
    });

    test('a session idle at the checkout step is flagged as HIGH dropoff risk (classic abandoned-cart signal) even though the idle penalty pulls intent_level down to MEDIUM', () => {
        const staleTime = new Date(Date.now() - 10 * 60000).toISOString(); // 10 min ago
        const result = intent.predictIntent({ session_events: [
            { type: 'SEARCH', timestamp: staleTime },
            { type: 'SELECT_SEAT', timestamp: staleTime },
            { type: 'START_PAYMENT', timestamp: staleTime },
        ] });
        // score = 5*1(search) + 25(seat) + 35(checkout) - 2*10(idle) = 45 -> MEDIUM
        expect(result.intent_level).toBe('MEDIUM');
        expect(result.dropoff_risk).toBe('HIGH');
        expect(result.recommended_action).toBe('SEND_REMINDER'); // MEDIUM intent + HIGH risk -> nudge, not hold a seat
    });

    test('a HIGH-intent session that goes idle right at checkout gets the strongest save action (SHOW_PROMO_OR_HOLD_SEAT)', () => {
        const staleTime = new Date(Date.now() - 3 * 60000).toISOString(); // exactly 3 min ago
        const result = intent.predictIntent({ session_events: [
            { type: 'SEARCH', timestamp: staleTime },
            { type: 'VIEW_TRIP', timestamp: staleTime },
            { type: 'VIEW_TRIP', timestamp: staleTime },
            { type: 'SELECT_SEAT', timestamp: staleTime },
            { type: 'START_PAYMENT', timestamp: staleTime },
        ] });
        // score = 5 + 12 + 25 + 35 - 2*3 = 71 -> still HIGH; idle >= 3min at checkout -> HIGH risk
        expect(result.intent_level).toBe('HIGH');
        expect(result.dropoff_risk).toBe('HIGH');
        expect(result.recommended_action).toBe('SHOW_PROMO_OR_HOLD_SEAT');
    });

    test('an empty session scores 0, LOW level, NO_ACTION', () => {
        const result = intent.predictIntent({ session_events: [] });
        expect(result.intent_score).toBe(0);
        expect(result.intent_level).toBe('LOW');
        expect(result.recommended_action).toBe('NO_ACTION');
    });

    test('non-array session_events is treated as empty rather than throwing', () => {
        expect(() => intent.predictIntent({ session_events: undefined })).not.toThrow();
        expect(intent.predictIntent({ session_events: 'not-an-array' }).event_count).toBe(0);
    });

    test('score is always clamped to [0,100]', () => {
        const now = new Date().toISOString();
        const manySearches = Array.from({ length: 50 }, () => ({ type: 'SEARCH', timestamp: now }));
        const result = intent.predictIntent({ session_events: manySearches });
        expect(result.intent_score).toBeLessThanOrEqual(100);
        expect(result.intent_score).toBeGreaterThanOrEqual(0);
    });
});

describe('passengerAIController.predictIntent (POST /api/ai/predict-intent)', () => {
    test('valid session_events -> 200 with the real computed result, and best-effort logs to ai_intent_log', async () => {
        db.query.mockResolvedValueOnce([{}]); // ai_intent_log INSERT
        const req = { body: { session_events: [{ type: 'SEARCH', timestamp: new Date().toISOString() }] }, user: null };
        const res = mockRes();
        await passengerAICtrl.predictIntent(req, res);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            intent_score: expect.any(Number), intent_level: expect.any(String),
            dropoff_risk: expect.any(String), recommended_action: expect.any(String),
        }));
    });

    test('missing/invalid session_events -> 400, never reaches the DB', async () => {
        const req = { body: {} };
        const res = mockRes();
        await passengerAICtrl.predictIntent(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(db.query).not.toHaveBeenCalled();
    });
});

/* ══════════════════════════════════════════
   6. aiDemandForecaster — system-wide demand forecast
══════════════════════════════════════════ */
describe('aiDemandForecaster.computeDemandForecast', () => {
    test('a route with a rising booking trend and high seat-fill gets a high sellout_risk_pct and a positive demand_change_pct', async () => {
        db.query
            .mockResolvedValueOnce([[ // upcoming trips
                { trip_id: 1, route_id: 10, origin: 'HN', destination: 'DN', departure_time: '2026-08-20T10:00:00', total_seats: 40, available_seats: 4 }, // 90% full
            ]])
            .mockResolvedValueOnce([[ // trend
                { route_id: 10, lastWeekBookings: 20, priorBookings: 20 }, // priorWeeklyAvg = 20/4 = 5; lastWeek 20 -> +300%
            ]]);

        const results = await forecaster.computeDemandForecast();
        expect(results).toHaveLength(1);
        expect(results[0].demand_change_pct).toBeGreaterThan(0);
        expect(results[0].sellout_risk_pct).toBeGreaterThan(70);
        expect(results[0].message).toMatch(/tăng/);
    });

    test('no prior-week baseline -> demand_change_pct is null (never a fabricated percentage), not 0 or 100', async () => {
        db.query
            .mockResolvedValueOnce([[
                { trip_id: 1, route_id: 11, origin: 'A', destination: 'B', departure_time: '2026-08-20T10:00:00', total_seats: 40, available_seats: 40 },
            ]])
            .mockResolvedValueOnce([[]]); // no trend rows at all

        const results = await forecaster.computeDemandForecast();
        expect(results[0].demand_change_pct).toBeNull();
        expect(results[0].sellout_risk_pct).toBe(0); // 0% filled, no baseline to inflate risk
        expect(results[0].message).toMatch(/chưa đủ dữ liệu/);
    });

    test('no upcoming trips at all -> empty array, zero trend query fired', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const results = await forecaster.computeDemandForecast();
        expect(results).toEqual([]);
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    test('results are sorted by sellout_risk_pct descending', async () => {
        db.query
            .mockResolvedValueOnce([[
                { trip_id: 1, route_id: 1, origin: 'A', destination: 'B', departure_time: '2026-08-20T10:00:00', total_seats: 40, available_seats: 38 }, // low fill
                { trip_id: 2, route_id: 2, origin: 'C', destination: 'D', departure_time: '2026-08-20T10:00:00', total_seats: 40, available_seats: 2 },  // high fill
            ]])
            .mockResolvedValueOnce([[]]);
        const results = await forecaster.computeDemandForecast();
        expect(results[0].route_id).toBe(2);
        expect(results[0].sellout_risk_pct).toBeGreaterThan(results[1].sellout_risk_pct);
    });
});

describe('passengerAIController.demandForecast / getBehavioralAnalytics (Admin/Operator endpoints)', () => {
    test('demandForecast returns a real forecast array and persists it (best-effort)', async () => {
        db.query
            .mockResolvedValueOnce([[{ trip_id: 1, route_id: 1, origin: 'A', destination: 'B', departure_time: '2026-08-20T10:00:00', total_seats: 40, available_seats: 40 }]])
            .mockResolvedValueOnce([[]])
            .mockResolvedValueOnce([{}]); // persistForecast upsert
        const req = { query: {} };
        const res = mockRes();
        await passengerAICtrl.demandForecast(req, res);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ forecast: expect.any(Array) }));
    });

    test('getBehavioralAnalytics aggregates real PAID-booking history into price/time/vehicle buckets', async () => {
        db.query
            .mockResolvedValueOnce([[
                { departure_time: '2026-08-10T22:00:00', base_price: 450000, bus_type: 'Giường nằm 40 chỗ', seat_price: 450000 },
                { departure_time: '2026-08-11T09:00:00', base_price: 90000, bus_type: 'STANDARD', seat_price: null },
            ]])
            .mockResolvedValueOnce([[]]); // ai_intent_log
        const req = {};
        const res = mockRes();
        await passengerAICtrl.getBehavioralAnalytics(req, res);
        const arg = res.json.mock.calls[0][0];
        expect(arg.sample_size).toBe(2);
        expect(arg.price_distribution.duoi_100k).toBe(1);
        expect(arg.price_distribution['200k_400k'] + arg.price_distribution.tren_400k).toBe(1);
        expect(arg.vehicle_distribution.GIUONG_NAM).toBe(1);
        expect(arg.vehicle_distribution.GHE_NGOI).toBe(1);
    });
});

/* ══════════════════════════════════════════
   7. Schema / migration
══════════════════════════════════════════ */
describe('migrate_v19.sql / migrate.js — Sprint 11 schema', () => {
    test('migrate_v19.sql adds the structured behavior-event columns without touching action/action_time', () => {
        const sql = fs.readFileSync(path.join(__dirname, '../server/config/migrate_v19.sql'), 'utf8');
        expect(sql).toMatch(/ADD COLUMN event_type ENUM\('SEARCH','VIEW_TRIP','SELECT_SEAT','START_PAYMENT','COMPLETE_BOOKING','CANCEL'\)/);
        expect(sql).toMatch(/ADD COLUMN event_data JSON/);
        expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS user_profiles_ai/);
        expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS ai_intent_log/);
        expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS ai_demand_forecast/);
        expect(sql).not.toMatch(/DROP COLUMN action\b/);
    });

    test('migrate.js registers migrate_v19.sql and verifies its schema objects', () => {
        const js = fs.readFileSync(path.join(__dirname, '../server/config/migrate.js'), 'utf8');
        expect(js).toMatch(/'migrate_v19\.sql'/);
        expect(js).toMatch(/user_behavior\.event_type/);
        expect(js).toMatch(/user_profiles_ai/);
    });
});

/* ══════════════════════════════════════════
   8. Frontend integration — content-level checks
══════════════════════════════════════════ */
describe('public/pages/passenger/index.html — AI Match Score badge', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/pages/passenger/index.html'), 'utf8');

    test('search request includes user_id for logged-in users', () => {
        expect(html).toMatch(/const uid=getUserId&&getUserId\(\);/);
        expect(html).toMatch(/user_id=\$\{encodeURIComponent\(uid\)\}/);
    });

    test('trip card conditionally renders the AI badge only when ai_match_score is present', () => {
        expect(html).toMatch(/t\.ai_match_score!=null/);
        expect(html).toMatch(/🤖 \$\{t\.ai_match_score\}% Phù hợp/);
    });

    test('badge click opens an explanatory popover, and reason/detail text is HTML-escaped before insertion', () => {
        expect(html).toMatch(/function toggleAiMatchPopover\(/);
        expect(html).toMatch(/function escapeHtml\(/);
        expect(html).toMatch(/escapeHtml\(t\.ai_match_reason\|\|''\)/);
    });

    test('has no inline script syntax errors', () => {
        const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
        scripts.forEach(src => expect(() => new Function(src)).not.toThrow());
    });
});

describe('public/pages/admin/admin.html — AI Behavioral Analytics & Demand Forecast section', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/pages/admin/admin.html'), 'utf8');

    test('the new section lives inside the existing "AI & Hành vi" panel rather than a new redundant tab', () => {
        const panelStart = html.indexOf('id="panel-ai"');
        const sectionIdx = html.indexOf('AI Behavioral Analytics & Demand Forecast');
        const panelEnd = html.indexOf('id="panel-reviews"');
        expect(panelStart).toBeGreaterThan(-1);
        expect(sectionIdx).toBeGreaterThan(panelStart);
        expect(sectionIdx).toBeLessThan(panelEnd);
    });

    test('renders the demand forecast heatmap table and the real-time intent log table', () => {
        expect(html).toMatch(/id="aiForecastTable"/);
        expect(html).toMatch(/id="aiIntentLogTable"/);
    });

    test('loadAiBehavioral() calls the real Sprint 11 endpoints', () => {
        expect(html).toMatch(/req\("ai\/behavioral-analytics"\)/);
        expect(html).toMatch(/req\("ai\/demand-forecast/);
    });

    test('has no inline script syntax errors', () => {
        const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
        scripts.forEach(src => expect(() => new Function(src)).not.toThrow());
    });
});

describe('server/routes/passengerAIRoutes.js — Sprint 11 route wiring', () => {
    test('predict-intent is public (optionalAuth), demand-forecast and behavioral-analytics require admin/operator', () => {
        const src = fs.readFileSync(path.join(__dirname, '../server/routes/passengerAIRoutes.js'), 'utf8');
        expect(src).toMatch(/router\.post\('\/predict-intent',\s*aiLimiter,\s*optionalAuth,\s*ctrl\.predictIntent\)/); // Sprint 12 added aiLimiter ahead of optionalAuth
        expect(src).toMatch(/router\.get\('\/demand-forecast',\s*authenticate,\s*requireAdminOrOperator,\s*ctrl\.demandForecast\)/);
        expect(src).toMatch(/router\.get\('\/behavioral-analytics',\s*authenticate,\s*requireAdminOrOperator,\s*ctrl\.getBehavioralAnalytics\)/);
    });
});
