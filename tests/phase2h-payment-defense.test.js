'use strict';
/**
 * Phase 2H Priority 4 — F-13/F-17 VietQR confirm defense.
 * Previously: any caller who knew a booking_id could mark it PAID.
 * Now: booking_code (the same secret already used by guest booking lookup)
 * is required and must match, status is explicitly validated, and the
 * payment INSERT is guarded by the UPDATE's affectedRows to avoid
 * duplicate payment rows under a race.
 * All DB access is mocked — no real database is touched.
 */

jest.mock('../server/config/db', () => ({ query: jest.fn() }));
jest.mock('../server/services/paymentService', () => ({}));
const db = require('../server/config/db');

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

beforeEach(() => { jest.clearAllMocks(); });

describe('Phase 2H — POST /api/payment/vietqr/confirm', () => {
    test('missing booking_code → 400, no DB query attempted', async () => {
        const { confirmVietQR } = require('../server/routes/paymentRoutes');
        const req = { body: { booking_id: 42 } };
        const res = mockRes();
        await confirmVietQR(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('unknown booking_id → 404', async () => {
        const { confirmVietQR } = require('../server/routes/paymentRoutes');
        db.query.mockResolvedValueOnce([[]]);
        const req = { body: { booking_id: 99999, booking_code: 'ABCD1234' } };
        const res = mockRes();
        await confirmVietQR(req, res);
        expect(res.status).toHaveBeenCalledWith(404);
    });

    test('wrong booking_code (arbitrary booking_id attack) → 403, booking NOT marked PAID', async () => {
        const { confirmVietQR } = require('../server/routes/paymentRoutes');
        db.query.mockResolvedValueOnce([[{ status: 'PENDING', total_amount: 300000, booking_code: 'REALCODE' }]]);
        const req = { body: { booking_id: 42, booking_code: 'GUESSED1' } };
        const res = mockRes();
        await confirmVietQR(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(db.query).toHaveBeenCalledTimes(1); // only the SELECT — no UPDATE ever attempted
    });

    test('booking with NULL booking_code (legacy row) cannot be confirmed by any code', async () => {
        const { confirmVietQR } = require('../server/routes/paymentRoutes');
        db.query.mockResolvedValueOnce([[{ status: 'PENDING', total_amount: 300000, booking_code: null }]]);
        const req = { body: { booking_id: 42, booking_code: 'ANYTHING1' } };
        const res = mockRes();
        await confirmVietQR(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
    });

    test('correct code but booking already CANCELED → 409, not silently marked PAID', async () => {
        const { confirmVietQR } = require('../server/routes/paymentRoutes');
        db.query.mockResolvedValueOnce([[{ status: 'CANCELED', total_amount: 300000, booking_code: 'REALCODE' }]]);
        const req = { body: { booking_id: 42, booking_code: 'REALCODE' } };
        const res = mockRes();
        await confirmVietQR(req, res);
        expect(res.status).toHaveBeenCalledWith(409);
        expect(db.query).toHaveBeenCalledTimes(1); // no UPDATE/INSERT for a non-payable booking
    });

    test('already PAID → idempotent 200 success, no duplicate payment row inserted', async () => {
        const { confirmVietQR } = require('../server/routes/paymentRoutes');
        db.query.mockResolvedValueOnce([[{ status: 'PAID', total_amount: 300000, booking_code: 'REALCODE' }]]);
        const req = { body: { booking_id: 42, booking_code: 'REALCODE' } };
        const res = mockRes();
        await confirmVietQR(req, res);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        expect(db.query).toHaveBeenCalledTimes(1); // no further writes
    });

    test('correct code, PENDING booking → status flips to PAID, exactly one payment row inserted', async () => {
        const { confirmVietQR } = require('../server/routes/paymentRoutes');
        db.query
            .mockResolvedValueOnce([[{ status: 'PENDING', total_amount: 300000, booking_code: 'REALCODE' }]])
            .mockResolvedValueOnce([{ affectedRows: 1 }])
            .mockResolvedValueOnce([{}]);
        const req = { body: { booking_id: 42, booking_code: 'REALCODE' } };
        const res = mockRes();
        await confirmVietQR(req, res);
        expect(db.query.mock.calls[1][0]).toMatch(/UPDATE booking SET status='PAID'/);
        expect(db.query.mock.calls[2][0]).toMatch(/INSERT INTO payment/);
        expect(db.query.mock.calls[2][1]).toEqual([42, 300000]);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    test('race condition — UPDATE affects 0 rows → 409, payment INSERT never attempted (no duplicate)', async () => {
        const { confirmVietQR } = require('../server/routes/paymentRoutes');
        db.query
            .mockResolvedValueOnce([[{ status: 'PENDING', total_amount: 300000, booking_code: 'REALCODE' }]])
            .mockResolvedValueOnce([{ affectedRows: 0 }]); // another request already flipped it
        const req = { body: { booking_id: 42, booking_code: 'REALCODE' } };
        const res = mockRes();
        await confirmVietQR(req, res);
        expect(res.status).toHaveBeenCalledWith(409);
        expect(db.query).toHaveBeenCalledTimes(2); // never reaches the INSERT
    });
});
