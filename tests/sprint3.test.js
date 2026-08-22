'use strict';
/**
 * Sprint 3 Tests — SmartBusAI
 * Tests cho: Auth/RBAC, US-903, US-101, US-102, US-103, US-201, US-501
 * Tất cả controller tests là UNIT (không cần DB thật)
 */

/* ══════════════════════════════════════════
   1. AUTH MIDDLEWARE TESTS
══════════════════════════════════════════ */
/* Sprint 3: authenticate() now re-checks the user's status in the DB on
   every call (see server/middleware/authMiddleware.js) — db.js is mocked
   here so this stays a real unit test. Every OTHER describe block in this
   file requires controllers that never actually reach a db.query() call
   under the specific validation-only paths they test, so a file-wide mock
   returning undefined-by-default is harmless to them. */
jest.mock('../server/config/db', () => ({ query: jest.fn(), getConnection: jest.fn() }));

describe('authMiddleware', () => {
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = require('../server/config/jwtSecret'); // same source authMiddleware verifies against
    const db = require('../server/config/db');

    function makeToken(payload, secret = JWT_SECRET, opts = {}) {
        return jwt.sign(payload, secret, { expiresIn: '1h', ...opts });
    }

    function mockRes() {
        const res = {};
        res.status = jest.fn().mockReturnValue(res);
        res.json   = jest.fn().mockReturnValue(res);
        return res;
    }

    const { authenticate, requireAdmin, requireAdminOrOperator, requireSelfOrAdmin } =
        require('../server/middleware/authMiddleware');

    beforeEach(() => { db.query.mockReset(); });

    test('authenticate — missing header → 401', () => {
        const req = { headers: {} };
        const res = mockRes();
        const next = jest.fn();
        authenticate(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    test('authenticate — invalid token → 401', () => {
        const req = { headers: { authorization: 'Bearer INVALID' } };
        const res = mockRes();
        const next = jest.fn();
        authenticate(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
    });

    test('authenticate — expired token → 401 expired', () => {
        const token = makeToken({ user_id: 1, role: 'ADMIN' }, JWT_SECRET, { expiresIn: '-1s' });
        const req = { headers: { authorization: `Bearer ${token}` } };
        const res = mockRes();
        const next = jest.fn();
        authenticate(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ expired: true }));
    });

    test('authenticate — valid token, ACTIVE user → sets req.user and calls next', async () => {
        const token = makeToken({ user_id: 5, role: 'PASSENGER', email: 'a@b.com' });
        const req = { headers: { authorization: `Bearer ${token}` } };
        const res = mockRes();
        const next = jest.fn();
        db.query.mockResolvedValueOnce([[{ status: 'ACTIVE' }]]);
        await authenticate(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(req.user).toMatchObject({ user_id: 5, role: 'PASSENGER' });
    });

    /* Sprint 3 — MASTER_COMPLETION_MATRIX.md blocker: a valid, unexpired
       token for a since-blocked user must be rejected, not silently
       trusted from the token payload. */
    test('authenticate — valid token, BLOCKED user → 403, next NOT called', async () => {
        const token = makeToken({ user_id: 5, role: 'PASSENGER', email: 'a@b.com' });
        const req = { headers: { authorization: `Bearer ${token}` } };
        const res = mockRes();
        const next = jest.fn();
        db.query.mockResolvedValueOnce([[{ status: 'BLOCKED' }]]);
        await authenticate(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
        expect(req.user).toBeUndefined();
    });

    test('authenticate — valid token, user no longer exists (deleted) → 403, fails closed', async () => {
        const token = makeToken({ user_id: 999, role: 'PASSENGER', email: 'a@b.com' });
        const req = { headers: { authorization: `Bearer ${token}` } };
        const res = mockRes();
        const next = jest.fn();
        db.query.mockResolvedValueOnce([[]]);
        await authenticate(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    test('requireAdmin — PASSENGER → 403', () => {
        const req = { user: { user_id: 2, role: 'PASSENGER' } };
        const res = mockRes();
        const next = jest.fn();
        requireAdmin(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    test('requireAdmin — ADMIN → calls next', () => {
        const req = { user: { user_id: 1, role: 'ADMIN' } };
        const res = mockRes();
        const next = jest.fn();
        requireAdmin(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('requireAdminOrOperator — OPERATOR → calls next', () => {
        const req = { user: { user_id: 3, role: 'OPERATOR' } };
        const res = mockRes();
        const next = jest.fn();
        requireAdminOrOperator(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('requireAdminOrOperator — PASSENGER → 403', () => {
        const req = { user: { user_id: 3, role: 'PASSENGER' } };
        const res = mockRes();
        const next = jest.fn();
        requireAdminOrOperator(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
    });

    test('requireSelfOrAdmin — own resource → calls next', () => {
        const req = { user: { user_id: 5, role: 'PASSENGER' }, params: { id: '5' } };
        const res = mockRes();
        const next = jest.fn();
        requireSelfOrAdmin(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('requireSelfOrAdmin — other user resource → 403', () => {
        const req = { user: { user_id: 5, role: 'PASSENGER' }, params: { id: '99' } };
        const res = mockRes();
        const next = jest.fn();
        requireSelfOrAdmin(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
    });

    test('requireSelfOrAdmin — ADMIN accessing other user → calls next', () => {
        const req = { user: { user_id: 1, role: 'ADMIN' }, params: { id: '99' } };
        const res = mockRes();
        const next = jest.fn();
        requireSelfOrAdmin(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('requireSelfOrAdmin — no user → 401', () => {
        const req = { user: null, params: { id: '1' } };
        const res = mockRes();
        const next = jest.fn();
        requireSelfOrAdmin(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
    });
});

/* ══════════════════════════════════════════
   2. US-903 USER CONTROLLER — pagination/validation logic
══════════════════════════════════════════ */
describe('US-903 userController validation', () => {
    function mockRes() {
        const res = {};
        res.status = jest.fn().mockReturnValue(res);
        res.json   = jest.fn().mockReturnValue(res);
        return res;
    }

    test('updateUser — PASSENGER trying to change role → 403', async () => {
        const ctrl = require('../server/controllers/userController');
        const req = {
            params: { id: '5' },
            user: { user_id: 5, role: 'PASSENGER' },
            body: { role: 'ADMIN' }
        };
        const res = mockRes();
        await ctrl.updateUser(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
    });

    test('updateUser — invalid role → 422', async () => {
        const ctrl = require('../server/controllers/userController');
        const req = {
            params: { id: '5' },
            user: { user_id: 1, role: 'ADMIN' },
            body: { role: 'SUPERADMIN' }
        };
        const res = mockRes();
        await ctrl.updateUser(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
    });

    test('updateUser — invalid status → 422', async () => {
        const ctrl = require('../server/controllers/userController');
        const req = {
            params: { id: '5' },
            user: { user_id: 1, role: 'ADMIN' },
            body: { status: 'DELETED' }
        };
        const res = mockRes();
        await ctrl.updateUser(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
    });

    test('deleteUser — self-deletion → 409', async () => {
        const ctrl = require('../server/controllers/userController');
        const req = {
            params: { id: '1' },
            user: { user_id: 1, role: 'ADMIN' }
        };
        const res = mockRes();
        await ctrl.deleteUser(req, res);
        expect(res.status).toHaveBeenCalledWith(409);
    });
});

/* ══════════════════════════════════════════
   3. US-101 ADMIN CONTROLLER — route validation
══════════════════════════════════════════ */
describe('US-101 route validation', () => {
    function mockRes() {
        const res = {};
        res.status = jest.fn().mockReturnValue(res);
        res.json   = jest.fn().mockReturnValue(res);
        return res;
    }

    test('createRoute — missing origin → 400', async () => {
        const ctrl = require('../server/controllers/adminController');
        const req  = { body: { destination: 'Đà Nẵng' } };
        const res  = mockRes();
        await ctrl.createRoute(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('createRoute — origin === destination → 422', async () => {
        const ctrl = require('../server/controllers/adminController');
        const req  = { body: { origin: 'Hà Nội', destination: 'Hà Nội' } };
        const res  = mockRes();
        await ctrl.createRoute(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
    });

    test('createRoute — negative distance → 422', async () => {
        const ctrl = require('../server/controllers/adminController');
        const req  = { body: { origin: 'Hà Nội', destination: 'Đà Nẵng', distance_km: -100 } };
        const res  = mockRes();
        await ctrl.createRoute(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
    });

    test('updateRouteStatus — invalid status → 422', async () => {
        const ctrl = require('../server/controllers/adminController');
        const req  = { params: { id: '1' }, body: { status: 'DELETED' } };
        const res  = mockRes();
        await ctrl.updateRouteStatus(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
    });
});

/* ══════════════════════════════════════════
   4. US-102 IMPORT ROUTES — preview validation (pure logic, no DB)
══════════════════════════════════════════ */
describe('US-102 importRoutesPreview validation', () => {
    function mockRes() {
        const res = {};
        res.status = jest.fn().mockReturnValue(res);
        res.json   = jest.fn().mockReturnValue(res);
        return res;
    }

    test('empty rows → 400', async () => {
        const ctrl = require('../server/controllers/adminController');
        const req  = { body: { rows: [] } };
        const res  = mockRes();
        await ctrl.importRoutesPreview(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('rows not array → 400', async () => {
        const ctrl = require('../server/controllers/adminController');
        const req  = { body: { rows: "not-array" } };
        const res  = mockRes();
        await ctrl.importRoutesPreview(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('over 500 rows → 400', async () => {
        const ctrl = require('../server/controllers/adminController');
        const rows = Array.from({ length: 501 }, (_, i) => ({ origin: `A${i}`, destination: `B${i}` }));
        const req  = { body: { rows } };
        const res  = mockRes();
        await ctrl.importRoutesPreview(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });
});

/* ══════════════════════════════════════════
   5. US-103 TRIP CONTROLLER — validation
══════════════════════════════════════════ */
describe('US-103 tripController validation', () => {
    function mockRes() {
        const res = {};
        res.status = jest.fn().mockReturnValue(res);
        res.json   = jest.fn().mockReturnValue(res);
        return res;
    }

    test('createTrip — arrival before departure → 422', async () => {
        const ctrl = require('../server/controllers/tripController');
        const req  = {
            body: {
                route_id: 1, bus_id: 1,
                departure_time: '2026-07-20 10:00:00',
                arrival_time:   '2026-07-20 08:00:00',
                base_price: 200000
            }
        };
        const res = mockRes();
        await ctrl.createTrip(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
    });

    test('createTrip — missing fields → 400', async () => {
        const ctrl = require('../server/controllers/tripController');
        const req  = { body: { route_id: 1 } };
        const res  = mockRes();
        await ctrl.createTrip(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('createTrip — negative price → 422', async () => {
        const ctrl = require('../server/controllers/tripController');
        const req  = {
            body: {
                route_id: 1, bus_id: 1,
                departure_time: '2026-07-20 08:00:00',
                arrival_time:   '2026-07-20 18:00:00',
                base_price: -100
            }
        };
        const res = mockRes();
        await ctrl.createTrip(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
    });

    test('updateTripStatus — invalid status → 422', async () => {
        const ctrl = require('../server/controllers/tripController');
        const req  = { params: { id: '1' }, body: { status: 'INVALID_STATUS' } };
        const res  = mockRes();
        await ctrl.updateTripStatus(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
    });

    test('updateTripPrice — negative price → 422', async () => {
        const ctrl = require('../server/controllers/tripController');
        const req  = { params: { id: '1' }, body: { price: -500 } };
        const res  = mockRes();
        await ctrl.updateTripPrice(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
    });

    /* Phase 2H Priority 3 — searchTrips price filter validation */
    test('searchTrips — non-numeric minPrice → 422', async () => {
        const ctrl = require('../server/controllers/tripController');
        const req  = { query: { minPrice: 'abc' } };
        const res  = mockRes();
        await ctrl.searchTrips(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
    });

    test('searchTrips — negative maxPrice → 422', async () => {
        const ctrl = require('../server/controllers/tripController');
        const req  = { query: { maxPrice: '-100' } };
        const res  = mockRes();
        await ctrl.searchTrips(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
    });

    test('searchTrips — minPrice > maxPrice → 422', async () => {
        const ctrl = require('../server/controllers/tripController');
        const req  = { query: { minPrice: '300000', maxPrice: '100000' } };
        const res  = mockRes();
        await ctrl.searchTrips(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
    });
});

/* ══════════════════════════════════════════
   6. US-201 LOCATION — GPS validation
══════════════════════════════════════════ */
describe('US-201 Location GPS validation', () => {
    function mockRes() {
        const res = {};
        res.status = jest.fn().mockReturnValue(res);
        res.json   = jest.fn().mockReturnValue(res);
        return res;
    }

    test('createLocation — missing name → 400', async () => {
        const ctrl = require('../server/controllers/adminController');
        const req  = { body: { latitude: 21, longitude: 106 } };
        const res  = mockRes();
        await ctrl.createLocation(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('createLocation — lat > 90 → 422', async () => {
        const ctrl = require('../server/controllers/adminController');
        const req  = { body: { name: 'Test', latitude: 91, longitude: 106 } };
        const res  = mockRes();
        await ctrl.createLocation(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
    });

    test('createLocation — lat < -90 → 422', async () => {
        const ctrl = require('../server/controllers/adminController');
        const req  = { body: { name: 'Test', latitude: -91, longitude: 106 } };
        const res  = mockRes();
        await ctrl.createLocation(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
    });

    test('createLocation — lng > 180 → 422', async () => {
        const ctrl = require('../server/controllers/adminController');
        const req  = { body: { name: 'Test', latitude: 21, longitude: 181 } };
        const res  = mockRes();
        await ctrl.createLocation(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
    });

    test('createLocation — lng < -180 → 422', async () => {
        const ctrl = require('../server/controllers/adminController');
        const req  = { body: { name: 'Test', latitude: 21, longitude: -181 } };
        const res  = mockRes();
        await ctrl.createLocation(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
    });

    test('updateLocationStatus — invalid status → 422', async () => {
        const ctrl = require('../server/controllers/adminController');
        const req  = { params: { id: '1' }, body: { status: 'UNKNOWN' } };
        const res  = mockRes();
        await ctrl.updateLocationStatus(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
    });
});

/* ══════════════════════════════════════════
   7. US-501 ROUTE STOP — validation
══════════════════════════════════════════ */
describe('US-501 routeStopController validation', () => {
    function mockRes() {
        const res = {};
        res.status = jest.fn().mockReturnValue(res);
        res.json   = jest.fn().mockReturnValue(res);
        return res;
    }

    test('createStop — missing stop_name → 400', async () => {
        const ctrl = require('../server/controllers/routeStopController');
        const req  = { body: { route_id: 1 } };
        const res  = mockRes();
        await ctrl.createStop(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('createStop — invalid stop_type → 422', async () => {
        const ctrl = require('../server/controllers/routeStopController');
        const req  = { body: { route_id: 1, stop_name: 'Bến xe A', stop_type: 'INVALID' } };
        const res  = mockRes();
        await ctrl.createStop(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
    });

    test('createStop — lat out of range → 422', async () => {
        const ctrl = require('../server/controllers/routeStopController');
        const req  = { body: { route_id: 1, stop_name: 'Bến xe A', lat: 95 } };
        const res  = mockRes();
        await ctrl.createStop(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
    });

    test('createStop — lng out of range → 422', async () => {
        const ctrl = require('../server/controllers/routeStopController');
        const req  = { body: { route_id: 1, stop_name: 'Bến xe A', lng: -200 } };
        const res  = mockRes();
        await ctrl.createStop(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
    });

    test('createStop — lat=0 is valid (not falsy check)', async () => {
        const ctrl = require('../server/controllers/routeStopController');
        /* lat=0 không nên trả 422 — 0 là tọa độ hợp lệ */
        const req = { body: { route_id: 1, stop_name: 'Bến xe A', lat: 0, lng: 0 } };
        const res = mockRes();
        await ctrl.createStop(req, res);
        /* Không phải 422 (có thể 404 vì không có DB, nhưng không phải validation lỗi) */
        if (res.status.mock.calls.length > 0) {
            expect(res.status.mock.calls[0][0]).not.toBe(422);
        }
    });

    test('getNearestStops — lat > 90 → 400', async () => {
        const ctrl = require('../server/controllers/routeStopController');
        const req  = { query: { lat: '91', lng: '106' } };
        const res  = mockRes();
        await ctrl.getNearestStops(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('getNearestStops — missing lat → 400', async () => {
        const ctrl = require('../server/controllers/routeStopController');
        const req  = { query: { lng: '106' } };
        const res  = mockRes();
        await ctrl.getNearestStops(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('updateStop — lat out of range → 422', async () => {
        const ctrl = require('../server/controllers/routeStopController');
        const req  = { params: { id: '1' }, body: { stop_name: 'Test', stop_type: 'BOTH', lat: -91 } };
        const res  = mockRes();
        await ctrl.updateStop(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
    });
});

/* ══════════════════════════════════════════
   8. REGRESSION — transitRouter còn đúng
══════════════════════════════════════════ */
describe('regression — transitRouter haversine', () => {
    const { haversine } = require('../server/ai/transitRouter');

    test('haversine — same point returns 0', () => {
        expect(haversine(10.8, 106.7, 10.8, 106.7)).toBe(0);
    });

    test('haversine — Hà Nội → TP.HCM ≈ 1137 km', () => {
        const d = haversine(21.0285, 105.8542, 10.8231, 106.6297);
        expect(d).toBeGreaterThan(1100);
        expect(d).toBeLessThan(1200);
    });

    test('haversine — returns Infinity for falsy coord', () => {
        expect(haversine(null, 106, 10, 106)).toBe(Infinity);
        expect(haversine(21, 106, 10, null)).toBe(Infinity);
    });

    test('haversine — lat=0,lng=0 is valid (same point → distance=0)', () => {
        // Bug fixed: transitRouter.js now uses null/isFinite check instead of !lat1
        // lat=0 and lng=0 are valid coordinates (Gulf of Guinea)
        const d = haversine(0, 0, 0, 0);
        expect(d).toBe(0);
    });
});
