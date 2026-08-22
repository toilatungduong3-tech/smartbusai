'use strict';
/**
 * TRUTHNODE — PHASE 1, Section D: transaction audit.
 * Regression tests for the DB-level seat-uniqueness backstop
 * (MASTER_COMPLETION_MATRIX.md blocker #7 — trip_seat_hold, migrate_v9.sql)
 * and the cancellation-path hold-release fix.
 *
 * All DB access is mocked — pure control-flow verification of the
 * transaction boundaries and error handling. Live concurrency proof (two
 * real, simultaneous HTTP requests racing for the same seat against the
 * real running server/DB) is in tests/phase1-concurrency-live.js — this
 * file only proves the code takes the right branch given a given DB
 * response; it does not by itself prove the real race is closed.
 */

jest.mock('../server/config/db', () => ({ query: jest.fn(), getConnection: jest.fn() }));
const db = require('../server/config/db');
const bookingCtrl = require('../server/controllers/bookingController');
const adminCtrl = require('../server/controllers/adminController');
const tripCtrl = require('../server/controllers/tripController');

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

beforeEach(() => { jest.clearAllMocks(); });

/** Builds a conn.query mock that dispatches by matching against the SQL
 *  text, mirroring createBooking's real statement sequence. */
function makeCreateBookingConn({ holdInsertError = null } = {}) {
    return {
        beginTransaction: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn(),
        release: jest.fn(),
        query: jest.fn((sql) => {
            if (/SELECT base_price, bus_id FROM trip/.test(sql)) {
                return Promise.resolve([[{ base_price: 100000, bus_id: 1 }]]);
            }
            if (/SELECT bd\.seat_id FROM booking_detail/.test(sql)) {
                return Promise.resolve([[]]); // no conflicting active booking
            }
            if (/SELECT booking_id FROM booking WHERE booking_code=\?/.test(sql)) {
                return Promise.resolve([[]]); // code not taken
            }
            if (/INSERT INTO booking \(/.test(sql)) {
                return Promise.resolve([{ insertId: 500 }]);
            }
            if (/INSERT INTO booking_detail/.test(sql)) {
                return Promise.resolve([{}]);
            }
            if (/INSERT INTO trip_seat_hold/.test(sql)) {
                if (holdInsertError) return Promise.reject(holdInsertError);
                return Promise.resolve([{}]);
            }
            return Promise.resolve([{}]);
        }),
    };
}

describe('createBooking — trip_seat_hold DB backstop', () => {
    test('successful booking inserts one trip_seat_hold row per seat, inside the same transaction', async () => {
        const conn = makeCreateBookingConn();
        db.getConnection.mockResolvedValueOnce(conn);
        const req = { body: { user_id: 1, trip_id: 42, seats: [{ id: 10, type: 'NORMAL' }, { id: 11, type: 'NORMAL' }] } };
        const res = mockRes();
        await bookingCtrl.createBooking(req, res);

        const holdCall = conn.query.mock.calls.find(c => /INSERT INTO trip_seat_hold/.test(c[0]));
        expect(holdCall).toBeDefined();
        const [rows] = holdCall[1];
        expect(rows).toEqual([[42, 10, 500], [42, 11, 500]]);
        expect(conn.commit).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(201);
    });

    test('a duplicate-key violation on trip_seat_hold (concurrent booking won the race) rolls back and returns 409, not 500', async () => {
        const dupErr = Object.assign(new Error("Duplicate entry '42-10' for key 'PRIMARY'"), { code: 'ER_DUP_ENTRY', errno: 1062 });
        const conn = makeCreateBookingConn({ holdInsertError: dupErr });
        db.getConnection.mockResolvedValueOnce(conn);
        const req = { body: { user_id: 1, trip_id: 42, seats: [{ id: 10, type: 'NORMAL' }] } };
        const res = mockRes();
        await bookingCtrl.createBooking(req, res);

        expect(conn.rollback).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.status).not.toHaveBeenCalledWith(500);
        // booking_detail was inserted, but the whole transaction rolled back —
        // no half-committed booking should be visible.
        expect(conn.commit).not.toHaveBeenCalled();
    });

    test('a non-duplicate-key error on the hold insert still rolls back and surfaces as a generic 500 (not misreported as a seat conflict)', async () => {
        const otherErr = new Error('connection lost mid-transaction');
        const conn = makeCreateBookingConn({ holdInsertError: otherErr });
        db.getConnection.mockResolvedValueOnce(conn);
        const req = { body: { user_id: 1, trip_id: 42, seats: [{ id: 10, type: 'NORMAL' }] } };
        const res = mockRes();
        await bookingCtrl.createBooking(req, res);

        expect(conn.rollback).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.status).not.toHaveBeenCalledWith(409);
    });
});

describe('cancellation — atomically releases trip_seat_hold rows', () => {
    test('bookingController.updateBookingStatus: cancelling wraps the status UPDATE and hold DELETE in one transaction', async () => {
        const conn = { beginTransaction: jest.fn(), query: jest.fn().mockResolvedValue([{}]), commit: jest.fn(), rollback: jest.fn(), release: jest.fn() };
        db.query.mockResolvedValueOnce([[{ user_id: 1 }]]); // ownership lookup
        db.getConnection.mockResolvedValueOnce(conn);
        const req = { params: { id: '7' }, body: { status: 'CANCELED' }, user: { user_id: 1, role: 'PASSENGER' } };
        const res = mockRes();
        await bookingCtrl.updateBookingStatus(req, res);

        const statements = conn.query.mock.calls.map(c => c[0]);
        expect(statements.some(s => /UPDATE booking SET status=\?/.test(s))).toBe(true);
        expect(statements.some(s => /DELETE FROM trip_seat_hold WHERE booking_id=\?/.test(s))).toBe(true);
        expect(conn.commit).toHaveBeenCalled();
    });

    test('bookingController.updateBookingStatus: a non-cancel transition does NOT touch trip_seat_hold (no getConnection call)', async () => {
        db.query
            .mockResolvedValueOnce([[{ user_id: 1 }]])  // ownership lookup
            .mockResolvedValueOnce([{}]);                // the plain UPDATE
        const req = { params: { id: '7' }, body: { status: 'PENDING' }, user: { user_id: 1, role: 'ADMIN' } };
        const res = mockRes();
        await bookingCtrl.updateBookingStatus(req, res);
        expect(db.getConnection).not.toHaveBeenCalled();
    });

    test('adminController.updateBookingStatus: cancelling also atomically releases holds', async () => {
        const conn = { beginTransaction: jest.fn(), query: jest.fn().mockResolvedValue([{}]), commit: jest.fn(), rollback: jest.fn(), release: jest.fn() };
        db.getConnection.mockResolvedValueOnce(conn);
        const req = { params: { id: '9' }, body: { status: 'CANCELED' } };
        const res = mockRes();
        await adminCtrl.updateBookingStatus(req, res);

        const statements = conn.query.mock.calls.map(c => c[0]);
        expect(statements.some(s => /UPDATE booking SET status = \?/.test(s))).toBe(true);
        expect(statements.some(s => /DELETE FROM trip_seat_hold WHERE booking_id=\?/.test(s))).toBe(true);
        expect(conn.commit).toHaveBeenCalled();
    });

    test('adminController.updateBookingStatus: rollback leaves no partial hold-release if the DELETE fails', async () => {
        const conn = {
            beginTransaction: jest.fn(),
            query: jest.fn()
                .mockResolvedValueOnce([{}])                          // UPDATE succeeds
                .mockRejectedValueOnce(new Error('lock wait timeout')), // DELETE fails
            commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
        };
        db.getConnection.mockResolvedValueOnce(conn);
        const req = { params: { id: '9' }, body: { status: 'CANCELED' } };
        const res = mockRes();
        await adminCtrl.updateBookingStatus(req, res);
        expect(conn.rollback).toHaveBeenCalled();
        expect(conn.commit).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(500);
    });
});

describe('createTrip — advisory-lock TOCTOU fix (conflict-check + INSERT serialized per bus_id)', () => {
    function makeLockConn({ locked = 1, hasConflict = false } = {}) {
        return {
            query: jest.fn((sql) => {
                if (/GET_LOCK/.test(sql)) return Promise.resolve([[{ locked }]]);
                if (/RELEASE_LOCK/.test(sql)) return Promise.resolve([[{}]]);
                if (/SELECT trip_id FROM trip/.test(sql)) return Promise.resolve([hasConflict ? [{ trip_id: 77 }] : []]);
                if (/INSERT INTO trip/.test(sql)) return Promise.resolve([{ insertId: 200 }]);
                return Promise.resolve([{}]);
            }),
            release: jest.fn(),
        };
    }

    test('conflict-check and INSERT both run on the SAME locked connection, not the plain pool', async () => {
        const conn = makeLockConn();
        db.getConnection.mockResolvedValueOnce(conn);
        const req = { body: { route_id: 1, bus_id: 10, departure_time: '2026-09-01 08:00:00', arrival_time: '2026-09-01 12:00:00', base_price: 100000 } };
        const res = mockRes();
        await tripCtrl.createTrip(req, res);

        expect(db.query).not.toHaveBeenCalled(); // no ownership check for this req (no req.user), no other db access
        const statements = conn.query.mock.calls.map(c => c[0]);
        expect(statements.some(s => /GET_LOCK/.test(s))).toBe(true);
        expect(statements.some(s => /SELECT trip_id FROM trip/.test(s))).toBe(true);
        expect(statements.some(s => /INSERT INTO trip/.test(s))).toBe(true);
        expect(statements.some(s => /RELEASE_LOCK/.test(s))).toBe(true);
        expect(res.status).toHaveBeenCalledWith(201);
        expect(conn.release).toHaveBeenCalled();
    });

    test('a conflict discovered under the lock is rejected with 409, and the lock is still released', async () => {
        const conn = makeLockConn({ hasConflict: true });
        db.getConnection.mockResolvedValueOnce(conn);
        const req = { body: { route_id: 1, bus_id: 10, departure_time: '2026-09-01 08:00:00', arrival_time: '2026-09-01 12:00:00', base_price: 100000 } };
        const res = mockRes();
        await tripCtrl.createTrip(req, res);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(conn.query.mock.calls.some(c => /INSERT INTO trip/.test(c[0]))).toBe(false); // never reached
        expect(conn.query.mock.calls.some(c => /RELEASE_LOCK/.test(c[0]))).toBe(true); // lock still released
        expect(conn.release).toHaveBeenCalled();
    });

    test('failing to acquire the lock (another request holds it) is rejected with 409, not a silent race', async () => {
        const conn = makeLockConn({ locked: 0 });
        db.getConnection.mockResolvedValueOnce(conn);
        const req = { body: { route_id: 1, bus_id: 10, departure_time: '2026-09-01 08:00:00', arrival_time: '2026-09-01 12:00:00', base_price: 100000 } };
        const res = mockRes();
        await tripCtrl.createTrip(req, res);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(conn.query.mock.calls.some(c => /SELECT trip_id FROM trip/.test(c[0]))).toBe(false); // never even checked
        expect(conn.release).toHaveBeenCalled();
    });
});
