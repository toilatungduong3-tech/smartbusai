'use strict';
/**
 * TRUTHNODE — PHASE 2: Passenger Search Engine Correctness, Section 1 (price filter).
 *
 * Root-cause finding for the reported "lọc giá ở index.html không hoạt động"
 * bug: the BACKEND (tripController.searchTrips) was already correct —
 * proven here down to the exact bound SQL parameters — and separately
 * proven live against the real DB (tests/phase2-search-filter-live.js).
 * The actual bug was 100% frontend: public/pages/passenger/index.html's
 * renderPage() (the shared render function for both the homepage's default
 * trip listing AND search results) never read _minPrice/_maxPrice at all —
 * only _timeFilter/_busTypeFilter/_sortMode were applied before pagination.
 * Clicking a price chip before running an explicit origin/destination
 * search visually activated the chip but changed nothing on screen. Fixed
 * in index.html's renderPage()/setPriceFilter(); this file covers the
 * backend half of the pipeline this bug traveled through.
 *
 * All DB access is mocked — these assert the exact SQL/params constructed,
 * not the real query execution (see phase2-search-filter-live.js for that).
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

describe('searchTrips — price filter: exact SQL/parameter matrix', () => {
    test('minPrice=0 is a valid, meaningful filter (not treated as falsy/unset)', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { query: { minPrice: '0' } };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/AND t\.base_price >= \?/);
        expect(params).toContain(0);
        expect(res.status).not.toHaveBeenCalledWith(422);
    });

    test('minPrice=100000 binds exactly 100000 (number, not string) to the SQL parameter', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { query: { minPrice: '100000' } };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        const [, params] = db.query.mock.calls[0];
        expect(params).toContain(100000);
        expect(typeof params.find(p => p === 100000)).toBe('number');
    });

    test('maxPrice=200000 alone (min not given) only adds the upper bound clause', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { query: { maxPrice: '200000' } };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/AND t\.base_price <= \?/);
        expect(sql).not.toMatch(/AND t\.base_price >= \?/);
        expect(params).toEqual([200000]);
    });

    test('maxPrice=500000 alone', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { query: { maxPrice: '500000' } };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        expect(res.status).not.toHaveBeenCalledWith(422);
        expect(db.query.mock.calls[0][1]).toEqual([500000]);
    });

    test('min only (no max) — only lower-bound clause added', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { query: { minPrice: '300000' } };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/AND t\.base_price >= \?/);
        expect(sql).not.toMatch(/AND t\.base_price <= \?/);
        expect(params).toEqual([300000]);
    });

    test('min AND max together — both clauses, both params, in the correct order', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { query: { minPrice: '100000', maxPrice: '200000' } };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        const [, params] = db.query.mock.calls[0];
        expect(params).toEqual([100000, 200000]);
    });

    test('min > max is rejected with 422 and never reaches the SQL layer', async () => {
        const req = { query: { minPrice: '500000', maxPrice: '100000' } };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('min === max is accepted (an exact-price filter is valid, boundary-inclusive)', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { query: { minPrice: '200000', maxPrice: '200000' } };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        expect(res.status).not.toHaveBeenCalledWith(422);
        expect(db.query.mock.calls[0][1]).toEqual([200000, 200000]);
    });

    test('empty string minPrice is treated as "not provided", not as 0 or NaN', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { query: { minPrice: '' } };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).not.toMatch(/AND t\.base_price/); // base_price is always a SELECTed column; only the WHERE clause matters here
        expect(params).toEqual([]);
    });

    test('invalid (non-numeric) minPrice → 422, never silently coerced to NaN/0', async () => {
        const req = { query: { minPrice: 'abc' } };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('decimal price (99999.99) is accepted and passed through as-is', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { query: { minPrice: '99999.99' } };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        expect(res.status).not.toHaveBeenCalledWith(422);
        expect(db.query.mock.calls[0][1]).toEqual([99999.99]);
    });

    test('negative price → 422', async () => {
        const req = { query: { minPrice: '-1' } };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
    });

    /* Phase 2 hardening — found live during this phase's audit, not present
       in the pre-existing Phase 2H coverage above. */
    test('hex notation ("0x10") is rejected, not silently parsed as 16', async () => {
        const req = { query: { minPrice: '0x10' } };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('exponential notation ("1e2") is rejected, not silently parsed as 100', async () => {
        const req = { query: { minPrice: '1e2' } };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
    });

    test('"Infinity" is rejected with 422, never reaches the SQL layer as an unserializable bound value (was a live 500 before this fix)', async () => {
        const req = { query: { minPrice: 'Infinity' } };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
        expect(res.status).not.toHaveBeenCalledWith(500);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('Vietnamese-formatted currency text ("318.000đ") is rejected, not silently misparsed', async () => {
        const req = { query: { minPrice: '318.000đ' } };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
    });

    test('leading/trailing whitespace ("  100000  ") is still accepted as a valid number (Number() trims it)', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { query: { minPrice: '  100000  ' } };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        expect(res.status).not.toHaveBeenCalledWith(422);
    });
});

describe('searchTrips — sorting is numeric/date-based SQL, never a formatted string', () => {
    test('sort=asc orders by the raw numeric base_price column, ascending', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { query: { sort: 'asc' } };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        expect(db.query.mock.calls[0][0]).toMatch(/ORDER BY t\.base_price ASC/);
    });

    test('sort=desc orders by the raw numeric base_price column, descending', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { query: { sort: 'desc' } };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        expect(db.query.mock.calls[0][0]).toMatch(/ORDER BY t\.base_price DESC/);
    });

    test('no sort param defaults to departure_time ascending (a real DATETIME column, not a formatted string)', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { query: {} };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        expect(db.query.mock.calls[0][0]).toMatch(/ORDER BY t\.departure_time ASC/);
    });
});
