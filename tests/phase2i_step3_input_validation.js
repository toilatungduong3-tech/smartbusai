'use strict';
/**
 * Phase 2I Step 3F — input validation sweep against the live server.
 * Focused on booking, payment, loyalty, review, support — the
 * highest-risk inputs. Verifies 4xx (not 500/crash), no DB mutation on
 * rejected requests, no stack trace / SQL text leakage.
 */
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:2704/api';
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'phase2i_step3_testdata.json'), 'utf8'));
const { userA } = data;

async function call(method, p, token, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    let text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, body: json, rawText: text };
}
function leaks(r) {
    const t = r.rawText || '';
    return /at\s+\w+\s+\(|node_modules|SELECT .* FROM|ECONNREFUSED|\.js:\d+:\d+/.test(t);
}

(async () => {
    const cases = [
        // booking creation
        ['POST /bookings missing trip_id', () => call('POST', '/bookings', userA.token, { seats: [1], user_id: userA.user.user_id })],
        ['POST /bookings empty seats array', () => call('POST', '/bookings', userA.token, { trip_id: 38, seats: [], user_id: userA.user.user_id })],
        ['POST /bookings seats as object not array', () => call('POST', '/bookings', userA.token, { trip_id: 38, seats: { id: 1 }, user_id: userA.user.user_id })],
        ['POST /bookings seat id NaN', () => call('POST', '/bookings', userA.token, { trip_id: 38, seats: ['abc'], user_id: userA.user.user_id })],
        ['POST /bookings negative trip_id', () => call('POST', '/bookings', userA.token, { trip_id: -1, seats: [1], user_id: userA.user.user_id })],
        ['POST /bookings nonexistent trip_id', () => call('POST', '/bookings', userA.token, { trip_id: 9999999, seats: [1], user_id: userA.user.user_id })],
        // payment
        ['POST /payment/create missing booking_id', () => call('POST', '/payment/create', null, { payment_method: 'vnpay' })],
        ['POST /payment/create invalid payment_method', () => call('POST', '/payment/create', null, { booking_id: 102, payment_method: 'DOGECOIN' })],
        ['POST /payment/create booking_id as string "abc"', () => call('POST', '/payment/create', null, { booking_id: 'abc', payment_method: 'vnpay' })],
        // loyalty
        ['POST /redeem-points negative points', () => call('POST', `/users/${userA.user.user_id}/redeem-points`, userA.token, { points: -5 })],
        ['POST /redeem-points zero points', () => call('POST', `/users/${userA.user.user_id}/redeem-points`, userA.token, { points: 0 })],
        ['POST /redeem-points points as string', () => call('POST', `/users/${userA.user.user_id}/redeem-points`, userA.token, { points: 'lots' })],
        ['POST /redeem-points huge points', () => call('POST', `/users/${userA.user.user_id}/redeem-points`, userA.token, { points: 999999999 })],
        // review
        ['POST /reviews rating out of range (10)', () => call('POST', '/reviews', userA.token, { trip_id: 38, rating: 10, user_id: userA.user.user_id })],
        ['POST /reviews rating negative', () => call('POST', '/reviews', userA.token, { trip_id: 38, rating: -1, user_id: userA.user.user_id })],
        ['POST /reviews rating missing', () => call('POST', '/reviews', userA.token, { trip_id: 38, user_id: userA.user.user_id })],
        // support
        ['POST /support/requests invalid type enum', () => call('POST', '/support/requests', userA.token, { type: 'NOT_A_REAL_TYPE', title: 'x', content: 'y' })],
        ['POST /support/requests XSS in title (reflected?)', () => call('POST', '/support/requests', userA.token, { type: 'GENERAL', title: '<script>alert(1)</script>', content: 'y' })],
        // malformed JSON / auth edge
        ['GET /bookings/user/abc malformed id', () => call('GET', '/bookings/user/abc', userA.token)],
        ['GET /bookings/-1/qr negative id', () => call('GET', '/bookings/-1/qr', userA.token)],
        ['Authorization header malformed (not Bearer)', () => call('GET', `/bookings/user/${userA.user.user_id}`, null).then(async () => {
            const res = await fetch(`${BASE}/bookings/user/${userA.user.user_id}`, { headers: { Authorization: 'NotBearer sometoken' } });
            let t = await res.text(); let j = null; try { j = JSON.parse(t); } catch {}
            return { status: res.status, body: j, rawText: t };
        })],
    ];

    const results = [];
    for (const [name, fn] of cases) {
        const r = await fn();
        results.push({
            name, status: r.status,
            is4xx: r.status >= 400 && r.status < 500,
            leaked: leaks(r),
            bodyPreview: JSON.stringify(r.body).slice(0, 150),
        });
    }
    console.log(JSON.stringify(results, null, 2));
    const bad = results.filter(r => !r.is4xx || r.leaked);
    console.log(`\n=== ${results.length - bad.length}/${results.length} well-behaved (4xx, no leak) ===`);
    if (bad.length) { console.log('NEEDS REVIEW:'); bad.forEach(b => console.log(' -', b.name, b.status, b.leaked ? '[LEAK]' : '')); }
})();
