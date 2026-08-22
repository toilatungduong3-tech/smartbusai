'use strict';
/* ═══════════════════════════════════════════════════════════
   requestContext.js — Enterprise Hardening Pass (Pillar 4).

   AsyncLocalStorage (Node's built-in request-scoped context, no extra
   dependency) carries {trace_id, path, user_id} through the whole async
   call chain of a single request — including calls several layers deep
   in services/repositories that never receive `req` as a parameter.
   This is what lets logger.js attach trace_id/path/user_id to every log
   line without changing the call signature of any existing log call
   site (see the mechanical console.* → logger.* replacement across
   server/ — that replacement is only safe because context threading
   happens here, not by passing new arguments through 231 call sites).
═══════════════════════════════════════════════════════════ */
const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

function run(store, fn) {
    return als.run(store, fn);
}

function getStore() {
    return als.getStore();
}

/** Best-effort mutation of the current request's store (e.g. authMiddleware
 *  filling in user_id once a token is decoded, after the store was created
 *  with user_id:null by requestId.js). No-op outside a request context. */
function setContext(patch) {
    const store = als.getStore();
    if (store) Object.assign(store, patch);
}

module.exports = { run, getStore, setContext };
