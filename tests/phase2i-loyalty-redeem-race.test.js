'use strict';
/**
 * Phase 2I — loyaltyService.redeemPoints race-condition fix.
 * Balance was previously read via a plain (non-transactional, unlocked)
 * db.query before opening the transaction, then trusted for the UPDATE —
 * two concurrent redeem requests (double-click) could both read the same
 * balance, both pass the "enough points" check, and both deduct. The
 * balance read now happens via SELECT ... FOR UPDATE inside the
 * transaction, on the same connection used for the UPDATE.
 * All DB access is mocked — no real database is touched.
 */

jest.mock('../server/config/db', () => ({ query: jest.fn(), getConnection: jest.fn() }));
const db = require('../server/config/db');
const { redeemPoints, awardPoints } = require('../server/services/loyaltyService');

function makeConn(balanceRow) {
    return {
        beginTransaction: jest.fn(),
        query: jest.fn((sql) => {
            if (/SELECT loyalty_points FROM users WHERE user_id=\? FOR UPDATE/.test(sql)) {
                return Promise.resolve([[balanceRow]]);
            }
            return Promise.resolve([{}]);
        }),
        commit: jest.fn(),
        rollback: jest.fn(),
        release: jest.fn(),
    };
}

beforeEach(() => { jest.clearAllMocks(); });

test('balance check happens on the transaction connection with FOR UPDATE, not a plain db.query', async () => {
    const conn = makeConn({ loyalty_points: 500 });
    db.getConnection.mockResolvedValueOnce(conn);
    await redeemPoints(db, 1, 100);
    const lockingCall = conn.query.mock.calls.find(c => /FOR UPDATE/.test(c[0]));
    expect(lockingCall).toBeDefined();
    // The old vulnerable path read the balance via a plain db.query call
    // (unlocked, outside the tx) — it must never touch loyalty_points now.
    const unlockedBalanceRead = db.query.mock.calls.find(c => /loyalty_points/.test(c[0]) && !/ALTER|CREATE/.test(c[0]));
    expect(unlockedBalanceRead).toBeUndefined();
    expect(conn.commit).toHaveBeenCalled();
});

test('Phase 2I Step 3: non-numeric points ("lots") is rejected, never reaches a query', async () => {
    // `pts <= 0` alone does not catch NaN (NaN comparisons are always
    // false) — a non-numeric points value used to slip past validation and
    // leak a raw MySQL error ("Unknown column 'NaN' in 'field list'").
    // getConnection is intentionally left unmocked here: it must never be
    // called, and queuing an unused mockResolvedValueOnce would otherwise
    // leak into whichever test runs next.
    await expect(redeemPoints(db, 1, 'lots')).rejects.toThrow(/Số điểm không hợp lệ/);
    expect(db.getConnection).not.toHaveBeenCalled();
});

test('insufficient points → throws, rolls back, no UPDATE applied', async () => {
    const conn = makeConn({ loyalty_points: 50 });
    db.getConnection.mockResolvedValueOnce(conn);
    await expect(redeemPoints(db, 1, 100)).rejects.toThrow(/Không đủ điểm/);
    expect(conn.rollback).toHaveBeenCalled();
    const updateCall = conn.query.mock.calls.find(c => /UPDATE users SET loyalty_points/.test(c[0]));
    expect(updateCall).toBeUndefined();
});

test('second redemption in sequence sees the already-decremented balance (lock serializes access)', async () => {
    // Simulate two sequential redemptions sharing mutable "DB" state to prove
    // the second call reads the post-first-redemption balance, not a stale one.
    let balance = 100;
    const conn = {
        beginTransaction: jest.fn(),
        query: jest.fn((sql, params) => {
            if (/FOR UPDATE/.test(sql)) return Promise.resolve([[{ loyalty_points: balance }]]);
            if (/UPDATE users SET loyalty_points/.test(sql)) { balance = params[0]; return Promise.resolve([{}]); }
            return Promise.resolve([{}]);
        }),
        commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
    };
    db.getConnection.mockResolvedValue(conn);

    const first = await redeemPoints(db, 1, 100); // spends all 100
    expect(first.newPoints).toBe(0);

    await expect(redeemPoints(db, 1, 100)).rejects.toThrow(/Không đủ điểm/); // balance now 0, can't redeem again
});

test('awardPoints also locks the balance row with FOR UPDATE', async () => {
    const conn = makeConn({ loyalty_points: 200 });
    db.getConnection.mockResolvedValueOnce(conn);
    const earned = await awardPoints(db, 1, 42, 100000);
    expect(earned).toBeGreaterThan(0);
    const lockingCall = conn.query.mock.calls.find(c => /SELECT loyalty_points FROM users WHERE user_id=\? FOR UPDATE/.test(c[0]));
    expect(lockingCall).toBeDefined();
    expect(conn.commit).toHaveBeenCalled();
});
