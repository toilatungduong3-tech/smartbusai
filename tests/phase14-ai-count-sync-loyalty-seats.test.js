'use strict';
/**
 * Phase 14 — 4 root-cause fixes:
 *   1. AI search badge ("Còn X chuyến sắp tới") vs the real results list —
 *      previously two independent SQL queries with different WHERE
 *      conditions (no date filter on the badge's count), now the badge
 *      literally reuses tripController._runTripSearch()'s row count.
 *   2. applyUserTierDiscount(basePrice, userTier, systemFeePct) — one
 *      canonical formula shared by loyaltyService (backend, the real
 *      charge) and /public/js/pricing.js (frontend display).
 *   3. seatController.getSeatsByTrip — removed a bogus
 *      DATE(bk.booking_time)=DATE(t.departure_time) condition that
 *      undercounted real advance bookings. The fill-rate/overflow math
 *      itself was moved client-side in operator/seats.html
 *      (_occupancyStats, clamped MIN/MAX per the checklist's formula) —
 *      verified live in-browser, not unit-testable here (no jsdom
 *      environment configured in this repo for inline <script> logic).
 *   4. seatController.batchUpdateSeats — PUT /api/seats/batch-update,
 *      used by operator/seats.html's new row/column quick-edit tool.
 */

jest.mock('../server/config/db', () => ({ query: jest.fn(), getConnection: jest.fn() }));
const db = require('../server/config/db');

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

beforeEach(() => jest.clearAllMocks());

/* ══════════════════════════════════════════
   1. AI search-insight trip count == real search count
══════════════════════════════════════════ */
describe('passengerAIController.getSearchInsight — trip count matches the real search exactly', () => {
    const tripController = require('../server/controllers/tripController');
    const aiController = require('../server/controllers/passengerAIController');

    test('reuses tripController._runTripSearch — never a second, independently-filtered COUNT query', async () => {
        const spy = jest.spyOn(tripController, '_runTripSearch').mockResolvedValueOnce({
            rows: Array.from({ length: 9 }, (_, i) => ({ trip_id: i + 1, base_price: 100000 + i * 1000 })),
        });
        db.query.mockResolvedValue([[]]); // user_history / lastBook / etc. queries

        const req = { query: { origin: 'Vĩnh Long', destination: 'Đồng Tháp', date: '2026-08-25' }, user: null };
        const res = mockRes();
        await aiController.getSearchInsight(req, res);

        // Called with the exact same params a real search would use —
        // this IS what guarantees parity, not a coincidence of numbers.
        expect(spy).toHaveBeenCalledWith(db, expect.objectContaining({
            origin: 'Vĩnh Long', destination: 'Đồng Tháp', date: '2026-08-25',
        }));

        const body = res.json.mock.calls[0][0];
        const availabilityInsight = body.insights.find(i => i.type === 'availability');
        expect(availabilityInsight.text).toBe('Còn 9 chuyến sắp tới');
        spy.mockRestore();
    });

    test('zero real results -> no availability insight claiming a nonzero count', async () => {
        const spy = jest.spyOn(tripController, '_runTripSearch').mockResolvedValueOnce({ rows: [] });
        db.query.mockResolvedValue([[]]);
        const req = { query: { origin: 'Cà Mau', destination: 'Lai Châu' }, user: null };
        const res = mockRes();
        await aiController.getSearchInsight(req, res);
        const body = res.json.mock.calls[0][0];
        expect(body.insights.find(i => i.type === 'availability')).toBeUndefined();
        spy.mockRestore();
    });

    test('forwards busType/minPrice/maxPrice too, not just date — the badge must match ANY active filter, not just date', async () => {
        const spy = jest.spyOn(tripController, '_runTripSearch').mockResolvedValueOnce({ rows: [{ trip_id: 1, base_price: 1 }] });
        db.query.mockResolvedValue([[]]);
        const req = { query: { origin: 'A', destination: 'B', busType: 'VIP', minPrice: '100000', maxPrice: '500000' }, user: null };
        const res = mockRes();
        await aiController.getSearchInsight(req, res);
        expect(spy).toHaveBeenCalledWith(db, expect.objectContaining({
            busType: 'VIP', minPrice: '100000', maxPrice: '500000',
        }));
        spy.mockRestore();
    });
});

/* ══════════════════════════════════════════
   2. Loyalty tier discount — canonical shared formula
══════════════════════════════════════════ */
describe('loyaltyService.applyUserTierDiscount — canonical formula (discount then system fee)', () => {
    const { applyUserTierDiscount, calculateDiscountedPrice } = require('../server/services/loyaltyService');

    test('DIAMOND (15% off), no fee: 580000 -> 493000', () => {
        expect(applyUserTierDiscount(580000, 'DIAMOND', 0).finalPrice).toBe(493000);
    });

    test('DIAMOND (15% off) + 2% system fee composes as base*(1-0.15)*(1.02)', () => {
        const result = applyUserTierDiscount(580000, 'DIAMOND', 2);
        expect(result.finalPrice).toBe(Math.round(580000 * 0.85 * 1.02));
        expect(result.discountPct).toBe(15);
        expect(result.feePct).toBe(2);
    });

    test('BRONZE (0% discount) still applies the system fee — fee is unconditional', () => {
        const result = applyUserTierDiscount(100000, 'BRONZE', 2);
        expect(result.finalPrice).toBe(102000);
        expect(result.discountPct).toBe(0);
    });

    test('unknown/missing tier falls back to BRONZE (0% discount), never throws', () => {
        expect(() => applyUserTierDiscount(100000, 'NOT_A_TIER', 0)).not.toThrow();
        expect(applyUserTierDiscount(100000, undefined, 0).finalPrice).toBe(100000);
    });

    test('missing/invalid systemFeePct defaults to 0, never NaN', () => {
        expect(applyUserTierDiscount(100000, 'GOLD', undefined).finalPrice).toBe(90000);
        expect(Number.isFinite(applyUserTierDiscount(100000, 'GOLD', 'abc').finalPrice)).toBe(true);
    });

    test('calculateDiscountedPrice (discount-only helper) still exists unchanged for callers that only need the tier %', () => {
        expect(calculateDiscountedPrice(580000, 'DIAMOND').discountedPrice).toBe(493000);
    });
});

/* ══════════════════════════════════════════
   3. getSeatsByTrip — no longer undercounts advance bookings
══════════════════════════════════════════ */
describe('seatController.getSeatsByTrip — scoped strictly to trip_id, no booking_time date restriction', () => {
    const seatController = require('../server/controllers/seatController');

    test('the query no longer restricts on DATE(bk.booking_time) — that column comparison undercounted real advance bookings', async () => {
        db.query.mockResolvedValueOnce([[{ seat_id: 1, seat_number: 'A1', seat_type: 'NORMAL', isBooked: 1 }]]);
        const req = { params: { tripId: '5' } };
        const res = mockRes();
        await seatController.getSeatsByTrip(req, res);
        const sql = db.query.mock.calls[0][0];
        expect(sql).toMatch(/bk\.trip_id\s*=\s*t\.trip_id/);
        expect(sql).not.toMatch(/DATE\(bk\.booking_time\)/);
        expect(sql).toMatch(/WHERE t\.trip_id\s*=\s*\?/);
        expect(db.query.mock.calls[0][1]).toEqual(['5']);
    });
});

/* ══════════════════════════════════════════
   4. Batch row/column seat-type update
══════════════════════════════════════════ */
describe('seatController.batchUpdateSeats — PUT /api/seats/batch-update', () => {
    const seatController = require('../server/controllers/seatController');
    const OPERATOR_A = { user_id: 10, role: 'OPERATOR' };
    const OPERATOR_B = { user_id: 11, role: 'OPERATOR' };
    const ADMIN = { user_id: 1, role: 'ADMIN' };

    test('updates every seat_id in ONE query, scoped to the caller\'s own operator_id', async () => {
        db.query.mockResolvedValueOnce([[{ operator_id: 5 }]]); // ownership lookup: all seats belong to operator 5
        db.query.mockResolvedValueOnce([{ affectedRows: 3 }]);  // the UPDATE
        const req = { body: { seat_ids: [1, 2, 3], seat_type: 'VIP' }, user: OPERATOR_A, operatorId: 5 };
        const res = mockRes();
        await seatController.batchUpdateSeats(req, res);

        expect(res.status).not.toHaveBeenCalledWith(400);
        expect(res.status).not.toHaveBeenCalledWith(403);
        expect(db.query).toHaveBeenCalledTimes(2);
        const updateCall = db.query.mock.calls[1];
        expect(updateCall[0]).toMatch(/UPDATE seat/i);
        expect(updateCall[0]).toMatch(/seat_id IN/i);
        expect(updateCall[1]).toEqual(['VIP', [1, 2, 3]]);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ updated: 3 }));
    });

    test('rejects touching another operator\'s seats, no UPDATE issued', async () => {
        db.query.mockResolvedValueOnce([[{ operator_id: 6 }]]); // seats belong to operator 6, caller is operator 5
        const req = { body: { seat_ids: [1, 2], seat_type: 'VIP' }, user: OPERATOR_A, operatorId: 5 };
        const res = mockRes();
        await seatController.batchUpdateSeats(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(db.query).toHaveBeenCalledTimes(1); // ownership check only, no UPDATE
    });

    test('ADMIN can batch-update seats across any operator', async () => {
        db.query.mockResolvedValueOnce([[{ operator_id: 6 }]]);
        db.query.mockResolvedValueOnce([{ affectedRows: 2 }]);
        const req = { body: { seat_ids: [1, 2], seat_type: 'NORMAL' }, user: ADMIN, operatorId: null };
        const res = mockRes();
        await seatController.batchUpdateSeats(req, res);
        expect(res.status).not.toHaveBeenCalledWith(403);
        expect(db.query).toHaveBeenCalledTimes(2);
    });

    test('rejects an invalid seat_type (not VIP/NORMAL) before touching the DB', async () => {
        const req = { body: { seat_ids: [1, 2], seat_type: 'DROP TABLE seat' }, user: OPERATOR_A, operatorId: 5 };
        const res = mockRes();
        await seatController.batchUpdateSeats(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('rejects an empty seat_ids array before touching the DB', async () => {
        const req = { body: { seat_ids: [], seat_type: 'VIP' }, user: OPERATOR_A, operatorId: 5 };
        const res = mockRes();
        await seatController.batchUpdateSeats(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('rejects non-numeric seat_ids before touching the DB', async () => {
        const req = { body: { seat_ids: [1, 'DROP TABLE'], seat_type: 'VIP' }, user: OPERATOR_A, operatorId: 5 };
        const res = mockRes();
        await seatController.batchUpdateSeats(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('404 when none of the seat_ids exist', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { body: { seat_ids: [999], seat_type: 'VIP' }, user: OPERATOR_A, operatorId: 5 };
        const res = mockRes();
        await seatController.batchUpdateSeats(req, res);
        expect(res.status).toHaveBeenCalledWith(404);
    });
});
