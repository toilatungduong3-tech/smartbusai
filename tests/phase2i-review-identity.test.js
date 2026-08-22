'use strict';
/**
 * Phase 2I — review creation identity source.
 * createReview / createOperatorReview previously trusted body.user_id with
 * zero auth — anyone could post a review attributed to any other user.
 * All DB access is mocked — no real database is touched.
 */

jest.mock('../server/config/db', () => ({ query: jest.fn() }));
const db = require('../server/config/db');
const ctrl = require('../server/controllers/reviewController');

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

beforeEach(() => { jest.clearAllMocks(); });

test('createReview ignores a spoofed body.user_id, uses req.user.user_id', async () => {
    db.query
        .mockResolvedValueOnce([[]])   // duplicate check — none found
        .mockResolvedValueOnce([{}]);  // INSERT
    const req = {
        user: { user_id: 1, role: 'PASSENGER' },
        body: { user_id: 99, trip_id: 5, rating: 5 }
    };
    const res = mockRes();
    await ctrl.createReview(req, res);
    expect(db.query.mock.calls[0][1]).toEqual([1, 5]);       // duplicate-check uses real user
    expect(db.query.mock.calls[1][1][0]).toBe(1);            // INSERT uses real user
});

test('createOperatorReview ignores a spoofed body.user_id, uses req.user.user_id', async () => {
    db.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([{}]);
    const req = {
        user: { user_id: 1, role: 'PASSENGER' },
        body: { user_id: 99, operator_id: 7, rating: 4 }
    };
    const res = mockRes();
    await ctrl.createOperatorReview(req, res);
    expect(db.query.mock.calls[0][1]).toEqual([1, 7]);
    expect(db.query.mock.calls[1][1][0]).toBe(1);
});
