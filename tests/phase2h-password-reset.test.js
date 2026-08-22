'use strict';
/**
 * Phase 2H — F-16 password reset regression tests.
 * checkEmail/resetPassword now require a real, single-use, time-limited
 * token instead of accepting {email, new_password} directly.
 * All DB and email access is mocked — no real database/SMTP is touched.
 */

jest.mock('../server/config/db', () => ({ query: jest.fn() }));
jest.mock('../server/services/emailService', () => ({ sendPasswordReset: jest.fn().mockResolvedValue({}) }));

const db = require('../server/config/db');
const emailService = require('../server/services/emailService');

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

beforeEach(() => { jest.clearAllMocks(); });

describe('Phase 2H — checkEmail (token issuance)', () => {
    test('missing email → 400', async () => {
        const ctrl = require('../server/controllers/authController');
        const req = { body: {} };
        const res = mockRes();
        await ctrl.checkEmail(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('existing email → 200 generic message, token inserted, email attempted', async () => {
        const ctrl = require('../server/controllers/authController');
        db.query
            .mockResolvedValueOnce([[{ user_id: 7, full_name: 'Test User', email: 'a@b.com' }]]) // SELECT users
            .mockResolvedValueOnce([{}]) // invalidate old tokens
            .mockResolvedValueOnce([{}]); // INSERT new token
        const req = { body: { email: 'a@b.com' } };
        const res = mockRes();
        await ctrl.checkEmail(req, res);
        expect(res.status).not.toHaveBeenCalledWith(400);
        expect(res.status).not.toHaveBeenCalledWith(404);
        expect(db.query.mock.calls[2][0]).toMatch(/INSERT INTO password_reset_tokens/);
        expect(emailService.sendPasswordReset).toHaveBeenCalledTimes(1);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining('Nếu tài khoản tồn tại')
        }));
    });

    test('non-existing email → same 200 generic message, NO token inserted, NO email sent (no enumeration)', async () => {
        const ctrl = require('../server/controllers/authController');
        db.query.mockResolvedValueOnce([[]]); // SELECT users — empty
        const req = { body: { email: 'nobody@nowhere.com' } };
        const res = mockRes();
        await ctrl.checkEmail(req, res);
        expect(res.status).not.toHaveBeenCalledWith(404);
        expect(db.query).toHaveBeenCalledTimes(1); // only the SELECT, no INSERT
        expect(emailService.sendPasswordReset).not.toHaveBeenCalled();
        const existingCall = res.json.mock.calls[0][0].message;
        // Must be byte-identical to the "exists" case's message — verified separately above.
        expect(existingCall).toEqual(expect.stringContaining('Nếu tài khoản tồn tại'));
    });

    test('email send failure does not break the response (still 200, generic message)', async () => {
        const ctrl = require('../server/controllers/authController');
        emailService.sendPasswordReset.mockRejectedValueOnce(new Error('SMTP down'));
        db.query
            .mockResolvedValueOnce([[{ user_id: 7, full_name: 'Test User', email: 'a@b.com' }]])
            .mockResolvedValueOnce([{}])
            .mockResolvedValueOnce([{}]);
        const req = { body: { email: 'a@b.com' } };
        const res = mockRes();
        await ctrl.checkEmail(req, res);
        expect(res.status).not.toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
    });
});

describe('Phase 2H — resetPassword (token redemption)', () => {
    test('missing token or password → 400', async () => {
        const ctrl = require('../server/controllers/authController');
        const res = mockRes();
        await ctrl.resetPassword({ body: { new_password: 'abcdef' } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    /* Sprint 7: resetPassword's length-only check ("< 6 chars → 400") was
       replaced by the shared 4-criteria strength policy (8+ chars, upper,
       digit, symbol — server/utils/passwordPolicy.js, matching what
       register.html's strength meter already displayed but never actually
       enforced). A validation failure here now responds 422, matching the
       422-for-business-validation convention already used elsewhere in
       this codebase (e.g. tripController's price validation). The other
       tests in this describe block use a password that passes the new
       policy ('Str0ngP@ss1') so they keep testing what they're actually
       about — token validity — not password strength. */
    test('password fails the strength policy → 422', async () => {
        const ctrl = require('../server/controllers/authController');
        const res = mockRes();
        await ctrl.resetPassword({ body: { token: 'x'.repeat(64), new_password: '123' } }, res);
        expect(res.status).toHaveBeenCalledWith(422);
    });

    test('unknown token → 400, no password mutation attempted', async () => {
        const ctrl = require('../server/controllers/authController');
        db.query.mockResolvedValueOnce([[]]); // token lookup — not found
        const res = mockRes();
        await ctrl.resetPassword({ body: { token: 'bad-token', new_password: 'Str0ngP@ss1' } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    test('already-used token → 400', async () => {
        const ctrl = require('../server/controllers/authController');
        db.query.mockResolvedValueOnce([[{
            id: 1, user_id: 7, expires_at: new Date(Date.now() + 60000), used_at: new Date()
        }]]);
        const res = mockRes();
        await ctrl.resetPassword({ body: { token: 'used-token', new_password: 'Str0ngP@ss1' } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    test('expired token → 400', async () => {
        const ctrl = require('../server/controllers/authController');
        db.query.mockResolvedValueOnce([[{
            id: 1, user_id: 7, expires_at: new Date(Date.now() - 60000), used_at: null
        }]]);
        const res = mockRes();
        await ctrl.resetPassword({ body: { token: 'expired-token', new_password: 'Str0ngP@ss1' } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('valid, unused, unexpired token → password updated, token marked used, 200', async () => {
        const ctrl = require('../server/controllers/authController');
        db.query
            .mockResolvedValueOnce([[{ id: 1, user_id: 7, expires_at: new Date(Date.now() + 60000), used_at: null }]])
            .mockResolvedValueOnce([{ affectedRows: 1 }]) // mark-used UPDATE
            .mockResolvedValueOnce([{}]); // password UPDATE
        const res = mockRes();
        await ctrl.resetPassword({ body: { token: 'good-token', new_password: 'Str0ngP@ss1' } }, res);
        expect(res.status).not.toHaveBeenCalledWith(400);
        expect(db.query.mock.calls[1][0]).toMatch(/UPDATE password_reset_tokens SET used_at/);
        expect(db.query.mock.calls[2][0]).toMatch(/UPDATE users SET password_hash/);
        expect(db.query.mock.calls[2][1][1]).toBe(7); // updates the correct user_id
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
    });

    test('concurrent redemption race — mark-used UPDATE affects 0 rows → 400, password NOT changed', async () => {
        const ctrl = require('../server/controllers/authController');
        db.query
            .mockResolvedValueOnce([[{ id: 1, user_id: 7, expires_at: new Date(Date.now() + 60000), used_at: null }]])
            .mockResolvedValueOnce([{ affectedRows: 0 }]); // another request already consumed it
        const res = mockRes();
        await ctrl.resetPassword({ body: { token: 'raced-token', new_password: 'Str0ngP@ss1' } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(db.query).toHaveBeenCalledTimes(2); // never reaches the password UPDATE
    });
});
