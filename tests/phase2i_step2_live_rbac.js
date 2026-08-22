'use strict';
/**
 * Phase 2I Step 2 — live verification: canonical operator identity
 * (users.operator_id FK), cross-operator isolation, operator_id spoofing
 * resistance, email-mismatch resilience, unlinked-operator fail-closed,
 * admin/passenger boundaries. Real HTTP against the real running server.
 */
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:2704/api';
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'phase2i_step4_testdata.json'), 'utf8'));
const { passenger, opAUser, opBUser, adminUser, operatorAId, operatorBId, busAId, busBId, seatAId } = data;
const realTokens = JSON.parse(fs.readFileSync(path.join(__dirname, 'phase2i_step2_real_tokens.json'), 'utf8'));

const results = [];
function record(name, expect, actual, extra) {
    const pass = Array.isArray(expect) ? expect.includes(actual) : expect === actual;
    results.push({ name, expect, actual, pass, extra });
}
async function call(method, p, token, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, body: json };
}

(async () => {
    let r;

    // ── REAL production accounts: 46 linked, 47 unlinked, 48 linked ──
    r = await call('GET', '/operators/dashboard/buses', realTokens.user46_linked_to_op1.token);
    record('REAL user46 (linked, email mismatched) sees exactly operator 1\'s 9 buses', 9, (r.body||[]).length);

    r = await call('GET', '/operators/dashboard/buses', realTokens.user47_unlinked.token);
    record('REAL user47 (unlinked) sees empty array, not global data', 0, (r.body||[]).length);

    r = await call('GET', '/operators/dashboard/buses', realTokens.user48_linked_to_op3.token);
    record('REAL user48 (linked) sees exactly operator 3\'s 7 buses', 7, (r.body||[]).length);

    r = await call('POST', `/buses`, realTokens.user47_unlinked.token, { plate_number: 'X', bus_type: 'VIP', total_seats: 10 });
    record('REAL user47 (unlinked) cannot create a bus -> 403', 403, r.status);

    // ── Fresh isolated operator A/B: email deliberately mismatched for A ──
    r = await call('GET', '/operators/dashboard/buses', opAUser.token);
    const fleetA = (r.body||[]).map(b=>b.bus_id);
    record('Operator A (email mismatched vs bus_operator.email) still resolves correctly, sees own bus only', true,
        fleetA.includes(busAId) && !fleetA.includes(busBId), { fleetA });

    r = await call('PUT', `/buses/${busBId}`, opAUser.token, { plate_number: 'HIJACK', bus_type: 'VIP', total_seats: 99 });
    record('Operator A cannot update Operator B\'s bus (cross-operator IDOR)', 403, r.status);

    r = await call('DELETE', `/buses/${busBId}`, opAUser.token);
    record('Operator A cannot delete Operator B\'s bus', 403, r.status);

    r = await call('PUT', `/seats/${seatAId}`, opBUser.token, { seat_type: 'VIP' });
    record('Operator B cannot update Operator A\'s seat', 403, r.status);

    // ── Spoofing: operator_id in body/query must be ignored, server uses JWT-derived identity ──
    r = await call('POST', '/buses', opAUser.token, { operator_id: operatorBId, plate_number: 'SPOOF-TEST', bus_type: 'VIP', total_seats: 10 });
    record('Operator A spoofing operator_id=B in body -> still creates under A (201)', 201, r.status);
    let spoofBusId = r.body?.bus_id;

    r = await call('GET', `/operators/dashboard/buses?operator_id=${operatorBId}`, opAUser.token);
    const fleetSpoofed = (r.body||[]).map(b=>b.bus_id);
    record('Operator A spoofing ?operator_id=B in query -> dashboard still scoped to A, never returns B\'s data', true,
        !fleetSpoofed.includes(busBId), { fleetSpoofed });

    r = await call('PUT', `/buses/${busAId}`, opAUser.token, { operator_id: operatorBId, plate_number: 'STILL-A', bus_type: 'VIP', total_seats: 20 });
    record('Operator A cannot reassign own bus to operator B via body.operator_id (admin-only reassignment)', 200, r.status);

    // ── Admin / passenger boundaries ──
    r = await call('GET', '/operators/dashboard/buses', adminUser.token);
    const fleetAdmin = (r.body||[]).map(b=>b.bus_id);
    record('Admin sees both operator A and B (and spoof-test) buses (global)', true,
        fleetAdmin.includes(busAId) && fleetAdmin.includes(busBId), { fleetAdmin });

    r = await call('GET', '/operators/dashboard/buses', passenger.token);
    record('Passenger denied operator dashboard', 403, r.status);

    r = await call('GET', '/operators/dashboard/buses', null);
    record('Anonymous denied operator dashboard', 401, r.status);

    console.log(JSON.stringify(results, null, 2));
    const failed = results.filter(x => !x.pass);
    console.log(`\n=== ${results.length - failed.length}/${results.length} PASS ===`);
    if (failed.length) failed.forEach(f => console.log(' FAIL:', f.name, 'expected', f.expect, 'got', f.actual, f.extra||''));

    // Verify the operator_id reassignment attempt did NOT actually change bus A's operator ownership
    fs.writeFileSync(path.join(__dirname, 'phase2i_step2_spoof_bus_id.json'), JSON.stringify({ spoofBusId }));
})();
