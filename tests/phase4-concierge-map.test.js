'use strict';
/**
 * TRUTHNODE — SPRINT 4: AI Booking Concierge & Map Integration.
 * Covers: Vietnamese NLU extraction accuracy, DB-grounded city
 * recognition, real-search-engine integration (no independent mock
 * search), and the route-map pickup/dropoff data wiring.
 *
 * All DB access mocked — live end-to-end proof (real server, real DB) is
 * in tests/phase4-concierge-live.js.
 */

process.env.TZ = 'Asia/Ho_Chi_Minh';

/* bookingConcierge.handleMessage lazily requires tripController, which in
   turn requires the real server/config/db.js at its own top level — mock
   it here so that require chain never opens a real connection (this test
   file otherwise has no reason to touch a live DB at all; every trip
   result is injected via jest.spyOn(tripCtrl, '_runTripSearch') below). */
jest.mock('../server/config/db', () => ({ query: jest.fn(), getConnection: jest.fn() }));

const {
    handleMessage, extractIntent, extractRoute, extractTravelDate,
    extractBusType, extractTimeWindow, extractSeatCount,
    findCityMentions, getKnownCities, _resetCityCache,
} = require('../server/ai/bookingConcierge');

const REAL_CITIES = ['Hà Nội', 'Đà Nẵng', 'Hồ Chí Minh', 'Hải Phòng', 'Nha Trang', 'Đà Lạt', 'Cần Thơ', 'Huế', 'Vinh', 'Hải Dương'];

function mockDbWithCities(cities = REAL_CITIES) {
    return { query: jest.fn().mockResolvedValue([cities.map(c => ({ city: c }))]) };
}

beforeEach(() => { _resetCityCache(); });

/* ══════════════════════════════════════════
   1. City recognition — grounded in real route data
══════════════════════════════════════════ */
describe('getKnownCities — grounded in the real route table, not a hardcoded list', () => {
    test('queries DISTINCT origin/destination from the route table', async () => {
        const db = mockDbWithCities();
        await getKnownCities(db);
        const sql = db.query.mock.calls[0][0];
        expect(sql).toMatch(/DISTINCT origin AS city FROM route/);
        expect(sql).toMatch(/DISTINCT destination AS city FROM route/);
    });

    test('a city with zero routes in the DB is never "recognized"', async () => {
        const db = mockDbWithCities(['Hà Nội', 'Đà Nẵng']); // no "Cà Mau" route exists
        const cities = await getKnownCities(db);
        expect(cities).not.toContain('Cà Mau');
    });

    test('result is cached — a second call within the TTL does not re-query', async () => {
        const db = mockDbWithCities();
        await getKnownCities(db);
        await getKnownCities(db);
        expect(db.query).toHaveBeenCalledTimes(1);
    });
});

describe('findCityMentions — longest-match, no double-counting overlapping names', () => {
    test('finds two distinct cities in order of appearance', () => {
        const found = findCityMentions('Tôi muốn đi từ Hà Nội đến Đà Nẵng', REAL_CITIES);
        expect(found).toEqual(['Hà Nội', 'Đà Nẵng']);
    });

    test('"Hồ Chí Minh" is not double-matched as a shorter accidental substring', () => {
        const found = findCityMentions('đi từ Hà Nội đến Hồ Chí Minh', REAL_CITIES);
        expect(found).toEqual(['Hà Nội', 'Hồ Chí Minh']);
    });

    test('no known city mentioned -> empty array', () => {
        expect(findCityMentions('tôi muốn đi chơi', REAL_CITIES)).toEqual([]);
    });

    /* Regression guard: the `route` table stores destinations with an
       administrative prefix — e.g. "TP. Hồ Chí Minh" — but users naturally
       type just "Hồ Chí Minh" with no prefix. A live-server test against
       the real DB caught this: exact-substring matching against the raw
       DB value never fires because "tp. hồ chí minh" is not a substring of
       the user's message. Matching must normalize prefixes on both sides
       (via the same normCity() transitRouter.js already uses for its own
       route matching) and return the canonical (DB-stored) form. */
    test('matches a user mention without the DB\'s "TP. " prefix', () => {
        const dbCities = ['Hà Nội', 'TP. Hồ Chí Minh', 'Đà Nẵng'];
        const found = findCityMentions('cho tôi đi từ Hà Nội đến Hồ Chí Minh cuối tuần này', dbCities);
        expect(found).toEqual(['Hà Nội', 'TP. Hồ Chí Minh']);
    });

    test('also matches when the user types the prefix themselves', () => {
        const dbCities = ['Hà Nội', 'TP. Hồ Chí Minh'];
        const found = findCityMentions('đi từ Hà Nội đến TP HCM à không, TP. Hồ Chí Minh', dbCities);
        expect(found).toEqual(['Hà Nội', 'TP. Hồ Chí Minh']);
    });
});

/* ══════════════════════════════════════════
   2. Intent extraction — the exact example from the sprint brief
══════════════════════════════════════════ */
describe('extractIntent — "Tôi muốn đi từ Hà Nội đến Đà Nẵng tối mai tầm 8h, vé Limousine"', () => {
    test('extracts origin, destination, relative date, time window, and bus type all at once', async () => {
        const db = mockDbWithCities();
        const now = new Date(2026, 7, 16, 10, 0, 0); // 2026-08-16, a Sunday
        const intent = await extractIntent(db, 'Tôi muốn đi từ Hà Nội đến Đà Nẵng tối mai tầm 8h, vé Limousine', now);
        expect(intent.origin).toBe('Hà Nội');
        expect(intent.destination).toBe('Đà Nẵng');
        expect(intent.travel_date).toBe('2026-08-17'); // "mai" from 2026-08-16
        expect(intent.bus_type).toBe('LIMOUSINE');
        expect(intent.time_window).toEqual(expect.objectContaining({ type: 'exact', hour: 20 })); // "8h" + "tối" context -> 20:00
    });
});

describe('extractRoute — positional heuristic (first mention = origin, second = destination)', () => {
    test('"X đi Y" phrasing', () => {
        expect(extractRoute('Hà Nội đi Đà Nẵng', REAL_CITIES)).toEqual({ origin: 'Hà Nội', destination: 'Đà Nẵng' });
    });
    test('"X - Y" phrasing', () => {
        expect(extractRoute('Hà Nội - Đà Nẵng', REAL_CITIES)).toEqual({ origin: 'Hà Nội', destination: 'Đà Nẵng' });
    });
    test('only one city mentioned -> destination is null', () => {
        expect(extractRoute('tôi muốn đi Hà Nội', REAL_CITIES)).toEqual({ origin: 'Hà Nội', destination: null });
    });
    test('no cities mentioned -> both null', () => {
        expect(extractRoute('tôi muốn đi du lịch', REAL_CITIES)).toEqual({ origin: null, destination: null });
    });
});

/* ══════════════════════════════════════════
   3. Travel date — relative Vietnamese phrases, Asia/Ho_Chi_Minh local
══════════════════════════════════════════ */
describe('extractTravelDate — required test cases from the sprint brief', () => {
    const now = new Date(2026, 7, 16, 10, 0, 0); // Sunday, 2026-08-16

    test('"hôm nay" -> today', () => {
        expect(extractTravelDate('tôi muốn đi hôm nay', now)).toBe('2026-08-16');
    });
    test('"ngày mai" -> tomorrow', () => {
        expect(extractTravelDate('đi ngày mai nhé', now)).toBe('2026-08-17');
    });
    test('"cuối tuần này" from a weekday -> the upcoming Saturday', () => {
        const tuesday = new Date(2026, 7, 18, 10, 0, 0); // Tue 2026-08-18
        expect(extractTravelDate('cuối tuần này mình đi', tuesday)).toBe('2026-08-22');
    });
    test('"cuối tuần này" said on a Sunday -> today (the weekend is already in progress, not next week)', () => {
        expect(extractTravelDate('cuối tuần này mình đi', now)).toBe('2026-08-16'); // now itself is Sun 8/16
    });
    test('"cuối tuần" when today already IS Saturday -> today', () => {
        const saturday = new Date(2026, 7, 22, 9, 0, 0);
        expect(extractTravelDate('đi cuối tuần này', saturday)).toBe('2026-08-22');
    });
    test('"ngày mốt" -> day after tomorrow', () => {
        expect(extractTravelDate('ngày mốt mình đi', now)).toBe('2026-08-18');
    });
    test('explicit dd/mm, still upcoming this year', () => {
        expect(extractTravelDate('đi ngày 20/8', now)).toBe('2026-08-20');
    });
    test('explicit dd/mm that already passed this year rolls to next year', () => {
        expect(extractTravelDate('đi ngày 1/1', now)).toBe('2027-01-01');
    });
    test('no date phrase found -> null (never guesses)', () => {
        expect(extractTravelDate('tôi muốn đi Đà Nẵng', now)).toBeNull();
    });
    test('date arithmetic never uses UTC-forcing parsing (Phase 1 time-contract regression guard)', () => {
        // Late-night local time near a UTC day boundary — a UTC-based bug
        // would compute "tomorrow" as the wrong calendar date here.
        const lateNight = new Date(2026, 7, 16, 23, 45, 0);
        expect(extractTravelDate('ngày mai', lateNight)).toBe('2026-08-17');
    });
});

/* ══════════════════════════════════════════
   4. Bus type — keyword-matched, consistent with Sprint 2's real-data fix
══════════════════════════════════════════ */
describe('extractBusType', () => {
    test('"Limousine" -> LIMOUSINE', () => { expect(extractBusType('vé Limousine nhé')).toBe('LIMOUSINE'); });
    test('"VIP" -> VIP', () => { expect(extractBusType('cho tôi ghế VIP')).toBe('VIP'); });
    test('"giường nằm" -> NORMAL (matches Sprint 2\'s real bus_type categorization)', () => {
        expect(extractBusType('xe giường nằm')).toBe('NORMAL');
    });
    test('"ghế ngồi" -> NORMAL', () => { expect(extractBusType('ghế ngồi bình thường')).toBe('NORMAL'); });
    test('no bus type mentioned -> null', () => { expect(extractBusType('đi Đà Nẵng')).toBeNull(); });
});

/* ══════════════════════════════════════════
   5. Time window
══════════════════════════════════════════ */
describe('extractTimeWindow', () => {
    test('"sáng" -> morning range', () => {
        expect(extractTimeWindow('đi buổi sáng')).toEqual(expect.objectContaining({ type: 'range', range: [6, 12] }));
    });
    test('"tối" -> evening range', () => {
        expect(extractTimeWindow('đi tối nay')).toEqual(expect.objectContaining({ type: 'range', range: [18, 24] }));
    });
    test('"8h sáng" -> exact 08:00, not shifted', () => {
        expect(extractTimeWindow('tầm 8h sáng')).toEqual(expect.objectContaining({ type: 'exact', hour: 8 }));
    });
    test('"8h tối" -> exact 20:00 (12h->24h conversion via context)', () => {
        expect(extractTimeWindow('tầm 8h tối')).toEqual(expect.objectContaining({ type: 'exact', hour: 20 }));
    });
    test('"20h" (already 24h format) -> exact 20:00, unaffected by missing context', () => {
        expect(extractTimeWindow('khởi hành lúc 20h')).toEqual(expect.objectContaining({ type: 'exact', hour: 20 }));
    });
    test('no time mentioned -> null', () => { expect(extractTimeWindow('đi Đà Nẵng')).toBeNull(); });
});

/* ══════════════════════════════════════════
   6. Seat count
══════════════════════════════════════════ */
describe('extractSeatCount', () => {
    test('"2 vé" -> 2', () => { expect(extractSeatCount('cho tôi 2 vé')).toBe(2); });
    test('"cho 3 người" -> 3', () => { expect(extractSeatCount('đặt cho 3 người')).toBe(3); });
    test('no count mentioned -> null', () => { expect(extractSeatCount('đi Đà Nẵng')).toBeNull(); });
    test('an absurd count (>20) is rejected, not silently accepted', () => {
        expect(extractSeatCount('cho tôi 999 vé')).toBeNull();
    });
});

/* ══════════════════════════════════════════
   7. handleMessage — full pipeline, REAL search engine integration
══════════════════════════════════════════ */
describe('handleMessage — reuses tripController._runTripSearch, never an independent mock search', () => {
    test('missing origin/destination -> clarifying reply, no trip search attempted', async () => {
        const db = mockDbWithCities();
        const result = await handleMessage(db, 'tôi muốn đi du lịch');
        expect(result.needsInfo).toEqual(expect.arrayContaining(['origin', 'destination']));
        expect(result.trips).toEqual([]);
        expect(result.reply).toMatch(/điểm đi|điểm đến/);
    });

    test('enough info -> calls the real search engine with the extracted params', async () => {
        const tripCtrl = require('../server/controllers/tripController');
        const spy = jest.spyOn(tripCtrl, '_runTripSearch').mockResolvedValueOnce({
            rows: [
                { trip_id: 1, origin: 'Hà Nội', destination: 'Đà Nẵng', base_price: 300000, departure_time: '2026-08-17 20:00:00', available_seats: 10, operator_name: 'Test Bus', bus_type: 'LIMOUSINE' },
            ],
        });
        const db = mockDbWithCities();
        const result = await handleMessage(db, 'đi từ Hà Nội đến Đà Nẵng ngày mai tầm 8h tối, Limousine', new Date(2026, 7, 16));

        expect(spy).toHaveBeenCalledWith(db, expect.objectContaining({
            origin: 'Hà Nội', destination: 'Đà Nẵng', date: '2026-08-17', busType: 'LIMOUSINE',
        }));
        expect(result.trips).toHaveLength(1);
        expect(result.trips[0].trip_id).toBe(1);
        expect(result.needsInfo).toEqual([]);
        spy.mockRestore();
    });

    test('time_window filters the real search results by departure hour (post-query, does not alter the SQL)', async () => {
        const tripCtrl = require('../server/controllers/tripController');
        const spy = jest.spyOn(tripCtrl, '_runTripSearch').mockResolvedValueOnce({
            rows: [
                { trip_id: 1, origin: 'Hà Nội', destination: 'Đà Nẵng', base_price: 300000, departure_time: '2026-08-17 08:00:00', available_seats: 10 },
                { trip_id: 2, origin: 'Hà Nội', destination: 'Đà Nẵng', base_price: 300000, departure_time: '2026-08-17 20:00:00', available_seats: 10 },
            ],
        });
        const db = mockDbWithCities();
        const result = await handleMessage(db, 'Hà Nội đến Đà Nẵng tối mai', new Date(2026, 7, 16));
        expect(result.trips).toHaveLength(1);
        expect(result.trips[0].trip_id).toBe(2); // only the 20:00 (evening) trip survives the "tối" filter
        spy.mockRestore();
    });

    test('seat_count filters out trips with insufficient available_seats', async () => {
        const tripCtrl = require('../server/controllers/tripController');
        const spy = jest.spyOn(tripCtrl, '_runTripSearch').mockResolvedValueOnce({
            rows: [
                { trip_id: 1, origin: 'Hà Nội', destination: 'Đà Nẵng', base_price: 300000, departure_time: '2026-08-17 08:00:00', available_seats: 1 },
                { trip_id: 2, origin: 'Hà Nội', destination: 'Đà Nẵng', base_price: 300000, departure_time: '2026-08-17 09:00:00', available_seats: 5 },
            ],
        });
        const db = mockDbWithCities();
        const result = await handleMessage(db, 'Hà Nội đến Đà Nẵng cho 3 người', new Date(2026, 7, 16));
        expect(result.trips).toHaveLength(1);
        expect(result.trips[0].trip_id).toBe(2);
        spy.mockRestore();
    });

    test('a real search-engine validation error (e.g. bad date) is surfaced honestly, not silently swallowed', async () => {
        const tripCtrl = require('../server/controllers/tripController');
        const spy = jest.spyOn(tripCtrl, '_runTripSearch').mockResolvedValueOnce({
            error: { status: 422, message: 'minPrice không được lớn hơn maxPrice' },
        });
        const db = mockDbWithCities();
        const result = await handleMessage(db, 'Hà Nội đến Đà Nẵng', new Date(2026, 7, 16));
        expect(result.reply).toMatch(/lỗi/i);
        expect(result.trips).toEqual([]);
        spy.mockRestore();
    });

    /* End-to-end regression for the DB-prefix city-matching bug found during
       live-server verification: real trips exist for Hà Nội -> TP. Hồ Chí
       Minh, but the concierge asked for "destination" again because the
       user's plain "Hồ Chí Minh" never matched the DB's "TP. Hồ Chí Minh". */
    test('recognizes a destination the user typed without the DB\'s administrative prefix', async () => {
        const tripCtrl = require('../server/controllers/tripController');
        const spy = jest.spyOn(tripCtrl, '_runTripSearch').mockResolvedValueOnce({
            rows: [
                { trip_id: 9, origin: 'Hà Nội', destination: 'TP. Hồ Chí Minh', base_price: 450000, departure_time: '2026-08-17 15:00:00', available_seats: 45 },
            ],
        });
        const db = mockDbWithCities(['Hà Nội', 'TP. Hồ Chí Minh']);
        const result = await handleMessage(db, 'cho tôi đi từ Hà Nội đến Hồ Chí Minh cuối tuần này, 2 vé', new Date(2026, 7, 18));

        expect(result.needsInfo).toEqual([]);
        expect(spy).toHaveBeenCalledWith(db, expect.objectContaining({
            origin: 'Hà Nội', destination: 'TP. Hồ Chí Minh',
        }));
        expect(result.trips).toHaveLength(1);
        spy.mockRestore();
    });

    test('empty message -> asks for origin/destination, no DB call at all', async () => {
        const db = mockDbWithCities();
        const result = await handleMessage(db, '');
        expect(result.needsInfo).toEqual(['origin', 'destination']);
        expect(db.query).not.toHaveBeenCalled();
    });
});

/* ══════════════════════════════════════════
   8. Route map — pickup/dropoff data wiring (real DB stop_type, no fabrication)
══════════════════════════════════════════ */
describe('route map data accuracy — pickup/dropoff points sourced from real route_stop.stop_type', () => {
    test('index.html\'s resolveRouteStops carries stop_type through instead of discarding it', () => {
        const fs = require('fs');
        const html = fs.readFileSync('public/pages/passenger/index.html', 'utf8');
        const fnMatch = html.match(/async function resolveRouteStops\(t\)\{[\s\S]*?\n\}/);
        expect(fnMatch).not.toBeNull();
        const fnSrc = fnMatch[0];
        expect(fnSrc).toMatch(/stop_type\s*:\s*s\.stop_type/);
    });

    test('the Leaflet stop-marker code distinguishes PICKUP/DROPOFF/BOTH using real stop_type, not a fabricated label', () => {
        const fs = require('fs');
        const html = fs.readFileSync('public/pages/passenger/index.html', 'utf8');
        expect(html).toMatch(/stype===['"]PICKUP['"]/);
        expect(html).toMatch(/stype===['"]DROPOFF['"]/);
        expect(html).toMatch(/stype===['"]BOTH['"]/);
    });

    test('Leaflet is not loaded unconditionally in <head> anymore (Sprint 4 lazy-load perf fix)', () => {
        const fs = require('fs');
        const html = fs.readFileSync('public/pages/passenger/index.html', 'utf8');
        expect(html).not.toMatch(/<script src="https:\/\/unpkg\.com\/leaflet[^>]*>\s*<\/script>/);
        expect(html).toMatch(/function _ensureLeaflet\(\)/);
        expect(html).toMatch(/await _ensureLeaflet\(\)/);
    });
});
