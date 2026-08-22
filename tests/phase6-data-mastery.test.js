'use strict';
/**
 * TRUTHNODE — SPRINT 6: Data Integrity, Route Map & Seat Map Mastery.
 * Covers: Dynamic Seat Layout Engine (JSON matrix generation + CRUD
 * blocked-when-booked constraints on bus/trip), opt-in pagination on
 * /api/trips, /api/bookings, /api/buses, and Profile/Saved-Passenger data
 * integrity. DB access is mocked throughout, consistent with every other
 * test file in this repo — live proof (real route_stop backfill, real
 * seat-layout generation, real CRUD-guard 409s, real pagination responses)
 * was run against the real server/DB this sprint and is documented in
 * DATA_CRUD_MASTERY_REPORT.md, not re-measured here.
 */

jest.mock('../server/config/db', () => ({ query: jest.fn(), getConnection: jest.fn() }));
const db = require('../server/config/db');

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

beforeEach(() => { jest.clearAllMocks(); });

/* ══════════════════════════════════════════
   1. Dynamic Seat Layout Engine — pure logic
══════════════════════════════════════════ */
describe('seatLayoutService — bus category classification', () => {
    const { classifyBusCategory } = require('../server/services/seatLayoutService');

    test('"Ghế ngồi 45 chỗ" -> SEATER', () => {
        expect(classifyBusCategory('Ghế ngồi 45 chỗ')).toBe('SEATER');
    });
    test('"VIP Limousine 22 chỗ" -> LIMOUSINE', () => {
        expect(classifyBusCategory('VIP Limousine 22 chỗ')).toBe('LIMOUSINE');
    });
    test('"Giường nằm 40 chỗ" -> SLEEPER (case-sensitive Vietnamese diacritics handled correctly)', () => {
        expect(classifyBusCategory('Giường nằm 40 chỗ')).toBe('SLEEPER');
    });
    test('unrecognized free-text bus_type ("STANDARD") -> SEATER default, never throws', () => {
        expect(classifyBusCategory('STANDARD')).toBe('SEATER');
    });
    test('empty/null busType -> SEATER default, never throws', () => {
        expect(classifyBusCategory(null)).toBe('SEATER');
        expect(classifyBusCategory(undefined)).toBe('SEATER');
    });
});

describe('seatLayoutService — buildSeatLayout / flattenLayoutToSeats', () => {
    const { buildSeatLayout, flattenLayoutToSeats } = require('../server/services/seatLayoutService');

    test.each([
        ['Ghế ngồi 45 chỗ', 45, 'SEATER', 1],
        ['Ghế ngồi 29 chỗ', 29, 'SEATER', 1],
        ['VIP Limousine 22 chỗ', 22, 'LIMOUSINE', 1],
        ['VIP Limousine 9 chỗ', 9, 'LIMOUSINE', 1],
        ['Giường nằm 40 chỗ', 40, 'SLEEPER', 2],
        ['Giường nằm 34 chỗ', 34, 'SLEEPER', 2],
    ])('%s (%i chỗ) generates exactly %i seats with no duplicates across %i floor(s)', (busType, totalSeats, expectedCategory, expectedFloors) => {
        const layout = buildSeatLayout(busType, totalSeats);
        expect(layout.category).toBe(expectedCategory);
        expect(layout.floors.length).toBe(expectedFloors);

        const seats = flattenLayoutToSeats(layout);
        expect(seats.length).toBe(totalSeats);
        const seatNumbers = seats.map(s => s.seat_number);
        expect(new Set(seatNumbers).size).toBe(seatNumbers.length); // no duplicate seat_number
        seats.forEach(s => expect(['NORMAL', 'VIP']).toContain(s.seat_type));
    });

    test('SLEEPER floor-2 seat numbers are prefixed to disambiguate from floor 1 (both floors otherwise reuse A1, B1...)', () => {
        const layout = buildSeatLayout('Giường nằm 40 chỗ', 40);
        const floor2Seats = flattenLayoutToSeats({ floors: [layout.floors[1]] });
        expect(floor2Seats.every(s => s.seat_number.startsWith('2-'))).toBe(true);
    });

    test('invalid totalSeats (0, negative, NaN) throws rather than silently producing a broken layout', () => {
        expect(() => buildSeatLayout('Ghế ngồi', 0)).toThrow();
        expect(() => buildSeatLayout('Ghế ngồi', -5)).toThrow();
        expect(() => buildSeatLayout('Ghế ngồi', NaN)).toThrow();
    });

    test('aisle cells are excluded from the flattened seat list', () => {
        const layout = buildSeatLayout('Ghế ngồi 8 chỗ', 8);
        const anyAisle = layout.floors[0].rows.some(r => r.cells.some(c => c.aisle));
        expect(anyAisle).toBe(true); // layout itself has aisle markers
        const seats = flattenLayoutToSeats(layout);
        expect(seats.every(s => s.seat_number)).toBe(true); // every flattened entry is a real seat
    });
});

/* ══════════════════════════════════════════
   2. CRUD validation — blocked when active bookings exist
══════════════════════════════════════════ */
describe('busController.updateBus — blocks bus_type/total_seats change when actively booked', () => {
    const ctrl = require('../server/controllers/busController');

    test('changing bus_type on a bus with a PAID/PENDING booking -> 409, no UPDATE attempted', async () => {
        db.query
            .mockResolvedValueOnce([[{ operator_id: 3, bus_type: 'Ghế ngồi 45 chỗ', total_seats: 45 }]]) // SELECT bus
            .mockResolvedValueOnce([[{ cnt: 2 }]]); // active-booking count
        const req = { params: { id: '5' }, user: { role: 'ADMIN' }, body: { bus_type: 'VIP Limousine 22 chỗ', total_seats: 22 } };
        const res = mockRes();
        await ctrl.updateBus(req, res);
        expect(res.status).toHaveBeenCalledWith(409);
        expect(db.query).toHaveBeenCalledTimes(2); // SELECT + booking-count check only, never the UPDATE
    });

    test('changing bus_type with zero active bookings -> allowed, seat_layout_config regenerated', async () => {
        db.query
            .mockResolvedValueOnce([[{ operator_id: 3, bus_type: 'Ghế ngồi 45 chỗ', total_seats: 45 }]])
            .mockResolvedValueOnce([[{ cnt: 0 }]])
            .mockResolvedValueOnce([{}]); // UPDATE
        const req = { params: { id: '5' }, user: { role: 'ADMIN' }, body: { bus_type: 'VIP Limousine 22 chỗ', total_seats: 22, plate_number: '29A-1', status: 'AVAILABLE' } };
        const res = mockRes();
        await ctrl.updateBus(req, res);
        expect(res.status).not.toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ seat_layout_regenerated: true }));
        const updateCall = db.query.mock.calls[2];
        expect(updateCall[0]).toMatch(/seat_layout_config/);
    });

    test('changing only status/description (not bus_type/total_seats) -> never checks bookings at all', async () => {
        db.query
            .mockResolvedValueOnce([[{ operator_id: 3, bus_type: 'Ghế ngồi 45 chỗ', total_seats: 45 }]])
            .mockResolvedValueOnce([{}]); // UPDATE directly — no booking-count query in between
        const req = { params: { id: '5' }, user: { role: 'ADMIN' }, body: { status: 'MAINTENANCE' } };
        const res = mockRes();
        await ctrl.updateBus(req, res);
        expect(db.query).toHaveBeenCalledTimes(2);
        expect(db.query.mock.calls[1][0]).not.toMatch(/booking/i);
    });
});

describe('busController.deleteBus — blocks when actively booked', () => {
    const ctrl = require('../server/controllers/busController');

    test('bus with active bookings -> 409, DELETE never attempted', async () => {
        db.query
            .mockResolvedValueOnce([[{ operator_id: 3 }]])
            .mockResolvedValueOnce([[{ cnt: 1 }]]);
        const req = { params: { id: '5' }, user: { role: 'ADMIN' } };
        const res = mockRes();
        await ctrl.deleteBus(req, res);
        expect(res.status).toHaveBeenCalledWith(409);
        expect(db.query).toHaveBeenCalledTimes(2);
    });

    test('bus with zero active bookings -> deleted normally', async () => {
        db.query
            .mockResolvedValueOnce([[{ operator_id: 3 }]])
            .mockResolvedValueOnce([[{ cnt: 0 }]])
            .mockResolvedValueOnce([{}]);
        const req = { params: { id: '5' }, user: { role: 'ADMIN' } };
        const res = mockRes();
        await ctrl.deleteBus(req, res);
        expect(res.status).not.toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('thành công') }));
    });
});

describe('tripController.updateTrip — blocks structural change (route/bus/time) when actively booked', () => {
    const EXISTING_ROW = {
        route_id: 10, bus_id: 20,
        departure_time: new Date(2026, 7, 20, 8, 0, 0),
        arrival_time: new Date(2026, 7, 20, 12, 0, 0),
        base_price: 250000, status: 'OPEN',
    };

    test('changing bus_id on a trip with active bookings -> 409, UPDATE never attempted', async () => {
        const ctrl = require('../server/controllers/tripController');
        db.query
            .mockResolvedValueOnce([[EXISTING_ROW]])
            .mockResolvedValueOnce([[{ cnt: 3 }]]);
        const req = { params: { id: '5' }, body: { bus_id: 99 } };
        const res = mockRes();
        await ctrl.updateTrip(req, res);
        expect(res.status).toHaveBeenCalledWith(409);
        expect(db.query).toHaveBeenCalledTimes(2);
    });

    test('changing base_price only (not a structural field) on an actively-booked trip -> allowed (dynamic pricing must keep working)', async () => {
        const ctrl = require('../server/controllers/tripController');
        db.query
            .mockResolvedValueOnce([[EXISTING_ROW]])
            .mockResolvedValueOnce([{}]); // UPDATE directly, no booking-count check
        const req = { params: { id: '5' }, body: { base_price: 280000 } };
        const res = mockRes();
        await ctrl.updateTrip(req, res);
        expect(res.status).not.toHaveBeenCalledWith(409);
        expect(db.query).toHaveBeenCalledTimes(2);
    });
});

/* ══════════════════════════════════════════
   3. Pagination — /api/trips, /api/bookings, /api/buses
══════════════════════════════════════════ */
describe('utils/pagination — parsePagination', () => {
    const { parsePagination, paginatedResponse } = require('../server/utils/pagination');

    test('no page/limit params -> null (opt-in: preserves the unbounded-array behavior)', () => {
        expect(parsePagination({})).toBeNull();
        expect(parsePagination(undefined)).toBeNull();
    });
    test('?limit=10 alone -> page defaults to 1', () => {
        expect(parsePagination({ limit: '10' })).toEqual({ page: 1, limit: 10, offset: 0 });
    });
    test('?page=3&limit=20 -> correct offset', () => {
        expect(parsePagination({ page: '3', limit: '20' })).toEqual({ page: 3, limit: 20, offset: 40 });
    });
    test('limit is capped at max_limit=100 even if a caller asks for more', () => {
        expect(parsePagination({ page: '1', limit: '99999' }).limit).toBe(100);
    });
    test('invalid/non-numeric page or limit falls back to safe defaults (page=1, limit=20), never NaN/negative', () => {
        expect(parsePagination({ page: 'abc', limit: '20' }).page).toBe(1);
        expect(parsePagination({ page: '1', limit: 'xyz' }).limit).toBe(20);
        expect(parsePagination({ page: '-5', limit: '20' }).page).toBe(1);
    });
    test('paginatedResponse wraps rows with correct total/totalPages', () => {
        const wrapped = paginatedResponse([{ a: 1 }], 45, { page: 2, limit: 20 });
        expect(wrapped).toEqual({ data: [{ a: 1 }], pagination: { total: 45, page: 2, limit: 20, totalPages: 3 } });
    });
});

describe('tripController.getTrips — opt-in pagination', () => {
    const ctrl = require('../server/controllers/tripController');

    test('no page/limit -> raw array response, exactly as before Sprint 6 (backward compatible)', async () => {
        db.query.mockResolvedValueOnce([[{ trip_id: 1 }, { trip_id: 2 }]]);
        const req = { query: {} };
        const res = mockRes();
        await ctrl.getTrips(req, res);
        expect(db.query).toHaveBeenCalledTimes(1); // no COUNT query when unpaginated
        expect(res.json).toHaveBeenCalledWith([{ trip_id: 1 }, { trip_id: 2 }]);
    });

    test('?page=2&limit=5 -> {data, pagination} shape, with a COUNT query and LIMIT/OFFSET applied', async () => {
        db.query
            .mockResolvedValueOnce([[{ total: 37 }]])
            .mockResolvedValueOnce([[{ trip_id: 6 }]]);
        const req = { query: { page: '2', limit: '5' } };
        const res = mockRes();
        await ctrl.getTrips(req, res);
        expect(res.json).toHaveBeenCalledWith({
            data: [{ trip_id: 6 }],
            pagination: { total: 37, page: 2, limit: 5, totalPages: 8 },
        });
        const mainQueryCall = db.query.mock.calls[1];
        expect(mainQueryCall[0]).toMatch(/LIMIT \? OFFSET \?/);
        expect(mainQueryCall[1].slice(-2)).toEqual([5, 5]); // limit=5, offset=(page-1)*limit=5
    });
});

describe('bookingController.getAllBookings / busController.getBuses — opt-in pagination (same contract)', () => {
    test('bookings: unpaginated by default, no crash when req.query is entirely absent', async () => {
        const ctrl = require('../server/controllers/bookingController');
        db.query.mockResolvedValueOnce([[{ booking_id: 1 }]]);
        const req = { user: { role: 'ADMIN' } }; // no .query at all — matches real pre-Sprint-6 test fixtures
        const res = mockRes();
        await ctrl.getAllBookings(req, res);
        expect(res.json).toHaveBeenCalledWith([{ booking_id: 1 }]);
    });

    test('buses: ?page=1&limit=9 -> paginated response', async () => {
        const ctrl = require('../server/controllers/busController');
        db.query
            .mockResolvedValueOnce([[{ total: 53 }]])
            .mockResolvedValueOnce([[{ bus_id: 1 }]]);
        const req = { user: { role: 'ADMIN' }, query: { page: '1', limit: '9' } };
        const res = mockRes();
        await ctrl.getBuses(req, res);
        expect(res.json).toHaveBeenCalledWith({
            data: [{ bus_id: 1 }],
            pagination: { total: 53, page: 1, limit: 9, totalPages: 6 },
        });
    });
});

/* ══════════════════════════════════════════
   4. Profile & Saved Passengers data integrity
══════════════════════════════════════════ */
describe('userController — saved passengers CRUD', () => {
    const ctrl = require('../server/controllers/userController');

    test('addSavedPassenger rejects an empty/missing full_name', async () => {
        const req = { params: { id: '1' }, body: { full_name: '   ' } };
        const res = mockRes();
        await ctrl.addSavedPassenger(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('addSavedPassenger enforces a 20-passenger cap per user', async () => {
        db.query.mockResolvedValueOnce([[{ cnt: 20 }]]);
        const req = { params: { id: '1' }, body: { full_name: 'Nguyễn Văn A' } };
        const res = mockRes();
        await ctrl.addSavedPassenger(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
    });

    test('addSavedPassenger succeeds under the cap, trims whitespace from full_name', async () => {
        db.query
            .mockResolvedValueOnce([[{ cnt: 3 }]])
            .mockResolvedValueOnce([{ insertId: 42 }]);
        const req = { params: { id: '1' }, body: { full_name: '  Nguyễn Văn A  ', phone: '0900000000' } };
        const res = mockRes();
        await ctrl.addSavedPassenger(req, res);
        expect(res.status).toHaveBeenCalledWith(201);
        const insertParams = db.query.mock.calls[1][1];
        expect(insertParams[1]).toBe('Nguyễn Văn A'); // trimmed
    });

    test('deleteSavedPassenger is scoped to both saved_passenger_id AND user_id (cannot delete another user\'s saved passenger)', async () => {
        db.query.mockResolvedValueOnce([{ affectedRows: 0 }]);
        const req = { params: { id: '1', passengerId: '99' } };
        const res = mockRes();
        await ctrl.deleteSavedPassenger(req, res);
        expect(res.status).toHaveBeenCalledWith(404);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/saved_passenger_id=\? AND user_id=\?/);
        expect(params).toEqual(['99', '1']);
    });

    test('getSavedPassengers never selects id_number/email of OTHER users — scoped to :id only', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { params: { id: '1' } };
        const res = mockRes();
        await ctrl.getSavedPassengers(req, res);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/WHERE user_id=\?/);
        expect(params).toEqual(['1']);
    });
});

describe('userController.getStatsSummary — composes existing endpoints without duplicating their SQL', () => {
    const ctrl = require('../server/controllers/userController');
    const loyaltyService = require('../server/services/loyaltyService');

    test('merges getUserStats + getTravelProfile + loyaltyService.getUserLoyalty into one response', async () => {
        db.query
            // getUserStats: booking aggregate, then loyalty_points lookup
            .mockResolvedValueOnce([[{ completed: 12, total_spent: 3000000 }]])
            .mockResolvedValueOnce([[{ loyalty_points: 0 }]])
            // getTravelProfile: favRoutes, favOps, total_km, topDeps
            .mockResolvedValueOnce([[{ route: 'Hà Nội → Đà Nẵng', cnt: 5 }]])
            .mockResolvedValueOnce([[{ company_name: 'Phương Trang', cnt: 5 }]])
            .mockResolvedValueOnce([[{ total_km: 5000 }]])
            .mockResolvedValueOnce([[]]);
        jest.spyOn(loyaltyService, 'getUserLoyalty').mockResolvedValueOnce({
            points: 3000, tier: 'GOLD', tierLabel: '🥇 Vàng', tierDiscount: 10,
            nextTier: 'DIAMOND', nextTierAt: 5000, progress: 60,
        });

        const req = { params: { id: '1' } };
        const res = mockRes();
        await ctrl.getStatsSummary(req, res);

        expect(res.json).toHaveBeenCalledWith({
            total_trips: 12,
            total_spent: 3000000,
            favorite_route: 'Hà Nội → Đà Nẵng',
            km_traveled: 5000,
            loyalty_points: 3000,
            membership_tier: 'GOLD',
            membership_tier_label: '🥇 Vàng',
            tier_discount_pct: 10,
            next_tier: 'DIAMOND',
            next_tier_at: 5000,
            tier_progress_pct: 60,
        });
        loyaltyService.getUserLoyalty.mockRestore();
    });
});

describe('userController.updateUser — accepts the new Sprint 6 profile auto-fill fields', () => {
    const ctrl = require('../server/controllers/userController');

    test('id_number/default_pickup/default_dropoff are written via the same IFNULL-preserve pattern as other fields', async () => {
        db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
        const req = {
            params: { id: '1' },
            user: { user_id: 1, role: 'PASSENGER' },
            body: { id_number: '001199012345', default_pickup: 'Bến xe Mỹ Đình', default_dropoff: 'Bến xe Miền Đông' },
        };
        const res = mockRes();
        await ctrl.updateUser(req, res);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/id_number=IFNULL\(\?,id_number\)/);
        expect(sql).toMatch(/default_pickup=IFNULL\(\?,default_pickup\)/);
        expect(sql).toMatch(/default_dropoff=IFNULL\(\?,default_dropoff\)/);
        expect(params).toContain('001199012345');
        expect(params).toContain('Bến xe Mỹ Đình');
        expect(params).toContain('Bến xe Miền Đông');
    });

    test('omitting id_number/default_pickup/default_dropoff never overwrites existing values (IFNULL keeps them)', async () => {
        db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
        const req = { params: { id: '1' }, user: { user_id: 1, role: 'PASSENGER' }, body: { full_name: 'New Name' } };
        const res = mockRes();
        await ctrl.updateUser(req, res);
        const params = db.query.mock.calls[0][1];
        expect(params).toContain(null); // id_number/default_pickup/default_dropoff all pass null -> IFNULL keeps existing
    });
});

/* ══════════════════════════════════════════
   5. route_stop generator — grounding rules
══════════════════════════════════════════ */
describe('generate_route_stops — never fabricates coordinates for a route it can\'t ground in real data', () => {
    test('a route whose origin/destination matches neither a curated station nor a known province is skipped, not faked', async () => {
        jest.resetModules();
        jest.doMock('../server/config/db', () => ({ query: jest.fn(), getConnection: jest.fn() }));
        jest.doMock('../server/config/seed_full', () => ({
            PROVINCES: [{ name: 'Hà Nội', lat: 21.0285, lng: 105.8542 }],
            BUS_STATIONS: [{ city: 'Hà Nội', name: 'Bến xe Mỹ Đình', lat: 21.0278, lng: 105.7829, address: 'Hà Nội' }],
        }));
        const mockedDb = require('../server/config/db');
        mockedDb.query
            .mockResolvedValueOnce([[]]) // junk cleanup check
            .mockResolvedValueOnce([[{ route_id: 999, origin: 'Hà Nội', destination: 'Phú Quốc', distance_km: 500 }]]); // uncovered routes

        const { generateRouteStops } = require('../server/config/generate_route_stops');
        const result = await generateRouteStops({ dryRun: true });

        expect(result.routesFixed).toBe(0);
        expect(result.skipped).toEqual([{ route_id: 999, origin: 'Hà Nội', destination: 'Phú Quốc' }]);

        jest.dontMock('../server/config/db');
        jest.dontMock('../server/config/seed_full');
    });

    test('a route with a known province on both ends gets real, non-zero coordinates — never lat=0/lng=0', async () => {
        jest.resetModules();
        jest.doMock('../server/config/db', () => ({ query: jest.fn(), getConnection: jest.fn() }));
        jest.doMock('../server/config/seed_full', () => ({
            PROVINCES: [
                { name: 'Hà Nội', lat: 21.0285, lng: 105.8542 },
                { name: 'Nam Định', lat: 20.4388, lng: 106.1621 },
            ],
            BUS_STATIONS: [],
        }));
        const mockedDb = require('../server/config/db');
        mockedDb.query
            .mockResolvedValueOnce([[]])
            .mockResolvedValueOnce([[{ route_id: 5, origin: 'Hà Nội', destination: 'Nam Định', distance_km: 90 }]])
            .mockResolvedValueOnce([{}]) // PICKUP insert
            .mockResolvedValueOnce([{}]); // DROPOFF insert

        const { generateRouteStops } = require('../server/config/generate_route_stops');
        const result = await generateRouteStops({ dryRun: false });

        expect(result.routesFixed).toBe(1);
        expect(result.skipped).toEqual([]);
        const pickupInsertParams = mockedDb.query.mock.calls[2][1];
        expect(pickupInsertParams[4]).toBe(21.0285); // real lat, never 0
        expect(pickupInsertParams[5]).toBe(105.8542); // real lng, never 0

        jest.dontMock('../server/config/db');
        jest.dontMock('../server/config/seed_full');
    });
});
