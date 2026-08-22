'use strict';
/**
 * TRUTHNODE — SPRINT 3: Security, RBAC & Perf Hardening.
 * Live verification against the REAL running server (localhost:2704) and
 * REAL database. Creates disposable users/data and cleans them up itself.
 * Safe to re-run any time the server is up.
 *
 * Covers:
 *   - GET /api/bookings PII leak (now 401 unauthenticated; ticker endpoint
 *     is public, capped at 20, PII-masked)
 *   - GET /api/buses fleet leak (now 401 unauthenticated)
 *   - Blocked account rejected at login, at an already-issued access
 *     token, and at refreshToken
 *   - Suspended operator blocked from viewing/creating buses
 */
require('dotenv').config();
const db = require('../server/config/db');
const bcrypt = require('bcryptjs');
const BASE = 'http://localhost:2704/api';

const cleanupUserIds = [];

async function makeDisposableUser({ role = 'PASSENGER', operator_id = null, status = 'ACTIVE' } = {}) {
    const stamp = Date.now() + Math.floor(Math.random() * 1000);
    const email = `phase3_live_${stamp}@test.local`;
    const username = `phase3live_${stamp}`;
    const password = 'TestPass123!';
    const hash = await bcrypt.hash(password, 10);
    const [r] = await db.query(
        'INSERT INTO users (username, full_name, email, password_hash, role, operator_id, status) VALUES (?,?,?,?,?,?,?)',
        [username, 'Phase3 Live Test', email, hash, role, operator_id, status]
    );
    cleanupUserIds.push(r.insertId);
    return { user_id: r.insertId, email, password };
}

async function login(email, password) {
    const res = await fetch(`${BASE}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
}

async function main() {
    const results = [];
    function check(name, pass, detail) {
        results.push({ name, pass });
        console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
    }

    // ── GET /api/bookings PII leak ──
    const rBookingsNoAuth = await fetch(`${BASE}/bookings`);
    check('GET /api/bookings unauthenticated -> 401 (was fully public before this sprint)', rBookingsNoAuth.status === 401);

    const rTicker = await fetch(`${BASE}/bookings/ticker`);
    const ticker = await rTicker.json();
    const piiFields = ['email', 'phone', 'booking_id', 'user_id', 'plate_number', 'payment_method', 'payment_status'];
    const hasPii = ticker.some(row => piiFields.some(f => f in row));
    check('GET /api/bookings/ticker -> 200, <=20 rows, zero PII fields',
        rTicker.status === 200 && ticker.length <= 20 && !hasPii,
        `count=${ticker.length}`);

    // ── GET /api/buses fleet leak ──
    const rBusesNoAuth = await fetch(`${BASE}/buses`);
    check('GET /api/buses unauthenticated -> 401 (was fully public before this sprint)', rBusesNoAuth.status === 401);

    // ── Blocked account enforcement ──
    const blocked = await makeDisposableUser({ role: 'PASSENGER' });
    const loginActive = await login(blocked.email, blocked.password);
    const accessToken = loginActive.body.accessToken;
    const refreshToken = loginActive.body.refreshToken;
    check('login while ACTIVE succeeds', loginActive.status === 200 && !!accessToken);

    const rBeforeBlock = await fetch(`${BASE}/users/${blocked.user_id}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    check('authenticated request works before block', rBeforeBlock.status === 200);

    await db.query("UPDATE users SET status='BLOCKED' WHERE user_id=?", [blocked.user_id]);

    const loginBlocked = await login(blocked.email, blocked.password);
    check('login while BLOCKED -> 403', loginBlocked.status === 403);

    const rAfterBlock = await fetch(`${BASE}/users/${blocked.user_id}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    check('a pre-block access token is rejected once blocked -> 403 (not silently trusted)', rAfterBlock.status === 403);

    const rRefreshBlocked = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
    });
    check('refreshToken for a now-blocked user -> 403 (cannot mint a fresh access token)', rRefreshBlocked.status === 403);

    // ── Suspended operator enforcement ──
    const [[suspendedOp]] = await db.query("SELECT operator_id FROM bus_operator WHERE status='SUSPENDED' LIMIT 1");
    if (suspendedOp) {
        const suspUser = await makeDisposableUser({ role: 'OPERATOR', operator_id: suspendedOp.operator_id });
        const loginSusp = await login(suspUser.email, suspUser.password);
        const suspToken = loginSusp.body.accessToken;

        const rSuspBuses = await fetch(`${BASE}/buses`, { headers: { Authorization: `Bearer ${suspToken}` } });
        const suspBuses = await rSuspBuses.json();
        check('suspended operator: GET /api/buses -> 200 with empty list (fails closed, not an error)',
            rSuspBuses.status === 200 && Array.isArray(suspBuses) && suspBuses.length === 0);

        const rSuspCreate = await fetch(`${BASE}/buses`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${suspToken}` },
            body: JSON.stringify({ plate_number: 'PHASE3-LIVE-TEST', bus_type: 'NORMAL', total_seats: 40 }),
        });
        check('suspended operator: POST /api/buses (create) -> 403', rSuspCreate.status === 403);
    } else {
        check('suspended-operator checks', true, 'SKIPPED — no SUSPENDED bus_operator row exists in this DB right now');
    }

    console.log(`\n${results.filter(r => r.pass).length}/${results.length} checks passed`);

    await db.query(`DELETE FROM users WHERE user_id IN (?)`, [cleanupUserIds]);
    console.log(`🧹 Cleaned up ${cleanupUserIds.length} disposable test user(s): [${cleanupUserIds.join(', ')}]`);

    process.exit(results.every(r => r.pass) ? 0 : 1);
}

main().catch(async (e) => {
    console.error('FATAL:', e);
    if (cleanupUserIds.length) await db.query(`DELETE FROM users WHERE user_id IN (?)`, [cleanupUserIds]).catch(() => {});
    process.exit(1);
});
