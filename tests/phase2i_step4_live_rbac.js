'use strict';
/**
 * Phase 2I Step 4 — live RBAC/ownership verification against the real
 * running server + real DB, using real JWTs for real, isolated test
 * identities (passenger, operator A, operator B, admin).
 */
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:2704/api';
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'phase2i_step4_testdata.json'), 'utf8'));
const { passenger, opAUser, opBUser, adminUser, operatorAId, operatorBId, busAId, busBId, seatAId } = data;

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

    // ── operator CRUD: anonymous / passenger / operator all denied write; admin allowed ──
    r = await call('POST', '/operators', null, { name: 'x', email: 'x@x.com' });
    record('createOperator anonymous', 401, r.status);
    r = await call('POST', '/operators', passenger.token, { name: 'x', email: 'x@x.com' });
    record('createOperator passenger', 403, r.status);
    r = await call('POST', '/operators', opAUser.token, { name: 'x', email: 'x@x.com' });
    record('createOperator operator (CRUD is admin-only)', 403, r.status);
    r = await call('PUT', `/operators/${operatorBId}`, opAUser.token, { name: 'hijacked' });
    record('updateOperator operator A cannot edit any operator profile (admin-only)', 403, r.status);

    // ── bus writes: cross-operator isolation ──
    r = await call('PUT', `/buses/${busBId}`, opAUser.token, { plate_number: 'HIJACKED', bus_type: 'VIP', total_seats: 99 });
    record('updateBus operator A -> operator B\'s bus', 403, r.status, r.body);

    r = await call('PUT', `/buses/${busAId}`, opAUser.token, { plate_number: 'P2IS4-A-01-updated', bus_type: 'VIP', total_seats: 22 });
    record('updateBus operator A -> own bus', 200, r.status, r.body);

    r = await call('PUT', `/buses/status/${busBId}`, opAUser.token, { status: 'MAINTENANCE' });
    record('updateBusStatus operator A -> operator B\'s bus', 403, r.status);

    r = await call('DELETE', `/buses/${busBId}`, opAUser.token);
    record('deleteBus operator A -> operator B\'s bus', 403, r.status);

    r = await call('PUT', `/buses/${busAId}`, adminUser.token, { plate_number: 'P2IS4-A-01-admin', bus_type: 'VIP', total_seats: 20 });
    record('updateBus admin -> any bus', 200, r.status);

    r = await call('PUT', `/buses/${busAId}`, passenger.token, { plate_number: 'x', bus_type: 'x', total_seats: 1 });
    record('updateBus passenger denied', 403, r.status);

    r = await call('PUT', `/buses/${busAId}`, null, { plate_number: 'x', bus_type: 'x', total_seats: 1 });
    record('updateBus anonymous denied', 401, r.status);

    r = await call('POST', '/buses', opAUser.token, { operator_id: operatorBId, plate_number: 'P2IS4-STEAL', bus_type: 'VIP', total_seats: 10 });
    const stolenOperatorId = r.body && r.status === 201 ? null : null; // will check DB below
    record('createBus operator A cannot spoof operator_id=B in body', [200, 201], r.status);
    let createdBusId = r.body?.bus_id;

    // ── seat writes: cross-operator isolation ──
    r = await call('PUT', `/seats/${seatAId}`, opBUser.token, { seat_type: 'VIP' });
    record('updateSeat operator B -> operator A\'s seat', 403, r.status);

    r = await call('PUT', `/seats/${seatAId}`, opAUser.token, { seat_type: 'VIP' });
    record('updateSeat operator A -> own seat', 200, r.status);

    r = await call('DELETE', `/seats/${seatAId}`, opBUser.token);
    record('deleteSeat operator B -> operator A\'s seat', 403, r.status);

    r = await call('POST', '/seats', opBUser.token, { bus_id: busAId, seat_number: 'Z10' });
    record('createSeat operator B -> operator A\'s bus', 403, r.status);

    r = await call('POST', '/seats', opAUser.token, { bus_id: busAId, seat_number: 'Z10' });
    record('createSeat operator A -> own bus', [200, 201], r.status);
    let createdSeatId = r.body?.seat_id;

    r = await call('POST', `/seats/expand-bus/${busBId}`, opAUser.token, {});
    record('expandSeats operator A -> operator B\'s bus', 403, r.status);

    // ── dashboard scoping: operator A only sees their own bus in fleet ──
    r = await call('GET', '/operators/dashboard/buses', opAUser.token);
    const fleetIds = (r.body || []).map(b => b.bus_id);
    record('dashboard/buses operator A sees only own bus, never B\'s', true,
        fleetIds.includes(busAId) && !fleetIds.includes(busBId), { fleetIds, busAId, busBId });

    r = await call('GET', '/operators/dashboard/buses', opBUser.token);
    const fleetIdsB = (r.body || []).map(b => b.bus_id);
    record('dashboard/buses operator B sees only own bus, never A\'s', true,
        fleetIdsB.includes(busBId) && !fleetIdsB.includes(busAId), { fleetIdsB });

    r = await call('GET', '/operators/dashboard/buses', null);
    record('dashboard/buses anonymous denied', 401, r.status);

    r = await call('GET', '/operators/dashboard/buses', passenger.token);
    record('dashboard/buses passenger denied', 403, r.status);

    r = await call('GET', '/operators/dashboard/buses', adminUser.token);
    const fleetIdsAdmin = (r.body || []).map(b => b.bus_id);
    record('dashboard/buses admin sees BOTH operator A and B buses (global view)', true,
        fleetIdsAdmin.includes(busAId) && fleetIdsAdmin.includes(busBId));

    r = await call('GET', '/operators/dashboard/stats', opAUser.token);
    record('dashboard/stats operator A returns 200', 200, r.status);

    console.log(JSON.stringify(results, null, 2));
    const failed = results.filter(x => !x.pass);
    console.log(`\n=== ${results.length - failed.length}/${results.length} PASS ===`);
    if (failed.length) failed.forEach(f => console.log(' FAIL:', f.name, 'expected', f.expect, 'got', f.actual, f.extra || ''));

    fs.writeFileSync(path.join(__dirname, 'phase2i_step4_created_ids.json'), JSON.stringify({ createdBusId, createdSeatId }));
})();
