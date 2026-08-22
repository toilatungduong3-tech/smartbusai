'use strict';
/**
 * SmartBusAI — System-wide time contract (Phase 1 hardening).
 *
 * THE CONTRACT (single source of truth — do not reinvent per-file):
 *   1. DB storage: every naive DATETIME column (trip.departure_time,
 *      trip.arrival_time, booking.booking_time, etc.) stores VIETNAM LOCAL
 *      wall-clock time (Asia/Ho_Chi_Minh, UTC+7, no DST). This is enforced
 *      at the driver level — server/config/db.js sets the mysql2 pool's
 *      `timezone: '+07:00'` explicitly, so every Date object sent to or
 *      read from the DB is converted using a fixed +07:00 offset,
 *      independent of the host OS's timezone.
 *   2. Backend process timezone: pinned explicitly via `process.env.TZ`
 *      in server.js (set before any other module loads), so every
 *      Node-native local-time call (toLocaleString, getHours, etc.) is
 *      also Vietnam-local regardless of the deployment host's default.
 *   3. API responses: dates are serialized as ISO 8601 (the default
 *      JSON.stringify of a JS Date) — this correctly encodes the
 *      absolute instant; the frontend must parse it with the native
 *      `Date` constructor and read LOCAL fields (getHours, toLocaleString)
 *      for display, never re-slice the ISO text directly.
 *
 * RULE: never hand-format a Date using UTC accessors (getUTCFullYear,
 * getUTCHours, toISOString-then-slice) when the destination is a DB
 * DATETIME literal or a `datetime-local` form field — both are LOCAL by
 * convention. Use the helpers below instead of ad hoc string surgery.
 */

function pad(n) {
    return String(n).padStart(2, '0');
}

/** Format a Date as a `YYYY-MM-DD HH:mm:ss` local-wall-clock literal,
 *  suitable for writing directly into a DATETIME column. */
function toDbDateTime(d) {
    if (!(d instanceof Date) || isNaN(d.getTime())) {
        throw new TypeError('toDbDateTime: expected a valid Date, got ' + String(d));
    }
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
           `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Parse a value that may already be a Date (mysql2 with timezone:'+07:00'
 *  returns Date objects for DATETIME columns) or a raw `YYYY-MM-DD HH:mm:ss`
 *  / `YYYY-MM-DDTHH:mm:ss` string, treating a naive string as LOCAL time
 *  (no forced 'Z' — that would misinterpret it as UTC). */
function parseDbDateTime(v) {
    if (v instanceof Date) return v;
    if (v == null) return new Date(NaN);
    return new Date(String(v).replace(' ', 'T'));
}

function isValidDate(v) {
    return !isNaN(parseDbDateTime(v).getTime());
}

module.exports = { toDbDateTime, parseDbDateTime, isValidDate, pad };
