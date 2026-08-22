'use strict';
/**
 * Phase 2I — CRITICAL price-tampering fix.
 * POST /api/payment/create previously took `amount` straight from the
 * client body with zero validation against booking.total_amount, so a
 * caller could request a gateway payUrl for far less than the booking's
 * real total and have vnpay/return · momo/return · momo/notify mark it
 * PAID on nothing more than a validly-signed gateway callback (which also
 * never checked the amount). Both the request-creation path and the
 * return/notify amount cross-check are covered here.
 * All DB access and gateway calls are mocked — no real network/DB touched.
 */

jest.mock('../server/config/db', () => ({ query: jest.fn() }));
const db = require('../server/config/db');

jest.mock('../server/services/paymentService', () => ({
    createVNPayPayment: jest.fn(() => ({ payUrl: 'https://vnpay.example/pay', orderId: 'SB1T1' })),
    createMoMoPayment: jest.fn(async () => ({ payUrl: 'https://momo.example/pay', orderId: 'SMART1_1' })),
    getVietQRUrl: jest.fn(() => 'https://img.vietqr.io/fake.png'),
    verifyVNPayReturn: jest.fn(),
    parseVNPayBookingId: jest.fn(),
    verifyMoMoReturn: jest.fn(),
    parseMoMoBookingId: jest.fn(),
}));
const pmt = require('../server/services/paymentService');

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.redirect = jest.fn().mockReturnValue(res);
    return res;
}

function getHandler(path, method = 'post') {
    const router = require('../server/routes/paymentRoutes');
    const layer = router.stack.find(l => l.route && l.route.path === path && l.route.methods[method]);
    return layer.route.stack[layer.route.stack.length - 1].handle;
}

beforeEach(() => { jest.clearAllMocks(); });

describe('Phase 2I — POST /api/payment/create ignores client-supplied amount', () => {
    test('uses booking.total_amount from the DB, not a spoofed body.amount', async () => {
        const handler = getHandler('/create', 'post');
        db.query.mockResolvedValueOnce([[{ status: 'PENDING', total_amount: 500000 }]]);
        const req = { body: { booking_id: 1, payment_method: 'vnpay', amount: 1000 }, headers: {}, socket: {} };
        const res = mockRes();
        await handler(req, res);
        expect(pmt.createVNPayPayment).toHaveBeenCalledWith(
            expect.objectContaining({ bookingId: 1, amount: 500000 })
        );
    });

    test('booking not PENDING → 409, no gateway call made', async () => {
        const handler = getHandler('/create', 'post');
        db.query.mockResolvedValueOnce([[{ status: 'PAID', total_amount: 500000 }]]);
        const req = { body: { booking_id: 1, payment_method: 'vnpay', amount: 500000 } };
        const res = mockRes();
        await handler(req, res);
        expect(res.status).toHaveBeenCalledWith(409);
        expect(pmt.createVNPayPayment).not.toHaveBeenCalled();
    });

    test('unknown booking_id → 404', async () => {
        const handler = getHandler('/create', 'post');
        db.query.mockResolvedValueOnce([[]]);
        const req = { body: { booking_id: 999, payment_method: 'vnpay', amount: 1 } };
        const res = mockRes();
        await handler(req, res);
        expect(res.status).toHaveBeenCalledWith(404);
    });
});

describe('Phase 2I — vnpay/return amount cross-check', () => {
    test('mismatched paid amount → booking NOT marked PAID', async () => {
        const handler = getHandler('/vnpay/return', 'get');
        pmt.verifyVNPayReturn.mockReturnValue(true);
        pmt.parseVNPayBookingId.mockReturnValue('1');
        db.query
            .mockResolvedValueOnce([[{ total_amount: 500000 }]]) // amount cross-check lookup
            .mockResolvedValueOnce([[{ booking_code: 'ABC123' }]]); // bookingCode lookup for redirect
        const req = { query: { vnp_Amount: '100000' } }; // 1,000đ paid (x100), real total is 500,000đ
        const res = mockRes();
        await handler(req, res);
        const updateCall = db.query.mock.calls.find(c => /UPDATE booking SET status='PAID'/.test(c[0]));
        expect(updateCall).toBeUndefined();
    });

    test('matching paid amount → booking marked PAID', async () => {
        const handler = getHandler('/vnpay/return', 'get');
        pmt.verifyVNPayReturn.mockReturnValue(true);
        pmt.parseVNPayBookingId.mockReturnValue('1');
        db.query
            .mockResolvedValueOnce([[{ total_amount: 500000 }]]) // amount cross-check
            .mockResolvedValueOnce([{}])                          // UPDATE
            .mockResolvedValueOnce([{}])                          // INSERT payment
            .mockResolvedValueOnce([[{ booking_code: 'ABC123' }]]); // bookingCode lookup for redirect
        const req = { query: { vnp_Amount: '50000000' } }; // 500,000đ * 100
        const res = mockRes();
        await handler(req, res);
        const updateCall = db.query.mock.calls.find(c => /UPDATE booking SET status='PAID'/.test(c[0]));
        expect(updateCall).toBeDefined();
    });
});

describe('Phase 2I — momo/notify amount cross-check', () => {
    test('mismatched paid amount → booking NOT marked PAID', async () => {
        const handler = getHandler('/momo/notify', 'post');
        pmt.verifyMoMoReturn.mockReturnValue(true);
        pmt.parseMoMoBookingId.mockReturnValue('1');
        db.query.mockResolvedValueOnce([[{ total_amount: 500000 }]]);
        const req = { body: { amount: 1000 } };
        const res = mockRes();
        await handler(req, res);
        const updateCall = db.query.mock.calls.find(c => /UPDATE booking SET status='PAID'/.test(c[0]));
        expect(updateCall).toBeUndefined();
        expect(res.json).toHaveBeenCalledWith({ message: 'ok' });
    });
});
