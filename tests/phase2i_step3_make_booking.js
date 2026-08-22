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
    const res = await j(`${BASE}/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.userA.token}` },
        body: JSON.stringify({ user_id: data.userA.user.user_id, trip_id: 38, seats: [254], status: 'PENDING' })
    });
    console.log('create booking:', res.status, res.body);
    data.testBooking = { trip_id: 38, seat_id: 254, ...res.body };
    fs.writeFileSync(outFile, JSON.stringify(data, null, 2));
})();
