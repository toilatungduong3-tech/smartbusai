'use strict';
/**
 * TRUTHNODE — SPRINT 3: Security, RBAC & Perf Hardening.
 * Regression tests for the P0 security fixes. All DB access is mocked —
 * live end-to-end proof against the real server/DB is in
 * tests/phase3-security-live.js (10/10 passing).
 */

jest.mock('../server/config/db', () => ({ query: jest.fn(), getConnection: jest.fn() }));
const db = require('../server/config/db');

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

beforeEach(() => { jest.clearAllMocks(); });

/* ══════════════════════════════════════════
   1. GET /api/bookings — PII leak fix
══════════════════════════════════════════ */
describe('bookingController.getAllBookings — operator/admin scoping', () => {
    const ctrl = require('../server/controllers/bookingController');

    test('OPERATOR: query is scoped to req.operatorId (bus.operator_id = ?)', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { user: { role: 'OPERATOR' }, operatorId: 5 };
        const res = mockRes();
        await ctrl.getAllBookings(req, res);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/WHERE bus\.operator_id = \?/);
        expect(params).toEqual([5]);
    });

    test('OPERATOR with no linked/active operator (undefined operatorId) -> empty array, no query', async () => {
        const req = { user: { role: 'OPERATOR' }, operatorId: undefined };
        const res = mockRes();
        await ctrl.getAllBookings(req, res);
        expect(res.json).toHaveBeenCalledWith([]);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('ADMIN: unscoped, sees all bookings, no WHERE clause added', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { user: { role: 'ADMIN' }, operatorId: null };
        const res = mockRes();
        await ctrl.getAllBookings(req, res);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).not.toMatch(/WHERE bus\.operator_id/);
        expect(params).toEqual([]);
    });
});

describe('bookingController.getBookingsTicker — public, PII-free, capped', () => {
    const ctrl = require('../server/controllers/bookingController');

    test('query is hard-capped at 20 and selects only display fields', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = {};
        const res = mockRes();
        await ctrl.getBookingsTicker(req, res);
        const [sql] = db.query.mock.calls[0];
        const selectClause = sql.slice(0, sql.indexOf('FROM'));
        expect(sql).toMatch(/LIMIT 20/);
        expect(selectClause).not.toMatch(/u\.email/);
        expect(selectClause).not.toMatch(/b\.booking_id/); // not selected — only appears later, in GROUP BY
        expect(selectClause).not.toMatch(/plate_number/);
        expect(selectClause).not.toMatch(/payment/i);
        expect(selectClause).not.toMatch(/b\.user_id/);
    });

    test('full_name is masked server-side before being sent to the client', async () => {
        db.query.mockResolvedValueOnce([[
            { full_name: 'Nguyễn Văn An', booking_time: '2026-01-01', total_amount: 100000, status: 'PAID', origin: 'A', destination: 'B', bus_type: 'VIP', seat_numbers: 'A1' },
        ]]);
        const req = {};
        const res = mockRes();
        await ctrl.getBookingsTicker(req, res);
        const payload = res.json.mock.calls[0][0];
        expect(payload[0].full_name).toBe('An N.');
        expect(payload[0].full_name).not.toContain('Nguyễn Văn'); // raw name never in the response
    });

    test('single-word name masks to "X***"', async () => {
        db.query.mockResolvedValueOnce([[
            { full_name: 'Madonna', booking_time: '2026-01-01', total_amount: 100000, status: 'PAID', origin: 'A', destination: 'B', bus_type: 'VIP', seat_numbers: 'A1' },
        ]]);
        const req = {};
        const res = mockRes();
        await ctrl.getBookingsTicker(req, res);
        expect(res.json.mock.calls[0][0][0].full_name).toBe('M***');
    });

    test('missing full_name (guest booking) -> "Khách hàng" fallback, no crash', async () => {
        db.query.mockResolvedValueOnce([[
            { full_name: null, booking_time: '2026-01-01', total_amount: 50000, status: 'PENDING', origin: 'A', destination: 'B', bus_type: 'NORMAL', seat_numbers: 'B2' },
        ]]);
        const req = {};
        const res = mockRes();
        await ctrl.getBookingsTicker(req, res);
        expect(res.json.mock.calls[0][0][0].full_name).toBe('Khách hàng');
    });
});

/* ══════════════════════════════════════════
   2. Account block enforcement
══════════════════════════════════════════ */
describe('authController.login — account status enforcement', () => {
    test('BLOCKED user with correct password -> 403, no tokens issued', async () => {
        const bcrypt = require('bcryptjs');
        const ctrl = require('../server/controllers/authController');
        const hash = await bcrypt.hash('correct-password', 4);
        db.query.mockResolvedValueOnce([[{ user_id: 1, email: 'a@b.com', password_hash: hash, role: 'PASSENGER', status: 'BLOCKED' }]]);
        const req = { body: { email: 'a@b.com', password: 'correct-password' } };
        const res = mockRes();
        await ctrl.login(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).not.toHaveBeenCalledWith(expect.objectContaining({ accessToken: expect.anything() }));
    });

    test('ACTIVE user with correct password -> tokens issued normally', async () => {
        const bcrypt = require('bcryptjs');
        const ctrl = require('../server/controllers/authController');
        const hash = await bcrypt.hash('correct-password', 4);
        db.query.mockResolvedValueOnce([[{ user_id: 1, email: 'a@b.com', password_hash: hash, role: 'PASSENGER', status: 'ACTIVE' }]]);
        const req = { body: { email: 'a@b.com', password: 'correct-password' } };
        const res = mockRes();
        await ctrl.login(req, res);
        expect(res.status).not.toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ accessToken: expect.any(String) }));
    });
});

describe('authController.refreshToken — re-checks status on every refresh', () => {
    test('BLOCKED user cannot mint a new access token even with a valid, unexpired refresh token', async () => {
        const jwt = require('jsonwebtoken');
        const JWT_SECRET = require('../server/config/jwtSecret');
        const ctrl = require('../server/controllers/authController');
        const refreshToken = jwt.sign({ user_id: 1, role: 'PASSENGER', email: 'a@b.com' }, JWT_SECRET, { expiresIn: '7d' });
        db.query.mockResolvedValueOnce([[{ status: 'BLOCKED' }]]);
        const req = { body: { refreshToken } };
        const res = mockRes();
        await ctrl.refreshToken(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
    });

    test('ACTIVE user refreshes normally', async () => {
        const jwt = require('jsonwebtoken');
        const JWT_SECRET = require('../server/config/jwtSecret');
        const ctrl = require('../server/controllers/authController');
        const refreshToken = jwt.sign({ user_id: 1, role: 'PASSENGER', email: 'a@b.com' }, JWT_SECRET, { expiresIn: '7d' });
        db.query.mockResolvedValueOnce([[{ status: 'ACTIVE' }]]);
        const req = { body: { refreshToken } };
        const res = mockRes();
        await ctrl.refreshToken(req, res);
        expect(res.status).not.toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ accessToken: expect.any(String) }));
    });
});

/* ══════════════════════════════════════════
   3. Fleet data leak — busController / seatController
══════════════════════════════════════════ */
describe('busController.getBuses — operator scoping', () => {
    const ctrl = require('../server/controllers/busController');

    test('OPERATOR is always scoped to req.operatorId, ignoring any client-supplied operator_id query param', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { user: { role: 'OPERATOR' }, operatorId: 5, query: { operator_id: '999' } }; // attacker-supplied
        const res = mockRes();
        await ctrl.getBuses(req, res);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/WHERE b\.operator_id=\?/);
        expect(params).toEqual([5]); // NOT 999 — the spoofed query param is ignored
    });

    test('OPERATOR with no active/linked operator -> empty array, no query', async () => {
        const req = { user: { role: 'OPERATOR' }, operatorId: undefined, query: {} };
        const res = mockRes();
        await ctrl.getBuses(req, res);
        expect(res.json).toHaveBeenCalledWith([]);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('ADMIN with no operator_id filter -> sees all buses, no WHERE clause', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { user: { role: 'ADMIN' }, operatorId: null, query: {} };
        const res = mockRes();
        await ctrl.getBuses(req, res);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).not.toMatch(/WHERE b\.operator_id/);
        expect(params).toEqual([]);
    });

    test('ADMIN with an explicit operator_id filter -> honored (admin is allowed to filter)', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { user: { role: 'ADMIN' }, operatorId: null, query: { operator_id: '3' } };
        const res = mockRes();
        await ctrl.getBuses(req, res);
        const [, params] = db.query.mock.calls[0];
        expect(params).toEqual(['3']);
    });
});

describe('seatController.getSeatsByBus — ownership check added', () => {
    const ctrl = require('../server/controllers/seatController');

    test('operator cannot view another operator\'s bus seat layout -> 403', async () => {
        db.query.mockResolvedValueOnce([[{ operator_id: 99 }]]);
        const req = { params: { busId: '10' }, user: { role: 'OPERATOR' }, operatorId: 5 };
        const res = mockRes();
        await ctrl.getSeatsByBus(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(db.query).toHaveBeenCalledTimes(1); // ownership lookup only, seat query never ran
    });

    test('operator viewing their own bus\'s seats succeeds', async () => {
        db.query.mockResolvedValueOnce([[{ operator_id: 5 }]]).mockResolvedValueOnce([[]]);
        const req = { params: { busId: '10' }, user: { role: 'OPERATOR' }, operatorId: 5 };
        const res = mockRes();
        await ctrl.getSeatsByBus(req, res);
        expect(res.status).not.toHaveBeenCalledWith(403);
    });

    test('bus not found -> 404', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { params: { busId: '999' }, user: { role: 'OPERATOR' }, operatorId: 5 };
        const res = mockRes();
        await ctrl.getSeatsByBus(req, res);
        expect(res.status).toHaveBeenCalledWith(404);
    });
});

/* ══════════════════════════════════════════
   4. Suspended operator enforcement
══════════════════════════════════════════ */
describe('operatorScope.attachOperatorId — SUSPENDED operator fails closed', () => {
    const { attachOperatorId, ownsOperator } = require('../server/middleware/operatorScope');

    test('SUSPENDED operator: req.operatorId undefined, operatorSuspended=true, ownsOperator always false', async () => {
        db.query.mockResolvedValueOnce([[{ operator_id: 8, operator_status: 'SUSPENDED' }]]);
        const req = { user: { user_id: 50, role: 'OPERATOR' } };
        const res = mockRes();
        const next = jest.fn();
        await attachOperatorId(req, res, next);
        expect(req.operatorId).toBeUndefined();
        expect(req.operatorSuspended).toBe(true);
        expect(next).toHaveBeenCalled(); // still authenticated, just fails downstream authz
        expect(ownsOperator(req, 8)).toBe(false);
    });

    test('ACTIVE operator: resolves normally, operatorSuspended=false', async () => {
        db.query.mockResolvedValueOnce([[{ operator_id: 3, operator_status: 'ACTIVE' }]]);
        const req = { user: { user_id: 48, role: 'OPERATOR' } };
        const res = mockRes();
        const next = jest.fn();
        await attachOperatorId(req, res, next);
        expect(req.operatorId).toBe(3);
        expect(req.operatorSuspended).toBe(false);
    });
});
