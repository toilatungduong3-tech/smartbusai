'use strict';
/* ═══════════════════════════════════════════════════════════
   requestId.js — Enterprise Hardening Pass (Pillar 4).

   Mounted as the very first middleware in server.js so trace_id covers
   every request, including ones rejected by rate limiting or CORS before
   reaching a route. Honors an incoming X-Request-Id (e.g. from an
   upstream load balancer/API gateway in a real deployment) so a trace can
   be followed across services instead of only inside this one process;
   generates a fresh UUID when the caller didn't supply one. Echoed back
   as a response header so a client (or the load balancer's own access
   log) can correlate its request to this service's log lines.
═══════════════════════════════════════════════════════════ */
const crypto = require('crypto');
const { run } = require('../utils/requestContext');

module.exports = function requestId(req, res, next) {
    const trace_id = req.headers['x-request-id'] || crypto.randomUUID();
    res.setHeader('X-Request-Id', trace_id);
    run({ trace_id, path: req.originalUrl, user_id: null }, () => next());
};
