'use strict';
/**
 * TRUTHNODE — SPRINT 7: Ultimate UI/UX, Modern Authentication & Full
 * System Harmonization.
 * Covers: Google/Facebook OAuth login/register (mocked tokens — real
 * end-to-end verification needs live provider credentials this
 * environment doesn't have, see SPRINT7_FINAL_REPORT.md), forgot/reset
 * password token issuance+validation+strength policy, real server-side
 * logout via token_version revocation, and the compression/cache-control
 * middleware (content-level checks, matching the same convention already
 * used in tests/phase5-production-defense.test.js for infra files that
 * can't be exercised without a live server/DB in this suite).
 *
 * Mocking strategy: every dependency is mocked ONCE at module level
 * (jest.mock, hoisted) and controlled per-test via mockResolvedValueOnce
 * chains on the SAME mock reference — no jest.resetModules()/doMock()/
 * dontMock() anywhere. That combination previously caused a real,
 * hard-to-diagnose failure in this exact file during development: a
 * dontMock('../server/config/db') call inside one test removed the DB
 * mock for every subsequent require() in the file, so a later test
 * transparently opened a real MySQL connection and hung the whole suite
 * (the same dangling-real-DB-connection failure class documented in this
 * repo's memory from tests/phase4-concierge-map.test.js's development).
 */

const fs = require('fs');
const path = require('path');

jest.mock('../server/config/db', () => ({ query: jest.fn(), getConnection: jest.fn() }));
jest.mock('../server/services/emailService', () => ({ sendPasswordReset: jest.fn().mockResolvedValue({}) }));

const mockVerifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
    OAuth2Client: jest.fn().mockImplementation(() => ({ verifyIdToken: mockVerifyIdToken })),
}));

const db = require('../server/config/db');
const jwt = require('jsonwebtoken');

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.FACEBOOK_APP_ID;
    delete process.env.FACEBOOK_APP_SECRET;
    delete global.fetch;
});
afterAll(() => { process.env = ORIGINAL_ENV; });

/* ══════════════════════════════════════════
   1. Google OAuth
══════════════════════════════════════════ */
describe('authController.googleAuth', () => {
    const ctrl = require('../server/controllers/authController');

    test('not configured (no GOOGLE_CLIENT_ID) -> 503, never touches the DB', async () => {
        const req = { body: { credential: 'fake' } };
        const res = mockRes();
        await ctrl.googleAuth(req, res);
        expect(res.status).toHaveBeenCalledWith(503);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('missing credential -> 400', async () => {
        process.env.GOOGLE_CLIENT_ID = 'real-client-id';
        const req = { body: {} };
        const res = mockRes();
        await ctrl.googleAuth(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('existing BLOCKED user -> 403 (Sprint 7 fix: was checking status==="BANNED", a value that has never existed in this schema — users.status is enum(\'ACTIVE\',\'BLOCKED\',\'INACTIVE\') — so a blocked user could log back in via Google, bypassing the same check login()/authenticate()/refreshToken() all correctly apply)', async () => {
        process.env.GOOGLE_CLIENT_ID = 'real-client-id';
        mockVerifyIdToken.mockResolvedValueOnce({
            getPayload: () => ({ email: 'blocked@x.com', name: 'Blocked User', sub: 'g123' }),
        });
        db.query.mockResolvedValueOnce([[{ user_id: 1, full_name: 'Blocked User', email: 'blocked@x.com', role: 'PASSENGER', status: 'BLOCKED', operator_id: null, token_version: 0 }]]);

        const req = { body: { credential: 'valid-looking-token' } };
        const res = mockRes();
        await ctrl.googleAuth(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
    });

    test('unknown email -> creates a new PASSENGER account with a real bcrypt-hashed random password (not the old plaintext "google:<id>" placeholder)', async () => {
        process.env.GOOGLE_CLIENT_ID = 'real-client-id';
        mockVerifyIdToken.mockResolvedValueOnce({
            getPayload: () => ({ email: 'new@x.com', name: 'New User', sub: 'g456' }),
        });
        db.query
            .mockResolvedValueOnce([[]]) // no existing user
            .mockResolvedValueOnce([{ insertId: 99 }]); // INSERT

        const req = { body: { credential: 'valid-looking-token' } };
        const res = mockRes();
        await ctrl.googleAuth(req, res);

        const insertCall = db.query.mock.calls[1];
        expect(insertCall[0]).toMatch(/INSERT INTO users/);
        expect(insertCall[0]).toMatch(/'PASSENGER', 'ACTIVE'/);
        const insertedHash = insertCall[1][3];
        expect(insertedHash).not.toMatch(/^google:/); // not the old placeholder
        expect(insertedHash).toMatch(/^\$2[aby]\$/); // real bcrypt hash format
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Google') }));
    });

    test('existing ACTIVE user -> logs in normally, no INSERT', async () => {
        process.env.GOOGLE_CLIENT_ID = 'real-client-id';
        mockVerifyIdToken.mockResolvedValueOnce({
            getPayload: () => ({ email: 'active@x.com', name: 'Active User', sub: 'g789' }),
        });
        db.query.mockResolvedValueOnce([[{ user_id: 5, full_name: 'Active User', email: 'active@x.com', role: 'PASSENGER', status: 'ACTIVE', operator_id: null, token_version: 2 }]]);

        const req = { body: { credential: 'valid-looking-token' } };
        const res = mockRes();
        await ctrl.googleAuth(req, res);
        expect(res.status).not.toHaveBeenCalledWith(403);
        expect(db.query).toHaveBeenCalledTimes(1); // lookup only, no INSERT
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            user: expect.objectContaining({ user_id: 5 }),
            accessToken: expect.any(String),
        }));
    });
});

/* ══════════════════════════════════════════
   2. Facebook OAuth
══════════════════════════════════════════ */
describe('authController.facebookAuth', () => {
    const ctrl = require('../server/controllers/authController');

    test('not configured (no FACEBOOK_APP_ID/SECRET) -> 503, never touches the DB', async () => {
        const req = { body: { accessToken: 'fake' } };
        const res = mockRes();
        await ctrl.facebookAuth(req, res);
        expect(res.status).toHaveBeenCalledWith(503);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('missing accessToken -> 400', async () => {
        process.env.FACEBOOK_APP_ID = 'real-app-id';
        process.env.FACEBOOK_APP_SECRET = 'real-app-secret';
        const req = { body: {} };
        const res = mockRes();
        await ctrl.facebookAuth(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('token belongs to a different Facebook app (debug_token app_id mismatch) -> 401, rejected before any DB access', async () => {
        process.env.FACEBOOK_APP_ID = 'real-app-id';
        process.env.FACEBOOK_APP_SECRET = 'real-app-secret';
        global.fetch = jest.fn().mockResolvedValueOnce({
            json: async () => ({ data: { is_valid: true, app_id: 'SOME-OTHER-APP' } }),
        });
        const req = { body: { accessToken: 'stolen-token' } };
        const res = mockRes();
        await ctrl.facebookAuth(req, res);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('account has no email permission granted -> 422, not silently created without one (this app identifies accounts by email — users.email UNIQUE)', async () => {
        process.env.FACEBOOK_APP_ID = 'real-app-id';
        process.env.FACEBOOK_APP_SECRET = 'real-app-secret';
        global.fetch = jest.fn()
            .mockResolvedValueOnce({ json: async () => ({ data: { is_valid: true, app_id: 'real-app-id' } }) })
            .mockResolvedValueOnce({ json: async () => ({ id: 'fb123', name: 'No Email User' }) }); // no email field
        const req = { body: { accessToken: 'valid-token' } };
        const res = mockRes();
        await ctrl.facebookAuth(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('valid token, unknown email -> creates a new PASSENGER account, same pattern as Google', async () => {
        process.env.FACEBOOK_APP_ID = 'real-app-id';
        process.env.FACEBOOK_APP_SECRET = 'real-app-secret';
        global.fetch = jest.fn()
            .mockResolvedValueOnce({ json: async () => ({ data: { is_valid: true, app_id: 'real-app-id' } }) })
            .mockResolvedValueOnce({ json: async () => ({ id: 'fb789', name: 'FB User', email: 'fbuser@x.com' }) });
        db.query
            .mockResolvedValueOnce([[]]) // no existing user
            .mockResolvedValueOnce([{ insertId: 55 }]); // INSERT

        const req = { body: { accessToken: 'valid-token' } };
        const res = mockRes();
        await ctrl.facebookAuth(req, res);

        const insertCall = db.query.mock.calls[1];
        expect(insertCall[0]).toMatch(/INSERT INTO users/);
        expect(insertCall[0]).toMatch(/'PASSENGER', 'ACTIVE'/);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Facebook') }));
    });
});

/* ══════════════════════════════════════════
   3. Password strength policy (register, reset, change)
══════════════════════════════════════════ */
describe('passwordPolicy — shared 4-criteria strength check', () => {
    const { validatePasswordStrength } = require('../server/utils/passwordPolicy');

    test.each([
        ['short1!', false, 'too short'],
        ['alllowercase1!', false, 'no uppercase'],
        ['NoDigitsHere!', false, 'no digit'],
        ['NoSymbolHere1', false, 'no symbol'],
        ['Str0ngP@ss1', true, 'passes all 4 criteria'],
    ])('%s -> valid=%s (%s)', (pw, expected) => {
        expect(validatePasswordStrength(pw).valid).toBe(expected);
    });
});

describe('authController.register — enforces password strength server-side (was previously unchecked)', () => {
    const ctrl = require('../server/controllers/authController');

    test('weak password -> 422, no INSERT attempted', async () => {
        const req = { body: { username: 'u1', full_name: 'Test', email: 't@x.com', password: 'weak' } };
        const res = mockRes();
        await ctrl.register(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
        expect(db.query).not.toHaveBeenCalled();
    });
});

/* ══════════════════════════════════════════
   4. Real server-side logout (token_version revocation)
══════════════════════════════════════════ */
describe('authController.logout — real server-side revocation (was a pure no-op before Sprint 7)', () => {
    const ctrl = require('../server/controllers/authController');

    test('increments users.token_version for the authenticated caller', async () => {
        db.query.mockResolvedValueOnce([{}]);
        const req = { user: { user_id: 42 } };
        const res = mockRes();
        await ctrl.logout(req, res);
        expect(db.query).toHaveBeenCalledWith(
            'UPDATE users SET token_version = token_version + 1 WHERE user_id = ?', [42]
        );
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
    });

    test('still responds success even if the revocation write fails (fail-open on the response — tokens still naturally expire regardless)', async () => {
        db.query.mockRejectedValueOnce(new Error('DB down'));
        const req = { user: { user_id: 42 } };
        const res = mockRes();
        await ctrl.logout(req, res);
        expect(res.status).not.toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
    });
});

describe('authMiddleware.authenticate — rejects a token whose token_version is stale', () => {
    const { authenticate } = require('../server/middleware/authMiddleware');
    const JWT_SECRET = require('../server/config/jwtSecret');

    test('token_version mismatch (post-logout token reused) -> 401, even though signature/expiry are still valid', async () => {
        db.query.mockResolvedValueOnce([[{ status: 'ACTIVE', token_version: 1 }]]); // logged out once since this token was minted
        const token = jwt.sign({ user_id: 1, role: 'PASSENGER', email: 'x@x.com', token_version: 0 }, JWT_SECRET);
        const req = { headers: { authorization: `Bearer ${token}` } };
        const res = mockRes();
        const next = jest.fn();
        await authenticate(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    test('a pre-Sprint-7 token with no token_version claim at all is treated as version 0, not rejected outright (doesn\'t retroactively log out every session at deploy time)', async () => {
        db.query.mockResolvedValueOnce([[{ status: 'ACTIVE', token_version: 0 }]]);
        const token = jwt.sign({ user_id: 1, role: 'PASSENGER', email: 'x@x.com' }, JWT_SECRET); // no token_version claim
        const req = { headers: { authorization: `Bearer ${token}` } };
        const res = mockRes();
        const next = jest.fn();
        await authenticate(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    test('matching token_version -> passes through normally', async () => {
        db.query.mockResolvedValueOnce([[{ status: 'ACTIVE', token_version: 3 }]]);
        const token = jwt.sign({ user_id: 1, role: 'PASSENGER', email: 'x@x.com', token_version: 3 }, JWT_SECRET);
        const req = { headers: { authorization: `Bearer ${token}` } };
        const res = mockRes();
        const next = jest.fn();
        await authenticate(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(req.user).toEqual({ user_id: 1, role: 'PASSENGER', email: 'x@x.com' });
    });
});

describe('authController.resetPassword — also revokes existing sessions on password reset (Sprint 7)', () => {
    const ctrl = require('../server/controllers/authController');

    test('successful reset bumps token_version in the same UPDATE as the password hash', async () => {
        db.query
            .mockResolvedValueOnce([[{ id: 1, user_id: 7, expires_at: new Date(Date.now() + 60000), used_at: null }]])
            .mockResolvedValueOnce([{ affectedRows: 1 }])
            .mockResolvedValueOnce([{}]);
        const req = { body: { token: 'good-token', new_password: 'Str0ngP@ss1' } };
        const res = mockRes();
        await ctrl.resetPassword(req, res);
        const updateCall = db.query.mock.calls[2];
        expect(updateCall[0]).toMatch(/token_version = token_version \+ 1/);
    });

    test('weak new_password -> 422 (was previously just length<6)', async () => {
        const req = { body: { token: 'x'.repeat(64), new_password: '123' } };
        const res = mockRes();
        await ctrl.resetPassword(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
    });
});

/* ══════════════════════════════════════════
   5. Change-password endpoint (was completely missing before Sprint 7 —
   profile.html's modal has always called this exact path and 404'd)
══════════════════════════════════════════ */
describe('userController.changePassword', () => {
    const ctrl = require('../server/controllers/userController');

    test('self-service: wrong current_password -> 401, no update attempted', async () => {
        const bcrypt = require('bcryptjs');
        const realHash = await bcrypt.hash('RealCurrent1!', 12);
        db.query.mockResolvedValueOnce([[{ user_id: 1, password_hash: realHash }]]);
        const req = { params: { id: '1' }, user: { user_id: 1, role: 'PASSENGER' }, body: { current_password: 'WrongOne1!', new_password: 'NewStr0ng@1' } };
        const res = mockRes();
        await ctrl.changePassword(req, res);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(db.query).toHaveBeenCalledTimes(1); // only the SELECT
    });

    test('self-service: correct current_password + strong new_password -> succeeds, bumps token_version', async () => {
        const bcrypt = require('bcryptjs');
        const realHash = await bcrypt.hash('RealCurrent1!', 12);
        db.query
            .mockResolvedValueOnce([[{ user_id: 1, password_hash: realHash }]])
            .mockResolvedValueOnce([{}]);
        const req = { params: { id: '1' }, user: { user_id: 1, role: 'PASSENGER' }, body: { current_password: 'RealCurrent1!', new_password: 'NewStr0ng@1' } };
        const res = mockRes();
        await ctrl.changePassword(req, res);
        expect(res.status).not.toHaveBeenCalledWith(401);
        expect(res.status).not.toHaveBeenCalledWith(422);
        const updateCall = db.query.mock.calls[1];
        expect(updateCall[0]).toMatch(/token_version = token_version \+ 1/);
    });

    test('weak new_password -> 422, never reaches the user lookup', async () => {
        const req = { params: { id: '1' }, user: { user_id: 1, role: 'PASSENGER' }, body: { current_password: 'x', new_password: 'weak' } };
        const res = mockRes();
        await ctrl.changePassword(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('ADMIN acting on another user\'s account is not asked for current_password', async () => {
        db.query
            .mockResolvedValueOnce([[{ user_id: 5, password_hash: 'whatever' }]])
            .mockResolvedValueOnce([{}]);
        const req = { params: { id: '5' }, user: { user_id: 99, role: 'ADMIN' }, body: { new_password: 'NewStr0ng@1' } };
        const res = mockRes();
        await ctrl.changePassword(req, res);
        expect(res.status).not.toHaveBeenCalledWith(400);
        expect(res.status).not.toHaveBeenCalledWith(401);
    });
});

/* ══════════════════════════════════════════
   6. Compression & Cache-Control middleware (content-level — matches the
   established convention for infra checks that can't be exercised
   without a live server in this suite, see phase5-production-defense).
══════════════════════════════════════════ */
describe('server.js — compression + cache-control middleware wiring', () => {
    const serverSrc = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');

    test('compression package is required and applied as middleware', () => {
        expect(serverSrc).toMatch(/require\(["']compression["']\)/);
        expect(serverSrc).toMatch(/app\.use\(compression\(\)\)/);
    });

    test('compression is required in package.json dependencies', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
        expect(pkg.dependencies.compression).toBeDefined();
    });

    /* Sprint 8: was `max-age=604800` with `etag: false` — a real bug, not a
       feature. With no ETag and a 7-day max-age, a browser that already
       cached api.js/style.css never even asks the server again until the
       7 days expire, so every code fix shipped to those files was
       invisible to already-cached browsers for up to a week (discovered
       while trying to verify the Sprint 8 topbar dropdown fix — the fix
       was correct on disk and served correctly with cache:'no-store', but
       a normal page load kept rendering the pre-fix version). Switched to
       `etag: true` + `Cache-Control: no-cache` for JS/CSS: every load
       revalidates (cheap 304 if unchanged), so a deploy is picked up on
       the very next request instead of hiding behind a week-long cache. */
    test('static JS/CSS assets always revalidate via ETag instead of trusting a long unrevalidated cache', () => {
        expect(serverSrc).toMatch(/\.\(js\|css\)/);
        expect(serverSrc).toMatch(/etag:\s*true/);
        expect(serverSrc).toMatch(/Cache-Control["'],\s*["']no-cache["']/);
        expect(serverSrc).not.toMatch(/etag:\s*false/);
    });

    test('static images/fonts get an even longer, immutable Cache-Control', () => {
        expect(serverSrc).toMatch(/max-age=2592000.*immutable/);
    });

    test('HSTS is explicitly disabled — this server has no TLS termination in front of it, so sending Strict-Transport-Security would incorrectly tell browsers to force-upgrade to a non-existent HTTPS endpoint', () => {
        expect(serverSrc).toMatch(/hsts:\s*false/);
    });
});
