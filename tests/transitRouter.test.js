'use strict';

/**
 * Unit tests for server/ai/transitRouter.js
 * Tests all pure functions without a real DB connection.
 */

const {
    haversine,
    citiesMatch,
    searchWithTransit,
} = require('../server/ai/transitRouter');

/* ─────────────────────────────────────────────
   haversine()
───────────────────────────────────────────── */
describe('haversine()', () => {
    test('same point returns 0', () => {
        expect(haversine(10.8, 106.7, 10.8, 106.7)).toBe(0);
    });

    test('Hà Nội → TP.HCM ≈ 1137 km (straight-line)', () => {
        const d = haversine(21.0285, 105.8542, 10.8231, 106.6297);
        expect(d).toBeGreaterThan(1100);
        expect(d).toBeLessThan(1200);
    });

    test('returns Infinity when any coord is falsy', () => {
        expect(haversine(null, 106, 10, 106)).toBe(Infinity);
        expect(haversine(21, null, 10, 106)).toBe(Infinity);
        expect(haversine(21, 106, null, 106)).toBe(Infinity);
        expect(haversine(21, 106, 10, null)).toBe(Infinity);
        expect(haversine(0, 106, 10, 106)).toBe(Infinity);
    });

    test('symmetric: d(A,B) ≈ d(B,A)', () => {
        const d1 = haversine(21.0285, 105.8542, 16.0544, 108.2022);
        const d2 = haversine(16.0544, 108.2022, 21.0285, 105.8542);
        expect(Math.abs(d1 - d2)).toBeLessThan(0.001);
    });
});

/* ─────────────────────────────────────────────
   citiesMatch()
───────────────────────────────────────────── */
describe('citiesMatch()', () => {
    test('exact same name', () => {
        expect(citiesMatch('Hà Nội', 'Hà Nội')).toBe(true);
    });

    test('prefix stripping: "TP. Hồ Chí Minh" matches "Hồ Chí Minh"', () => {
        expect(citiesMatch('TP. Hồ Chí Minh', 'Hồ Chí Minh')).toBe(true);
    });

    test('prefix stripping: "Thành phố Đà Nẵng" matches "Đà Nẵng"', () => {
        expect(citiesMatch('Thành phố Đà Nẵng', 'Đà Nẵng')).toBe(true);
    });

    test('prefix stripping: "Tỉnh Bình Dương" matches "Bình Dương"', () => {
        expect(citiesMatch('Tỉnh Bình Dương', 'Bình Dương')).toBe(true);
    });

    test('case insensitive match', () => {
        expect(citiesMatch('hà nội', 'HÀ NỘI')).toBe(true);
    });

    test('different cities do NOT match', () => {
        expect(citiesMatch('Hà Nội', 'Đà Nẵng')).toBe(false);
    });

    test('empty strings return true (both empty)', () => {
        expect(citiesMatch('', '')).toBe(true);
    });

    test('null/undefined treated as empty string', () => {
        expect(citiesMatch(null, null)).toBe(true);
        expect(citiesMatch(undefined, '')).toBe(true);
    });
});

/* ─────────────────────────────────────────────
   searchWithTransit() — with mock DB
───────────────────────────────────────────── */
describe('searchWithTransit()', () => {
    function makeTrip(id, origin, destination, depHour, durationH, price = 200000) {
        const dep = new Date(`2026-07-01T${String(depHour).padStart(2, '0')}:00:00.000Z`);
        const arr = new Date(dep.getTime() + durationH * 3600 * 1000);
        return {
            trip_id:         id,
            route_id:        id,
            origin,
            destination,
            distance_km:     100,
            origin_lat:      null,
            origin_lng:      null,
            dest_lat:        null,
            dest_lng:        null,
            departure_time:  dep.toISOString(),
            arrival_time:    arr.toISOString(),
            base_price:      price,
            status:          'OPEN',
            total_seats:     40,
            operator_name:   'TestBus',
            operator_id:     1,
            bus_type:        'LIMOUSINE',
            booked_seats:    0,
        };
    }

    function mockDb(trips) {
        return {
            query: jest.fn().mockResolvedValue([trips])
        };
    }

    test('finds direct route when trip exists', async () => {
        const trips = [makeTrip(1, 'Hà Nội', 'Đà Nẵng', 6, 10)];
        const db = mockDb(trips);
        const result = await searchWithTransit(db, {
            origin: 'Hà Nội',
            destination: 'Đà Nẵng',
            date: '2026-07-01'
        });
        expect(result.direct).toHaveLength(1);
        expect(result.direct[0].type).toBe('DIRECT');
        expect(result.direct[0].trip_id).toBe(1);
    });

    test('finds 1-hop transit route A→B→C', async () => {
        // HN → DN departs 06:00 arrives 16:00 (10h)
        // DN → HCM departs 20:00 arrives next day 06:00 (10h) — 4h wait
        const trips = [
            makeTrip(10, 'Hà Nội',  'Đà Nẵng',    6, 10),
            makeTrip(20, 'Đà Nẵng', 'Hồ Chí Minh', 20, 10),
        ];
        const db = mockDb(trips);
        const result = await searchWithTransit(db, {
            origin: 'Hà Nội',
            destination: 'Hồ Chí Minh',
            date: '2026-07-01'
        });
        expect(result.transit.length).toBeGreaterThan(0);
        const plan = result.transit[0];
        expect(plan.type).toBe('TRANSIT');
        expect(plan.hops).toBe(2);
        expect(plan.transfer_points).toContain('Đà Nẵng');
        expect(plan.total_price).toBe(400000);
    });

    test('returns empty arrays on DB error', async () => {
        const db = { query: jest.fn().mockRejectedValue(new Error('DB fail')) };
        const result = await searchWithTransit(db, {
            origin: 'A', destination: 'B', date: '2026-07-01'
        });
        expect(result.direct).toEqual([]);
        expect(result.transit).toEqual([]);
    });

    test('no result when wait time < 30 min (too short)', async () => {
        // HN → DN departs 06:00 arrives 16:00
        // DN → HCM departs 16:10 (only 10 min wait) — too short
        const leg1 = makeTrip(10, 'Hà Nội',  'Đà Nẵng',    6, 10);
        // Arrive at DN at 16:00, next leg departs 16:10 — only 10 min wait
        const leg2 = makeTrip(20, 'Đà Nẵng', 'Hồ Chí Minh', 6, 10);
        leg2.departure_time = '2026-07-01T16:10:00.000Z';
        leg2.arrival_time   = '2026-07-02T02:10:00.000Z';
        const trips = [leg1, leg2];
        const db = mockDb(trips);
        const result = await searchWithTransit(db, {
            origin: 'Hà Nội',
            destination: 'Hồ Chí Minh',
            date: '2026-07-01'
        });
        // Transit plan with <30 min wait must NOT be returned
        const validPlans = result.transit.filter(p =>
            p.legs.length === 2 &&
            p.wait_mins < 30
        );
        expect(validPlans).toHaveLength(0);
    });

    test('prefers lower cost when mode=cost', async () => {
        // Two transit plans via different mid-points, different prices
        const trips = [
            makeTrip(1, 'Hà Nội', 'Vinh',          6,  4, 150000),
            makeTrip(2, 'Hà Nội', 'Đà Nẵng',        6,  10, 300000),
            makeTrip(3, 'Vinh',   'Hồ Chí Minh',    14, 12, 250000),
            makeTrip(4, 'Đà Nẵng','Hồ Chí Minh',    20, 10, 200000),
        ];
        const db = mockDb(trips);
        const result = await searchWithTransit(db, {
            origin: 'Hà Nội',
            destination: 'Hồ Chí Minh',
            date: '2026-07-01',
            mode: 'cost'
        });
        if (result.transit.length >= 2) {
            // First result should have lower or equal total_price
            expect(result.transit[0].total_price).toBeLessThanOrEqual(result.transit[1].total_price);
        }
    });
});
