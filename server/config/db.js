const mysql = require("mysql2/promise");
const logger = require('../utils/logger');
require("dotenv").config();

const pool = mysql.createPool({
    host:     process.env.DB_HOST     || "localhost",
    user:     process.env.DB_USER     || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME     || "smartbusai",
    port:     Number(process.env.DB_PORT) || 3306,

    // Time contract (Phase 1 hardening — see server/utils/dateTime.js):
    // every naive DATETIME column stores Vietnam local wall-clock time.
    // A fixed +07:00 offset (Vietnam observes no DST) makes JS Date <-> DB
    // DATETIME conversion correct independent of the host OS's timezone,
    // instead of relying on mysql2's 'local' default coincidentally
    // matching the deployment host.
    timezone: '+07:00',

    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

/* Connects with retry + backoff instead of a single unretried attempt.
   server.js awaits this (db.waitForConnection()) before calling
   runMigration() — see server.js's START SERVER section for why.
   On a machine where MySQL/XAMPP was JUST started (or is starting at the
   same moment as `node server/server.js`), the very first connection
   attempt can genuinely hit ETIMEDOUT/ECONNREFUSED simply because mysqld
   hasn't finished its own boot (InnoDB crash recovery, etc.) yet, not
   because anything is actually broken — the exact same connection
   succeeds a second later once MySQL is ready. Confirmed reproducible on
   a real cold start here: server.js used to call runMigration() straight
   away with no readiness check, so its first query could lose this race
   and throw — and since runMigration() failing is treated as fatal
   (server.js's `catch` calls `process.exit(1)`, by design, so a REAL
   degraded-schema problem is never silently ignored), a slow-starting
   MySQL could take the whole server down before it ever got a chance to
   come up. Waiting here first turns that into "startup takes a few extra
   seconds" instead of "startup fails outright". */
async function waitForConnection({ maxAttempts = 8, baseDelayMs = 1000 } = {}) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const conn = await pool.getConnection();
            conn.release();
            return true;
        } catch (err) {
            /* mysql2's connection-level errors (ECONNREFUSED, ETIMEDOUT)
               populate .code but leave .message empty — logging only
               err.message here produced a blank, useless log line during
               testing. .code is always present for this error class. */
            const reason = err.code || err.message || String(err);
            if (attempt === maxAttempts) {
                logger.error(`❌ MySQL Connection Failed after ${maxAttempts} attempts:`, reason);
                return false;
            }
            logger.warn(`⏳ MySQL not ready yet (attempt ${attempt}/${maxAttempts}): ${reason} — retrying in ${baseDelayMs * attempt}ms`);
            await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
        }
    }
    return false;
}
pool.waitForConnection = waitForConnection;

/* Sprint 12 — Graceful Degradation: without this listener, an idle pooled
   connection dropped by MariaDB (network blip, DB restart, connection
   timeout) fires an unhandled 'error' event on the underlying callback
   pool (`pool.pool` — the object mysql2/promise's PromisePool wraps,
   same one healthController.js already reaches into for live pool
   stats) and CRASHES the whole Node process by default. Logging it here
   instead lets the pool do what it already does on its own — drop the
   dead connection and open a fresh one for the next `getConnection()` —
   without taking the entire server down over one bad connection. */
pool.pool.on('error', (err) => {
    logger.error("⚠️  MySQL pool error (connection dropped, pool will reconnect):", err.message);
});

module.exports = pool;
