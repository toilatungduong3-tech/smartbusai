'use strict';
/**
 * SmartBusAI — Sprint 5: production health-check.
 * Reports real, measured values only — no placeholder/static numbers.
 * Public (ops/monitoring endpoint, no PII, no auth required — matches the
 * same public posture already used for GET /api/trips/search).
 */
const db = require('../config/db');
const { verifySchema } = require('../config/migrate');

exports.getHealth = async (req, res) => {
    const dbCheck = { connected: false, ping_ms: null, pool: null };
    let dbOk = true;

    try {
        const t0 = Date.now();
        await db.query('SELECT 1');
        dbCheck.connected = true;
        dbCheck.ping_ms = Date.now() - t0;
    } catch (err) {
        dbOk = false;
        dbCheck.error = err.message;
    }

    /* Sprint 12 — Docker's HEALTHCHECK already can't succeed until
       server.listen() runs, which server.js gates behind runMigration()
       completing (see migrate.js's own header comment) — so a container
       reporting healthy already implies migrations ran. This makes that
       guarantee directly INSPECTABLE in the response itself, rather than
       only true by construction, for the thesis-defense demo's own
       confidence check (and for anyone debugging a "healthy but weird
       data" report after this point in time, independent of container
       start-up ordering). Best-effort: a schema-check failure here
       degrades the reported status but never crashes the endpoint. */
    let migrationsOk = null;
    if (dbOk) {
        try {
            const missing = await verifySchema();
            migrationsOk = missing.length === 0;
            if (!migrationsOk) dbCheck.schema_issues = missing;
        } catch (err) {
            migrationsOk = null; // couldn't check — not the same as "known bad"
        }
    }

    /* mysql2's PromisePool wraps the underlying callback-style Pool at
       `db.pool` — that inner pool is the only place actual connection
       counts live (mysql2 has no separate public stats API for this).
       `_allConnections`/`_freeConnections` are a `Denque` (double-ended
       queue), not a plain Array — verified via inspection this mysql2
       version uses Denque, so `.length` is checked directly rather than
       `Array.isArray`. Guarded throughout since these are undocumented
       internals that could change across mysql2 versions — the endpoint
       degrades to `pool: null` rather than throwing if the shape shifts. */
    const inner = db.pool;
    if (inner && inner._allConnections && typeof inner._allConnections.length === 'number') {
        const total = inner._allConnections.length;
        const idle = inner._freeConnections && typeof inner._freeConnections.length === 'number'
            ? inner._freeConnections.length : 0;
        dbCheck.pool = {
            total,
            idle,
            active: total - idle,
            limit: inner.config ? inner.config.connectionLimit : null,
        };
    }

    const mem = process.memoryUsage();
    const toMb = (bytes) => Math.round((bytes / (1024 * 1024)) * 10) / 10;

    const status = !dbOk ? 'down' : (migrationsOk === false ? 'degraded' : (dbCheck.ping_ms > 200 ? 'degraded' : 'healthy'));

    res.status(dbOk ? 200 : 503).json({
        status,
        timestamp: new Date().toISOString(),
        uptime_seconds: Math.round(process.uptime()),
        database: dbCheck,
        migrations_ok: migrationsOk,
        memory_mb: {
            rss: toMb(mem.rss),
            heap_used: toMb(mem.heapUsed),
            heap_total: toMb(mem.heapTotal),
            external: toMb(mem.external),
        },
        node_version: process.version,
    });
};
