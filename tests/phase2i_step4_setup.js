'use strict';
/**
 * Phase 2I Step 4 — create isolated test identities + isolated
 * bus_operator/bus/seat test fixtures for live operator-isolation testing.
 * All rows are uniquely tagged (phase2i_step4_ prefix / test.local emails)
 * and tracked for cleanup.
 */
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:2704/api';
const db = require('../server/config/db');
const outFile = path.join(__dirname, 'phase2i_step4_testdata.json');

async function j(url, opts) {
    const res = await fetch(url, opts);
    let body = null;
    try { body = await res.json(); } catch {}
    return { status: res.status, body };
}
async function registerAndLogin(suffix) {
    const username = `phase2i_step4_${suffix}`;
    const email = `phase2i_step4_${suffix}@test.local`;
    const password = 'TestPass123!';
    await j(`${BASE}/auth/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, full_name: `Phase2I S4 ${suffix}`, email, password, phone: '0911' + suffix.padStart(6, '0') })
    });
    const login = await j(`${BASE}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });
    return { username, email, password, token: login.body?.accessToken, user: login.body?.user };
}

(async () => {
    const passenger = await registerAndLogin('passenger');
    const opAUser = await registerAndLogin('opA');
    const opBUser = await registerAndLogin('opB');
    const adminUser = await registerAndLogin('admin');

    await db.query("UPDATE users SET role='OPERATOR' WHERE user_id=? AND username=?", [opAUser.user.user_id, opAUser.username]);
    await db.query("UPDATE users SET role='OPERATOR' WHERE user_id=? AND username=?", [opBUser.user.user_id, opBUser.username]);
    await db.query("UPDATE users SET role='ADMIN' WHERE user_id=? AND username=?", [adminUser.user.user_id, adminUser.username]);

    // Create isolated bus_operator rows whose email matches each operator account.
    const [opAResult] = await db.query(
        "INSERT INTO bus_operator (name,address,phone,email,status) VALUES (?,?,?,?,'ACTIVE')",
        ['Phase2I Step4 Operator A', 'Test address A', '0900000001', opAUser.email]
    );
    const [opBResult] = await db.query(
        "INSERT INTO bus_operator (name,address,phone,email,status) VALUES (?,?,?,?,'ACTIVE')",
        ['Phase2I Step4 Operator B', 'Test address B', '0900000002', opBUser.email]
    );
    const operatorAId = opAResult.insertId;
    const operatorBId = opBResult.insertId;

    // One bus each, owned by their respective operator.
    const [busAResult] = await db.query(
        "INSERT INTO bus (operator_id, plate_number, bus_type, total_seats, status) VALUES (?,?,?,?,'AVAILABLE')",
        [operatorAId, 'P2IS4-A-01', 'VIP', 20]
    );
    const [busBResult] = await db.query(
        "INSERT INTO bus (operator_id, plate_number, bus_type, total_seats, status) VALUES (?,?,?,?,'AVAILABLE')",
        [operatorBId, 'P2IS4-B-01', 'VIP', 20]
    );
    const busAId = busAResult.insertId;
    const busBId = busBResult.insertId;

    // One seat on bus A, for delete/update ownership tests.
    const [seatAResult] = await db.query(
        "INSERT INTO seat (bus_id, seat_number, seat_type) VALUES (?,?,?)", [busAId, 'Z9', 'NORMAL']
    );
    const seatAId = seatAResult.insertId;

    // Re-login opA/opB/admin now that roles changed, to get JWTs with the correct role claim.
    async function relogin(u) {
        const login = await j(`${BASE}/auth/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: u.email, password: u.password })
        });
        u.token = login.body?.accessToken;
        u.user = login.body?.user;
        return u;
    }
    await relogin(opAUser);
    await relogin(opBUser);
    await relogin(adminUser);

    const data = { passenger, opAUser, opBUser, adminUser, operatorAId, operatorBId, busAId, busBId, seatAId };
    fs.writeFileSync(outFile, JSON.stringify(data, null, 2));
    console.log(JSON.stringify({
        passenger: passenger.user?.user_id, opA: { user: opAUser.user?.user_id, role: opAUser.user?.role, operator_id: opAUser.user?.operator_id },
        opB: { user: opBUser.user?.user_id, role: opBUser.user?.role, operator_id: opBUser.user?.operator_id },
        admin: { user: adminUser.user?.user_id, role: adminUser.user?.role },
        operatorAId, operatorBId, busAId, busBId, seatAId
    }, null, 2));
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
