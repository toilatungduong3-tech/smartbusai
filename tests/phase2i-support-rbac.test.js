'use strict';
/**
 * Phase 2I — support_request RBAC/IDOR fixes.
 * createRequest previously trusted a client-supplied user_id (impersonation);
 * getUserRequests trusted the :user_id URL param with no ownership check
 * (IDOR — reads another user's request titles/content/admin replies);
 * getAllRequests/replyRequest were reachable by anyone with no admin check.
 * All DB access is mocked — no real database is touched.
 */

jest.mock('../server/config/db', () => ({ query: jest.fn() }));
const db = require('../server/config/db');
const ctrl = require('../server/controllers/supportController');

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

beforeEach(() => { jest.clearAllMocks(); });

describe('Phase 2I — createRequest identity source', () => {
    test('ignores a spoofed body.user_id, uses req.user.user_id for the insert', async () => {
        db.query.mockResolvedValueOnce([{ insertId: 42 }]);
        const req = {
            user: { user_id: 1, role: 'PASSENGER' },
            body: { user_id: 99, type: 'general', title: 'x', content: 'y' }
        };
        const res = mockRes();
        await ctrl.createRequest(req, res);
        expect(res.status).toHaveBeenCalledWith(201);
        expect(db.query.mock.calls[0][1][0]).toBe(1); // not 99
    });
});

describe('Phase 2I — getUserRequests ownership (IDOR)', () => {
    test('user A cannot read user B\'s support requests → 403, no query attempted', async () => {
        const req = { params: { user_id: '99' }, user: { user_id: 1, role: 'PASSENGER' } };
        const res = mockRes();
        await ctrl.getUserRequests(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('user can read their own support requests', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { params: { user_id: '1' }, user: { user_id: 1, role: 'PASSENGER' } };
        const res = mockRes();
        await ctrl.getUserRequests(req, res);
        expect(res.status).not.toHaveBeenCalledWith(403);
    });

    test('ADMIN can read any user\'s support requests', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { params: { user_id: '99' }, user: { user_id: 1, role: 'ADMIN' } };
        const res = mockRes();
        await ctrl.getUserRequests(req, res);
        expect(res.status).not.toHaveBeenCalledWith(403);
    });
});
