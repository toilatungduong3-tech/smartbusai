'use strict';
/* ═══════════════════════════════════════════════════════════
   logger.js — Enterprise Hardening Pass (Pillar 4).

   Structured JSON logging via Winston, replacing bare console.log/
   console.error/console.warn across the backend. Every line carries
   {timestamp, level, message, trace_id, path, user_id, ...extra} —
   trace_id/path/user_id come from requestContext.js's AsyncLocalStorage,
   not from the call site, so log calls deep inside services/repositories
   (which never receive `req`) still get correctly correlated to the
   request that triggered them.

   Ergonomics compatible with console.*: this module exports info/warn/
   error functions that accept the same call shapes this codebase already
   uses everywhere — `logger.error("SOME LABEL:", err)`, a bare string,
   or a string plus a plain metadata object. A raw Winston logger does
   NOT concatenate multiple positional arguments the way console does
   (multi-arg calls like `logger.error("X:", err)` would silently lose
   the second argument under Winston's default splat handling) — the
   normalize() step below is what makes the console.* → logger.*
   replacement mechanically safe across 231 existing call sites instead
   of silently dropping half of every two-argument log call.
═══════════════════════════════════════════════════════════ */
const winston = require('winston');
const { getStore } = require('./requestContext');

const winstonLogger = winston.createLogger({
    // Jest sets NODE_ENV=test by default — silenced there so the 700+ test
    // suite's stdout stays readable; every log call still executes (a test
    // can still assert on it via jest.spyOn(logger, 'warn'/'error'/...)),
    // it just isn't printed.
    silent: process.env.NODE_ENV === 'test',
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const store = getStore() || {};
            return JSON.stringify({
                timestamp,
                level,
                message,
                trace_id: store.trace_id || null,
                path: store.path || null,
                user_id: store.user_id || null,
                ...meta,
            });
        })
    ),
    transports: [new winston.transports.Console()],
});

function normalize(args) {
    const parts = [];
    const meta = {};
    for (const a of args) {
        if (a instanceof Error) {
            meta.error = a.message;
            meta.stack = a.stack;
        } else if (a !== null && typeof a === 'object') {
            Object.assign(meta, a);
        } else {
            parts.push(String(a));
        }
    }
    return { message: parts.join(' '), meta };
}

function log(level, args) {
    const { message, meta } = normalize(args);
    winstonLogger[level](message, meta);
}

module.exports = {
    info: (...args) => log('info', args),
    warn: (...args) => log('warn', args),
    error: (...args) => log('error', args),
    debug: (...args) => log('debug', args),
    _winston: winstonLogger, // escape hatch for callers that need the real Winston instance directly
};
