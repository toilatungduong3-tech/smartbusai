'use strict';
/**
 * Phase 2I Step 3B — payment amount-tampering + state-machine runtime test
 * against the real server + real DB. Creates its own disposable PENDING
 * bookings (does not touch booking 102 or any real/demo data).
 */
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:2704/api';
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'phase2i_step3_testdata.json'), 'utf8'));
const { userA } = data;

async function call(method, p, token, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, body: json };
}

async function makeBooking(seatId) {
    const r = await call('POST', '/bookings', userA.token, { user_id: userA.user.user_id, trip_id: 38, seats: [seatId], status: 'PENDING' });
    return r.body;
}

(async () => {
    const results = [];
    const createdBookingIds = [];

    // 1. amount tampering — real booking total is 60000
    const bk1 = await makeBooking(255);
    createdBookingIds.push(bk1.booking_id);
    for (const amount of [1, 1000, 0, -1, 999999999]) {
        const r = await call('POST', '/payment/create', null, { booking_id: bk1.booking_id, payment_method: 'vnpay', amount });
        // Extract the actual amount VNPay was asked to charge from the payUrl (vnp_Amount is amount*100)
        let gatewayAmount = null;
        if (r.body?.payUrl) {
            const m = r.body.payUrl.match(/vnp_Amount=(\d+)/);
            if (m) gatewayAmount = Number(m[1]) / 100;
        }
        results.push({ test: `create with amount=${amount}`, status: r.status, gatewayAmount, expectedGatewayAmount: 60000, pass: r.status !== 200 || gatewayAmount === 60000 });
    }

    // 2. eligibility: PENDING / PAID / CANCELED / nonexistent
    const rPending = await call('POST', '/payment/create', null, { booking_id: bk1.booking_id, payment_method: 'vietqr' });
    results.push({ test: 'create for PENDING booking', status: rPending.status, expect: 200, pass: rPending.status === 200 });

    // pay it via payBooking to flip to PAID, then retry /create
    await call('POST', `/bookings/${bk1.booking_id}/pay`, userA.token, { method: 'BANK' });
    const rPaid = await call('POST', '/payment/create', null, { booking_id: bk1.booking_id, payment_method: 'vietqr' });
    results.push({ test: 'create for already-PAID booking', status: rPaid.status, expect: 409, pass: rPaid.status === 409 });

    const bk2 = await makeBooking(256);
    createdBookingIds.push(bk2.booking_id);
    await call('PUT', `/bookings/${bk2.booking_id}`, userA.token, { status: 'CANCELED' });
    const rCanceled = await call('POST', '/payment/create', null, { booking_id: bk2.booking_id, payment_method: 'vietqr' });
    results.push({ test: 'create for CANCELED booking', status: rCanceled.status, expect: 409, pass: rCanceled.status === 409 });

    const rMissing = await call('POST', '/payment/create', null, { booking_id: 999999, payment_method: 'vietqr' });
    results.push({ test: 'create for nonexistent booking', status: rMissing.status, expect: 404, pass: rMissing.status === 404 });

    console.log(JSON.stringify(results, null, 2));
    const failed = results.filter(r => !r.pass);
    console.log(`\n=== ${results.length - failed.length}/${results.length} PASS ===`);
    console.log('createdBookingIds (for cleanup):', createdBookingIds);

    fs.writeFileSync(path.join(__dirname, 'phase2i_step3_payment_bookings.json'), JSON.stringify(createdBookingIds));
})();
