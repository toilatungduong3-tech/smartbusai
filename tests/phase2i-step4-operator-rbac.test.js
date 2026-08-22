'use strict';
/**
 * Phase 2I Step 4 — operator/bus/seat RBAC + tenant-ownership regression
 * tests. operatorRoutes.js/busRoutes.js/seatRoutes.js were previously fully
 * unauthenticated. authenticate/requireAdminOrOperator/requireAdmin are
 * wired at the route level (already covered by authMiddleware's own
 * behavior — malformed/missing/invalid tokens always 401, wrong role always
 * 403, tested elsewhere in this suite). These tests cover what only the
 * controllers can prove: ownership enforcement via operatorScope.js,
 * derived from req.user/req.operatorId as the route middleware would set
 * them, for operator A vs operator B vs ADMIN vs an unlinked operator
 * account. All DB access is mocked — no real database is touched.
 */

jest.mock('../server/config/db', () => ({ query: jest.fn() }));
const db = require('../server/config/db');
const bus = require('../server/controllers/busController');
const seat = require('../server/controllers/seatController');
const operatorCtrl = require('../server/controllers/operatorController');

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}
const OPERATOR_A = { user_id: 10, role: 'OPERATOR', email: 'opA@test.local' };
const OPERATOR_B = { user_id: 11, role: 'OPERATOR', email: 'opB@test.local' };
const ADMIN      = { user_id: 1,  role: 'ADMIN',    email: 'admin@test.local' };

beforeEach(() => { jest.clearAllMocks(); });

describe('busController — ownership enforcement', () => {
    test('createBus: OPERATOR with no linked operator_id → 403, no INSERT attempted', async () => {
        const req = { user: OPERATOR_A, operatorId: undefined, body: { plate_number: 'X', bus_type: 'VIP', total_seats: 40 } };
        const res = mockRes();
        await bus.createBus(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('createBus: linked OPERATOR ignores a spoofed body.operator_id, uses their own', async () => {
        db.query.mockResolvedValueOnce([{ insertId: 99 }]);
        const req = { user: OPERATOR_A, operatorId: 5, body: { operator_id: 999, plate_number: 'X', bus_type: 'VIP', total_seats: 40 } };
        const res = mockRes();
        await bus.createBus(req, res);
        expect(db.query.mock.calls[0][1][0]).toBe(5); // operator_id param — not 999
    });

    test('createBus: ADMIN may specify any operator_id', async () => {
        db.query.mockResolvedValueOnce([{ insertId: 99 }]);
        const req = { user: ADMIN, operatorId: null, body: { operator_id: 7, plate_number: 'X', bus_type: 'VIP', total_seats: 40 } };
        const res = mockRes();
        await bus.createBus(req, res);
        expect(db.query.mock.calls[0][1][0]).toBe(7);
    });

    test('updateBus: operator A cannot modify operator B\'s bus → 403, no UPDATE attempted', async () => {
        db.query.mockResolvedValueOnce([[{ operator_id: 999 }]]); // bus belongs to operator 999
        const req = { user: OPERATOR_A, operatorId: 5, params: { id: '1' }, body: { plate_number: 'X' } };
        const res = mockRes();
        await bus.updateBus(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(db.query).toHaveBeenCalledTimes(1); // only the ownership lookup
    });

    test('updateBus: operator can modify their own bus', async () => {
        db.query.mockResolvedValueOnce([[{ operator_id: 5 }]]).mockResolvedValueOnce([{}]);
        const req = { user: OPERATOR_A, operatorId: 5, params: { id: '1' }, body: { plate_number: 'X', bus_type: 'VIP', total_seats: 40 } };
        const res = mockRes();
        await bus.updateBus(req, res);
        expect(res.status).not.toHaveBeenCalledWith(403);
    });

    test('updateBus: ADMIN can modify any operator\'s bus', async () => {
        db.query.mockResolvedValueOnce([[{ operator_id: 999 }]]).mockResolvedValueOnce([{}]);
        const req = { user: ADMIN, operatorId: null, params: { id: '1' }, body: { plate_number: 'X' } };
        const res = mockRes();
        await bus.updateBus(req, res);
        expect(res.status).not.toHaveBeenCalledWith(403);
    });

    test('updateBus: nonexistent bus → 404', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { user: OPERATOR_A, operatorId: 5, params: { id: '999' }, body: {} };
        const res = mockRes();
        await bus.updateBus(req, res);
        expect(res.status).toHaveBeenCalledWith(404);
    });

    test('updateBusStatus: operator B cannot change operator A\'s bus status → 403', async () => {
        db.query.mockResolvedValueOnce([[{ operator_id: 5 }]]);
        const req = { user: OPERATOR_B, operatorId: 6, params: { id: '1' }, body: { status: 'MAINTENANCE' } };
        const res = mockRes();
        await bus.updateBusStatus(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
    });

    test('deleteBus: operator cannot delete another operator\'s bus → 403, no DELETE attempted', async () => {
        db.query.mockResolvedValueOnce([[{ operator_id: 5 }]]);
        const req = { user: OPERATOR_B, operatorId: 6, params: { id: '1' } };
        const res = mockRes();
        await bus.deleteBus(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(db.query).toHaveBeenCalledTimes(1);
    });
});

describe('seatController — ownership enforcement via bus chain', () => {
    test('createSeat: operator cannot add a seat to another operator\'s bus → 403', async () => {
        db.query.mockResolvedValueOnce([[{ operator_id: 5 }]]);
        const req = { user: OPERATOR_B, operatorId: 6, body: { bus_id: 1, seat_number: 'A1' } };
        const res = mockRes();
        await seat.createSeat(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
    });

    test('updateSeat: operator cannot modify a seat on another operator\'s bus → 403', async () => {
        db.query.mockResolvedValueOnce([[{ operator_id: 5 }]]);
        const req = { user: OPERATOR_B, operatorId: 6, params: { id: '1' }, body: { seat_type: 'VIP' } };
        const res = mockRes();
        await seat.updateSeat(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
    });

    test('updateSeat: operator can modify a seat on their own bus', async () => {
        db.query.mockResolvedValueOnce([[{ operator_id: 5 }]]).mockResolvedValueOnce([{}]);
        const req = { user: OPERATOR_A, operatorId: 5, params: { id: '1' }, body: { seat_type: 'VIP' } };
        const res = mockRes();
        await seat.updateSeat(req, res);
        expect(res.status).not.toHaveBeenCalledWith(403);
    });

    test('deleteSeat: operator cannot delete a seat on another operator\'s bus → 403, no booking-check query attempted', async () => {
        db.query.mockResolvedValueOnce([[{ operator_id: 5 }]]);
        const req = { user: OPERATOR_B, operatorId: 6, params: { id: '1' } };
        const res = mockRes();
        await seat.deleteSeat(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    test('generateSeats: operator cannot generate seats for another operator\'s trip/bus → 403', async () => {
        db.query.mockResolvedValueOnce([[{ bus_id: 1, total_seats: 40, operator_id: 5 }]]);
        const req = { user: OPERATOR_B, operatorId: 6, params: { tripId: '1' } };
        const res = mockRes();
        await seat.generateSeats(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
    });

    test('expandSeats: operator cannot expand seats for another operator\'s bus → 403', async () => {
        db.query.mockResolvedValueOnce([[{ bus_id: 1, total_seats: 40, operator_id: 5 }]]);
        const req = { user: OPERATOR_B, operatorId: 6, params: { busId: '1' } };
        const res = mockRes();
        await seat.expandSeats(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
    });
});

describe('operatorController — dashboard tenant scoping', () => {
    test('getDashboardStats: OPERATOR query is scoped by their operator_id', async () => {
        db.query.mockResolvedValueOnce([[{ totalTrips: 3, totalBookings: 2, totalRevenue: 100000, avgRating: 4.5 }]]);
        const req = { user: OPERATOR_A, operatorId: 5 };
        const res = mockRes();
        await operatorCtrl.getDashboardStats(req, res);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/operator_id\s*=\s*\?/);
        /* Enterprise Hardening follow-up: getDashboardStats now returns a
           much richer KPI shape (todayRevenue, activeTrips, activeBus,
           bookingRate, monthRevenue, ...) — every one of those extra
           subqueries scopes by the same operator_id, so the placeholder
           count grew from a hardcoded 4 to however many `?` the SQL
           template actually contains. Every placeholder is the SAME
           value (opId), so what actually matters for tenant-scoping
           correctness is that every bound param is operatorId — not a
           specific count that would need updating every time a KPI is
           added. */
        expect(params.length).toBeGreaterThan(0);
        expect(params.every(p => p === 5)).toBe(true);
    });

    test('getDashboardStats: ADMIN query is global (no operator_id filter)', async () => {
        db.query.mockResolvedValueOnce([[{ totalTrips: 100, totalBookings: 80, totalRevenue: 5000000, avgRating: 4.2 }]]);
        const req = { user: ADMIN, operatorId: null };
        const res = mockRes();
        await operatorCtrl.getDashboardStats(req, res);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).not.toMatch(/operator_id\s*=\s*\?/);
        expect(params).toEqual([]);
    });

    test('getDashboardStats: unlinked OPERATOR account gets an empty result, no query attempted', async () => {
        const req = { user: OPERATOR_A, operatorId: undefined };
        const res = mockRes();
        await operatorCtrl.getDashboardStats(req, res);
        expect(db.query).not.toHaveBeenCalled();
        /* Extended emptyStats shape (Enterprise Hardening follow-up) — see
           operatorController.js's emptyStats constant for the full field
           list operator.html's loadStats() now reads. */
        expect(res.json).toHaveBeenCalledWith({
            totalTrips: 0, totalBookings: 0, totalRevenue: 0, avgRating: 0,
            todayRevenue: 0, todayBookings: 0, activeTrips: 0, activeBus: 0,
            totalSeats: 0, bookingRate: 0, avgTicket: 0, totalBus: 0, totalRoutes: 0,
            monthRevenue: 0, monthBookings: 0, fullTrips: 0, canceledTrips: 0,
            maintenanceBus: 0, revGrowth: 0, bkGrowth: 0,
        });
    });

    test('getBuses (dashboard fleet): OPERATOR only sees their own buses', async () => {
        db.query.mockResolvedValueOnce([[{ bus_id: 1 }]]);
        const req = { user: OPERATOR_A, operatorId: 5 };
        const res = mockRes();
        await operatorCtrl.getBuses(req, res);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/WHERE b\.operator_id=\?/);
        expect(params).toEqual([5]);
    });
});
