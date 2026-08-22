'use strict';

/* ═══════════════════════════════════════════════════════════
   dbErrors.js — Sprint 12: Graceful Degradation helper.

   Distinguishes "the database is temporarily unreachable" from "this
   specific query is wrong" — a query bug should still surface as a 500
   (so it gets noticed and fixed), but a dropped connection/timeout
   shouldn't look identical to one. Search-facing callers use this to
   return a clearly-labeled degraded response instead of either crashing
   the request or silently pretending real trips exist when the DB is
   down.
═══════════════════════════════════════════════════════════ */

const CONNECTION_ERROR_CODES = new Set([
    'PROTOCOL_CONNECTION_LOST',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ER_CON_COUNT_ERROR',
    'PROTOCOL_SEQUENCE_TIMEOUT',
    'ENOTFOUND',
    'ECONNRESET',
    'POOL_CLOSED',
]);

function isConnectionError(err) {
    return !!err && CONNECTION_ERROR_CODES.has(err.code);
}

/** 503 (not 500) with a `degraded:true` flag the frontend can key off of
 *  to show "results may be incomplete" instead of a hard error page. An
 *  empty `results`/`rows` array (name chosen by the caller) is included
 *  so a client that doesn't check `degraded` still renders "no results"
 *  gracefully rather than crashing on `undefined`. */
function sendDegraded(res, resultsKey, message) {
    return res.status(503).json({
        degraded: true,
        message: message || 'Hệ thống đang tạm thời quá tải, vui lòng thử lại sau giây lát.',
        [resultsKey]: [],
    });
}

module.exports = { isConnectionError, sendDegraded, CONNECTION_ERROR_CODES };
