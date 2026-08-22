'use strict';
/**
 * Phase 2I Final pass — Objective A: admin operator_id assignment workflow.
 * userController.updateUser/createUser now support assigning/unassigning
 * users.operator_id, ADMIN-only, validated against a real bus_operator row
 * (never trusted blindly from the client). All DB access is mocked — no
 * real database is touched.
 */

jest.mock('../server/config/db', () => ({ query: jest.fn() }));
const db = require('../server/config/db');
const ctrl = require('../server/controllers/userController');

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}
beforeEach(() => { jest.clearAllMocks(); });

describe('updateUser — operator_id assignment', () => {
    test('non-admin cannot assign operator_id -> 403, no query attempted', async () => {
        const req = { params: { id: '46' }, user: { user_id: 46, role: 'OPERATOR' }, body: { operator_id: 1 } };
        const res = mockRes();
        await ctrl.updateUser(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('admin assigning a nonexistent operator_id -> 422, no UPDATE attempted', async () => {
        db.query.mockResolvedValueOnce([[]]); // bus_operator lookup — no match
        const req = { params: { id: '47' }, user: { user_id: 1, role: 'ADMIN' }, body: { operator_id: 9999 } };
        const res = mockRes();
        await ctrl.updateUser(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    test('admin assigning a real operator_id succeeds and is included in the UPDATE', async () => {
        db.query.mockResolvedValueOnce([[{ operator_id: 1 }]]).mockResolvedValueOnce([{ affectedRows: 1 }]);
        const req = { params: { id: '47' }, user: { user_id: 1, role: 'ADMIN' }, body: { operator_id: 1 } };
        const res = mockRes();
        await ctrl.updateUser(req, res);
        expect(res.status).not.toHaveBeenCalledWith(422);
        expect(res.status).not.toHaveBeenCalledWith(403);
        const [sql, params] = db.query.mock.calls[1];
        expect(sql).toMatch(/operator_id=\?/);
        expect(params).toContain(1);
    });

    test('admin explicitly unassigning (operator_id: null) sets it to NULL', async () => {
        db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
        const req = { params: { id: '46' }, user: { user_id: 1, role: 'ADMIN' }, body: { operator_id: null } };
        const res = mockRes();
        await ctrl.updateUser(req, res);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/operator_id=\?/);
        expect(params).toContain(null);
    });

    test('omitting operator_id entirely leaves the column untouched (no operator_id in SQL/params)', async () => {
        db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
        const req = { params: { id: '46' }, user: { user_id: 1, role: 'ADMIN' }, body: { full_name: 'New Name' } };
        const res = mockRes();
        await ctrl.updateUser(req, res);
        const [sql] = db.query.mock.calls[0];
        expect(sql).not.toMatch(/operator_id=\?/);
    });
});

describe('createUser — operator_id validated, not trusted blindly', () => {
    test('nonexistent operator_id -> 422, no INSERT attempted', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { body: { full_name: 'X', email: 'x@test.local', role: 'OPERATOR', operator_id: 9999 } };
        const res = mockRes();
        await ctrl.createUser(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    test('valid operator_id is included in the INSERT', async () => {
        db.query.mockResolvedValueOnce([[{ operator_id: 1 }]]).mockResolvedValueOnce([{ insertId: 100 }]);
        const req = { body: { full_name: 'X', email: 'x@test.local', role: 'OPERATOR', operator_id: 1 } };
        const res = mockRes();
        await ctrl.createUser(req, res);
        const [sql, params] = db.query.mock.calls[1];
        expect(sql).toMatch(/operator_id/);
        expect(params).toContain(1);
    });
});
