'use strict';
/**
 * TRUTHNODE — PHASE 1: Backend + Time/DateTime Integrity Hardening
 * Regression tests for the system-wide time contract (server/utils/dateTime.js)
 * and the root-cause fix to autoGenerateRecurringTrips' fmtUTC() bug
 * (MASTER_COMPLETION_MATRIX.md blocker #1 — 7h drift on every daily advance,
 * confirmed live in production with a real trip service drifting through
 * nearly every hour of the day over one month).
 *
 * Section A — pure dateTime.js unit tests, including the exact edge cases
 *             required by this phase's instructions (23:30->00:30 next day,
 *             23:59->00:05 next day, 00:00, 12:00 noon/midnight ambiguity).
 * Section B — autoGenerateRecurringTrips regression: local hour-of-day must
 *             be preserved across advance, including overnight trips whose
 *             arrival date must not collapse into the departure date.
 * Section C — createTrip/updateTrip invariants: departure<arrival, duration>0,
 *             specifically for overnight trips.
 *
 * All DB access is mocked (matches this repo's existing test convention —
 * see phase2d-trip-integrity.test.js) since these are pure-logic/contract
 * regressions, not concurrency tests. Concurrency/idempotency is tested
 * separately against the real DB (see tests/phase1-concurrency.test.js).
 */

process.env.TZ = 'Asia/Ho_Chi_Minh'; // pin explicitly — do not rely on host default

const { toDbDateTime, parseDbDateTime, isValidDate } = require('../server/utils/dateTime');

/* ══════════════════════════════════════════
   SECTION A — dateTime.js pure contract tests
══════════════════════════════════════════ */
describe('dateTime.js — time contract primitives', () => {
    test('toDbDateTime round-trips local wall-clock fields exactly (no UTC drift)', () => {
        const d = new Date(2026, 7, 16, 23, 30, 0); // 2026-08-16 23:30:00 local
        expect(toDbDateTime(d)).toBe('2026-08-16 23:30:00');
    });

    test('midnight (00:00) is not confused with noon — the classic 12-hour AM/PM ambiguity point', () => {
        const midnight = new Date(2026, 7, 16, 0, 0, 0);
        expect(toDbDateTime(midnight)).toBe('2026-08-16 00:00:00');
        expect(parseDbDateTime('2026-08-16 00:00:00').getHours()).toBe(0);
    });

    test('noon (12:00) is not confused with midnight', () => {
        const noon = new Date(2026, 7, 16, 12, 0, 0);
        expect(toDbDateTime(noon)).toBe('2026-08-16 12:00:00');
        expect(parseDbDateTime('2026-08-16 12:00:00').getHours()).toBe(12);
    });

    test('23:30 -> 00:30 next day: parsed instants are exactly 1 hour apart, arrival date correctly advances', () => {
        const dep = parseDbDateTime('2026-08-16 23:30:00');
        const arr = parseDbDateTime('2026-08-17 00:30:00');
        expect(arr.getTime() - dep.getTime()).toBe(60 * 60 * 1000); // exactly 1h, not -23h or 25h
        expect(arr.getDate()).toBe(dep.getDate() + 1);
        expect(arr.getHours()).toBe(0);
        expect(dep.getHours()).toBe(23);
    });

    test('23:59 -> 00:05 next day: 6-minute overnight duration, not a negative/huge one', () => {
        const dep = parseDbDateTime('2026-08-16 23:59:00');
        const arr = parseDbDateTime('2026-08-17 00:05:00');
        expect(arr.getTime() - dep.getTime()).toBe(6 * 60 * 1000);
        expect(arr.getTime()).toBeGreaterThan(dep.getTime()); // never negative duration
    });

    test('parseDbDateTime treats a naive "YYYY-MM-DD HH:mm:ss" string as LOCAL time, never forces UTC', () => {
        // Regression guard for the removed anti-pattern: appending 'Z' to a
        // naive DB string misinterprets Vietnam-local digits as UTC, which
        // is the exact class of bug behind blockers #1/#2/#3.
        const viaSpace = parseDbDateTime('2026-08-16 15:00:00');
        const viaT = new Date('2026-08-16T15:00:00'); // native ISO-no-zone parse, also local per spec
        expect(viaSpace.getTime()).toBe(viaT.getTime());
        expect(viaSpace.getHours()).toBe(15); // NOT shifted by the +07:00 offset
    });

    test('isValidDate rejects null/undefined/garbage, accepts Date and valid strings', () => {
        expect(isValidDate(null)).toBe(false);
        expect(isValidDate(undefined)).toBe(false);
        expect(isValidDate('not-a-date')).toBe(false);
        expect(isValidDate(new Date('invalid'))).toBe(false);
        expect(isValidDate(new Date())).toBe(true);
        expect(isValidDate('2026-08-16 12:00:00')).toBe(true);
    });

    test('toDbDateTime throws on invalid input rather than silently emitting "NaN-NaN-NaN"', () => {
        expect(() => toDbDateTime(new Date('invalid'))).toThrow(TypeError);
        expect(() => toDbDateTime('2026-08-16')).toThrow(TypeError); // must be a Date, not a string
    });
});

/* ══════════════════════════════════════════
   SECTION B — autoGenerateRecurringTrips: local-hour preservation
   (direct regression guard for MASTER_COMPLETION_MATRIX.md blocker #1)
══════════════════════════════════════════ */
jest.mock('../server/config/db', () => ({ query: jest.fn(), getConnection: jest.fn() }));
const db = require('../server/config/db');

/** createTrip's conflict-check+insert now runs on a dedicated connection
 *  under a named advisory lock (GET_LOCK/RELEASE_LOCK) — see tripController.js.
 *  Dispatches by SQL text, mirroring the real statement sequence. */
function makeCreateTripLockConn({ hasConflict = false, insertId = 1 } = {}) {
    return {
        query: jest.fn((sql) => {
            if (/GET_LOCK/.test(sql)) return Promise.resolve([[{ locked: 1 }]]);
            if (/RELEASE_LOCK/.test(sql)) return Promise.resolve([[{ 'RELEASE_LOCK(?)': 1 }]]);
            if (/SELECT trip_id FROM trip/.test(sql)) {
                return Promise.resolve([hasConflict ? [{ trip_id: 999 }] : []]);
            }
            if (/INSERT INTO trip/.test(sql)) return Promise.resolve([{ insertId }]);
            return Promise.resolve([{}]);
        }),
        release: jest.fn(),
    };
}

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

describe('autoGenerateRecurringTrips — 7h UTC-drift regression guard', () => {
    beforeEach(() => { jest.clearAllMocks(); });

    test('daytime trip: advancing 1 day preserves the exact local hour-of-day (no fmtUTC 7h shift)', async () => {
        const ctrl = require('../server/controllers/tripController');
        // Source trip departs 08:00 local, arrives 10:00 local (2h), no booking -> in-place branch.
        const sourceRow = {
            trip_id: 700, route_id: 1, bus_id: 1,
            departure_time: new Date(2026, 7, 10, 8, 0, 0),
            arrival_time: new Date(2026, 7, 10, 10, 0, 0),
            base_price: 100000
        };
        // "now" = shortly after the source trip's own arrival (i.e. it just
        // completed) — NOT the real wall-clock Date.now(), so exactly one
        // day-increment happens and the result is deterministic regardless
        // of what today's real date is when this test runs.
        const mockNowMs = sourceRow.arrival_time.getTime() + 5 * 60 * 1000;
        db.query
            .mockResolvedValueOnce([[sourceRow]])                         // eligibility SELECT
            .mockResolvedValueOnce([[{ nowMs: mockNowMs }]])              // UNIX_TIMESTAMP(NOW())
            .mockResolvedValueOnce([[{ cnt: 0 }]])                        // booking count -> in-place
            .mockResolvedValueOnce([{}]);                                 // the in-place UPDATE
        await ctrl.autoGenerateRecurringTrips();

        const [newDepStr, newArrStr] = db.query.mock.calls[3][1];
        // Before the fix, fmtUTC() would have written UTC-field-extracted
        // strings — on this +07:00 host that silently shifts the apparent
        // local hour by -7h (08:00 -> 01:00). Assert the local hour survives.
        expect(newDepStr).toBe('2026-08-11 08:00:00');
        expect(newArrStr).toBe('2026-08-11 10:00:00');
    });

    test('overnight trip (23:30 -> 00:30 next day): advancing preserves both the local hour AND the 1-day arrival offset', async () => {
        const ctrl = require('../server/controllers/tripController');
        const sourceRow = {
            trip_id: 701, route_id: 2, bus_id: 2,
            departure_time: new Date(2026, 7, 10, 23, 30, 0),
            arrival_time: new Date(2026, 7, 11, 0, 30, 0), // next calendar day
            base_price: 200000
        };
        const mockNowMs = sourceRow.arrival_time.getTime() + 5 * 60 * 1000;
        db.query
            .mockResolvedValueOnce([[sourceRow]])
            .mockResolvedValueOnce([[{ nowMs: mockNowMs }]])
            .mockResolvedValueOnce([[{ cnt: 0 }]])
            .mockResolvedValueOnce([{}]);
        await ctrl.autoGenerateRecurringTrips();

        const [newDepStr, newArrStr] = db.query.mock.calls[3][1];
        expect(newDepStr).toBe('2026-08-11 23:30:00');
        expect(newArrStr).toBe('2026-08-12 00:30:00'); // arrival date correctly advances too — not lost
        // Duration must still be exactly 1 hour, not corrupted into a
        // same-day (negative-looking) or 8-hour gap by a field-extraction bug.
        const dep = parseDbDateTime(newDepStr);
        const arr = parseDbDateTime(newArrStr);
        expect(arr.getTime() - dep.getTime()).toBe(60 * 60 * 1000);
    });

    test('cloned (has-booking) branch also preserves local hour-of-day, not just the in-place branch', async () => {
        const ctrl = require('../server/controllers/tripController');
        const sourceRow = {
            trip_id: 702, route_id: 3, bus_id: 3,
            departure_time: new Date(2026, 7, 10, 22, 0, 0),
            arrival_time: new Date(2026, 7, 11, 1, 0, 0),
            base_price: 300000
        };
        const mockNowMs = sourceRow.arrival_time.getTime() + 5 * 60 * 1000;
        db.query
            .mockResolvedValueOnce([[sourceRow]])            // eligibility SELECT
            .mockResolvedValueOnce([[{ nowMs: mockNowMs }]])
            .mockResolvedValueOnce([[{ cnt: 3 }]])            // has bookings -> clone branch
            .mockResolvedValueOnce([[]])                      // no existing future trip -> proceed to INSERT
            .mockResolvedValueOnce([{ insertId: 9001 }])      // INSERT
            .mockResolvedValueOnce([{}]);                     // mark old trip COMPLETED
        await ctrl.autoGenerateRecurringTrips();

        const insertCall = db.query.mock.calls[4];
        expect(insertCall[0]).toMatch(/INSERT INTO trip/);
        const [, , newDepStr, newArrStr] = insertCall[1];
        expect(newDepStr).toBe('2026-08-11 22:00:00');
        expect(newArrStr).toBe('2026-08-12 01:00:00');
    });

    test('advance never lands in the past — repeatedly adds a day until strictly after "now" (no infinite same-day loop)', async () => {
        const ctrl = require('../server/controllers/tripController');
        // Source trip's "next day" would still be in the past relative to
        // the mocked NOW (simulates the server having been down/stale) —
        // must keep adding days until the result is truly future.
        const sourceRow = {
            trip_id: 703, route_id: 4, bus_id: 4,
            departure_time: new Date(2026, 7, 1, 9, 0, 0),
            arrival_time: new Date(2026, 7, 1, 11, 0, 0),
            base_price: 150000
        };
        const farFutureNow = new Date(2026, 7, 5, 12, 0, 0).getTime(); // 4 days later
        db.query
            .mockResolvedValueOnce([[sourceRow]])
            .mockResolvedValueOnce([[{ nowMs: farFutureNow }]])
            .mockResolvedValueOnce([[{ cnt: 0 }]])
            .mockResolvedValueOnce([{}]);
        await ctrl.autoGenerateRecurringTrips();

        const [newDepStr] = db.query.mock.calls[3][1];
        const newDep = parseDbDateTime(newDepStr);
        expect(newDep.getTime()).toBeGreaterThan(farFutureNow);
        expect(newDep.getHours()).toBe(9); // local hour still preserved after multi-day skip
        expect(newDep.getMinutes()).toBe(0);
    });
});

/* ══════════════════════════════════════════
   SECTION C — createTrip / updateTrip invariants for overnight trips
══════════════════════════════════════════ */
describe('createTrip — overnight-trip invariants (departure < arrival, duration > 0)', () => {
    beforeEach(() => { jest.clearAllMocks(); });

    test('23:30 -> 00:30 next day is accepted (valid overnight trip)', async () => {
        const ctrl = require('../server/controllers/tripController');
        db.getConnection.mockResolvedValueOnce(makeCreateTripLockConn({ insertId: 1 }));
        const req = {
            body: {
                route_id: 1, bus_id: 1,
                departure_time: '2026-08-16 23:30:00',
                arrival_time: '2026-08-17 00:30:00',
                base_price: 100000
            }
        };
        const res = mockRes();
        await ctrl.createTrip(req, res);
        expect(res.status).not.toHaveBeenCalledWith(422);
        expect(res.status).toHaveBeenCalledWith(201);
    });

    test('23:59 -> 00:05 next day is accepted (6-minute overnight trip)', async () => {
        const ctrl = require('../server/controllers/tripController');
        db.getConnection.mockResolvedValueOnce(makeCreateTripLockConn({ insertId: 2 }));
        const req = {
            body: {
                route_id: 1, bus_id: 1,
                departure_time: '2026-08-16 23:59:00',
                arrival_time: '2026-08-17 00:05:00',
                base_price: 100000
            }
        };
        const res = mockRes();
        await ctrl.createTrip(req, res);
        expect(res.status).not.toHaveBeenCalledWith(422);
        expect(res.status).toHaveBeenCalledWith(201);
    });

    test('same-day trip where arrival == departure is rejected (duration must be > 0)', async () => {
        const ctrl = require('../server/controllers/tripController');
        const req = {
            body: {
                route_id: 1, bus_id: 1,
                departure_time: '2026-08-16 12:00:00',
                arrival_time: '2026-08-16 12:00:00',
                base_price: 100000
            }
        };
        const res = mockRes();
        await ctrl.createTrip(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
    });

    test('an "overnight-looking" trip where arrival is actually on the same day but earlier (data-entry mistake) is rejected, not silently accepted as if it rolled over', async () => {
        const ctrl = require('../server/controllers/tripController');
        const req = {
            body: {
                route_id: 1, bus_id: 1,
                departure_time: '2026-08-16 23:30:00',
                arrival_time: '2026-08-16 00:30:00', // missing the date rollover -> before departure
                base_price: 100000
            }
        };
        const res = mockRes();
        await ctrl.createTrip(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
    });

    test('noon-to-noon (12:00 -> 12:00 next day, exactly 24h) is accepted', async () => {
        const ctrl = require('../server/controllers/tripController');
        db.getConnection.mockResolvedValueOnce(makeCreateTripLockConn({ insertId: 3 }));
        const req = {
            body: {
                route_id: 1, bus_id: 1,
                departure_time: '2026-08-16 12:00:00',
                arrival_time: '2026-08-17 12:00:00',
                base_price: 100000
            }
        };
        const res = mockRes();
        await ctrl.createTrip(req, res);
        expect(res.status).not.toHaveBeenCalledWith(422);
        expect(res.status).toHaveBeenCalledWith(201);
    });

    test('midnight-to-midnight (00:00 -> 00:00 next day, exactly 24h) is accepted', async () => {
        const ctrl = require('../server/controllers/tripController');
        db.getConnection.mockResolvedValueOnce(makeCreateTripLockConn({ insertId: 4 }));
        const req = {
            body: {
                route_id: 1, bus_id: 1,
                departure_time: '2026-08-16 00:00:00',
                arrival_time: '2026-08-17 00:00:00',
                base_price: 100000
            }
        };
        const res = mockRes();
        await ctrl.createTrip(req, res);
        expect(res.status).not.toHaveBeenCalledWith(422);
        expect(res.status).toHaveBeenCalledWith(201);
    });
});
