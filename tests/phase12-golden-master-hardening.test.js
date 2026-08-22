'use strict';
/**
 * SPRINT 12 — Golden Master Release, Defense Hardening & Performance
 * Optimization.
 *
 * Mocking strategy matches phase10/phase11: single hoisted jest.mock()
 * per dependency, reused via mockResolvedValueOnce chains — no
 * jest.resetModules()/doMock() anywhere.
 *
 * On "Latency Check < 100ms": this repo never spins up a live HTTP
 * server inside Jest (every other perf-adjacent test file here —
 * phase3-transit-perf.test.js, phase5-production-defense.test.js — tests
 * deterministic logic/content instead of live timing, for the same
 * flakiness reason their own header comments already document). A
 * cache-hit test here proves the actual MECHANISM that makes reads fast
 * (db.query is never called on a hit) rather than asserting a timing
 * number that would be meaningless against a mocked, instant-resolving
 * db anyway. The real, live-measured latency numbers this sprint
 * produced against the actual running server are quoted in
 * SPRINT12_FINAL_REPORT.md, not fabricated here.
 */

const fs = require('fs');
const path = require('path');

jest.mock('../server/config/db', () => ({ query: jest.fn(), getConnection: jest.fn() }));
jest.mock('../server/ai/transitRouter', () => ({
    searchWithTransit: jest.fn(),
    getPopularTransferPoints: jest.fn(),
}));
jest.mock('../server/config/migrate', () => ({ verifySchema: jest.fn(), runMigration: jest.fn() }));
const db = require('../server/config/db');
const transitRouter = require('../server/ai/transitRouter');
const migrate = require('../server/config/migrate');
const { getHealth } = require('../server/controllers/healthController');
const cache = require('../server/services/cacheManager');
const statsCtrl = require('../server/controllers/statsController');
const tripCtrl = require('../server/controllers/tripController');
const adminCtrl = require('../server/controllers/adminController');
const searchCtrl = require('../server/controllers/searchController');
const { isConnectionError, sendDegraded, CONNECTION_ERROR_CODES } = require('../server/utils/dbErrors');
const sanitizeInput = require('../server/middleware/sanitizeInput');

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

beforeEach(async () => { jest.clearAllMocks(); await cache.clear(); });

/* ══════════════════════════════════════════
   1. cacheManager.js — Cache-Aside primitives
      (Enterprise Hardening Pass: Redis-backed with an in-memory fallback —
      NODE_ENV=test never opens a real Redis socket (see cacheManager.js's
      own module-load guard), so every call here transparently exercises
      the in-memory fallback path, the same path production traffic falls
      back to on a real Redis outage. Every method is now Promise-based —
      a real, deliberate API change from the prior sync in-memory-only
      version, not an accident; every call site in the app (statsController,
      recommendationRoutes, tripController, adminController) was updated
      alongside this to await it, see server/controllers/tripController.js's
      invalidateTripCaches for the pattern.)
══════════════════════════════════════════ */
describe('cacheManager', () => {
    test('get/set round-trips a value within its TTL', async () => {
        await cache.set('k1', { a: 1 }, 1000);
        expect(await cache.get('k1')).toEqual({ a: 1 });
    });

    test('get returns undefined for an unknown key', async () => {
        expect(await cache.get('nope')).toBeUndefined();
    });

    test('a value past its TTL is treated as a miss and removed from the store', async () => {
        await cache.set('k2', 'v', -1); // already expired
        expect(await cache.get('k2')).toBeUndefined();
        expect(cache.stats().memoryFallback.total).toBe(0); // the expired read also evicted it
    });

    test('getOrSet: a miss calls the loader exactly once and caches the result', async () => {
        const loader = jest.fn().mockResolvedValue('computed');
        const v1 = await cache.getOrSet('k3', 5000, loader);
        const v2 = await cache.getOrSet('k3', 5000, loader);
        expect(v1).toBe('computed');
        expect(v2).toBe('computed');
        expect(loader).toHaveBeenCalledTimes(1); // second call was a cache hit — loader never ran again
    });

    test('invalidate removes exactly the named key, leaving others untouched', async () => {
        await cache.set('a', 1, 5000);
        await cache.set('b', 2, 5000);
        await cache.invalidate('a');
        expect(await cache.get('a')).toBeUndefined();
        expect(await cache.get('b')).toBe(2);
    });

    test('invalidatePrefix removes every key sharing the prefix', async () => {
        await cache.set('trips:hot:hn-dn', 1, 5000);
        await cache.set('trips:hot:hcm-dl', 2, 5000);
        await cache.set('stats:public-summary', 3, 5000);
        await cache.invalidatePrefix('trips:hot:');
        expect(await cache.get('trips:hot:hn-dn')).toBeUndefined();
        expect(await cache.get('trips:hot:hcm-dl')).toBeUndefined();
        expect(await cache.get('stats:public-summary')).toBe(3);
    });

    test('clear() empties the whole store', async () => {
        await cache.set('x', 1, 5000);
        await cache.clear();
        expect(cache.stats().memoryFallback.total).toBe(0);
    });

    test('reports backend:"memory" when Redis is not ready (the real state in every test run)', () => {
        expect(cache.stats().backend).toBe('memory');
        expect(cache._isRedisReady()).toBe(false);
    });

    test('get/set never throw when Redis is unreachable — round-trips correctly via the in-memory fallback (the actual graceful-degradation guarantee)', async () => {
        // NODE_ENV=test guarantees redisReady stays false for the whole
        // suite (cacheManager.js never opens a real socket in tests) — so
        // this test exercises exactly the same code path a real Redis
        // outage in production would take: every operation below silently
        // falls back to the in-memory store instead of throwing or
        // returning a broken/undefined result.
        expect(cache._isRedisReady()).toBe(false);
        await expect(cache.set('resilience-key', 'still-works', 5000)).resolves.not.toThrow();
        expect(await cache.get('resilience-key')).toBe('still-works');
    });
});

/* ══════════════════════════════════════════
   2. statsController.getPublicSummary — Cache-Aside in practice
══════════════════════════════════════════ */
describe('statsController.getPublicSummary — Cache-Aside', () => {
    test('a cache hit never calls db.query — this is the actual "< 5ms" mechanism, not a timing assertion', async () => {
        db.query.mockResolvedValueOnce([[{ totalRoutes: 10, totalPassengers: 5, avgRating: '4.5', completedTrips: 1, canceledTrips: 0 }]]);
        const req = {}, res1 = mockRes(), res2 = mockRes();
        await statsCtrl.getPublicSummary(req, res1); // miss — computes and caches
        await statsCtrl.getPublicSummary(req, res2); // hit — must not touch the DB again
        expect(db.query).toHaveBeenCalledTimes(1);
        expect(res2.json).toHaveBeenCalledWith(res1.json.mock.calls[0][0]);
    });
});

/* ══════════════════════════════════════════
   3. Cache invalidation on write — every mutation that can change a
      cached read must clear it
══════════════════════════════════════════ */
describe('Cache invalidation on admin/operator writes', () => {
    test('tripController.updateTripStatus invalidates trips:trending and stats:public-summary', async () => {
        await cache.set('trips:trending', ['stale'], 60000);
        await cache.set('stats:public-summary', { stale: true }, 60000);
        db.query.mockResolvedValueOnce([{}]); // UPDATE trip SET status=...
        const req = { params: { id: '1' }, body: { status: 'CANCELED' }, user: { role: 'ADMIN' } };
        const res = mockRes();
        await tripCtrl.updateTripStatus(req, res);
        expect(await cache.get('trips:trending')).toBeUndefined();
        expect(await cache.get('stats:public-summary')).toBeUndefined();
    });

    test('tripController.updateTripPrice invalidates the same two caches', async () => {
        await cache.set('trips:trending', ['stale'], 60000);
        db.query.mockResolvedValueOnce([{}]);
        const req = { params: { id: '1' }, body: { price: 200000 }, user: { role: 'ADMIN' } };
        const res = mockRes();
        await tripCtrl.updateTripPrice(req, res);
        expect(await cache.get('trips:trending')).toBeUndefined();
    });

    test('adminController.updateBookingStatus invalidates both caches too (booking_count/completionRate can shift)', async () => {
        await cache.set('trips:trending', ['stale'], 60000);
        await cache.set('stats:public-summary', { stale: true }, 60000);
        db.query.mockResolvedValueOnce([{}]); // non-CANCELED path, single UPDATE
        const req = { params: { id: '1' }, body: { status: 'PAID' } };
        const res = mockRes();
        await adminCtrl.updateBookingStatus(req, res);
        expect(await cache.get('trips:trending')).toBeUndefined();
        expect(await cache.get('stats:public-summary')).toBeUndefined();
    });
});

/* ══════════════════════════════════════════
   4. Rate limiting (Sprint 12 additions)
══════════════════════════════════════════ */
describe('rateLimiter.js — paymentLimiter / aiLimiter', () => {
    const { paymentLimiter, aiLimiter } = require('../server/middleware/rateLimiter');

    test('both are real express-rate-limit middleware functions', () => {
        expect(typeof paymentLimiter).toBe('function');
        expect(typeof aiLimiter).toBe('function');
    });

    test('paymentRoutes.js applies paymentLimiter to /create and /vietqr/confirm, but not to gateway webhooks', () => {
        const src = fs.readFileSync(path.join(__dirname, '../server/routes/paymentRoutes.js'), 'utf8');
        expect(src).toMatch(/router\.post\('\/create',\s*paymentLimiter,/);
        expect(src).toMatch(/router\.post\('\/vietqr\/confirm',\s*paymentLimiter,/);
        // Webhooks are server-to-server and must stay unlimited (shared gateway IP pool)
        expect(src).not.toMatch(/router\.post\('\/momo\/notify',\s*paymentLimiter/);
        expect(src).not.toMatch(/router\.post\('\/zalopay\/callback',\s*paymentLimiter/);
        expect(src).not.toMatch(/router\.post\('\/vnpay\/ipn',\s*paymentLimiter/);
    });

    test('passengerAIRoutes.js applies aiLimiter to predict-intent', () => {
        const src = fs.readFileSync(path.join(__dirname, '../server/routes/passengerAIRoutes.js'), 'utf8');
        expect(src).toMatch(/router\.post\('\/predict-intent',\s*aiLimiter,\s*optionalAuth,/);
    });
});

/* ══════════════════════════════════════════
   5. sanitizeInput.js — XSS hardening
══════════════════════════════════════════ */
describe('sanitizeInput middleware', () => {
    function runSanitize(body, query = {}) {
        const req = { body, query };
        const next = jest.fn();
        sanitizeInput(req, {}, next);
        expect(next).toHaveBeenCalledTimes(1);
        return req;
    }

    test('escapes < and > in ordinary string fields', () => {
        const req = runSanitize({ comment: '<script>alert(1)</script>' });
        expect(req.body.comment).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    test('leaves excluded fields (password, token, signature, ...) completely untouched', () => {
        const req = runSanitize({ password: '<p@ss>word!', token: '<abc>', vnp_SecureHash: '<hash>' });
        expect(req.body.password).toBe('<p@ss>word!');
        expect(req.body.token).toBe('<abc>');
        expect(req.body.vnp_SecureHash).toBe('<hash>');
    });

    test('recurses into nested objects and arrays', () => {
        const req = runSanitize({ nested: { comment: '<b>hi</b>' }, list: ['<i>x</i>', 'plain'] });
        expect(req.body.nested.comment).toBe('&lt;b&gt;hi&lt;/b&gt;');
        expect(req.body.list[0]).toBe('&lt;i&gt;x&lt;/i&gt;');
        expect(req.body.list[1]).toBe('plain');
    });

    test('non-string values (numbers, booleans, null) pass through unchanged', () => {
        const req = runSanitize({ age: 30, active: true, note: null });
        expect(req.body.age).toBe(30);
        expect(req.body.active).toBe(true);
        expect(req.body.note).toBeNull();
    });

    test('also sanitizes req.query the same way', () => {
        const req = runSanitize({}, { origin: '<script>x</script>Hà Nội' });
        expect(req.query.origin).toBe('&lt;script&gt;x&lt;/script&gt;Hà Nội');
    });

    test('server.js applies sanitizeInput globally but explicitly skips /api/payment/* (gateway signature verification)', () => {
        const src = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
        expect(src).toMatch(/req\.path\.startsWith\("\/api\/payment\/"\)/);
        expect(src).toMatch(/sanitizeInput\(req, res, next\)/);
    });
});

/* ══════════════════════════════════════════
   6. Graceful Degradation
══════════════════════════════════════════ */
describe('dbErrors.js — connection-error classification', () => {
    test.each([...CONNECTION_ERROR_CODES])('%s is classified as a connection error', (code) => {
        expect(isConnectionError({ code })).toBe(true);
    });

    test('a real query bug (e.g. ER_BAD_FIELD_ERROR) is NOT classified as a connection error', () => {
        expect(isConnectionError({ code: 'ER_BAD_FIELD_ERROR' })).toBe(false);
        expect(isConnectionError(new Error('generic'))).toBe(false);
        expect(isConnectionError(null)).toBe(false);
    });

    test('sendDegraded responds 503 with degraded:true and an empty results array under the given key', () => {
        const res = mockRes();
        sendDegraded(res, 'rows', 'temporarily down');
        expect(res.status).toHaveBeenCalledWith(503);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ degraded: true, rows: [], message: 'temporarily down' }));
    });
});

describe('Search endpoints degrade gracefully on a DB connection error (never a bare 500)', () => {
    test('tripController.searchTrips -> 503 + degraded:true on ECONNREFUSED, not 500', async () => {
        const err = new Error('connect ECONNREFUSED'); err.code = 'ECONNREFUSED';
        db.query.mockRejectedValueOnce(err);
        const req = { query: {} };
        const res = mockRes();
        await tripCtrl.searchTrips(req, res);
        expect(res.status).toHaveBeenCalledWith(503);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ degraded: true, rows: [] }));
    });

    test('tripController.searchTrips still returns a plain 500 for a genuine non-connection DB error (a real bug should still be visible)', async () => {
        const err = new Error('Unknown column'); err.code = 'ER_BAD_FIELD_ERROR';
        db.query.mockRejectedValueOnce(err);
        const req = { query: {} };
        const res = mockRes();
        await tripCtrl.searchTrips(req, res);
        expect(res.status).toHaveBeenCalledWith(500);
    });

    test('searchController.transitSearch -> 503 + degraded:true on PROTOCOL_CONNECTION_LOST', async () => {
        transitRouter.searchWithTransit.mockRejectedValueOnce(Object.assign(new Error('lost'), { code: 'PROTOCOL_CONNECTION_LOST' }));
        const req = { body: { origin: 'A', destination: 'B' } };
        const res = mockRes();
        await searchCtrl.transitSearch(req, res);
        expect(res.status).toHaveBeenCalledWith(503);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ degraded: true, direct: [], transit: [] }));
    });
});

describe('server/config/db.js — pool error listener (prevents an unhandled "error" event from crashing the process)', () => {
    test('registers a listener on the underlying pool\'s "error" event', () => {
        const src = fs.readFileSync(path.join(__dirname, '../server/config/db.js'), 'utf8');
        expect(src).toMatch(/pool\.pool\.on\('error',/);
    });
});

/* ══════════════════════════════════════════
   7. Demo Mode — 1-click reset
══════════════════════════════════════════ */
describe('adminController.resetDemoData', () => {
    test('cancels every current PENDING booking (any age), releases seat holds, clears ai_intent_log, and never touches PAID bookings', async () => {
        db.query
            .mockResolvedValueOnce([[{ booking_id: 1 }, { booking_id: 2 }]]) // SELECT PENDING bookings
            .mockResolvedValueOnce([{ affectedRows: 1 }]) // booking 1: UPDATE ok
            .mockResolvedValueOnce([{}])                  // booking 1: DELETE seat hold
            .mockResolvedValueOnce([{ affectedRows: 1 }]) // booking 2: UPDATE ok
            .mockResolvedValueOnce([{}])                  // booking 2: DELETE seat hold
            .mockResolvedValueOnce([{ affectedRows: 4 }]); // DELETE FROM ai_intent_log

        db.getConnection.mockResolvedValue({
            beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
            query: (...args) => db.query(...args),
        });

        const req = {}, res = mockRes();
        await adminCtrl.resetDemoData(req, res);

        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            canceled_pending_bookings: 2, cleared_intent_logs: 4,
        }));
        // Never a DELETE/UPDATE against booking WHERE status='PAID'
        const sqlCalls = db.query.mock.calls.map(c => c[0]).join(' ');
        expect(sqlCalls).not.toMatch(/status\s*=\s*'PAID'/);
    });

    test('is mounted admin-only via adminRoutes.js\'s router.use(authenticate, requireAdmin)', () => {
        const src = fs.readFileSync(path.join(__dirname, '../server/routes/adminRoutes.js'), 'utf8');
        expect(src).toMatch(/router\.use\(authenticate, requireAdmin\)/);
        expect(src).toMatch(/router\.post\("\/demo\/reset",\s*admin\.resetDemoData\)/);
    });
});

/* ══════════════════════════════════════════
   8. Schema — migrate_v20.sql
══════════════════════════════════════════ */
describe('migrate_v20.sql / migrate.js — Sprint 12 indexing', () => {
    test('adds the two new booking composite indexes and the trip 3-column index, and does not re-declare the already-existing user_behavior index from migrate_v19', () => {
        const sql = fs.readFileSync(path.join(__dirname, '../server/config/migrate_v20.sql'), 'utf8');
        expect(sql).toMatch(/ADD INDEX idx_booking_user_status_time \(user_id, status, booking_time\)/);
        expect(sql).toMatch(/ADD INDEX idx_booking_trip_status \(trip_id, status\)/);
        expect(sql).toMatch(/ADD INDEX idx_trip_route_departure_status \(route_id, departure_time, status\)/);
        expect(sql).not.toMatch(/ADD INDEX idx_user_behavior_profiling/); // already exists from migrate_v19 — not re-declared (only mentioned in this file's own explanatory comment)
    });

    test('migrate.js registers migrate_v20.sql and verifies the new booking index', () => {
        const js = fs.readFileSync(path.join(__dirname, '../server/config/migrate.js'), 'utf8');
        expect(js).toMatch(/'migrate_v20\.sql'/);
        expect(js).toMatch(/idx_booking_user_status_time/);
    });
});

/* ══════════════════════════════════════════
   9. healthController — migration status visibility
══════════════════════════════════════════ */
describe('healthController.getHealth — migrations_ok', () => {
    test('reports migrations_ok:true when verifySchema finds nothing missing', async () => {
        db.query.mockResolvedValueOnce([[]]); // SELECT 1
        migrate.verifySchema.mockResolvedValueOnce([]);
        const res = mockRes();
        await getHealth({}, res);
        expect(res.json.mock.calls[0][0].migrations_ok).toBe(true);
        expect(res.json.mock.calls[0][0].status).toBe('healthy');
    });

    test('reports migrations_ok:false and status "degraded" (not "down") when something is missing but the DB itself is reachable', async () => {
        db.query.mockResolvedValueOnce([[]]);
        migrate.verifySchema.mockResolvedValueOnce(['some_index missing']);
        const res = mockRes();
        await getHealth({}, res);
        expect(res.json.mock.calls[0][0].migrations_ok).toBe(false);
        expect(res.json.mock.calls[0][0].status).toBe('degraded');
    });

    test('a verifySchema failure degrades to migrations_ok:null (unknown), never crashes the endpoint', async () => {
        db.query.mockResolvedValueOnce([[]]);
        migrate.verifySchema.mockRejectedValueOnce(new Error('boom'));
        const res = mockRes();
        await getHealth({}, res);
        expect(res.json.mock.calls[0][0].migrations_ok).toBeNull();
    });

    test('migrations_ok stays null when the DB ping itself fails (nothing to check yet)', async () => {
        db.query.mockRejectedValueOnce(new Error('connect ETIMEDOUT'));
        const res = mockRes();
        await getHealth({}, res);
        expect(res.json.mock.calls[0][0].migrations_ok).toBeNull();
        expect(res.json.mock.calls[0][0].status).toBe('down');
    });
});

/* ══════════════════════════════════════════
   10. Docker — content-level integrity (matches the established
       convention for infra files no live server can exercise in Jest —
       see phase5-production-defense.test.js's own header comment)
══════════════════════════════════════════ */
describe('Dockerfile / docker-compose.yml', () => {
    const dockerfile = fs.readFileSync(path.join(__dirname, '../Dockerfile'), 'utf8');
    const compose = fs.readFileSync(path.join(__dirname, '../docker-compose.yml'), 'utf8');

    test('Dockerfile runs as a non-root user and declares a real HEALTHCHECK hitting /api/health', () => {
        expect(dockerfile).toMatch(/USER node/);
        expect(dockerfile).toMatch(/HEALTHCHECK/);
        expect(dockerfile).toMatch(/\/api\/health/);
    });

    test('docker-compose.yml gates the backend behind the db healthcheck (service_healthy), never just "started"', () => {
        expect(compose).toMatch(/depends_on:\s*\n\s*db:\s*\n\s*condition:\s*service_healthy/);
    });

    test('the db service has its own real healthcheck (mysqladmin ping), not just an assumed-ready state', () => {
        expect(compose).toMatch(/healthcheck:/);
        expect(compose).toMatch(/mysqladmin/);
    });

    test('JWT_SECRET and QR_SECRET are required (no insecure default), matching this codebase\'s own jwtSecret.js warning about random-per-process secrets', () => {
        expect(compose).toMatch(/JWT_SECRET:\s*\$\{JWT_SECRET:\?/);
        expect(compose).toMatch(/QR_SECRET:\s*\$\{QR_SECRET:\?/);
    });
});
