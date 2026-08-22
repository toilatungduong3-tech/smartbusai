'use strict';
/**
 * Phase 2I Step 3A — live RBAC/IDOR verification matrix against the real
 * running server (localhost:2704) using real JWTs for isolated test users.
 * Read/probe only except where explicitly noted (booking 102 is disposable
 * test data created for this purpose).
 */
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:2704/api';
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'phase2i_step3_testdata.json'), 'utf8'));
const { userA, userB, userAdminSeed, userOperatorSeed, testBooking } = data;

const results = [];
function record(section, name, expectStatus, actualStatus, extra) {
    const pass = Array.isArray(expectStatus) ? expectStatus.includes(actualStatus) : expectStatus === actualStatus;
    results.push({ section, name, expectStatus, actualStatus, pass, extra });
}

async function call(method, path, token, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, body: json };
}

(async () => {
    const bId = testBooking.booking_id;

    // ── A. BOOKING OWNERSHIP ──
    let r;
    r = await call('POST', `/bookings/${bId}/pay`, null, { method: 'BANK' });
    record('A', 'payBooking unauthenticated', 401, r.status);

    r = await call('POST', `/bookings/${bId}/pay`, userB.token, { method: 'BANK' });
    record('A', 'payBooking wrong user (B pays A\'s booking)', 403, r.status, r.body);

    r = await call('GET', `/bookings/${bId}/qr`, userB.token);
    record('A', 'getBookingQR wrong user', 403, r.status, r.body);

    r = await call('GET', `/bookings/${bId}/qr`, null);
    record('A', 'getBookingQR unauthenticated', 401, r.status);

    r = await call('PUT', `/bookings/${bId}`, userB.token, { status: 'CANCELED' });
    record('A', 'updateBookingStatus wrong user cancels A\'s booking', 403, r.status, r.body);

    r = await call('PUT', `/bookings/999999`, userA.token, { status: 'CANCELED' });
    record('A', 'updateBookingStatus nonexistent booking', 404, r.status);

    r = await call('PUT', `/bookings/${bId}`, userA.token, { status: 'HACKED' });
    record('A', 'updateBookingStatus invalid status value', 422, r.status, r.body);

    r = await call('POST', `/bookings/${bId}/service-order`, userB.token, { items: [{ id: 'nuoc-suoi', qty: 1, price: 1 }] });
    record('A', 'addServiceOrder wrong user', 403, r.status, r.body);

    r = await call('POST', `/bookings/${bId}/service-order`, userA.token, { items: [{ id: 'nuoc-suoi', qty: 1, price: 999999 }] });
    record('A', 'addServiceOrder owner, spoofed price — check body', r.status === 200 ? 200 : r.status, r.status, r.body);

    r = await call('GET', `/bookings/user/${userA.user.user_id}`, userB.token);
    record('A', 'getBookingsByUser cross-user (B reads A\'s list)', 403, r.status, r.body);

    r = await call('GET', `/bookings/user/${userA.user.user_id}`, userA.token);
    record('A', 'getBookingsByUser owner reads own list', 200, r.status);

    r = await call('GET', `/bookings/user/${userA.user.user_id}`, userAdminSeed.token);
    record('A', 'getBookingsByUser ADMIN reads any list', 200, r.status);

    // ── B. PAYMENT STATUS / booking_code LEAK ──
    r = await call('GET', `/payment/status/${bId}`, null);
    const leaked = r.body && (r.body.booking_code || r.body.user_id || r.body.phone || r.body.email);
    record('B', 'payment/status no auth required (by design) — check leak', 200, r.status, { body: r.body, leaked: !!leaked });

    // ── C. PASSENGER AI / RECOMMENDATION IDENTITY ──
    r = await call('GET', `/ai/recommend/${userB.user.user_id}`, userA.token);
    record('C', 'getRecommendations A requests B\'s userId via path', 403, r.status, r.body);

    r = await call('GET', `/ai/recommend/${userA.user.user_id}`, userA.token);
    record('C', 'getRecommendations A requests own userId', 200, r.status);

    r = await call('GET', `/ai/behavior/${userB.user.user_id}`, userA.token);
    record('C', 'getBehaviorProfile A requests B\'s userId via path', 403, r.status, r.body);

    r = await call('GET', `/recommendations/me?userId=${userB.user.user_id}`, userA.token);
    const idorHit = r.body && Number(r.body.userId) === Number(userB.user.user_id);
    record('C', 'getMyRecommendations A spoofs userId=B in query', false, idorHit, { returnedUserId: r.body?.userId, expected: userA.user.user_id });

    r = await call('GET', `/recommendations/me`, null);
    record('C', 'getMyRecommendations unauthenticated', 401, r.status);

    // ── D. SUPPORT ──
    r = await call('POST', `/support/requests`, userA.token, { user_id: userB.user.user_id, type: 'GENERAL', title: 'x', content: 'y' });
    const asBspoof = r.status === 201; // need to check DB who it was actually created for — handled separately
    record('D', 'createRequest A spoofs user_id=B in body (status only)', 201, r.status, r.body);

    r = await call('GET', `/support/user/${userB.user.user_id}`, userA.token);
    record('D', 'getUserRequests A reads B\'s requests', 403, r.status, r.body);

    r = await call('GET', `/support/requests`, userA.token);
    record('D', 'getAllRequests passenger (should be admin-only)', 403, r.status, r.body);

    r = await call('GET', `/support/requests`, userAdminSeed.token);
    record('D', 'getAllRequests ADMIN', 200, r.status);

    r = await call('PUT', `/support/requests/1`, userA.token, { status: 'RESOLVED' });
    record('D', 'replyRequest passenger (should be admin-only)', 403, r.status, r.body);

    // ── E. REVIEWS ──
    r = await call('POST', `/reviews`, userA.token, { user_id: userB.user.user_id, trip_id: 38, rating: 5, comment: 'spoof test' });
    record('E', 'createReview A spoofs user_id=B (status only, DB checked separately)', 200, r.status, r.body);

    r = await call('POST', `/reviews`, null, { user_id: userA.user.user_id, trip_id: 38, rating: 5 });
    record('E', 'createReview unauthenticated', 401, r.status);

    // ── F. SEARCH ANALYTICS ──
    r = await call('GET', `/search/analytics`, null);
    record('F', 'search/analytics anonymous', 401, r.status);

    r = await call('GET', `/search/analytics`, userA.token);
    record('F', 'search/analytics passenger', 403, r.status);

    r = await call('GET', `/search/analytics`, userOperatorSeed.token);
    record('F', 'search/analytics operator (admin-only)', 403, r.status);

    r = await call('GET', `/search/analytics`, userAdminSeed.token);
    record('F', 'search/analytics admin', 200, r.status);

    // ── G. SETTINGS ──
    r = await call('POST', `/settings`, null, { maintenanceMode: true });
    record('G', 'settings mutation anonymous', 401, r.status);

    r = await call('POST', `/settings`, userA.token, { _phase2i_probe: true });
    record('G', 'settings mutation passenger', 403, r.status);

    r = await call('GET', `/settings`, null);
    record('G', 'settings read anonymous (public by design)', 200, r.status);

    console.log(JSON.stringify(results, null, 2));
    const failed = results.filter(r => !r.pass);
    console.log(`\n=== ${results.length - failed.length}/${results.length} PASS ===`);
    if (failed.length) {
        console.log('FAILED:');
        failed.forEach(f => console.log(` - [${f.section}] ${f.name}: expected ${JSON.stringify(f.expectStatus)}, got ${f.actualStatus}`, f.extra || ''));
    }
})();
