'use strict';
/**
 * Phase 2I — booking-scoped RBAC/IDOR fixes.
 * payBooking, getBookingQR, updateBookingStatus, addServiceOrder previously
 * had zero ownership check (payBooking had zero auth at all — a second,
 * separate bypass of the F-13/F-17 payment-integrity fix from Phase 2H).
 * All DB access is mocked — no real database is touched.
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

describe('Phase 2I — payBooking ownership', () => {
    test('user A cannot pay user B\'s booking → 403, no UPDATE/INSERT attempted', async () => {
        const ctrl = require('../server/controllers/bookingController');
        db.query.mockResolvedValueOnce([[{ booking_id: 5, total_amount: 100000, status: 'PENDING', user_id: 99 }]]);
        const req = { params: { id: '5' }, body: { method: 'BANK' }, user: { user_id: 1, role: 'PASSENGER' } };
        const res = mockRes();
        await ctrl.payBooking(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(db.query).toHaveBeenCalledTimes(1);
        expect(db.getConnection).not.toHaveBeenCalled();
    });

    test('booking owner CAN pay their own booking', async () => {
        const ctrl = require('../server/controllers/bookingController');
        const conn = { beginTransaction: jest.fn(), query: jest.fn().mockResolvedValue([{ affectedRows: 1 }]), commit: jest.fn(), rollback: jest.fn(), release: jest.fn() };
        db.query
            .mockResolvedValueOnce([[{ booking_id: 5, total_amount: 100000, status: 'PENDING', user_id: 1 }]])
            .mockResolvedValueOnce([[]]); // post-commit awardPoints/email lookup — empty, non-critical path
        db.getConnection.mockResolvedValueOnce(conn);
        const req = { params: { id: '5' }, body: { method: 'BANK' }, user: { user_id: 1, role: 'PASSENGER' } };
        const res = mockRes();
        await ctrl.payBooking(req, res);
        expect(res.status).not.toHaveBeenCalledWith(403);
        expect(conn.commit).toHaveBeenCalled();
    });

    test('ADMIN can pay any booking', async () => {
        const ctrl = require('../server/controllers/bookingController');
        const conn = { beginTransaction: jest.fn(), query: jest.fn().mockResolvedValue([{ affectedRows: 1 }]), commit: jest.fn(), rollback: jest.fn(), release: jest.fn() };
        db.query
            .mockResolvedValueOnce([[{ booking_id: 5, total_amount: 100000, status: 'PENDING', user_id: 99 }]])
            .mockResolvedValueOnce([[]]);
        db.getConnection.mockResolvedValueOnce(conn);
        const req = { params: { id: '5' }, body: { method: 'BANK' }, user: { user_id: 1, role: 'ADMIN' } };
        const res = mockRes();
        await ctrl.payBooking(req, res);
        expect(res.status).not.toHaveBeenCalledWith(403);
        expect(conn.commit).toHaveBeenCalled();
    });

    test('Phase 2I: race — status flips to PAID between the pre-check and the UPDATE → 409, no duplicate payment INSERT', async () => {
        const ctrl = require('../server/controllers/bookingController');
        // affectedRows:0 simulates another concurrent request having already
        // flipped this booking to PAID between the initial SELECT and this UPDATE.
        const conn = { beginTransaction: jest.fn(), query: jest.fn().mockResolvedValue([{ affectedRows: 0 }]), commit: jest.fn(), rollback: jest.fn(), release: jest.fn() };
        db.query.mockResolvedValueOnce([[{ booking_id: 5, total_amount: 100000, status: 'PENDING', user_id: 1 }]]);
        db.getConnection.mockResolvedValueOnce(conn);
        const req = { params: { id: '5' }, body: { method: 'BANK' }, user: { user_id: 1, role: 'PASSENGER' } };
        const res = mockRes();
        await ctrl.payBooking(req, res);
        expect(res.status).toHaveBeenCalledWith(409);
        expect(conn.rollback).toHaveBeenCalled();
        expect(conn.commit).not.toHaveBeenCalled();
        expect(conn.query).toHaveBeenCalledTimes(1); // only the UPDATE — no payment INSERT
    });
});

describe('Phase 2I — getBookingQR ownership (IDOR)', () => {
    test('user A cannot view user B\'s QR ticket → 403', async () => {
        const ctrl = require('../server/controllers/bookingController');
        db.query.mockResolvedValueOnce([[{ booking_id: 5, user_id: 99, status: 'PAID' }]]);
        const req = { params: { id: '5' }, user: { user_id: 1, role: 'PASSENGER' } };
        const res = mockRes();
        await ctrl.getBookingQR(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
    });
});

describe('Phase 2I — updateBookingStatus validation + ownership', () => {
    test('invalid status string → 422, no UPDATE attempted', async () => {
        const ctrl = require('../server/controllers/bookingController');
        const req = { params: { id: '5' }, body: { status: 'HACKED' }, user: { user_id: 1, role: 'PASSENGER' } };
        const res = mockRes();
        await ctrl.updateBookingStatus(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('user A cannot cancel user B\'s booking → 403', async () => {
        const ctrl = require('../server/controllers/bookingController');
        db.query.mockResolvedValueOnce([[{ user_id: 99 }]]);
        const req = { params: { id: '5' }, body: { status: 'CANCELED' }, user: { user_id: 1, role: 'PASSENGER' } };
        const res = mockRes();
        await ctrl.updateBookingStatus(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
    });

    test('passenger CANNOT set their own booking to PAID via this endpoint → 403', async () => {
        const ctrl = require('../server/controllers/bookingController');
        db.query.mockResolvedValueOnce([[{ user_id: 1 }]]);
        const req = { params: { id: '5' }, body: { status: 'PAID' }, user: { user_id: 1, role: 'PASSENGER' } };
        const res = mockRes();
        await ctrl.updateBookingStatus(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(db.query).toHaveBeenCalledTimes(1); // only the ownership-lookup SELECT
    });

    test('passenger CAN cancel their own booking', async () => {
        // Phase 1 hardening: cancelling now atomically releases
        // trip_seat_hold rows via a transaction (see
        // tests/phase1-transactions.test.js for the dedicated coverage of
        // that behavior) — the UPDATE runs on conn.query, not db.query.
        const ctrl = require('../server/controllers/bookingController');
        const conn = { beginTransaction: jest.fn(), query: jest.fn().mockResolvedValue([{}]), commit: jest.fn(), rollback: jest.fn(), release: jest.fn() };
        db.query
            .mockResolvedValueOnce([[{ user_id: 1 }]])
            .mockResolvedValueOnce([[]]); // cancellation email lookup, empty
        db.getConnection.mockResolvedValueOnce(conn);
        const req = { params: { id: '5' }, body: { status: 'CANCELED' }, user: { user_id: 1, role: 'PASSENGER' } };
        const res = mockRes();
        await ctrl.updateBookingStatus(req, res);
        expect(res.status).not.toHaveBeenCalledWith(403);
        expect(conn.query.mock.calls.some(c => /UPDATE booking SET status=/.test(c[0]))).toBe(true);
        expect(conn.commit).toHaveBeenCalled();
    });

    test('ADMIN can set any valid status on any booking', async () => {
        const ctrl = require('../server/controllers/bookingController');
        db.query
            .mockResolvedValueOnce([[{ user_id: 99 }]])
            .mockResolvedValueOnce([{}]);
        const req = { params: { id: '5' }, body: { status: 'PAID' }, user: { user_id: 1, role: 'ADMIN' } };
        const res = mockRes();
        await ctrl.updateBookingStatus(req, res);
        expect(res.status).not.toHaveBeenCalledWith(403);
        expect(res.status).not.toHaveBeenCalledWith(422);
    });

    test('booking not found → 404', async () => {
        const ctrl = require('../server/controllers/bookingController');
        db.query.mockResolvedValueOnce([[]]);
        const req = { params: { id: '999' }, body: { status: 'CANCELED' }, user: { user_id: 1, role: 'PASSENGER' } };
        const res = mockRes();
        await ctrl.updateBookingStatus(req, res);
        expect(res.status).toHaveBeenCalledWith(404);
    });
});

describe('Phase 2I — addServiceOrder ownership', () => {
    test('user A cannot add services to user B\'s booking → 403', async () => {
        const ctrl = require('../server/controllers/bookingController');
        db.query.mockResolvedValueOnce([[{ booking_id: 5, total_amount: 100000, extras: null, status: 'PAID', user_id: 99 }]]);
        const req = { params: { id: '5' }, body: { items: [{ id: 'x', price: 10000, qty: 1 }] }, user: { user_id: 1, role: 'PASSENGER' } };
        const res = mockRes();
        await ctrl.addServiceOrder(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(db.getConnection).not.toHaveBeenCalled();
    });
});
