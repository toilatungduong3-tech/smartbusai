'use strict';
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

(async () => {
    const data = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    for (const key of ['userAdminSeed', 'userOperatorSeed']) {
        const login = await j(`${BASE}/auth/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: data[key].email, password: data[key].password })
        });
        data[key].token = login.body?.accessToken;
        data[key].user = login.body?.user;
        console.log(key, { status: login.status, role: login.body?.user?.role, user_id: login.body?.user?.user_id });
    }
    fs.writeFileSync(outFile, JSON.stringify(data, null, 2));
})();
