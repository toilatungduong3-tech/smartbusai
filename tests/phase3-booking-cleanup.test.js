'use strict';
/**
 * TRUTHNODE — SPRINT 3: abandoned-checkout cleanup regression tests.
 * All DB access mocked. Live proof against a real disposable stuck
 * booking is in tests/phase3-booking-cleanup-live.js.
 */

jest.mock('../server/config/db', () => ({ query: jest.fn(), getConnection: jest.fn() }));
const db = require('../server/config/db');
const { cancelAbandonedBookings, ABANDONED_THRESHOLD_MINUTES } = require('../server/services/bookingCleanup');

beforeEach(() => { jest.clearAllMocks(); });

test('threshold is 15 minutes, matching the Sprint 3 requirement', () => {
    expect(ABANDONED_THRESHOLD_MINUTES).toBe(15);
});

test('no abandoned bookings found -> no-op, no getConnection call', async () => {
    db.query.mockResolvedValueOnce([[]]);
    const result = await cancelAbandonedBookings();
    expect(result).toEqual({ canceled: 0, skipped: 0 });
    expect(db.getConnection).not.toHaveBeenCalled();
});

test('the lookup query filters on status=PENDING and the 15-minute threshold', async () => {
    db.query.mockResolvedValueOnce([[]]);
    await cancelAbandonedBookings();
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/status = 'PENDING'/);
    expect(sql).toMatch(/booking_time < NOW\(\) - INTERVAL \? MINUTE/);
    expect(params).toEqual([15]);
});

test('one abandoned booking: atomically UPDATEs to CANCELED and DELETEs its trip_seat_hold rows, in that order, then commits', async () => {
    db.query.mockResolvedValueOnce([[{ booking_id: 101 }]]);
    const conn = {
        beginTransaction: jest.fn(),
        query: jest.fn()
            .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE
            .mockResolvedValueOnce([{}]),                  // DELETE
        commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
    };
    db.getConnection.mockResolvedValueOnce(conn);

    const result = await cancelAbandonedBookings();

    const calls = conn.query.mock.calls.map(c => c[0]);
    expect(calls[0]).toMatch(/UPDATE booking SET status='CANCELED' WHERE booking_id=\? AND status='PENDING'/);
    expect(calls[1]).toMatch(/DELETE FROM trip_seat_hold WHERE booking_id=\?/);
    expect(conn.query.mock.calls[0][1]).toEqual([101]);
    expect(conn.query.mock.calls[1][1]).toEqual([101]);
    expect(conn.commit).toHaveBeenCalled();
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
    expect(result).toEqual({ canceled: 1, skipped: 0 });
});

test('a booking that was paid/canceled concurrently (affectedRows=0) is skipped, not force-canceled', async () => {
    db.query.mockResolvedValueOnce([[{ booking_id: 102 }]]);
    const conn = {
        beginTransaction: jest.fn(),
        query: jest.fn().mockResolvedValueOnce([{ affectedRows: 0 }]), // already changed state
        commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
    };
    db.getConnection.mockResolvedValueOnce(conn);

    const result = await cancelAbandonedBookings();

    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
    // the DELETE FROM trip_seat_hold must never run for a booking that wasn't actually canceled here
    expect(conn.query).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ canceled: 0, skipped: 1 });
});

test('multiple abandoned bookings are each processed in their own transaction — one failure does not block the others', async () => {
    db.query.mockResolvedValueOnce([[{ booking_id: 201 }, { booking_id: 202 }]]);
    const failingConn = {
        beginTransaction: jest.fn(),
        query: jest.fn().mockRejectedValueOnce(new Error('lock wait timeout')),
        commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
    };
    const okConn = {
        beginTransaction: jest.fn(),
        query: jest.fn().mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce([{}]),
        commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
    };
    db.getConnection.mockResolvedValueOnce(failingConn).mockResolvedValueOnce(okConn);

    const result = await cancelAbandonedBookings();

    expect(failingConn.rollback).toHaveBeenCalled();
    expect(okConn.commit).toHaveBeenCalled();
    expect(result).toEqual({ canceled: 1, skipped: 1 });
});
