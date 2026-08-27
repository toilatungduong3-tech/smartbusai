'use strict';
/**
 * Phase 13 — VNPay code=99 fix, booking.html seat-badge fix, and
 * System Fee / VIP surcharge sync between booking.html and
 * bookingController.createBooking.
 *
 * Covers:
 *   1. bookingController.createBooking now applies BOTH systemFee and the
 *      real configured vipSurcharge (previously hardcoded to 50%, while
 *      settings.json/booking.html already used a different configured
 *      value) — mocking settingsController's exported getters keeps this
 *      deterministic regardless of the real settings.json on disk.
 *   2. Both now route through loyaltyService.applyUserTierDiscount()'s
 *      canonical formula (discount * fee, single rounding), with VIP
 *      surcharge applied as a separate multiplier on top — see phase14's
 *      test file for direct coverage of applyUserTierDiscount itself.
 *   3. paymentService VNPay fixes are covered in phase8-ui-payment-oauth.
 *      test.js (createVNPayPayment/verifyVNPayReturn round-trip, real
 *      crypto) — not duplicated here.
 */

jest.mock('../server/config/db', () => ({ query: jest.fn(), getConnection: jest.fn() }));
const db = require('../server/config/db');

jest.mock('../server/controllers/settingsController', () => ({
    getSystemFeePercent: jest.fn(() => 2),      // 2%
    getVipSurchargePercent: jest.fn(() => 20),  // 20%, NOT the old hardcoded 50%
}));
const settingsCtrl = require('../server/controllers/settingsController');

jest.mock('../server/services/loyaltyService', () => ({
    getUserLoyalty: jest.fn(),
    calculateDiscountedPrice: jest.requireActual('../server/services/loyaltyService').calculateDiscountedPrice,
    applyUserTierDiscount: jest.requireActual('../server/services/loyaltyService').applyUserTierDiscount,
    awardPoints: jest.fn(() => Promise.resolve(0)),
}));
const loyaltyService = require('../server/services/loyaltyService');

const bookingCtrl = require('../server/controllers/bookingController');

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

/** Mirrors phase1-transactions.test.js's makeCreateBookingConn helper. */
function makeConn({ basePrice = 100000 } = {}) {
    return {
        beginTransaction: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn(),
        release: jest.fn(),
        query: jest.fn((sql) => {
            if (/SELECT base_price, bus_id FROM trip/.test(sql)) {
                return Promise.resolve([[{ base_price: basePrice, bus_id: 1 }]]);
            }
            /* Sprint 24 — createBooking now runs pricingEngine.getDynamicPrice()
               on this same connection before applying fee/discount (see
               phase14's own dedicated test file for pricingEngine coverage
               in isolation). Fixed at a neutral 1.00x multiplier here — 5
               days out (the >3-and-<=7-day band) and 30% occupancy (inside
               the 20%-50% "no adjustment" band) — so every dollar-amount
               assertion below keeps testing fee/discount/VIP-surcharge
               composition in isolation, unaffected by dynamic pricing. */
            if (/FROM trip t\s+JOIN bus b/.test(sql)) {
                const departure_time = new Date(Date.now() + 5 * 24 * 3600 * 1000);
                return Promise.resolve([[{ base_price: basePrice, departure_time, booked: 3, total_seats: 10 }]]);
            }
            if (/SELECT bd\.seat_id FROM booking_detail/.test(sql)) return Promise.resolve([[]]);
            if (/SELECT booking_id FROM booking WHERE booking_code=\?/.test(sql)) return Promise.resolve([[]]);
            if (/INSERT INTO booking \(/.test(sql)) return Promise.resolve([{ insertId: 500 }]);
            if (/INSERT INTO booking_detail/.test(sql)) return Promise.resolve([{}]);
            if (/INSERT INTO trip_seat_hold/.test(sql)) return Promise.resolve([{}]);
            return Promise.resolve([{}]);
        }),
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    settingsCtrl.getSystemFeePercent.mockReturnValue(2);
    settingsCtrl.getVipSurchargePercent.mockReturnValue(20);
    loyaltyService.getUserLoyalty.mockResolvedValue({ tier: 'BRONZE', tierDiscount: 0 });
});

describe('createBooking — system fee applied to total_amount', () => {
    test('BRONZE (no discount), 1 normal seat, base 100000, fee 2% -> 102000', async () => {
        const conn = makeConn({ basePrice: 100000 });
        db.getConnection.mockResolvedValue(conn);
        const req = { body: { trip_id: 1, seats: [{ id: 1, type: 'NORMAL' }], guest_name: 'A', guest_phone: '0900000000' } };
        const res = mockRes();
        await bookingCtrl.createBooking(req, res);

        expect(res.status).toHaveBeenCalledWith(201);
        const payload = res.json.mock.calls[0][0];
        expect(payload.total).toBe(102000);
        expect(payload.system_fee_pct).toBe(2);
    });

    test('fee compounds with a real loyalty discount, applied to the fee-adjusted price', async () => {
        loyaltyService.getUserLoyalty.mockResolvedValue({ tier: 'GOLD', tierDiscount: 10 });
        const conn = makeConn({ basePrice: 100000 });
        db.getConnection.mockResolvedValue(conn);
        const req = {
            body: { trip_id: 1, seats: [{ id: 1, type: 'NORMAL' }], user_id: 7 },
            user: { user_id: 7 },
        };
        const res = mockRes();
        await bookingCtrl.createBooking(req, res);

        // feeAdjusted = round(100000*1.02) = 102000; discounted = round(102000*0.90) = 91800
        const payload = res.json.mock.calls[0][0];
        expect(payload.total).toBe(91800);
        expect(payload.loyalty_tier).toBe('GOLD');
        expect(payload.loyalty_discount_pct).toBe(10);
    });

    test('systemFee=0 leaves the price exactly at the pre-fee behavior', async () => {
        settingsCtrl.getSystemFeePercent.mockReturnValue(0);
        const conn = makeConn({ basePrice: 250000 });
        db.getConnection.mockResolvedValue(conn);
        const req = { body: { trip_id: 1, seats: [{ id: 1, type: 'NORMAL' }], guest_name: 'A', guest_phone: '0900000000' } };
        const res = mockRes();
        await bookingCtrl.createBooking(req, res);
        expect(res.json.mock.calls[0][0].total).toBe(250000);
    });
});

describe('createBooking — VIP surcharge reads the real configured %, not a hardcoded 50%', () => {
    test('VIP seat uses the configured 20% surcharge, applied after fee (not the old hardcoded 1.5x)', async () => {
        const conn = makeConn({ basePrice: 100000 });
        db.getConnection.mockResolvedValue(conn);
        const req = { body: { trip_id: 1, seats: [{ id: 1, type: 'VIP' }], guest_name: 'A', guest_phone: '0900000000' } };
        const res = mockRes();
        await bookingCtrl.createBooking(req, res);

        // feeAdjusted = round(100000*1.02) = 102000; VIP = round(102000*1.20) = 122400
        // (old hardcoded behavior would have been 100000*1.5 = 150000 — a real, previously-live price mismatch vs booking.html)
        const payload = res.json.mock.calls[0][0];
        expect(payload.total).toBe(122400);
    });

    test('mixed normal + VIP seats: booking_detail.price sum still equals total_amount', async () => {
        const conn = makeConn({ basePrice: 100000 });
        db.getConnection.mockResolvedValue(conn);
        const req = {
            body: { trip_id: 1, seats: [{ id: 1, type: 'NORMAL' }, { id: 2, type: 'VIP' }], guest_name: 'A', guest_phone: '0900000000' },
        };
        const res = mockRes();
        await bookingCtrl.createBooking(req, res);

        const detailInsertCall = conn.query.mock.calls.find(c => /INSERT INTO booking_detail/.test(c[0]));
        const rows = detailInsertCall[1][0]; // [ [bookingId, seatId, price], ... ]
        const sum = rows.reduce((a, r) => a + r[2], 0);
        const payload = res.json.mock.calls[0][0];
        expect(sum).toBe(payload.total);
        expect(rows.find(r => r[1] === 1)[2]).toBe(102000); // NORMAL: fee only
        expect(rows.find(r => r[1] === 2)[2]).toBe(122400); // VIP: fee then +20%
    });
});
