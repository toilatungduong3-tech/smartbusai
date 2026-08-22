'use strict';
/**
 * TRUTHNODE — SPRINT 5: Production & Defense Readiness.
 * Covers: the new GET /api/health endpoint, the migrate_v12.sql composite
 * indexes (content-level regression guard — the real EXPLAIN/timing
 * evidence proving they work at 100,000+ rows was measured live against
 * the real DB this sprint and is documented in migrate_v12.sql's own
 * header and SPRINT5_FINAL_REPORT.md, not re-measured here: a hard
 * millisecond assertion against a live DB would be flaky in any CI
 * environment without that exact dataset, which is why every earlier
 * performance-hardening test file in this repo — e.g.
 * tests/phase3-transit-perf.test.js — tests deterministic logic/content,
 * not live timing, for the same reason), and no-hardcoded-secret
 * regression guards (QR_SECRET, PORT, CORS_ORIGIN).
 *
 * DB access is mocked throughout — this file never opens a real
 * connection, matching every other *.test.js file in this repo.
 */

const fs = require('fs');
const path = require('path');

jest.mock('../server/config/db', () => ({ query: jest.fn(), getConnection: jest.fn() }));

/* ══════════════════════════════════════════
   1. GET /api/health
══════════════════════════════════════════ */
describe('healthController.getHealth', () => {
    let db;

    beforeEach(() => {
        jest.resetModules();
        db = require('../server/config/db');
        db.query.mockReset();
    });

    function mockRes() {
        return { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    }

    test('reports status "healthy" and 200 when the DB ping is fast', async () => {
        db.query.mockResolvedValueOnce([[]]); // SELECT 1
        const { getHealth } = require('../server/controllers/healthController');
        const res = mockRes();
        await getHealth({}, res);
        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe('healthy');
        expect(res.body.database.connected).toBe(true);
        expect(typeof res.body.database.ping_ms).toBe('number');
    });

    test('reports status "down" and 503 when the DB ping throws', async () => {
        db.query.mockRejectedValueOnce(new Error('connect ETIMEDOUT'));
        const { getHealth } = require('../server/controllers/healthController');
        const res = mockRes();
        await getHealth({}, res);
        expect(res.statusCode).toBe(503);
        expect(res.body.status).toBe('down');
        expect(res.body.database.connected).toBe(false);
        expect(res.body.database.error).toMatch(/ETIMEDOUT/);
    });

    test('never fabricates a pool reading — reports pool:null if the mocked db has no inner .pool shape', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const { getHealth } = require('../server/controllers/healthController');
        const res = mockRes();
        await getHealth({}, res);
        expect(res.body.database.pool).toBeNull();
    });

    test('reports real memory figures (process.memoryUsage(), not placeholders)', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const { getHealth } = require('../server/controllers/healthController');
        const res = mockRes();
        await getHealth({}, res);
        expect(res.body.memory_mb.rss).toBeGreaterThan(0);
        expect(res.body.memory_mb.heap_used).toBeGreaterThan(0);
        expect(res.body.node_version).toBe(process.version);
    });

    test('uptime_seconds tracks process.uptime(), not a fabricated/random estimate', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const { getHealth } = require('../server/controllers/healthController');
        const res = mockRes();
        const before = Math.floor(process.uptime());
        await getHealth({}, res);
        const after = Math.ceil(process.uptime());
        expect(res.body.uptime_seconds).toBeGreaterThanOrEqual(before);
        expect(res.body.uptime_seconds).toBeLessThanOrEqual(after);
    });
});

/* ══════════════════════════════════════════
   2. migrate_v12.sql — composite index content
   (the real EXPLAIN/timing proof lives in SPRINT5_FINAL_REPORT.md —
   see this file's header for why that isn't re-asserted here)
══════════════════════════════════════════ */
describe('migrate_v12.sql — composite indexes are present with the right columns', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../server/config/migrate_v12.sql'), 'utf8');

    test('adds booking(status, booking_time) — bookingCleanup.js\'s abandoned-PENDING scan', () => {
        expect(sql).toMatch(/ALTER TABLE booking\s+ADD INDEX idx_booking_status_time \(status, booking_time\)/);
    });

    test('adds trip(route_id, departure_time) — search/concierge/transit join performance', () => {
        expect(sql).toMatch(/ALTER TABLE trip\s+ADD INDEX idx_trip_route_departure \(route_id, departure_time\)/);
    });

    test('migrate_v12.sql is registered in the auto-run migration sequence', () => {
        const migrateJs = fs.readFileSync(path.join(__dirname, '../server/config/migrate.js'), 'utf8');
        expect(migrateJs).toMatch(/'migrate_v12\.sql'/);
    });

    test('verifySchema() checks for both new indexes (fails loud if a migration silently no-ops)', () => {
        const migrateJs = fs.readFileSync(path.join(__dirname, '../server/config/migrate.js'), 'utf8');
        expect(migrateJs).toMatch(/idx_booking_status_time/);
        expect(migrateJs).toMatch(/idx_trip_route_departure/);
    });
});

/* ══════════════════════════════════════════
   3. No hardcoded secrets
══════════════════════════════════════════ */
describe('Secret hygiene', () => {
    test('qrService.js no longer hardcodes the old literal QR_SECRET string', () => {
        const src = fs.readFileSync(path.join(__dirname, '../server/services/qrService.js'), 'utf8');
        expect(src).not.toMatch(/smartbusai_qr_secret_2024/);
        expect(src).toMatch(/require\(['"]\.\.\/config\/qrSecret['"]\)/);
    });

    test('qrSecret.js falls back to a random per-process secret (with a warning) when QR_SECRET is unset — never a fixed literal', () => {
        jest.isolateModules(() => {
            const originalEnv = process.env.QR_SECRET;
            delete process.env.QR_SECRET;
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
            const secretA = require('../server/config/qrSecret');
            expect(typeof secretA).toBe('string');
            expect(secretA.length).toBeGreaterThanOrEqual(64); // crypto.randomBytes(48).toString('hex') = 96 chars
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('QR_SECRET'));
            warnSpy.mockRestore();
            if (originalEnv !== undefined) process.env.QR_SECRET = originalEnv;
        });
    });

    test('qrSecret.js uses the real QR_SECRET from env when it is set, not the random fallback', () => {
        jest.isolateModules(() => {
            const originalEnv = process.env.QR_SECRET;
            process.env.QR_SECRET = 'a-real-configured-secret-value';
            const secret = require('../server/config/qrSecret');
            expect(secret).toBe('a-real-configured-secret-value');
            if (originalEnv !== undefined) process.env.QR_SECRET = originalEnv; else delete process.env.QR_SECRET;
        });
    });

    test('.env.example documents every secret as an empty placeholder, never a real filled-in value', () => {
        const example = fs.readFileSync(path.join(__dirname, '../.env.example'), 'utf8');
        // Every *_SECRET / *_KEY / DB_PASSWORD line must be `NAME=` with
        // nothing after the `=` (comments on separate lines are fine).
        const secretLines = example.split('\n').filter(l => /^(JWT_SECRET|QR_SECRET|.*_SECRET_KEY|.*_HASH_SECRET|DB_PASSWORD)=/.test(l.trim()));
        expect(secretLines.length).toBeGreaterThan(0);
        secretLines.forEach(line => {
            expect(line.trim()).toMatch(/^[A-Z_]+=$/);
        });
    });

    test('.env.example does not contain the known MoMo/VNPay sandbox literal values (documented as defaults in code, not duplicated in the template)', () => {
        const example = fs.readFileSync(path.join(__dirname, '../.env.example'), 'utf8');
        expect(example).not.toMatch(/F8BBA842ECF85/);
        expect(example).not.toMatch(/K951B6PE1waDMi640xX08PD3vg6EkVlz/);
        expect(example).not.toMatch(/RAOEXHYVSDDIIENYWSLDIIZTANXUXZFJ/);
    });

    test('server.js reads PORT from the environment (Docker/production requires this — was hardcoded before Sprint 5)', () => {
        const src = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
        expect(src).toMatch(/const PORT = Number\(process\.env\.PORT\) \|\| 2704/);
    });

    test('server.js supports an optional CORS_ORIGIN env var, additive to the built-in allow-list', () => {
        const src = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
        expect(src).toMatch(/process\.env\.CORS_ORIGIN/);
    });
});

/* ══════════════════════════════════════════
   4. Docker packaging sanity (content-level — no Docker daemon in this
   test environment, so this can't invoke `docker build`; the schema_base.sql
   + migrate.js sequence was separately verified end-to-end against a real
   scratch database this sprint — see SPRINT5_FINAL_REPORT.md)
══════════════════════════════════════════ */
describe('Docker packaging files exist and are internally consistent', () => {
    test('Dockerfile references the real health endpoint for its HEALTHCHECK', () => {
        const df = fs.readFileSync(path.join(__dirname, '../Dockerfile'), 'utf8');
        expect(df).toMatch(/HEALTHCHECK/);
        expect(df).toMatch(/\/api\/health/);
    });

    test('docker-compose.yml mounts the real exported schema_base.sql, not a placeholder', () => {
        const compose = fs.readFileSync(path.join(__dirname, '../docker-compose.yml'), 'utf8');
        expect(compose).toMatch(/schema_base\.sql/);
        expect(fs.existsSync(path.join(__dirname, '../server/config/schema_base.sql'))).toBe(true);
    });

    test('docker-compose.yml requires JWT_SECRET/QR_SECRET explicitly rather than a fixed fallback', () => {
        const compose = fs.readFileSync(path.join(__dirname, '../docker-compose.yml'), 'utf8');
        expect(compose).toMatch(/JWT_SECRET:\?/);
        expect(compose).toMatch(/QR_SECRET:\?/);
    });
});
