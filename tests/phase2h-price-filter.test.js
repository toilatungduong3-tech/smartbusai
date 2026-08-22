'use strict';
/**
 * Phase 2H Priority 3 — searchTrips price-range filter.
 * Validation-only cases are covered in tests/sprint3.test.js (no DB mock
 * needed there since they return before reaching db.query). This file
 * covers the happy path, proving the filter is applied server-side in the
 * actual SQL sent to the database, not just hidden on the frontend.
 */

jest.mock('../server/config/db', () => ({ query: jest.fn() }));
const db = require('../server/config/db');

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

beforeEach(() => { jest.clearAllMocks(); });

describe('Phase 2H — searchTrips price filter (server-side)', () => {
    test('minPrice only → SQL includes base_price >= bound', async () => {
        const ctrl = require('../server/controllers/tripController');
        db.query.mockResolvedValueOnce([[]]);
        const req = { query: { minPrice: '150000' } };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/t\.base_price >= \?/);
        expect(sql).not.toMatch(/t\.base_price <= \?/);
        expect(params).toContain(150000);
    });

    test('maxPrice only → SQL includes base_price <= bound', async () => {
        const ctrl = require('../server/controllers/tripController');
        db.query.mockResolvedValueOnce([[]]);
        const req = { query: { maxPrice: '200000' } };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/t\.base_price <= \?/);
        expect(sql).not.toMatch(/t\.base_price >= \?/);
        expect(params).toContain(200000);
    });

    test('both bounds → SQL includes both, in range order', async () => {
        const ctrl = require('../server/controllers/tripController');
        db.query.mockResolvedValueOnce([[]]);
        const req = { query: { minPrice: '100000', maxPrice: '300000' } };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/base_price >= \?[\s\S]*base_price <= \?/);
        expect(params).toEqual(expect.arrayContaining([100000, 300000]));
    });

    test('no price params → existing search behavior unchanged, no price clause added', async () => {
        const ctrl = require('../server/controllers/tripController');
        db.query.mockResolvedValueOnce([[]]);
        const req = { query: { origin: 'Hà Nội', destination: 'Đà Nẵng' } };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        const [sql] = db.query.mock.calls[0];
        expect(sql).not.toMatch(/base_price >= \?/);
        expect(sql).not.toMatch(/base_price <= \?/);
        expect(sql).toMatch(/r\.origin LIKE \?/);
        expect(sql).toMatch(/r\.destination LIKE \?/);
    });

    test('sorting still works alongside price filter', async () => {
        const ctrl = require('../server/controllers/tripController');
        db.query.mockResolvedValueOnce([[]]);
        const req = { query: { minPrice: '50000', sort: 'asc' } };
        const res = mockRes();
        await ctrl.searchTrips(req, res);
        const [sql] = db.query.mock.calls[0];
        expect(sql).toMatch(/ORDER BY t\.base_price ASC/);
    });
});
