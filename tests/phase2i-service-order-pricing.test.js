'use strict';
/**
 * Phase 2I — addServiceOrder server-authoritative pricing.
 * Previously trusted body.items[].price directly, so a caller could submit
 * any price for a real onboard-item id (or a fabricated id) and have it
 * recorded as a 'SUCCESS' payment for that amount. Price now comes only
 * from the server-side SVC_ITEM_PRICES catalog.
 * All DB access is mocked — no real database is touched.
 */

jest.mock('../server/config/db', () => ({ query: jest.fn(), getConnection: jest.fn() }));
const db = require('../server/config/db');
const ctrl = require('../server/controllers/bookingController');

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

beforeEach(() => { jest.clearAllMocks(); });

test('ignores a spoofed price and prices from the server catalog instead', async () => {
    const conn = { beginTransaction: jest.fn(), query: jest.fn().mockResolvedValue([{}]), commit: jest.fn(), rollback: jest.fn(), release: jest.fn() };
    db.query.mockResolvedValueOnce([[{ booking_id: 5, total_amount: 100000, extras: null, status: 'PAID', user_id: 1 }]]);
    db.getConnection.mockResolvedValueOnce(conn);
    // real catalog price for 'hop-an' is 20000 — attacker sends 1
    const req = {
        params: { id: '5' },
        body: { items: [{ id: 'hop-an', name: 'Suất ăn nhẹ', price: 1, qty: 2 }] },
        user: { user_id: 1, role: 'PASSENGER' }
    };
    const res = mockRes();
    await ctrl.addServiceOrder(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ added_total: 40000, new_total: 140000 }));
});

test('drops items with an unknown/fabricated id entirely — priced at 0, not the fabricated price', async () => {
    const conn = { beginTransaction: jest.fn(), query: jest.fn().mockResolvedValue([{}]), commit: jest.fn(), rollback: jest.fn(), release: jest.fn() };
    db.query.mockResolvedValueOnce([[{ booking_id: 5, total_amount: 100000, extras: null, status: 'PAID', user_id: 1 }]]);
    db.getConnection.mockResolvedValueOnce(conn);
    const req = {
        params: { id: '5' },
        body: { items: [{ id: 'made-up-item', name: 'Fake', price: 999999, qty: 1 }] },
        user: { user_id: 1, role: 'PASSENGER' }
    };
    const res = mockRes();
    await ctrl.addServiceOrder(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ added_total: 0, new_total: 100000 }));
});
