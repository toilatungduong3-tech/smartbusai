'use strict';
/**
 * Phase 2I Step 3E — real password-reset flow verification against the
 * live server. Uses the dedicated test user (userA) only.
 */
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:2704/api';
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'phase2i_step3_testdata.json'), 'utf8'));
const { userA } = data;

async function call(method, p, body) {
    const res = await fetch(`${BASE}${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, body: json };
}
async function sql(q, params) {
    const db = require('../server/config/db');
    const [rows] = await db.query(q, params);
    return rows;
}

(async () => {
    const results = [];

    // 1. known email vs unknown email — response shape must be equivalent
    const rKnown = await call('POST', '/auth/check-email', { email: userA.email });
    const rUnknown = await call('POST', '/auth/check-email', { email: 'phase2i_definitely_does_not_exist@test.local' });
    results.push({
        test: 'known vs unknown email response equivalence',
        knownStatus: rKnown.status, unknownStatus: rUnknown.status,
        knownMsg: rKnown.body?.message, unknownMsg: rUnknown.body?.message,
        PASS: rKnown.status === rUnknown.status && rKnown.body?.message === rUnknown.body?.message,
    });

    // 2. fetch the raw token from DB (dev-mode equivalent of reading the logged/emailed token)
    const tokenRows = await sql('SELECT id, token_hash, expires_at, used_at FROM password_reset_tokens WHERE user_id=? ORDER BY id DESC LIMIT 1', [userA.user.user_id]);
    results.push({ test: 'reset token row created', found: tokenRows.length === 1, row: tokenRows[0] });

    // We don't have the raw token (only its hash is stored) — grab it from the server log where checkEmail logs it for dev.
    const log = fs.readFileSync('C:\\Users\\admin\\AppData\\Local\\Temp\\smartbus_server.log', 'utf8');
    const tokenMatches = [...log.matchAll(/\[PasswordReset\] Token cho [^:]+:\s*([A-Za-z0-9_-]{16,})/gi)];
    results.push({ test: 'dev-mode token logging present', matchCount: tokenMatches.length, sampleLine: tokenMatches.length ? tokenMatches[tokenMatches.length - 1][0] : null });

    let rawToken = tokenMatches.length ? tokenMatches[tokenMatches.length - 1][1] : null;

    // 3. wrong token rejected
    const rWrong = await call('POST', '/auth/reset-password', { token: 'totally-invalid-token-value', new_password: 'NewPass123!' });
    results.push({ test: 'wrong token rejected', status: rWrong.status, PASS: rWrong.status >= 400 });

    // 4. empty token rejected
    const rEmpty = await call('POST', '/auth/reset-password', { token: '', new_password: 'NewPass123!' });
    results.push({ test: 'empty token rejected', status: rEmpty.status, PASS: rEmpty.status >= 400 });

    if (rawToken) {
        // 5. expired token rejected — force-expire via DB (isolated to this one token row)
        await sql('UPDATE password_reset_tokens SET expires_at=DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id=?', [tokenRows[0].id]);
        const rExpired = await call('POST', '/auth/reset-password', { token: rawToken, new_password: 'NewPass123!' });
        results.push({ test: 'expired token rejected', status: rExpired.status, PASS: rExpired.status >= 400 });

        // restore expiry, then do the real successful-reset test
        await sql('UPDATE password_reset_tokens SET expires_at=DATE_ADD(NOW(), INTERVAL 15 MINUTE) WHERE id=?', [tokenRows[0].id]);
        const rReset = await call('POST', '/auth/reset-password', { token: rawToken, new_password: 'NewPassAfterReset123!' });
        results.push({ test: 'valid token resets password', status: rReset.status, PASS: rReset.status === 200 });

        // 6. old password stops working
        const rOldLogin = await call('POST', '/auth/login', { email: userA.email, password: userA.password });
        results.push({ test: 'old password rejected after reset', status: rOldLogin.status, PASS: rOldLogin.status !== 200 });

        // 7. new password works
        const rNewLogin = await call('POST', '/auth/login', { email: userA.email, password: 'NewPassAfterReset123!' });
        results.push({ test: 'new password accepted', status: rNewLogin.status, PASS: rNewLogin.status === 200 });
        if (rNewLogin.body?.accessToken) { userA.token = rNewLogin.body.accessToken; userA.password = 'NewPassAfterReset123!'; }

        // 8. token single-use — replay
        const rReplay = await call('POST', '/auth/reset-password', { token: rawToken, new_password: 'YetAnotherPass123!' });
        results.push({ test: 'token replay rejected (single-use)', status: rReplay.status, PASS: rReplay.status >= 400 });
    } else {
        results.push({ test: 'SKIPPED remaining token-dependent tests', reason: 'raw token not found in server log — see note' });
    }

    console.log(JSON.stringify(results, null, 2));
    const withPass = results.filter(r => 'PASS' in r);
    console.log(`\n=== ${withPass.filter(r => r.PASS).length}/${withPass.length} PASS (of testable items) ===`);

    fs.writeFileSync(path.join(__dirname, 'phase2i_step3_testdata.json'), JSON.stringify(data, null, 2));
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
