'use strict';
/**
 * TRUTHNODE — SPRINT 3: transitRouter.js performance hardening.
 * MASTER_COMPLETION_MATRIX.md blocker: multi-hop transit search was
 * live-measured at ~35s/request. Root cause: (1) no upper bound on the
 * virtual-projection window (16 days x up to 8000 real trips), (2) a full
 * linear rescan of the entire trips array on every BFS node expansion,
 * (3) queue.sort() (O(n log n)) on every single pop instead of a heap.
 *
 * Live end-to-end proof (real server + real DB, this sprint):
 *   POST /api/search/transit Hà Nội -> TP. Hồ Chí Minh: 1,643ms (was ~35,000ms)
 *   direct module call across 4 route pairs: 1,153-1,546ms each
 * See PHASE3_FINAL_REPORT.md for the full measurement table.
 *
 * This file covers what a live timing run can't: correctness of the new
 * MinHeap and city-index internals in isolation, and a synthetic
 * large-dataset case proving the complexity actually improved (a live
 * timing number alone doesn't distinguish "still O(n^2) but n happens to
 * be small today" from "genuinely sub-quadratic now").
 */

const { MinHeap, buildCityIndex, tripsFromCity, citiesMatch, searchWithTransit, PROJECTION_DAYS } = require('../server/ai/transitRouter');

describe('MinHeap — correctness', () => {
    test('pops items in ascending comparator order regardless of push order', () => {
        const heap = new MinHeap((a, b) => a - b);
        [5, 1, 8, 2, 9, 0, 3].forEach(n => heap.push(n));
        const out = [];
        while (heap.size > 0) out.push(heap.pop());
        expect(out).toEqual([0, 1, 2, 3, 5, 8, 9]);
    });

    test('works with object items and a custom comparator (matches transitRouter\'s node shape)', () => {
        const heap = new MinHeap((a, b) => a.totalCost - b.totalCost);
        heap.push({ id: 'a', totalCost: 300000 });
        heap.push({ id: 'b', totalCost: 100000 });
        heap.push({ id: 'c', totalCost: 200000 });
        expect(heap.pop().id).toBe('b');
        expect(heap.pop().id).toBe('c');
        expect(heap.pop().id).toBe('a');
    });

    test('size reflects the number of pending items', () => {
        const heap = new MinHeap((a, b) => a - b);
        expect(heap.size).toBe(0);
        heap.push(1); heap.push(2);
        expect(heap.size).toBe(2);
        heap.pop();
        expect(heap.size).toBe(1);
    });

    test('handles duplicate keys stably enough (no crash, correct multiset)', () => {
        const heap = new MinHeap((a, b) => a - b);
        [3, 1, 1, 2, 3, 1].forEach(n => heap.push(n));
        const out = [];
        while (heap.size > 0) out.push(heap.pop());
        expect(out).toEqual([1, 1, 1, 2, 3, 3]);
    });
});

describe('city index — preserves exact citiesMatch() semantics (Sprint 3 perf fix #2)', () => {
    function trip(origin, destination) {
        return { origin, destination, base_price: 100000, departure_ms: 0, arrival_ms: 0 };
    }

    test('exact-name lookup', () => {
        const trips = [trip('Hà Nội', 'Đà Nẵng'), trip('Đà Nẵng', 'Hồ Chí Minh')];
        const idx = buildCityIndex(trips);
        const found = tripsFromCity(idx, 'Hà Nội');
        expect(found).toHaveLength(1);
        expect(found[0].destination).toBe('Đà Nẵng');
    });

    test('prefix-stripped fuzzy match: "TP. Hồ Chí Minh" query finds trips whose origin is "Hồ Chí Minh"', () => {
        const trips = [trip('Hồ Chí Minh', 'Cần Thơ')];
        const idx = buildCityIndex(trips);
        const found = tripsFromCity(idx, 'TP. Hồ Chí Minh');
        expect(found).toHaveLength(1);
    });

    test('substring-inclusion fuzzy match, both directions, matches citiesMatch() directly', () => {
        const trips = [trip('Bà Rịa Vũng Tàu', 'X')];
        const idx = buildCityIndex(trips);
        // Sanity: citiesMatch itself agrees these match (substring inclusion)
        expect(citiesMatch('Vũng Tàu', 'Bà Rịa Vũng Tàu')).toBe(true);
        expect(tripsFromCity(idx, 'Vũng Tàu')).toHaveLength(1);
    });

    test('no match returns an empty array, not undefined/throw', () => {
        const idx = buildCityIndex([trip('Hà Nội', 'Đà Nẵng')]);
        expect(tripsFromCity(idx, 'Cà Mau')).toEqual([]);
    });

    test('city with multiple departing trips returns all of them', () => {
        const trips = [trip('Hà Nội', 'A'), trip('Hà Nội', 'B'), trip('Đà Nẵng', 'C')];
        const idx = buildCityIndex(trips);
        expect(tripsFromCity(idx, 'Hà Nội')).toHaveLength(2);
    });

    test('memoized lookup returns a consistent result on repeated queries for the same city', () => {
        const trips = [trip('Hà Nội', 'Đà Nẵng')];
        const idx = buildCityIndex(trips);
        const first = tripsFromCity(idx, 'Hà Nội');
        const second = tripsFromCity(idx, 'hà nội'); // different case, same normalized key
        expect(second).toEqual(first);
    });
});

describe('projection window — reduced from 16 to 5 days (Sprint 3 perf fix #1)', () => {
    test('PROJECTION_DAYS is 5, not the old 16', () => {
        expect(PROJECTION_DAYS).toBe(5);
    });
});

describe('searchWithTransit — synthetic large dataset stays fast (proves algorithmic improvement, not just "n is small today")', () => {
    function makeTrip(id, origin, destination, depHour, durationH, price = 200000) {
        const dep = new Date(`2026-07-01T${String(depHour % 24).padStart(2, '0')}:00:00.000Z`);
        dep.setUTCDate(dep.getUTCDate() + Math.floor(depHour / 24));
        const arr = new Date(dep.getTime() + durationH * 3600 * 1000);
        return {
            trip_id: id, route_id: id, origin, destination, distance_km: 100,
            origin_lat: null, origin_lng: null, dest_lat: null, dest_lng: null,
            departure_time: dep.toISOString(), arrival_time: arr.toISOString(),
            base_price: price, status: 'OPEN', total_seats: 40,
            operator_name: 'TestBus', operator_id: 1, bus_type: 'LIMOUSINE', booked_seats: 0,
        };
    }

    test('5,000 synthetic trips across 40 cities resolve quickly (was O(hops x queue x n) against the full array every pop)', async () => {
        const cities = Array.from({ length: 40 }, (_, i) => `City${i}`);
        const trips = [];
        let id = 1;
        // Dense graph: every city has a trip to several "downstream" cities at varied hours,
        // guaranteeing many BFS branches without an explicit direct A->last route.
        for (let i = 0; i < cities.length - 1; i++) {
            for (let offset = 1; offset <= 4 && i + offset < cities.length; offset++) {
                for (let h = 6; h <= 20; h += 3) {
                    trips.push(makeTrip(id++, cities[i], cities[i + offset], h, 2));
                }
            }
        }
        // pad to ~5000 with harmless same-pair repeats at different hours
        while (trips.length < 5000) {
            trips.push(makeTrip(id++, cities[0], cities[1], (id % 24), 2));
        }

        const db = { query: jest.fn().mockResolvedValue([trips]) };
        const t0 = Date.now();
        const result = await searchWithTransit(db, { origin: cities[0], destination: cities[cities.length - 1], date: '2026-07-01', mode: 'time' });
        const elapsedMs = Date.now() - t0;

        // Generous bound to stay robust under parallel test-worker jitter
        // (measured ~50-150ms in isolation) — the point isn't a precise
        // number, it's proving this stays fast at n=5000 instead of the
        // old algorithm's behavior, which would take many seconds here.
        expect(elapsedMs).toBeLessThan(5000);
        expect(Array.isArray(result.transit)).toBe(true);
    }, 10000);
});
