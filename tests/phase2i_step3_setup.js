'use strict';
/**
 * Phase 2I — Step 3: create isolated, uniquely-identifiable test users via
 * the real register/login endpoints against the running server. Writes
 * tokens + ids to phase2i_step3_testdata.json for the runtime test scripts
 * to consume. cleanup script removes everything by the 'phase2i_step3_'
 * username prefix.
 */
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:2704/api';
const outFile = path.join(__dirname, 'phase2i_step3_testdata.json');

async function j(url, opts) {
    const res = await fetch(url, opts);
    let body = null;
    try { body = await res.json(); } catch {}
    return { status: res.status, body };
}

async function registerAndLogin(suffix) {
    const username = `phase2i_step3_${suffix}`;
    const email = `phase2i_step3_${suffix}@test.local`;
    const password = 'TestPass123!';
    const reg = await j(`${BASE}/auth/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, full_name: `Phase2I Test ${suffix}`, email, password, phone: '0900000' + suffix.padStart(3, '0') })
    });
    const login = await j(`${BASE}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });
    return { username, email, password, registerStatus: reg.status, registerBody: reg.body, loginStatus: login.status, token: login.body?.accessToken, user: login.body?.user };
}

(async () => {
    const userA = await registerAndLogin('userA');
    const userB = await registerAndLogin('userB');
    const userAdminSeed = await registerAndLogin('adminseed');
    const userOperatorSeed = await registerAndLogin('operatorseed');
    console.log('userA:', { status: userA.registerStatus, login: userA.loginStatus, user_id: userA.user?.user_id, token: !!userA.token });
    console.log('userB:', { status: userB.registerStatus, login: userB.loginStatus, user_id: userB.user?.user_id, token: !!userB.token });
    console.log('userAdminSeed:', { user_id: userAdminSeed.user?.user_id });
    console.log('userOperatorSeed:', { user_id: userOperatorSeed.user?.user_id });

    fs.writeFileSync(outFile, JSON.stringify({ userA, userB, userAdminSeed, userOperatorSeed }, null, 2));
    console.log('Written to', outFile);
})();
