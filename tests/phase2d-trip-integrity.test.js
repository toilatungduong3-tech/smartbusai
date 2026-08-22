'use strict';
/**
 * Phase 2D — F-24/F-25 root-cause regression tests
 * Bug A: tripController.updateTrip silently nulled omitted fields on a partial body.
 * Bug B: autoGenerateRecurringTrips re-selected COMPLETED trips and let invalid/
 *        zero-date source rows reach date arithmetic, producing zero-date clones.
 * All DB access is mocked — no real database is touched by this file.
 */

// Factory mock — replaces the module entirely so the real db.js (which opens
// a live connection on import) is never loaded by this test file.
jest.mock('../server/config/db', () => ({ query: jest.fn() }));
const db = require('../server/config/db');

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

/* ══════════════════════════════════════════
   isValidTripDate — pure helper, no DB needed
══════════════════════════════════════════ */
describe('tripController.isValidTripDate', () => {
    const { _isValidTripDate: isValidTripDate } = require('../server/controllers/tripController');

    test('null (SQL NULL / zero-date under this driver config) → false', () => {
        expect(isValidTripDate(null)).toBe(false);
    });
    test('undefined → false', () => {
        expect(isValidTripDate(undefined)).toBe(false);
    });
    test('valid Date object → true', () => {
        expect(isValidTripDate(new Date('2026-08-20T10:00:00Z'))).toBe(true);
    });
    test('valid date string → true', () => {
        expect(isValidTripDate('2026-08-20 10:00:00')).toBe(true);
    });
    test('Invalid Date object → false', () => {
        expect(isValidTripDate(new Date('not-a-date'))).toBe(false);
    });
    test('garbage string → false', () => {
        expect(isValidTripDate('NaN-NaN-NaN NaN:NaN:NaN')).toBe(false);
    });
    test('empty string → false', () => {
        expect(isValidTripDate('')).toBe(false);
    });
});

/* ══════════════════════════════════════════
   TEST GROUP A — updateTrip (Bug A)
══════════════════════════════════════════ */
describe('Phase 2D — updateTrip partial-body safety', () => {
    /* Phase 1 hardening: dates a mocked DB row would actually contain are
       Date objects representing correctly-converted Vietnam LOCAL wall-clock
       instants (mysql2 pool timezone:'+07:00' — see server/utils/dateTime.js).
       Built with the local Date constructor (not a UTC 'Z' string) so this
       fixture is correct under updateTrip's local-time parseDbDateTime(),
       matching real production data instead of the pre-fix UTC-tagged
       fixture that only "worked" against the old, buggy forced-UTC parse. */
    const EXISTING_ROW = {
        route_id: 10, bus_id: 20,
        departure_time: new Date(2026, 7, 20, 8, 0, 0),  // 2026-08-20 08:00 local
        arrival_time: new Date(2026, 7, 20, 12, 0, 0),   // 2026-08-20 12:00 local
        base_price: 250000, status: 'OPEN'
    };

    beforeEach(() => { jest.clearAllMocks(); });

    test('1. partial update with arrival_time only — other fields preserved from existing row', async () => {
        const ctrl = require('../server/controllers/tripController');
        db.query
            .mockResolvedValueOnce([[EXISTING_ROW]])   // SELECT existing
            .mockResolvedValueOnce([[{ cnt: 0 }]])     // Sprint 6 guard: active-booking count (structural field changed)
            .mockResolvedValueOnce([{}]);              // UPDATE
        const req = { params: { id: '5' }, body: { arrival_time: '2026-08-20 14:00:00' } };
        const res = mockRes();
        await ctrl.updateTrip(req, res);

        expect(res.status).not.toHaveBeenCalledWith(422);
        const updateCall = db.query.mock.calls[2];
        expect(updateCall[0]).toMatch(/UPDATE trip SET/);
        const params = updateCall[1];
        expect(params[0]).toBe(EXISTING_ROW.route_id);      // route_id preserved
        expect(params[1]).toBe(EXISTING_ROW.bus_id);         // bus_id preserved
        expect(params[2]).toBe(EXISTING_ROW.departure_time); // departure_time preserved
        expect(params[3]).toBe('2026-08-20 14:00:00');       // arrival_time updated
        expect(params[4]).toBe(EXISTING_ROW.base_price);     // base_price preserved
        expect(params[5]).toBe(EXISTING_ROW.status);         // status preserved
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
    });

    test('2. partial update with departure_time only — other fields preserved', async () => {
        const ctrl = require('../server/controllers/tripController');
        db.query
            .mockResolvedValueOnce([[EXISTING_ROW]])
            .mockResolvedValueOnce([[{ cnt: 0 }]])     // Sprint 6 guard: active-booking count
            .mockResolvedValueOnce([{}]);
        const req = { params: { id: '5' }, body: { departure_time: '2026-08-20 06:00:00' } };
        const res = mockRes();
        await ctrl.updateTrip(req, res);
        const params = db.query.mock.calls[2][1];
        expect(params[2]).toBe('2026-08-20 06:00:00');
        expect(params[3]).toBe(EXISTING_ROW.arrival_time);
        expect(params[1]).toBe(EXISTING_ROW.bus_id);
    });

    test('3. partial update with route_id only — dates/bus/price/status preserved', async () => {
        const ctrl = require('../server/controllers/tripController');
        db.query
            .mockResolvedValueOnce([[EXISTING_ROW]])
            .mockResolvedValueOnce([[{ cnt: 0 }]])     // Sprint 6 guard: active-booking count
            .mockResolvedValueOnce([{}]);
        const req = { params: { id: '5' }, body: { route_id: 99 } };
        const res = mockRes();
        await ctrl.updateTrip(req, res);
        const params = db.query.mock.calls[2][1];
        expect(params[0]).toBe(99);
        expect(params[2]).toBe(EXISTING_ROW.departure_time);
        expect(params[3]).toBe(EXISTING_ROW.arrival_time);
        expect(params[4]).toBe(EXISTING_ROW.base_price);
        expect(params[5]).toBe(EXISTING_ROW.status);
    });

    test('4. partial update with status only — everything else preserved', async () => {
        const ctrl = require('../server/controllers/tripController');
        db.query
            .mockResolvedValueOnce([[EXISTING_ROW]])
            .mockResolvedValueOnce([{}]);
        const req = { params: { id: '5' }, body: { status: 'FULL' } };
        const res = mockRes();
        await ctrl.updateTrip(req, res);
        const params = db.query.mock.calls[1][1];
        expect(params[5]).toBe('FULL');
        expect(params[2]).toBe(EXISTING_ROW.departure_time);
        expect(params[3]).toBe(EXISTING_ROW.arrival_time);
    });

    test('5a. explicit null for a field → 422, rejected (not silently applied)', async () => {
        const ctrl = require('../server/controllers/tripController');
        db.query.mockResolvedValueOnce([[EXISTING_ROW]]);
        const req = { params: { id: '5' }, body: { arrival_time: null } };
        const res = mockRes();
        await ctrl.updateTrip(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
        expect(db.query).toHaveBeenCalledTimes(1); // only the SELECT — no UPDATE was ever attempted
    });

    test('5b. explicit null for route_id → 422, rejected', async () => {
        const ctrl = require('../server/controllers/tripController');
        db.query.mockResolvedValueOnce([[EXISTING_ROW]]);
        const req = { params: { id: '5' }, body: { route_id: null } };
        const res = mockRes();
        await ctrl.updateTrip(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
    });

    test('6. invalid date string → 422', async () => {
        const ctrl = require('../server/controllers/tripController');
        db.query.mockResolvedValueOnce([[EXISTING_ROW]]);
        const req = { params: { id: '5' }, body: { arrival_time: 'not-a-real-date' } };
        const res = mockRes();
        await ctrl.updateTrip(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    test('7. existing row already has a zero-date (surfaces as null) → update rejected, fails closed', async () => {
        const ctrl = require('../server/controllers/tripController');
        const brokenExisting = { ...EXISTING_ROW, departure_time: null, arrival_time: null };
        db.query.mockResolvedValueOnce([[brokenExisting]]);
        const req = { params: { id: '15' }, body: { status: 'FULL' } }; // doesn't even touch dates
        const res = mockRes();
        await ctrl.updateTrip(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
        expect(db.query).toHaveBeenCalledTimes(1); // no UPDATE was attempted — fails closed
    });

    test('8. NaN base_price → 422', async () => {
        const ctrl = require('../server/controllers/tripController');
        db.query.mockResolvedValueOnce([[EXISTING_ROW]]);
        const req = { params: { id: '5' }, body: { base_price: 'not-a-number' } };
        const res = mockRes();
        await ctrl.updateTrip(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
    });

    test('9. omitted field (undefined) never overwrites existing DB value — verified across all 6 fields', async () => {
        const ctrl = require('../server/controllers/tripController');
        db.query
            .mockResolvedValueOnce([[EXISTING_ROW]])
            .mockResolvedValueOnce([{}]);
        const req = { params: { id: '5' }, body: {} }; // nothing supplied at all
        const res = mockRes();
        await ctrl.updateTrip(req, res);
        const params = db.query.mock.calls[1][1];
        expect(params.slice(0, 6)).toEqual([
            EXISTING_ROW.route_id, EXISTING_ROW.bus_id,
            EXISTING_ROW.departure_time, EXISTING_ROW.arrival_time,
            EXISTING_ROW.base_price, EXISTING_ROW.status
        ]);
    });

    test('10. Live ETA regression — exact payload {arrival_time} shape from operator/trips.html', async () => {
        const ctrl = require('../server/controllers/tripController');
        db.query
            .mockResolvedValueOnce([[EXISTING_ROW]])
            .mockResolvedValueOnce([[{ cnt: 0 }]])     // Sprint 6 guard: active-booking count
            .mockResolvedValueOnce([{}]);
        // Exact shape sent by public/pages/operator/trips.html saveLiveEta():
        // api.put(`/trips/${id}`, { arrival_time: newArr })
        const newArr = new Date('2026-08-20T15:00:00Z').toISOString().replace('T', ' ').slice(0, 19);
        const req = { params: { id: '5' }, body: { arrival_time: newArr } };
        const res = mockRes();
        await ctrl.updateTrip(req, res);
        expect(res.status).not.toHaveBeenCalledWith(422);
        expect(res.status).not.toHaveBeenCalledWith(404);
        expect(res.status).not.toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
    });

    test('trip not found → 404, no UPDATE attempted', async () => {
        const ctrl = require('../server/controllers/tripController');
        db.query.mockResolvedValueOnce([[]]);
        const req = { params: { id: '999999' }, body: { arrival_time: '2026-08-20 10:00:00' } };
        const res = mockRes();
        await ctrl.updateTrip(req, res);
        expect(res.status).toHaveBeenCalledWith(404);
        expect(db.query).toHaveBeenCalledTimes(1);
    });
});

/* ══════════════════════════════════════════
   TEST GROUP B — autoGenerateRecurringTrips / checkAndAdvanceIfNeeded (Bug B)
══════════════════════════════════════════ */
describe('Phase 2D — autoGenerateRecurringTrips eligibility & date-safety', () => {
    beforeEach(() => { jest.clearAllMocks(); });

    test('1&2. eligibility query explicitly whitelists OPEN/FULL/RUNNING (excludes COMPLETED and CANCELED)', async () => {
        const ctrl = require('../server/controllers/tripController');
        db.query.mockResolvedValueOnce([[]]); // no eligible rows
        await ctrl.autoGenerateRecurringTrips();
        const sql = db.query.mock.calls[0][0];
        expect(sql).toMatch(/status IN \('OPEN','FULL','RUNNING'\)/);
        expect(sql).not.toMatch(/!= 'CANCELED'/);
    });

    test('checkAndAdvanceIfNeeded — same whitelist in the trigger-check query', async () => {
        const ctrl = require('../server/controllers/tripController');
        db.query.mockResolvedValueOnce([[{ doneCnt: 0 }]]);
        await ctrl.checkAndAdvanceIfNeeded();
        const sql = db.query.mock.calls[0][0];
        expect(sql).toMatch(/status IN \('OPEN','FULL','RUNNING'\)/);
    });

    test('5&6&7&8. a row with NULL (zero-date) departure_time/arrival_time is skipped — no INSERT, no COMPLETED write', async () => {
        const ctrl = require('../server/controllers/tripController');
        const invalidRow = {
            trip_id: 15, route_id: null, bus_id: 1,
            departure_time: null, arrival_time: null, base_price: null
        };
        db.query
            .mockResolvedValueOnce([[invalidRow]])              // eligibility SELECT
            .mockResolvedValueOnce([[{ nowMs: Date.now() }]]);  // SELECT UNIX_TIMESTAMP(NOW())
        await ctrl.autoGenerateRecurringTrips();

        const allSql = db.query.mock.calls.map(c => c[0]).join('\n');
        expect(allSql).not.toMatch(/INSERT INTO trip/);
        expect(allSql).not.toMatch(/status='COMPLETED'/);
        expect(allSql).not.toMatch(/booking WHERE trip_id/); // booking-count lookup never reached for an invalid row
        expect(db.query).toHaveBeenCalledTimes(2); // only the two setup queries — nothing per-row
    });

    test('valid OPEN row with no booking still gets in-place recycled normally (existing behavior preserved)', async () => {
        const ctrl = require('../server/controllers/tripController');
        const validRow = {
            trip_id: 500, route_id: 1, bus_id: 1,
            departure_time: new Date('2026-08-10T08:00:00Z'),
            arrival_time: new Date('2026-08-10T12:00:00Z'),
            base_price: 200000
        };
        db.query
            .mockResolvedValueOnce([[validRow]])
            .mockResolvedValueOnce([[{ nowMs: Date.now() }]])
            .mockResolvedValueOnce([[{ cnt: 0 }]])   // booking count = 0 -> in-place branch
            .mockResolvedValueOnce([{}]);            // the in-place UPDATE
        await ctrl.autoGenerateRecurringTrips();

        const updateCall = db.query.mock.calls[3];
        expect(updateCall[0]).toMatch(/UPDATE trip SET departure_time=.*status='OPEN'/s);
        const [newDep, newArr] = updateCall[1];
        expect(newDep).not.toMatch(/NaN/);
        expect(newArr).not.toMatch(/NaN/);
        expect(newDep).not.toBe('0000-00-00 00:00:00');
    });

    test('11&12. mixed batch — one invalid (zero-date, has booking) + one valid row: invalid is skipped every time, cannot loop/insert, valid row still processes; repeated calls stay idempotent', async () => {
        const ctrl = require('../server/controllers/tripController');
        const invalidWithBooking = {
            trip_id: 15, route_id: null, bus_id: 1,
            departure_time: null, arrival_time: null, base_price: null
        };
        const validRow = {
            trip_id: 501, route_id: 2, bus_id: 3,
            departure_time: new Date('2026-08-10T08:00:00Z'),
            arrival_time: new Date('2026-08-10T12:00:00Z'),
            base_price: 150000
        };

        for (let i = 0; i < 2; i++) {
            db.query.mockReset();
            db.query
                .mockResolvedValueOnce([[invalidWithBooking, validRow]])
                .mockResolvedValueOnce([[{ nowMs: Date.now() }]])
                .mockResolvedValueOnce([[{ cnt: 0 }]])
                .mockResolvedValueOnce([{}]);
            await ctrl.autoGenerateRecurringTrips();
            const allSql = db.query.mock.calls.map(c => c[0]).join('\n');
            expect(allSql).not.toMatch(/INSERT INTO trip/); // trip 15 never clones, on either run
            expect(db.query).toHaveBeenCalledTimes(4); // 2 setup + 1 booking-count(valid row only) + 1 update(valid row only)
        }
    });

    test('warn-once dedup: logger.warn fires at most once for the same repeatedly-invalid trip_id across two calls', async () => {
        const ctrl = require('../server/controllers/tripController');
        // Enterprise Hardening Pass: tripController.js now routes through
        // server/utils/logger.js (Winston) instead of bare console.warn —
        // spy on the logger module's own export, not console, since
        // Winston's console transport never calls console.warn directly.
        const logger = require('../server/utils/logger');
        const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
        const invalidRow = {
            trip_id: 8888, route_id: null, bus_id: 1,
            departure_time: null, arrival_time: null, base_price: null
        };
        for (let i = 0; i < 2; i++) {
            db.query.mockReset();
            db.query
                .mockResolvedValueOnce([[invalidRow]])
                .mockResolvedValueOnce([[{ nowMs: Date.now() }]]);
            await ctrl.autoGenerateRecurringTrips();
        }
        const warningsForThisTrip = warnSpy.mock.calls.filter(c => String(c[0]).includes('trip_id=8888'));
        expect(warningsForThisTrip.length).toBe(1);
        warnSpy.mockRestore();
    });
});
