'use strict';
/**
 * Phase 2I — GET /api/payment/status/:bookingId no longer leaks booking_code.
 * Previously returned booking_code for any booking_id with zero auth — a
 * direct bypass of the F-13/F-17 fix (booking_code is the secret
 * vietqr/confirm requires). Only `status` is returned now.
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

test('response never includes booking_code, even though the DB row has one', async () => {
    // Load the route file to get the express router, then invoke the
    // '/status/:bookingId' handler directly via the router stack.
    const router = require('../server/routes/paymentRoutes');
    const layer = router.stack.find(l => l.route && l.route.path === '/status/:bookingId');
    expect(layer).toBeDefined();
    const handler = layer.route.stack[0].handle;

    db.query.mockResolvedValueOnce([[{ status: 'PAID', booking_code: 'SECRET99' }]]);
    const req = { params: { bookingId: '42' } };
    const res = mockRes();
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ status: 'PAID' });
    const responseArg = res.json.mock.calls[0][0];
    expect(responseArg.booking_code).toBeUndefined();
    // Also verify the SQL itself no longer selects booking_code.
    expect(db.query.mock.calls[0][0]).not.toMatch(/booking_code/);
});

test('unknown booking_id → 404', async () => {
    const router = require('../server/routes/paymentRoutes');
    const layer = router.stack.find(l => l.route && l.route.path === '/status/:bookingId');
    const handler = layer.route.stack[0].handle;

    db.query.mockResolvedValueOnce([[]]);
    const req = { params: { bookingId: '99999' } };
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
});
