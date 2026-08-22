'use strict';
/**
 * TRUTHNODE — PHASE 2: Passenger Search Engine Correctness, Section 2
 * (full search filter matrix) + Section 3 (sorting).
 *
 * Covers origin/destination/date/busType/sort — price is covered
 * separately in tests/phase2-price-filter.test.js. All DB access mocked;
 * asserts the exact SQL/params tripController.searchTrips constructs.
 */

jest.mock('../server/config/db', () => ({ query: jest.fn() }));
const db = require('../server/config/db');
const ctrl = require('../server/controllers/tripController');

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

beforeEach(() => { jest.clearAllMocks(); });

describe('searchTrips — origin/destination', () => {
    test('origin is matched with a parameterized LIKE %term%, never string-concatenated', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { query: { origin: 'Hà Nội' } };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/AND r\.origin LIKE \?/);
        expect(sql).not.toMatch(/Hà Nội/); // never inlined into the SQL text itself
        expect(params).toContain('%Hà Nội%');
    });

    test('destination same pattern', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { query: { destination: 'Đà Nẵng' } };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/AND r\.destination LIKE \?/);
        expect(params).toContain('%Đà Nẵng%');
    });

    test('neither origin nor destination supplied — no WHERE clause added for either, still returns 200 (browse-all is valid)', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { query: {} };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        const [sql] = db.query.mock.calls[0];
        expect(sql).not.toMatch(/AND r\.origin/);
        expect(sql).not.toMatch(/AND r\.destination/);
        expect(res.status).not.toHaveBeenCalledWith(422);
    });
});

describe('searchTrips — date filter uses SQL DATE(), never a JS-side comparison', () => {
    test('date=YYYY-MM-DD is bound as a parameter against DATE(t.departure_time)', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { query: { date: '2026-09-01' } };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/AND DATE\(t\.departure_time\) = \?/);
        expect(params).toContain('2026-09-01');
    });
});

describe('searchTrips — vehicle type (bus_type is free-text, not a clean enum)', () => {
    test('busType=VIP is keyword-matched (LIKE %VIP%), not exact-matched — real data has "VIP Limousine 16 chỗ" etc, never the bare string "VIP"', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { query: { busType: 'VIP' } };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/AND UPPER\(b\.bus_type\) LIKE \?/);
        expect(params).toContain('%VIP%');
    });

    test('busType=LIMOUSINE is keyword-matched, catching "VIP Limousine ..." buses too, not just the bare string "LIMOUSINE"', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { query: { busType: 'LIMOUSINE' } };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        const [, params] = db.query.mock.calls[0];
        expect(params).toContain('%LIMOUSINE%');
    });

    test('busType=NORMAL excludes anything matching VIP or LIMOUSINE keywords, two NOT LIKE clauses', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { query: { busType: 'NORMAL' } };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/NOT LIKE \? AND UPPER\(b\.bus_type\) NOT LIKE \?/);
        expect(params).toEqual(expect.arrayContaining(['%VIP%', '%LIMOUSINE%']));
    });

    test('no busType param — no bus_type clause at all', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { query: {} };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        expect(db.query.mock.calls[0][0]).not.toMatch(/AND [\w(]*bus_type/);
    });
});

describe('searchTrips — operator filter and seat-availability filter: confirmed MISSING (no UI control, no API param)', () => {
    test('searchTrips accepts no operator_id parameter — passing one has zero effect on the query', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { query: { operator_id: '5' } };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).not.toMatch(/AND o\.operator_id/);
        expect(sql).not.toMatch(/WHERE.*operator_id\s*=\s*\?/s);
        expect(params).toEqual([]); // the '5' never became a bound parameter anywhere
    });

    test('searchTrips has no seat-availability threshold parameter — sold-out trips are still included in results (by design: they render as "Hết vé", not hidden)', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { query: { minSeats: '1' } }; // hypothetical param — must be silently ignored, not error
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        expect(res.status).not.toHaveBeenCalledWith(422);
        expect(db.query.mock.calls[0][0]).not.toMatch(/available_seats\s*[><]/);
    });
});
