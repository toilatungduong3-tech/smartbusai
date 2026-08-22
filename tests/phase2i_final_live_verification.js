'use strict';
/**
 * Phase 2I Final pass — live verification of the new admin operator_id
 * assignment workflow (Objective A), plus a quick re-confirmation of core
 * RBAC invariants. Real HTTP against the real running server + real DB.
 */
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:2704/api';

async function j(url, opts) {
    const res = await fetch(url, opts);
    let body = null;
    try { body = await res.json(); } catch {}
    return { status: res.status, body };
}
async function call(method, p, token, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, body: json };
}

const results = [];
function record(name, expect, actual, extra) {
    const pass = Array.isArray(expect) ? expect.includes(actual) : expect === actual;
    results.push({ name, expect, actual, pass, extra });
}

(async () => {
    // ── setup: admin + a fresh unlinked test operator + a real bus_operator to assign ──
    const adminReg = await j(`${BASE}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'phase2i_final_admin', full_name: 'Final Admin', email: 'phase2i_final_admin@test.local', password: 'TestPass123!' }) });
    const opReg = await j(`${BASE}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'phase2i_final_op', full_name: 'Final Op', email: 'phase2i_final_op@test.local', password: 'TestPass123!' }) });

    const db = require('../server/config/db');
    const [[adminUser]] = await db.query("SELECT user_id FROM users WHERE username='phase2i_final_admin'");
    const [[opUser]] = await db.query("SELECT user_id FROM users WHERE username='phase2i_final_op'");
    await db.query("UPDATE users SET role='ADMIN' WHERE user_id=?", [adminUser.user_id]);
    await db.query("UPDATE users SET role='OPERATOR' WHERE user_id=?", [opUser.user_id]);
    const [testOpResult] = await db.query(
        "INSERT INTO bus_operator (name,email,phone,status) VALUES (?,?,?,?)",
        ['Phase2I Final Test Operator', 'final-test-operator@test.local', '0900000099', 'ACTIVE']
    );
    const testOperatorId = testOpResult.insertId;

    async function login(email) {
        const r = await j(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'TestPass123!' }) });
        return r.body;
    }
    const admin = await login('phase2i_final_admin@test.local');
    let op = await login('phase2i_final_op@test.local');

    // ── 1. unlinked operator: empty dashboard, write denied ──
    let r = await call('GET', '/operators/dashboard/buses', op.accessToken);
    record('unlinked test operator: empty dashboard', 0, (r.body||[]).length);

    // ── 2. passenger cannot assign operator_id (userController.updateUser) ──
    const passReg = await j(`${BASE}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'phase2i_final_pass', full_name: 'Final Pass', email: 'phase2i_final_pass@test.local', password: 'TestPass123!' }) });
    const passenger = await login('phase2i_final_pass@test.local');
    r = await call('PUT', `/users/${opUser.user_id}`, passenger.accessToken, { operator_id: testOperatorId });
    record('passenger cannot assign operator_id to anyone (self-or-admin gate + role check)', [401, 403], r.status);

    // ── 3. operator cannot self-assign operator_id ──
    r = await call('PUT', `/users/${opUser.user_id}`, op.accessToken, { operator_id: testOperatorId });
    record('operator cannot self-assign operator_id', 403, r.status);

    // ── 4. admin assigns a nonexistent operator_id -> 422 ──
    r = await call('PUT', `/users/${opUser.user_id}`, admin.accessToken, { operator_id: 999999 });
    record('admin assigning nonexistent operator_id -> 422', 422, r.status);

    // ── 5. admin assigns the real test operator_id -> success ──
    r = await call('PUT', `/users/${opUser.user_id}`, admin.accessToken, { operator_id: testOperatorId });
    record('admin assigns valid operator_id -> success', 200, r.status);

    // ── 6. re-login (or fresh-lookup) confirms operator now sees the assignment take effect ──
    op = await login('phase2i_final_op@test.local');
    record('login response reflects new operator_id', testOperatorId, op.user?.operator_id);

    r = await call('POST', '/buses', op.accessToken, { plate_number: 'FINAL-TEST-BUS', bus_type: 'VIP', total_seats: 10 });
    record('newly-linked operator can now create a bus under their operator', 201, r.status, r.body);
    const createdBusId = r.body?.bus_id;

    // ── 7. admin unassigns -> operator fails closed again ──
    r = await call('PUT', `/users/${opUser.user_id}`, admin.accessToken, { operator_id: null });
    record('admin unassigns operator_id -> success', 200, r.status);
    op = await login('phase2i_final_op@test.local');
    record('after unassign, login response operator_id is null', null, op.user?.operator_id);
    r = await call('GET', '/operators/dashboard/buses', op.accessToken);
    record('after unassign, dashboard empty again (fail closed, not stale access)', 0, (r.body||[]).length);

    console.log(JSON.stringify(results, null, 2));
    const failed = results.filter(x => !x.pass);
    console.log(`\n=== ${results.length - failed.length}/${results.length} PASS ===`);
    if (failed.length) failed.forEach(f => console.log(' FAIL:', f.name, 'expected', f.expect, 'got', f.actual, f.extra||''));

    fs.writeFileSync(path.join(__dirname, 'phase2i_final_test_ids.json'), JSON.stringify({
        userIds: [adminUser.user_id, opUser.user_id],
        passengerUsername: 'phase2i_final_pass',
        testOperatorId, createdBusId,
    }));
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
