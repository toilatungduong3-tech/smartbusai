'use strict';
/**
 * Phase 2I Step 2 — canonical operator identity resolution.
 * operatorScope.js previously resolved operator identity by matching
 * bus_operator.email against the JWT's email claim. That silently failed
 * whenever a user's own email legitimately differed from their company's
 * contact email (confirmed against real seed data — see
 * tests/phase2i_operator_identity_audit.md). It now derives operator_id
 * from the explicit users.operator_id -> bus_operator.operator_id FK
 * (migrate_v8.sql), looked up by user_id — never by email, and never
 * trusting req.body/req.query/req.params.
 * All DB access is mocked — no real database is touched.
 */

jest.mock('../server/config/db', () => ({ query: jest.fn() }));
const db = require('../server/config/db');
const { attachOperatorId, ownsOperator } = require('../server/middleware/operatorScope');

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}
beforeEach(() => { jest.clearAllMocks(); });

describe('attachOperatorId — identity resolution', () => {
    test('linked operator resolves operator_id from users.operator_id via user_id, not email', async () => {
        // Sprint 3: attachOperatorId now also joins bus_operator.status —
        // an ACTIVE operator resolves normally.
        db.query.mockResolvedValueOnce([[{ operator_id: 5, operator_status: 'ACTIVE' }]]);
        const req = { user: { user_id: 46, role: 'OPERATOR', email: 'tuan.op@phuongtrang.com.vn' } };
        const res = mockRes();
        const next = jest.fn();
        await attachOperatorId(req, res, next);
        expect(req.operatorId).toBe(5);
        expect(next).toHaveBeenCalled();
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/FROM users u[\s\S]*WHERE u\.user_id\s*=\s*\?/);
        expect(sql).not.toMatch(/bus_operator WHERE email/);
        expect(params).toEqual([46]);
    });

    test('REQUIRED: email mismatch does not prevent resolution — users.operator_id is authoritative regardless of email', async () => {
        // user's own email is completely unrelated to the operator's contact email
        db.query.mockResolvedValueOnce([[{ operator_id: 1, operator_status: 'ACTIVE' }]]);
        const req = { user: { user_id: 46, role: 'OPERATOR', email: 'totally-unrelated-address@example.com' } };
        const res = mockRes();
        const next = jest.fn();
        await attachOperatorId(req, res, next);
        expect(req.operatorId).toBe(1); // resolution succeeded purely via user_id -> operator_id
        expect(next).toHaveBeenCalled();
    });

    test('unlinked operator (operator_id NULL in DB) -> req.operatorId undefined, fail-closed, no global fallback', async () => {
        db.query.mockResolvedValueOnce([[{ operator_id: null, operator_status: null }]]);
        const req = { user: { user_id: 47, role: 'OPERATOR', email: 'operator@gmail.com' } };
        const res = mockRes();
        const next = jest.fn();
        await attachOperatorId(req, res, next);
        expect(req.operatorId).toBeUndefined();
        expect(next).toHaveBeenCalled(); // authentication still succeeds — authz is separate, enforced downstream
        expect(ownsOperator(req, 1)).toBe(false);
        expect(ownsOperator(req, 999)).toBe(false);
    });

    /* Sprint 3 — MASTER_COMPLETION_MATRIX.md blocker: a SUSPENDED operator
       must fail closed exactly like an unlinked account, not resolve to a
       usable operator_id. */
    test('SUSPENDED operator -> req.operatorId undefined, fail-closed, operatorSuspended flag set', async () => {
        db.query.mockResolvedValueOnce([[{ operator_id: 5, operator_status: 'SUSPENDED' }]]);
        const req = { user: { user_id: 46, role: 'OPERATOR', email: 'tuan.op@phuongtrang.com.vn' } };
        const res = mockRes();
        const next = jest.fn();
        await attachOperatorId(req, res, next);
        expect(req.operatorId).toBeUndefined();
        expect(req.operatorSuspended).toBe(true);
        expect(next).toHaveBeenCalled();
        expect(ownsOperator(req, 5)).toBe(false); // cannot act on their own (suspended) company's resources
    });

    test('ADMIN bypasses lookup entirely -> operatorId null (global access), no DB query', async () => {
        const req = { user: { user_id: 1, role: 'ADMIN', email: 'admin@test.local' } };
        const res = mockRes();
        const next = jest.fn();
        await attachOperatorId(req, res, next);
        expect(req.operatorId).toBeNull();
        expect(db.query).not.toHaveBeenCalled();
        expect(ownsOperator(req, 1)).toBe(true);
        expect(ownsOperator(req, 999)).toBe(true); // admin owns everything
    });

    test('PASSENGER role -> operatorId undefined, no DB query, fails ownsOperator', async () => {
        const req = { user: { user_id: 59, role: 'PASSENGER', email: 'p@test.local' } };
        const res = mockRes();
        const next = jest.fn();
        await attachOperatorId(req, res, next);
        expect(req.operatorId).toBeUndefined();
        expect(db.query).not.toHaveBeenCalled();
        expect(ownsOperator(req, 1)).toBe(false);
    });

    test('unauthenticated request -> 401, no query, next not called', async () => {
        const req = { user: null };
        const res = mockRes();
        const next = jest.fn();
        await attachOperatorId(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(db.query).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });
});

describe('ownsOperator — cross-operator isolation + spoofing resistance', () => {
    test('operator A cannot own operator B\'s resource', () => {
        const req = { user: { role: 'OPERATOR' }, operatorId: 5 };
        expect(ownsOperator(req, 6)).toBe(false);
    });

    test('operator A owns their own resource', () => {
        const req = { user: { role: 'OPERATOR' }, operatorId: 5 };
        expect(ownsOperator(req, 5)).toBe(true);
    });

    test('spoofed targetOperatorId (as would come from req.body/req.query/req.params) is still checked against the server-derived req.operatorId, not trusted directly', () => {
        const req = { user: { role: 'OPERATOR' }, operatorId: 5 };
        // Simulates an attacker-supplied body.operator_id / query.operator_id / params.id of another operator's id
        const spoofedTargetFromClient = 999;
        expect(ownsOperator(req, spoofedTargetFromClient)).toBe(false);
    });
});
