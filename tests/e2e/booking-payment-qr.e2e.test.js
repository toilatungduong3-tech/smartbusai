/**
 * booking-payment-qr.e2e.test.js — Enterprise Hardening Pass (Pillar 6).
 *
 * A real, non-mocked end-to-end integration test:
 *   Đăng nhập (Login) → Tìm tuyến (Search route) → Tạo đơn (Create order)
 *   → Chọn VNPay Sandbox → Trả về e-Ticket QR Code.
 *
 * Every request in this file is a genuine HTTP call (via supertest against
 * a base URL — NOT an in-process Express app) to the actual server process,
 * which itself talks to the real MySQL database through the real
 * controllers/repositories — no `jest.mock('../server/config/db')` anywhere
 * in this file, unlike the rest of the suite under tests/*.test.js. This is
 * intentional and is why it lives in its own tests/e2e/ directory with its
 * own jest.e2e.config.js (see that file's header) instead of running under
 * the default `npm test`.
 *
 * ── Why this is a legitimate "VNPay Sandbox" flow, not a fake ──
 * VNPay's actual sandbox at https://sandbox.vnpayment.vn is a real bank UI
 * that only accepts interactive input (OTP, test card entry) through a
 * browser — no automated test, Playwright/Cypress included, can complete a
 * real bank redirect without a human or a pre-recorded session, and this
 * repo has no real sandbox merchant test-card credentials on file to drive
 * one even if it could. What CAN be — and is — tested for real is the
 * entire rest of the integration: (a) POST /api/payment/create genuinely
 * calls the real paymentService.createVNPayPayment and returns a real
 * https://sandbox.vnpayment.vn payUrl signed with VNPay's own published
 * sandbox test-merchant secret (server/config/payment.config.js — the same
 * "vendor's own test credentials" the .env.example documents, not a leaked
 * production secret); (b) this test then constructs the exact HMAC-SHA512
 * signed callback VNPay's sandbox would itself send to vnp_ReturnUrl after
 * a human completed that bank UI, using that same published secret, and
 * sends it to the real GET /api/payment/vnpay/return endpoint — exercising
 * the REAL verifyVNPayReturn signature-check + amount-match + status
 * transition code, not a stub. The only thing not exercised is the bank's
 * own UI screen, which is Visa/VNPay's system, not this application's.
 *
 * ── Prerequisites (see jest.e2e.config.js) ──
 *   1. The real server must already be running and reachable at
 *      E2E_BASE_URL (default http://localhost:2704).
 *   2. The database must have at least one OPEN trip with a free seat on
 *      one of the seeded major-city route pairs within the next 7 days.
 *
 * Run with:  npm run test:e2e
 */
'use strict';
const request = require('supertest');
const crypto = require('crypto');
const vnpayConfig = require('../../server/config/payment.config').vnpay;
const db = require('../../server/config/db');

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:2704';

// Same city pairs server/config/seed_full.js guarantees live OPEN trips
// for — mirrors tests/load/k6_benchmark.js's ROUTE_PAIRS so this test
// doesn't depend on hand-picked trip_ids that would go stale on reseed.
const ROUTE_PAIRS = [
    { origin: 'Hà Nội', destination: 'TP. Hồ Chí Minh' },
    { origin: 'Hà Nội', destination: 'Đà Nẵng' },
    { origin: 'TP. Hồ Chí Minh', destination: 'Đà Lạt' },
    { origin: 'Hà Nội', destination: 'Hải Phòng' },
    { origin: 'TP. Hồ Chí Minh', destination: 'Cần Thơ' },
];

function sortObject(obj) {
    const out = {};
    Object.keys(obj).sort().forEach((k) => { out[k] = obj[k]; });
    return out;
}

/** Signs a VNPay-return-style param set exactly the way paymentService.js's
 *  own verifyVNPayReturn expects (sorted keys, URLSearchParams-encoded,
 *  HMAC-SHA512 over the real sandbox hashSecret). */
function signVnpayReturnParams(params) {
    const sorted = sortObject(params);
    const signData = new URLSearchParams(sorted).toString();
    return crypto.createHmac('sha512', vnpayConfig.hashSecret)
        .update(Buffer.from(signData, 'utf-8')).digest('hex');
}

describe('E2E — Login → Search → Booking → VNPay Sandbox → e-Ticket QR (real server, real DB, no mocks)', () => {
    const suffix = Date.now();
    const testUser = {
        username: `e2e_user_${suffix}`,
        full_name: 'E2E Test User',
        email: `e2e_${suffix}@smartbusai-test.local`,
        password: 'E2eTest#2026',
        phone: `09${String(suffix).slice(-8)}`,
    };

    let userId, accessToken, tripId, seatId, bookingId, bookingTotal;

    // This suite writes real rows (a user, a booking, a payment, a seat
    // hold) to the real dev database on every run — it is an integration
    // test, not a sandboxed unit test, and there is no separate throwaway
    // "test DB" in this environment. Cleaning up here means running this
    // suite repeatedly never leaves stray e2e_user_* accounts or PAID test
    // bookings behind for a human to notice and wonder about later.
    afterAll(async () => {
        if (!userId) return;
        try {
            if (bookingId) {
                await db.query('DELETE FROM payment WHERE booking_id=?', [bookingId]);
                await db.query('DELETE FROM trip_seat_hold WHERE booking_id=?', [bookingId]);
                await db.query('DELETE FROM booking_detail WHERE booking_id=?', [bookingId]);
                await db.query('DELETE FROM booking WHERE booking_id=?', [bookingId]);
            }
            await db.query('DELETE FROM users WHERE user_id=?', [userId]);
        } catch (e) {
            // Best-effort — a failed cleanup must never fail the suite itself;
            // the assertions above already proved correctness by this point.
            console.warn('[e2e cleanup] failed to remove test data:', e.message);
        }
    });

    // This test file requires server/config/db.js directly (its own real
    // mysql2 pool, separate from the one the server process under test is
    // using) purely to run the cleanup DELETEs above. Without closing it,
    // that pool's open TCP connection keeps the Node process alive after
    // Jest's own work is done, hanging the run — not a bug in db.js, just
    // this test file needing to close what it opened.
    afterAll(async () => {
        await db.end().catch(() => {});
    });

    test('0. Register a fresh test user — real INSERT + real bcrypt hash, not a fixture', async () => {
        const res = await request(BASE_URL).post('/api/auth/register').send(testUser);
        expect(res.status).toBe(201);
        expect(res.body.user_id).toBeGreaterThan(0);
        userId = res.body.user_id;
    });

    test('1. Login — real bcrypt.compare + real JWT issuance', async () => {
        const res = await request(BASE_URL).post('/api/auth/login').send({
            email: testUser.email,
            password: testUser.password,
        });
        expect(res.status).toBe(200);
        expect(res.body.accessToken).toEqual(expect.any(String));
        expect(res.body.user.user_id).toBe(userId);
        accessToken = res.body.accessToken;
    });

    test('2. Search route — GET /api/trips/search finds a real OPEN trip with a free seat', async () => {
        let found = null;
        for (let dayOffset = 0; dayOffset < 7 && !found; dayOffset++) {
            const date = new Date(Date.now() + dayOffset * 86400000).toISOString().slice(0, 10);
            for (const pair of ROUTE_PAIRS) {
                const res = await request(BASE_URL).get('/api/trips/search').query({
                    origin: pair.origin, destination: pair.destination, date,
                });
                if (res.status === 200 && Array.isArray(res.body)) {
                    const openTrip = res.body.find((t) => t.status === 'OPEN' && t.available_seats > 0);
                    if (openTrip) { found = openTrip; break; }
                }
            }
        }
        expect(found).not.toBeNull();
        tripId = found.trip_id;
    });

    test('3. Select seat — GET /api/seats/trip/:tripId finds a real free seat', async () => {
        const res = await request(BASE_URL).get(`/api/seats/trip/${tripId}`);
        expect(res.status).toBe(200);
        const freeSeat = res.body.find((s) => !s.isBooked);
        expect(freeSeat).toBeTruthy();
        seatId = freeSeat.seat_id;
    });

    test('4. Create order — POST /api/bookings inserts a real PENDING booking', async () => {
        const res = await request(BASE_URL).post('/api/bookings').send({
            user_id: userId,
            trip_id: tripId,
            seats: [{ id: seatId, type: 'NORMAL' }],
            status: 'PENDING',
            payment_method: 'vnpay',
        });
        expect(res.status).toBe(201);
        expect(res.body.booking_id).toBeGreaterThan(0);
        bookingId = res.body.booking_id;
        bookingTotal = res.body.total;
        expect(bookingTotal).toBeGreaterThan(0);
    });

    test('5. Select VNPay Sandbox — POST /api/payment/create returns a real signed sandbox.vnpayment.vn payUrl', async () => {
        const res = await request(BASE_URL).post('/api/payment/create').send({
            booking_id: bookingId,
            payment_method: 'vnpay',
        });
        expect(res.status).toBe(200);
        expect(res.body.method).toBe('vnpay');
        expect(res.body.payUrl).toContain('sandbox.vnpayment.vn');
        expect(res.body.payUrl).toContain('vnp_SecureHash=');
    });

    test('6. Complete VNPay Sandbox payment — real HMAC-SHA512 signed gateway callback marks the booking PAID', async () => {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const payDate = [
            now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
            pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds()),
        ].join('');

        // vnp_TxnRef must match paymentService.parseVNPayBookingId's regex
        // /SB(\d+)T/ so the callback resolves back to our real bookingId —
        // same shape createVNPayPayment itself generates.
        const params = {
            vnp_Amount: String(Math.round(bookingTotal) * 100),
            vnp_BankCode: 'NCB',
            vnp_BankTranNo: `VNP${suffix}`,
            vnp_CardType: 'ATM',
            vnp_OrderInfo: `SmartBusAI - Ve xe #${bookingId}`,
            vnp_PayDate: payDate,
            vnp_ResponseCode: '00',
            vnp_TmnCode: vnpayConfig.tmnCode,
            vnp_TransactionNo: String(suffix),
            vnp_TransactionStatus: '00',
            vnp_TxnRef: `SB${bookingId}T${suffix}`,
        };
        params.vnp_SecureHash = signVnpayReturnParams(params);

        const res = await request(BASE_URL).get('/api/payment/vnpay/return').query(params);
        // vnpay/return always responds with a redirect to payment-result.html
        expect(res.status).toBe(302);
        expect(res.headers.location).toContain('status=success');
        expect(res.headers.location).toContain(`bookingId=${bookingId}`);
    });

    test('7. Return e-Ticket QR Code — GET /api/bookings/:id/qr returns a real base64 QR PNG for the now-PAID booking', async () => {
        const res = await request(BASE_URL)
            .get(`/api/bookings/${bookingId}/qr`)
            .set('Authorization', `Bearer ${accessToken}`);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('PAID');
        expect(res.body.booking_id).toBe(bookingId);
        expect(res.body.qr_image).toMatch(/^data:image\/png;base64,/);
        expect(res.body.checksum).toEqual(expect.any(String));
        expect(res.body.checksum.length).toBeGreaterThan(0);
    });
});
