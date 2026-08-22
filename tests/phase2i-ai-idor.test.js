'use strict';
/**
 * Phase 2I — AI recommendation / behavior-profile IDOR fixes.
 * getRecommendations (/api/ai/recommend/:userId), getBehaviorProfile
 * (/api/ai/behavior/:userId), getMyRecommendations (/api/recommendations/me)
 * and getSearchInsight (/api/ai/search-insight) previously trusted a
 * client-supplied userId (URL param or query string) with zero ownership
 * check — any caller could read any other user's personalized
 * recommendations, spending savings, or search/booking behavior for a route.
 * All DB access is mocked — no real database is touched.
 */

jest.mock('../server/config/db', () => ({ query: jest.fn() }));
const db = require('../server/config/db');
const ctrl = require('../server/controllers/passengerAIController');

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

beforeEach(() => { jest.clearAllMocks(); });

describe('Phase 2I — getRecommendations (/api/ai/recommend/:userId) ownership', () => {
    test('user A cannot read user B\'s recommendations → 403, no DB query attempted', async () => {
        const req = { params: { userId: '99' }, user: { user_id: 1, role: 'PASSENGER' } };
        const res = mockRes();
        await ctrl.getRecommendations(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('user can read their own recommendations', async () => {
        db.query.mockResolvedValue([[]]);
        const req = { params: { userId: '1' }, user: { user_id: 1, role: 'PASSENGER' } };
        const res = mockRes();
        await ctrl.getRecommendations(req, res);
        expect(res.status).not.toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalled();
    });

    test('ADMIN can read any user\'s recommendations', async () => {
        db.query.mockResolvedValue([[]]);
        const req = { params: { userId: '99' }, user: { user_id: 1, role: 'ADMIN' } };
        const res = mockRes();
        await ctrl.getRecommendations(req, res);
        expect(res.status).not.toHaveBeenCalledWith(403);
    });
});

describe('Phase 2I — getBehaviorProfile (/api/ai/behavior/:userId) ownership', () => {
    test('user A cannot read user B\'s behavior profile → 403, no DB query attempted', async () => {
        const req = { params: { userId: '99' }, user: { user_id: 1, role: 'PASSENGER' } };
        const res = mockRes();
        await ctrl.getBehaviorProfile(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('user can read their own behavior profile', async () => {
        db.query.mockResolvedValue([[]]);
        const req = { params: { userId: '1' }, user: { user_id: 1, role: 'PASSENGER' } };
        const res = mockRes();
        await ctrl.getBehaviorProfile(req, res);
        expect(res.status).not.toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalled();
    });
});

describe('Phase 2I — getMyRecommendations (/api/recommendations/me) identity source', () => {
    test('ignores any client-supplied userId/user_id query param, uses req.user only', async () => {
        db.query.mockResolvedValue([[]]);
        const req = { query: { userId: '99' }, user: { user_id: 1, role: 'PASSENGER' } };
        const res = mockRes();
        await ctrl.getMyRecommendations(req, res);
        expect(res.json).toHaveBeenCalled();
        const body = res.json.mock.calls[0][0];
        expect(body.userId).toBe(1); // not 99
    });
});

describe('Phase 2I — getSearchInsight (/api/ai/search-insight) identity source', () => {
    test('anonymous request (no req.user) never queries search_log/booking for a user', async () => {
        db.query.mockResolvedValue([[]]);
        const req = { query: { origin: 'Hà Nội', destination: 'Đà Nẵng', userId: '99' }, user: null };
        const res = mockRes();
        await ctrl.getSearchInsight(req, res);
        expect(res.json).toHaveBeenCalled();
        const calledWithUserFilter = db.query.mock.calls.some(c => /user_id\s*=\s*\?/.test(c[0]));
        expect(calledWithUserFilter).toBe(false);
    });

    test('authenticated request personalizes using req.user.user_id, ignoring a spoofed ?userId=', async () => {
        db.query.mockResolvedValue([[]]);
        const req = { query: { origin: 'Hà Nội', destination: 'Đà Nẵng', userId: '99' }, user: { user_id: 1, role: 'PASSENGER' } };
        const res = mockRes();
        await ctrl.getSearchInsight(req, res);
        const userQuery = db.query.mock.calls.find(c => /user_id\s*=\s*\?/.test(c[0]));
        expect(userQuery).toBeDefined();
        expect(userQuery[1][0]).toBe(1); // not 99
    });
});
