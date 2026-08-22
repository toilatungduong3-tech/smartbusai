'use strict';
/**
 * Phase 2I Step 2 — tripController operator-ownership fix, found during
 * the final security sweep (same vulnerability class as operatorScope.js
 * was built to close, in an adjacent controller that had its own
 * independent, now-obsolete email-matching check — and two functions,
 * updateTripStatus/updateTripPrice, had no ownership check at all).
 * All DB access is mocked — no real database is touched.
 */

jest.mock('../server/config/db', () => ({ query: jest.fn(), getConnection: jest.fn() }));
const db = require('../server/config/db');
const ctrl = require('../server/controllers/tripController');

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}
beforeEach(() => { jest.clearAllMocks(); });

describe('createTrip — operator ownership via users.operator_id, not email', () => {
    test('operator cannot create a trip on another operator\'s bus', async () => {
        db.query.mockResolvedValueOnce([[{ operator_id: 99 }]]); // bus belongs to operator 99
        const req = {
            user: { role: 'OPERATOR', email: 'anything@example.com' }, operatorId: 5,
            body: { route_id: 1, bus_id: 10, departure_time: '2026-09-01T08:00:00', arrival_time: '2026-09-01T12:00:00', base_price: 100000 }
        };
        const res = mockRes();
        await ctrl.createTrip(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
    });

    test('operator can create a trip on their own bus, even with a mismatched email', async () => {
        db.query.mockResolvedValueOnce([[{ operator_id: 5 }]]); // ownership lookup only — conflict check + INSERT now run on a locked connection
        db.getConnection.mockResolvedValueOnce({
            query: jest.fn((sql) => {
                if (/GET_LOCK/.test(sql)) return Promise.resolve([[{ locked: 1 }]]);
                if (/RELEASE_LOCK/.test(sql)) return Promise.resolve([[{}]]);
                if (/SELECT trip_id FROM trip/.test(sql)) return Promise.resolve([[]]);
                if (/INSERT INTO trip/.test(sql)) return Promise.resolve([{ insertId: 1 }]);
                return Promise.resolve([{}]);
            }),
            release: jest.fn(),
        });
        const req = {
            user: { role: 'OPERATOR', email: 'unrelated-address@example.com' }, operatorId: 5,
            body: { route_id: 1, bus_id: 10, departure_time: '2026-09-01T08:00:00', arrival_time: '2026-09-01T12:00:00', base_price: 100000 }
        };
        const res = mockRes();
        await ctrl.createTrip(req, res);
        expect(res.status).not.toHaveBeenCalledWith(403);
    });
});

describe('updateTripStatus — previously had NO ownership check at all', () => {
    test('operator cannot change another operator\'s trip status', async () => {
        db.query.mockResolvedValueOnce([[{ operator_id: 99 }]]);
        const req = { user: { role: 'OPERATOR' }, operatorId: 5, params: { id: '1' }, body: { status: 'CANCELED' } };
        const res = mockRes();
        await ctrl.updateTripStatus(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(db.query).toHaveBeenCalledTimes(1); // only the ownership lookup, no UPDATE
    });

    test('operator can change their own trip\'s status', async () => {
        db.query.mockResolvedValueOnce([[{ operator_id: 5 }]]).mockResolvedValueOnce([{}]);
        const req = { user: { role: 'OPERATOR' }, operatorId: 5, params: { id: '1' }, body: { status: 'CANCELED' } };
        const res = mockRes();
        await ctrl.updateTripStatus(req, res);
        expect(res.status).not.toHaveBeenCalledWith(403);
    });

    test('admin can change any trip\'s status', async () => {
        const req = { user: { role: 'ADMIN' }, operatorId: null, params: { id: '1' }, body: { status: 'CANCELED' } };
        db.query.mockResolvedValueOnce([{}]);
        const res = mockRes();
        await ctrl.updateTripStatus(req, res);
        expect(res.status).not.toHaveBeenCalledWith(403);
        expect(db.query).toHaveBeenCalledTimes(1); // straight to UPDATE, no ownership lookup for admin
    });
});

describe('updateTripPrice — previously had NO ownership check at all', () => {
    test('operator cannot reprice another operator\'s trip', async () => {
        db.query.mockResolvedValueOnce([[{ operator_id: 99 }]]);
        const req = { user: { role: 'OPERATOR' }, operatorId: 5, params: { id: '1' }, body: { price: 1 } };
        const res = mockRes();
        await ctrl.updateTripPrice(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
    });
});
