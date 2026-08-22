'use strict';
/**
 * TRUTHNODE — PHASE 1, Section F: migration failure handling.
 * Regression tests for server/config/migrate.js.
 *
 * Root-cause bug: any error thrown by a migration statement — including a
 * real infrastructure failure like "connect ETIMEDOUT" — was caught,
 * logged as "[migrate] Skipped: <message>", and swallowed. runMigration()
 * still logged "✅ completed" and server.js never awaited it at all, so the
 * server could report "running" against an unmigrated/degraded schema.
 *
 * Fixed: only a specific benign-already-applied errno set is skipped;
 * everything else propagates. runMigration() also independently verifies
 * required schema objects exist and throws if not — this is checked here
 * against a real, mocked information_schema response, not just "no SQL
 * error was thrown".
 *
 * DB access is mocked (this is pure control-flow/error-propagation logic,
 * not the live schema itself — the live schema was separately verified by
 * actually restarting the real server against the real DB during this
 * phase, confirmed clean boot with "✅ [migrate] schema verified").
 */

jest.mock('fs', () => ({
    readFileSync: jest.fn(() => 'ALTER TABLE users ADD COLUMN x INT;\nALTER TABLE bus ADD COLUMN y INT;'),
}));
jest.mock('../server/config/db', () => ({ query: jest.fn() }));

const db = require('../server/config/db');
const { _runSqlFile, runMigration, verifySchema } = require('../server/config/migrate');

beforeEach(() => { jest.clearAllMocks(); });

describe('migrate.js — fatal errors are never silently swallowed', () => {
    test('a benign "already applied" error (duplicate column, errno 1060) is skipped, not fatal', async () => {
        const dupColumnErr = Object.assign(new Error("Duplicate column name 'x'"), { errno: 1060 });
        db.query
            .mockRejectedValueOnce(dupColumnErr)   // first statement: already exists
            .mockResolvedValueOnce([{}]);          // second statement: succeeds
        await expect(_runSqlFile('fake.sql')).resolves.toBeUndefined();
        expect(db.query).toHaveBeenCalledTimes(2); // both statements were attempted
    });

    test('an ETIMEDOUT-style connection failure is FATAL — propagates instead of being logged as "Skipped"', async () => {
        const timeoutErr = Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT', errno: undefined });
        db.query.mockRejectedValueOnce(timeoutErr);
        await expect(_runSqlFile('fake.sql')).rejects.toThrow('connect ETIMEDOUT');
    });

    test('a genuine SQL syntax error is FATAL (errno 1064 removed from the benign list — a syntax error is a real bug, never benign)', async () => {
        const syntaxErr = Object.assign(new Error('You have an error in your SQL syntax'), { errno: 1064 });
        db.query.mockRejectedValueOnce(syntaxErr);
        await expect(_runSqlFile('fake.sql')).rejects.toThrow(/SQL syntax/);
    });

    test('an unexpected mid-file failure stops that file — later statements in the same file are never attempted', async () => {
        const fatalErr = Object.assign(new Error('Access denied'), { code: 'ER_ACCESS_DENIED_ERROR' });
        db.query.mockRejectedValueOnce(fatalErr);
        await expect(_runSqlFile('fake.sql')).rejects.toThrow('Access denied');
        expect(db.query).toHaveBeenCalledTimes(1); // second statement never ran
    });
});

describe('migrate.js — runMigration() aborts the whole sequence on first file failure', () => {
    test('runMigration() throws (does not resolve) if any migration file fails fatally', async () => {
        const fatalErr = Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' });
        db.query.mockRejectedValueOnce(fatalErr);
        await expect(runMigration()).rejects.toThrow(/ETIMEDOUT/);
    });
});

describe('migrate.js — verifySchema() catches a migration that "succeeded" but left required objects missing', () => {
    /* verifySchema() runs its information_schema checks in a fixed order
       (see migrate.js): operator_id, password_reset_tokens, trip.status
       ENUM, trip_seat_hold, trip index, users.status ENUM, booking index
       (Sprint 5), trip route/departure index (Sprint 5), route_stop
       estimated_min_from_origin column (Sprint 6), bus.seat_layout_config
       column (Sprint 6), saved_passenger table (Sprint 6), token_version
       column (Sprint 7), avatar_url column (Sprint 8), route_stop.stop_type
       WAYPOINT enum value (Sprint 10), user_behavior.event_type column and
       user_profiles_ai table (Sprint 11), booking user/status/time index
       (Sprint 12). This queues a "everything present" response for all
       seventeen, with `overrides` replacing specific positions — keeps
       each test declaring only what it's actually testing instead of
       re-typing the whole chain every time a check is added. */
    function queueAllPresent(overrides = {}) {
        const defaults = [
            [[{ c: 1 }]],                                                          // 0: users.operator_id
            [[{ c: 1 }]],                                                          // 1: password_reset_tokens
            [[{ t: "enum('OPEN','FULL','RUNNING','COMPLETED','CANCELED')" }]],     // 2: trip.status
            [[{ c: 1 }]],                                                          // 3: trip_seat_hold
            [[{ c: 1 }]],                                                          // 4: trip status/departure index
            [[{ t: "enum('ACTIVE','BLOCKED','INACTIVE')" }]],                      // 5: users.status
            [[{ c: 1 }]],                                                          // 6: booking status/time index
            [[{ c: 1 }]],                                                          // 7: trip route/departure index
            [[{ c: 1 }]],                                                          // 8: route_stop.estimated_min_from_origin column
            [[{ c: 1 }]],                                                          // 9: bus.seat_layout_config column
            [[{ c: 1 }]],                                                          // 10: saved_passenger table
            [[{ c: 1 }]],                                                          // 11: users.token_version column
            [[{ c: 1 }]],                                                          // 12: users.avatar_url column
            [[{ t: "enum('PICKUP','DROPOFF','BOTH','WAYPOINT')" }]],               // 13: route_stop.stop_type WAYPOINT
            [[{ c: 1 }]],                                                          // 14: user_behavior.event_type column
            [[{ c: 1 }]],                                                          // 15: user_profiles_ai table
            [[{ c: 1 }]],                                                          // 16: booking(user_id,status,booking_time) index
            [[{ c: 0 }]],                                                          // 17: stale backup tables (0 = both dropped, passes)
            [[{ c: 0 }]],                                                          // 18: invalid/blank bus.status rows (0 = all normalized, passes)
        ];
        Object.entries(overrides).forEach(([i, v]) => { defaults[i] = v; });
        defaults.forEach(v => db.query.mockResolvedValueOnce(v));
    }

    test('reports users.operator_id missing even if no SQL statement threw an error', async () => {
        queueAllPresent({ 0: [[{ c: 0 }]] });
        const missing = await verifySchema();
        expect(missing.some(m => m.includes('users.operator_id'))).toBe(true);
        expect(missing.length).toBe(1);
    });

    test('all required objects present -> empty missing list (matches the live-verified real DB state)', async () => {
        queueAllPresent();
        const missing = await verifySchema();
        expect(missing).toEqual([]);
    });

    test('trip.status ENUM missing RUNNING/COMPLETED is reported even though the column itself exists', async () => {
        queueAllPresent({ 2: [[{ t: "enum('OPEN','FULL','CANCELED')" }]] }); // old, unmigrated enum
        const missing = await verifySchema();
        expect(missing.some(m => m.includes('trip.status'))).toBe(true);
    });

    test('trip_seat_hold table missing is reported (blocker #7 DB backstop)', async () => {
        queueAllPresent({ 3: [[{ c: 0 }]] });
        const missing = await verifySchema();
        expect(missing.some(m => m.includes('trip_seat_hold'))).toBe(true);
    });

    test('trip(status, departure_time) index missing is reported (Phase 2 — search performance)', async () => {
        queueAllPresent({ 4: [[{ c: 0 }]] });
        const missing = await verifySchema();
        expect(missing.some(m => m.includes('idx_trip_status_departure') || m.includes('trip(status, departure_time)'))).toBe(true);
    });

    test('users.status ENUM missing INACTIVE is reported (Sprint 3 — deleteUser soft-delete depends on this)', async () => {
        queueAllPresent({ 5: [[{ t: "enum('ACTIVE','BLOCKED')" }]] }); // old, unmigrated enum
        const missing = await verifySchema();
        expect(missing.some(m => m.includes('users.status'))).toBe(true);
    });

    test('booking(status, booking_time) index missing is reported (Sprint 5 — bookingCleanup.js scan depends on this at scale)', async () => {
        queueAllPresent({ 6: [[{ c: 0 }]] });
        const missing = await verifySchema();
        expect(missing.some(m => m.includes('idx_booking_status_time') || m.includes('booking(status, booking_time)'))).toBe(true);
    });

    test('trip(route_id, departure_time) index missing is reported (Sprint 5 — search/concierge/transit performance at scale)', async () => {
        queueAllPresent({ 7: [[{ c: 0 }]] });
        const missing = await verifySchema();
        expect(missing.some(m => m.includes('idx_trip_route_departure') || m.includes('trip(route_id, departure_time)'))).toBe(true);
    });

    test('route_stop.estimated_min_from_origin column missing is reported (Sprint 6 — route_stop coverage backfill depends on this)', async () => {
        queueAllPresent({ 8: [[{ c: 0 }]] });
        const missing = await verifySchema();
        expect(missing.some(m => m.includes('estimated_min_from_origin'))).toBe(true);
    });

    test('bus.seat_layout_config column missing is reported (Sprint 6 — Dynamic Seat Layout Engine depends on this)', async () => {
        queueAllPresent({ 9: [[{ c: 0 }]] });
        const missing = await verifySchema();
        expect(missing.some(m => m.includes('seat_layout_config'))).toBe(true);
    });

    test('saved_passenger table missing is reported (Sprint 6 — companion-list feature depends on this)', async () => {
        queueAllPresent({ 10: [[{ c: 0 }]] });
        const missing = await verifySchema();
        expect(missing.some(m => m.includes('saved_passenger'))).toBe(true);
    });

    test('users.token_version column missing is reported (Sprint 7 — real server-side logout depends on this)', async () => {
        queueAllPresent({ 11: [[{ c: 0 }]] });
        const missing = await verifySchema();
        expect(missing.some(m => m.includes('token_version'))).toBe(true);
    });

    test('users.avatar_url column missing is reported (Sprint 8 — Avatar Sync Engine depends on this)', async () => {
        queueAllPresent({ 12: [[{ c: 0 }]] });
        const missing = await verifySchema();
        expect(missing.some(m => m.includes('avatar_url'))).toBe(true);
    });

    test('route_stop.stop_type ENUM missing WAYPOINT is reported (Sprint 10 — Vietnam real-route seeding depends on this)', async () => {
        queueAllPresent({ 13: [[{ t: "enum('PICKUP','DROPOFF','BOTH')" }]] }); // old, unmigrated enum
        const missing = await verifySchema();
        expect(missing.some(m => m.includes('WAYPOINT'))).toBe(true);
    });

    test('user_behavior.event_type column missing is reported (Sprint 11 — aiUserProfilingService depends on this)', async () => {
        queueAllPresent({ 14: [[{ c: 0 }]] });
        const missing = await verifySchema();
        expect(missing.some(m => m.includes('user_behavior.event_type'))).toBe(true);
    });

    test('user_profiles_ai table missing is reported (Sprint 11 — preference-vector cache depends on this)', async () => {
        queueAllPresent({ 15: [[{ c: 0 }]] });
        const missing = await verifySchema();
        expect(missing.some(m => m.includes('user_profiles_ai'))).toBe(true);
    });

    test('booking(user_id,status,booking_time) index missing is reported (Sprint 12 — query performance hardening depends on this)', async () => {
        queueAllPresent({ 16: [[{ c: 0 }]] });
        const missing = await verifySchema();
        expect(missing.some(m => m.includes('idx_booking_user_status_time') || m.includes('booking(user_id, status, booking_time)'))).toBe(true);
    });

    test('stale backup tables still present is reported (Enterprise Hardening Pass — migrate_v21.sql cleanup depends on this; the one inverse check in verifySchema)', async () => {
        queueAllPresent({ 17: [[{ c: 2 }]] }); // both backup tables still exist
        const missing = await verifySchema();
        expect(missing.some(m => m.includes('stale backup table'))).toBe(true);
    });

    test('invalid/blank bus.status rows still present is reported (data-integrity pass — migrate_v22.sql normalization depends on this)', async () => {
        queueAllPresent({ 18: [[{ c: 40 }]] }); // 40 buses still have status=''
        const missing = await verifySchema();
        expect(missing.some(m => m.includes('invalid/blank status'))).toBe(true);
    });
});
