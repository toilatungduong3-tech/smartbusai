'use strict';
/**
 * TRUTHNODE — SPRINT 8: Topbar UI Fix, All-in-One Payments, Social Auth &
 * Avatar Sync.
 *
 * Covers what's actually new this sprint (Sprint 7's phase7 test file
 * already covers Google/Facebook token verification, password strength,
 * logout revocation; Phase 2I's phase2i-payment-amount-tampering.test.js
 * already covers the /create price-tampering fix for momo/vnpay — this
 * file does not re-test either):
 *   1. Real HMAC checksum/signature logic for MoMo, VNPay, and the new
 *      ZaloPay integration — signed correctly -> valid, tampered -> invalid.
 *      Unlike every other payment test in this repo, paymentService is
 *      NOT mocked here — the whole point is exercising the real crypto.
 *   2. The new ZaloPay route wiring (POST /create zalopay branch,
 *      POST /zalopay/callback IPN, GET /zalopay/return) and the new
 *      POST /vnpay/ipn server-to-server endpoint.
 *   3. avatar_url now flowing through login/googleAuth/facebookAuth.
 *   4. POST /api/users/:id/avatar (Avatar Sync Engine).
 *
 * Mocking strategy matches phase7: every dependency mocked once at module
 * level, controlled per-test via mockResolvedValueOnce chains on the same
 * mock reference. paymentService is deliberately left un-mocked so its
 * real HMAC functions run; only `https` (outbound gateway calls) and `db`
 * are mocked, so no real network/DB is touched anywhere in this file.
 */

const crypto = require('crypto');

jest.mock('../server/config/db', () => ({ query: jest.fn() }));
const db = require('../server/config/db');

jest.mock('fs', () => ({
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
    readFileSync: jest.fn(() => { throw new Error('ENOENT'); }), // authController's login() maintenance-mode check tolerates this (try/catch, allow login)
}));
const fs = require('fs');

// Mocked once, hoisted, for the WHOLE file (never jest.resetModules()/doMock()/
// dontMock() anywhere below — see phase7-ui-auth-harmony.test.js's own header
// comment: that combination previously caused a real, hard-to-diagnose bug
// where a later require() silently picked up a fresh, unconfigured mock
// instance instead of the one earlier tests had set up).
jest.mock('https');
const https = require('https');

const mockVerifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
    OAuth2Client: jest.fn().mockImplementation(() => ({ verifyIdToken: mockVerifyIdToken })),
}));

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.redirect = jest.fn().mockReturnValue(res);
    return res;
}

function getHandler(path, method = 'post') {
    const router = require('../server/routes/paymentRoutes');
    const layer = router.stack.find(l => l.route && l.route.path === path && l.route.methods[method]);
    return layer.route.stack[layer.route.stack.length - 1].handle;
}

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.FACEBOOK_APP_ID;
    delete process.env.FACEBOOK_APP_SECRET;
    delete global.fetch;
});
afterAll(() => { process.env = ORIGINAL_ENV; });

/* ══════════════════════════════════════════
   1. MoMo checksum — real HMAC-SHA256, no mocking
══════════════════════════════════════════ */
describe('paymentService — MoMo checksum (real crypto)', () => {
    const pmt = require('../server/services/paymentService');
    const cfg = require('../server/config/payment.config');

    function signedMomoParams(overrides = {}) {
        const base = {
            partnerCode: cfg.momo.partnerCode, orderId: 'SMART1_123', requestId: 'req1',
            amount: '150000', orderInfo: 'SmartBusAI - Vé xe #1', orderType: 'momo_wallet',
            transId: '999', resultCode: 0, message: 'Success', payType: 'qr',
            responseTime: '123456', extraData: Buffer.from(JSON.stringify({ bookingId: 1 })).toString('base64'),
            ...overrides,
        };
        const rawHash = [
            `accessKey=${cfg.momo.accessKey}`, `amount=${base.amount}`, `extraData=${base.extraData}`,
            `message=${base.message}`, `orderId=${base.orderId}`, `orderInfo=${base.orderInfo}`,
            `orderType=${base.orderType}`, `partnerCode=${base.partnerCode}`, `payType=${base.payType}`,
            `requestId=${base.requestId}`, `responseTime=${base.responseTime}`, `resultCode=${base.resultCode}`,
            `transId=${base.transId}`,
        ].join('&');
        base.signature = crypto.createHmac('sha256', cfg.momo.secretKey).update(rawHash).digest('hex');
        return base;
    }

    test('correctly signed callback with resultCode 0 -> valid', () => {
        expect(pmt.verifyMoMoReturn(signedMomoParams())).toBe(true);
    });

    test('tampered amount after signing -> invalid (signature no longer matches)', () => {
        const params = signedMomoParams();
        params.amount = '1'; // attacker drops the price post-signature
        expect(pmt.verifyMoMoReturn(params)).toBe(false);
    });

    test('validly signed but resultCode != 0 (gateway reports failure) -> invalid', () => {
        const params = signedMomoParams({ resultCode: 1006 });
        // re-sign so the signature itself is genuinely valid for this payload
        const rawHash = [
            `accessKey=${cfg.momo.accessKey}`, `amount=${params.amount}`, `extraData=${params.extraData}`,
            `message=${params.message}`, `orderId=${params.orderId}`, `orderInfo=${params.orderInfo}`,
            `orderType=${params.orderType}`, `partnerCode=${params.partnerCode}`, `payType=${params.payType}`,
            `requestId=${params.requestId}`, `responseTime=${params.responseTime}`, `resultCode=${params.resultCode}`,
            `transId=${params.transId}`,
        ].join('&');
        params.signature = crypto.createHmac('sha256', cfg.momo.secretKey).update(rawHash).digest('hex');
        expect(pmt.verifyMoMoReturn(params)).toBe(false);
    });

    test('parseMoMoBookingId extracts from base64 extraData', () => {
        const extraData = Buffer.from(JSON.stringify({ bookingId: 42 })).toString('base64');
        expect(pmt.parseMoMoBookingId({ extraData, orderId: 'SMART42_999' })).toBe(42);
    });

    test('parseMoMoBookingId falls back to orderId regex when extraData is missing', () => {
        expect(pmt.parseMoMoBookingId({ orderId: 'SMART77_12345' })).toBe('77');
    });
});

/* ══════════════════════════════════════════
   2. VNPay checksum — real HMAC-SHA512, no mocking
══════════════════════════════════════════ */
describe('paymentService — VNPay checksum (real crypto)', () => {
    const pmt = require('../server/services/paymentService');
    const cfg = require('../server/config/payment.config');

    function signedVnpayQuery(overrides = {}) {
        const base = {
            vnp_Amount: '15000000', vnp_TxnRef: 'SB1T123', vnp_ResponseCode: '00',
            vnp_OrderInfo: 'SmartBusAI - Vé xe #1', vnp_TmnCode: cfg.vnpay.tmnCode,
            ...overrides,
        };
        const sorted = Object.keys(base).sort().reduce((o, k) => { o[k] = base[k]; return o; }, {});
        const signData = new URLSearchParams(sorted).toString();
        base.vnp_SecureHash = crypto.createHmac('sha512', cfg.vnpay.hashSecret)
            .update(Buffer.from(signData, 'utf-8')).digest('hex');
        return base;
    }

    test('correctly signed return with ResponseCode 00 -> valid', () => {
        expect(pmt.verifyVNPayReturn(signedVnpayQuery())).toBe(true);
    });

    test('tampered vnp_Amount after signing -> invalid', () => {
        const query = signedVnpayQuery();
        query.vnp_Amount = '100'; // attacker drops the price post-signature
        expect(pmt.verifyVNPayReturn(query)).toBe(false);
    });

    test('missing vnp_SecureHash -> invalid, does not throw', () => {
        const query = signedVnpayQuery();
        delete query.vnp_SecureHash;
        expect(() => pmt.verifyVNPayReturn(query)).not.toThrow();
        expect(pmt.verifyVNPayReturn(query)).toBe(false);
    });

    test('parseVNPayBookingId extracts bookingId from vnp_TxnRef', () => {
        expect(pmt.parseVNPayBookingId({ vnp_TxnRef: 'SB123T999999' })).toBe('123');
    });
});

/* ══════════════════════════════════════════
   3. ZaloPay checksum — new this sprint, real HMAC-SHA256
══════════════════════════════════════════ */
describe('paymentService — ZaloPay checksum (real crypto, new this sprint)', () => {
    const pmt = require('../server/services/paymentService');
    const cfg = require('../server/config/payment.config');

    function signedZaloPayCallback(bookingId = 1, amount = 150000) {
        const data = JSON.stringify({
            app_id: cfg.zalopay.appId, app_trans_id: '260818_SB1_1', app_time: Date.now(),
            amount, embed_data: JSON.stringify({ bookingId }), app_user: 'smartbusai',
        });
        const mac = crypto.createHmac('sha256', cfg.zalopay.key2).update(data).digest('hex');
        return { data, mac };
    }

    test('correctly signed IPN body -> valid', () => {
        expect(pmt.verifyZaloPayCallback(signedZaloPayCallback())).toBe(true);
    });

    test('tampered mac -> invalid', () => {
        const body = signedZaloPayCallback();
        body.mac = 'deadbeef'.repeat(8);
        expect(pmt.verifyZaloPayCallback(body)).toBe(false);
    });

    test('missing data or mac -> invalid, does not throw', () => {
        expect(pmt.verifyZaloPayCallback({})).toBe(false);
        expect(pmt.verifyZaloPayCallback({ data: '{}' })).toBe(false);
        expect(() => pmt.verifyZaloPayCallback(null)).not.toThrow();
    });

    test('parseZaloPayCallbackData extracts bookingId + amount from embed_data', () => {
        const { data } = signedZaloPayCallback(88, 250000);
        expect(pmt.parseZaloPayCallbackData({ data })).toEqual({ bookingId: 88, amount: 250000 });
    });

    test('parseZaloPayCallbackData returns {} on malformed data instead of throwing', () => {
        expect(pmt.parseZaloPayCallbackData({ data: 'not json' })).toEqual({});
    });

    test('createZaloPayPayment signs the create-order request with the correct MAC field order (app_id|app_trans_id|app_user|amount|app_time|embed_data|item)', async () => {
        let capturedBody = '';
        https.request.mockImplementationOnce((opts, cb) => {
            const res = { on: (evt, handler) => { if (evt === 'end') handler(); } };
            cb(res);
            return { on: jest.fn(), write: (b) => { capturedBody = b; }, end: jest.fn() };
        });

        // Fire-and-forget: the mocked https never calls res.on('data'), so
        // the promise never resolves/rejects — only the captured request
        // body is needed, not the (unawaited) result.
        pmt.createZaloPayPayment({ bookingId: 5, amount: 200000, orderInfo: 'Test' }).catch(() => {});
        await new Promise(r => setImmediate(r));

        const params = new URLSearchParams(capturedBody);
        const macInput = [
            params.get('app_id'), params.get('app_trans_id'), params.get('app_user'),
            params.get('amount'), params.get('app_time'), params.get('embed_data'), params.get('item'),
        ].join('|');
        const expectedMac = crypto.createHmac('sha256', cfg.zalopay.key1).update(macInput).digest('hex');
        expect(params.get('mac')).toBe(expectedMac);
        expect(params.get('amount')).toBe('200000');
    });
});

/* ══════════════════════════════════════════
   4. Route wiring — new endpoints this sprint
══════════════════════════════════════════ */
describe('paymentRoutes — POST /create zalopay branch', () => {
    test('routes to createZaloPayPayment, uses booking.total_amount, persists payment_ref', async () => {
        const pmt = require('../server/services/paymentService');
        jest.spyOn(pmt, 'createZaloPayPayment').mockResolvedValueOnce({ payUrl: 'https://zalopay.example/pay', orderId: 'ZP1' });
        db.query.mockResolvedValueOnce([[{ status: 'PENDING', total_amount: 200000 }]]); // booking lookup
        db.query.mockResolvedValueOnce([{}]); // payment_ref update

        const handler = getHandler('/create', 'post');
        const req = { body: { booking_id: 5, payment_method: 'zalopay' }, headers: {}, socket: {} };
        const res = mockRes();
        await handler(req, res);

        expect(pmt.createZaloPayPayment).toHaveBeenCalledWith(expect.objectContaining({ bookingId: 5, amount: 200000 }));
        expect(res.json).toHaveBeenCalledWith({ payUrl: 'https://zalopay.example/pay', method: 'zalopay' });
        pmt.createZaloPayPayment.mockRestore();
    });
});

describe('paymentRoutes — POST /zalopay/callback (IPN)', () => {
    test('valid signature + matching amount -> booking PAID, payment row inserted, ack return_code 1', async () => {
        const cfg = require('../server/config/payment.config');
        const data = JSON.stringify({ app_id: cfg.zalopay.appId, app_trans_id: 'x', app_time: Date.now(), amount: 200000, embed_data: JSON.stringify({ bookingId: 9 }), app_user: 'smartbusai' });
        const mac = crypto.createHmac('sha256', cfg.zalopay.key2).update(data).digest('hex');

        db.query.mockResolvedValueOnce([[{ total_amount: 200000 }]]); // amount lookup
        db.query.mockResolvedValueOnce([{}]); // UPDATE booking
        db.query.mockResolvedValueOnce([{}]); // INSERT payment

        const handler = getHandler('/zalopay/callback', 'post');
        const req = { body: { data, mac } };
        const res = mockRes();
        await handler(req, res);

        expect(res.json).toHaveBeenCalledWith({ return_code: 1, return_message: 'success' });
        expect(db.query.mock.calls[1][0]).toMatch(/UPDATE booking SET status='PAID'/);
        expect(db.query.mock.calls[2][0]).toMatch(/INSERT INTO payment/);
        expect(db.query.mock.calls[2][1]).toEqual([9, 200000]);
    });

    test('tampered mac -> booking untouched, ack return_code -1', async () => {
        const handler = getHandler('/zalopay/callback', 'post');
        const req = { body: { data: '{"amount":200000}', mac: 'bad' } };
        const res = mockRes();
        await handler(req, res);
        expect(res.json).toHaveBeenCalledWith({ return_code: -1, return_message: 'mac not match' });
        expect(db.query).not.toHaveBeenCalled();
    });

    test('amount mismatch (paid less than booking total) -> booking NOT marked PAID', async () => {
        const cfg = require('../server/config/payment.config');
        const data = JSON.stringify({ app_id: cfg.zalopay.appId, app_trans_id: 'x', app_time: Date.now(), amount: 1000, embed_data: JSON.stringify({ bookingId: 9 }), app_user: 'smartbusai' });
        const mac = crypto.createHmac('sha256', cfg.zalopay.key2).update(data).digest('hex');

        db.query.mockResolvedValueOnce([[{ total_amount: 200000 }]]); // real booking total is far higher

        const handler = getHandler('/zalopay/callback', 'post');
        const req = { body: { data, mac } };
        const res = mockRes();
        await handler(req, res);

        expect(db.query).toHaveBeenCalledTimes(1); // only the lookup — no UPDATE/INSERT
        expect(res.json).toHaveBeenCalledWith({ return_code: 1, return_message: 'success' }); // still acks so ZaloPay stops retrying
    });
});

describe('paymentRoutes — GET /zalopay/return', () => {
    test('reflects whatever status the (already-run) IPN callback wrote to the booking, does not trust the browser leg itself', async () => {
        db.query.mockResolvedValueOnce([[{ status: 'PAID', booking_code: 'ABC123' }]]);
        const handler = getHandler('/zalopay/return', 'get');
        const req = { query: { apptransid: '260818_SB9_1' } };
        const res = mockRes();
        await handler(req, res);
        expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('status=success'));
        expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('bookingId=9'));
    });

    test('booking still PENDING (IPN has not arrived yet) -> status=failed in redirect', async () => {
        db.query.mockResolvedValueOnce([[{ status: 'PENDING', booking_code: 'ABC123' }]]);
        const handler = getHandler('/zalopay/return', 'get');
        const req = { query: { apptransid: '260818_SB9_1' } };
        const res = mockRes();
        await handler(req, res);
        expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('status=failed'));
    });
});

describe('paymentRoutes — POST /vnpay/ipn (server-to-server, independent of the browser return leg)', () => {
    const cfg = require('../server/config/payment.config');
    function signedIpn(overrides = {}) {
        const base = { vnp_Amount: '20000000', vnp_TxnRef: 'SB9T1', vnp_ResponseCode: '00', ...overrides };
        const sorted = Object.keys(base).sort().reduce((o, k) => { o[k] = base[k]; return o; }, {});
        const signData = new URLSearchParams(sorted).toString();
        base.vnp_SecureHash = crypto.createHmac('sha512', cfg.vnpay.hashSecret).update(Buffer.from(signData, 'utf-8')).digest('hex');
        return base;
    }

    test('valid signature + matching amount + PENDING booking -> PAID, RspCode 00', async () => {
        db.query.mockResolvedValueOnce([[{ total_amount: 200000, status: 'PENDING' }]]);
        db.query.mockResolvedValueOnce([{}]);
        db.query.mockResolvedValueOnce([{}]);
        const handler = getHandler('/vnpay/ipn', 'post');
        const req = { query: signedIpn(), body: {} };
        const res = mockRes();
        await handler(req, res);
        expect(res.json).toHaveBeenCalledWith({ RspCode: '00', Message: 'Confirm Success' });
    });

    test('invalid signature -> RspCode 97, no DB writes', async () => {
        const handler = getHandler('/vnpay/ipn', 'post');
        const req = { query: { ...signedIpn(), vnp_SecureHash: 'bad' }, body: {} };
        const res = mockRes();
        await handler(req, res);
        expect(res.json).toHaveBeenCalledWith({ RspCode: '97', Message: 'Invalid signature' });
        expect(db.query).not.toHaveBeenCalled();
    });

    test('amount mismatch -> RspCode 04, booking not updated', async () => {
        db.query.mockResolvedValueOnce([[{ total_amount: 999999, status: 'PENDING' }]]);
        const handler = getHandler('/vnpay/ipn', 'post');
        const req = { query: signedIpn(), body: {} };
        const res = mockRes();
        await handler(req, res);
        expect(res.json).toHaveBeenCalledWith({ RspCode: '04', Message: 'Invalid amount' });
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    test('booking already PAID -> idempotent ack, no duplicate payment row inserted', async () => {
        db.query.mockResolvedValueOnce([[{ total_amount: 200000, status: 'PAID' }]]);
        const handler = getHandler('/vnpay/ipn', 'post');
        const req = { query: signedIpn(), body: {} };
        const res = mockRes();
        await handler(req, res);
        expect(res.json).toHaveBeenCalledWith({ RspCode: '00', Message: 'Confirm Success' });
        expect(db.query).toHaveBeenCalledTimes(1); // only the lookup — no second UPDATE/INSERT
    });
});

/* ══════════════════════════════════════════
   5. avatar_url wired through login / OAuth (Sprint 8)
══════════════════════════════════════════ */
describe('authController.login — avatar_url included in response', () => {
    const bcrypt = require('bcryptjs');
    test('response.user.avatar_url reflects the DB column', async () => {
        const ctrl = require('../server/controllers/authController');
        const hash = await bcrypt.hash('Password1!', 4);
        db.query.mockResolvedValueOnce([[{
            user_id: 1, username: 'u1', full_name: 'User One', email: 'u1@x.com',
            password_hash: hash, status: 'ACTIVE', role: 'PASSENGER', operator_id: null,
            token_version: 0, avatar_url: '/uploads/avatars/1_abc.png',
        }]]);
        const req = { body: { email: 'u1@x.com', password: 'Password1!' } };
        const res = mockRes();
        await ctrl.login(req, res);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            user: expect.objectContaining({ avatar_url: '/uploads/avatars/1_abc.png' }),
        }));
    });
});

describe('authController.googleAuth — avatar_url from Google picture (Sprint 8)', () => {
    const ctrl = require('../server/controllers/authController');

    test('new user: picture from the ID token is inserted as avatar_url and returned', async () => {
        process.env.GOOGLE_CLIENT_ID = 'real-client-id';
        mockVerifyIdToken.mockResolvedValueOnce({
            getPayload: () => ({ email: 'new@x.com', name: 'New User', picture: 'https://lh3.googleusercontent.com/a/pic.jpg', sub: 'g1' }),
        });
        db.query
            .mockResolvedValueOnce([[]]) // no existing user
            .mockResolvedValueOnce([{ insertId: 100 }]); // INSERT

        const req = { body: { credential: 'valid-token' } };
        const res = mockRes();
        await ctrl.googleAuth(req, res);

        const insertCall = db.query.mock.calls[1];
        expect(insertCall[0]).toMatch(/avatar_url/);
        expect(insertCall[1]).toContain('https://lh3.googleusercontent.com/a/pic.jpg');
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            user: expect.objectContaining({ avatar_url: 'https://lh3.googleusercontent.com/a/pic.jpg' }),
        }));
    });

    test('existing user: avatar_url comes from the DB row, not re-fetched from Google', async () => {
        process.env.GOOGLE_CLIENT_ID = 'real-client-id';
        mockVerifyIdToken.mockResolvedValueOnce({
            getPayload: () => ({ email: 'existing@x.com', name: 'Existing', picture: 'https://google.example/new-pic.jpg', sub: 'g2' }),
        });
        db.query.mockResolvedValueOnce([[{
            user_id: 2, full_name: 'Existing', email: 'existing@x.com', role: 'PASSENGER',
            status: 'ACTIVE', operator_id: null, token_version: 0, avatar_url: '/uploads/avatars/2_custom.png',
        }]]);
        const req = { body: { credential: 'valid-token' } };
        const res = mockRes();
        await ctrl.googleAuth(req, res);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            user: expect.objectContaining({ avatar_url: '/uploads/avatars/2_custom.png' }),
        }));
    });
});

describe('authController.facebookAuth — avatar_url from picture.data.url (Sprint 8)', () => {
    const ctrl = require('../server/controllers/authController');

    test('requests the picture field and inserts picture.data.url as avatar_url for a new user', async () => {
        process.env.FACEBOOK_APP_ID = 'real-app-id';
        process.env.FACEBOOK_APP_SECRET = 'real-app-secret';
        const fetchMock = jest.fn()
            .mockResolvedValueOnce({ json: async () => ({ data: { is_valid: true, app_id: 'real-app-id' } }) })
            .mockResolvedValueOnce({ json: async () => ({
                id: 'fb1', name: 'FB User', email: 'fb1@x.com',
                picture: { data: { url: 'https://platform-lookaside.fbsbx.com/pic.jpg' } },
            }) });
        global.fetch = fetchMock;
        db.query
            .mockResolvedValueOnce([[]])
            .mockResolvedValueOnce([{ insertId: 200 }]);

        const req = { body: { accessToken: 'valid-token' } };
        const res = mockRes();
        await ctrl.facebookAuth(req, res);

        expect(fetchMock.mock.calls[1][0]).toMatch(/fields=id,name,email,picture/);
        const insertCall = db.query.mock.calls[1];
        expect(insertCall[1]).toContain('https://platform-lookaside.fbsbx.com/pic.jpg');
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            user: expect.objectContaining({ avatar_url: 'https://platform-lookaside.fbsbx.com/pic.jpg' }),
        }));
    });

    test('account has no picture field at all -> avatar_url is null, not a crash', async () => {
        process.env.FACEBOOK_APP_ID = 'real-app-id';
        process.env.FACEBOOK_APP_SECRET = 'real-app-secret';
        global.fetch = jest.fn()
            .mockResolvedValueOnce({ json: async () => ({ data: { is_valid: true, app_id: 'real-app-id' } }) })
            .mockResolvedValueOnce({ json: async () => ({ id: 'fb2', name: 'No Pic User', email: 'nopic@x.com' }) });
        db.query
            .mockResolvedValueOnce([[]])
            .mockResolvedValueOnce([{ insertId: 201 }]);

        const req = { body: { accessToken: 'valid-token' } };
        const res = mockRes();
        await ctrl.facebookAuth(req, res);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            user: expect.objectContaining({ avatar_url: null }),
        }));
    });
});

/* ══════════════════════════════════════════
   6. POST /api/users/:id/avatar — Avatar Sync Engine (Sprint 8)
══════════════════════════════════════════ */
describe('userController.uploadAvatar', () => {
    const ctrl = require('../server/controllers/userController');
    const TINY_PNG_B64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    test('valid base64 PNG -> writes a file, updates DB, returns avatar_url', async () => {
        db.query.mockResolvedValueOnce([{}]);
        const req = { params: { id: '5' }, body: { image_base64: TINY_PNG_B64 } };
        const res = mockRes();
        await ctrl.uploadAvatar(req, res);

        expect(fs.mkdirSync).toHaveBeenCalled();
        expect(fs.writeFileSync).toHaveBeenCalled();
        expect(db.query.mock.calls[0][0]).toMatch(/UPDATE users SET avatar_url/);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            avatar_url: expect.stringMatching(/^\/uploads\/avatars\/5_.+\.png$/),
        }));
    });

    test('unsupported MIME type -> 422, no file written, no DB call', async () => {
        const req = { params: { id: '5' }, body: { image_base64: 'data:text/plain;base64,aGVsbG8=' } };
        const res = mockRes();
        await ctrl.uploadAvatar(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
        expect(fs.writeFileSync).not.toHaveBeenCalled();
        expect(db.query).not.toHaveBeenCalled();
    });

    test('oversized image (> 2MB decoded) -> 413, no file written', async () => {
        const bigBuffer = Buffer.alloc(3 * 1024 * 1024, 1); // 3MB
        const req = { params: { id: '5' }, body: { image_base64: `data:image/png;base64,${bigBuffer.toString('base64')}` } };
        const res = mockRes();
        await ctrl.uploadAvatar(req, res);
        expect(res.status).toHaveBeenCalledWith(413);
        expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    test('valid https avatar_url -> DB updated directly, no file write', async () => {
        db.query.mockResolvedValueOnce([{}]);
        const req = { params: { id: '5' }, body: { avatar_url: 'https://lh3.googleusercontent.com/a/pic.jpg' } };
        const res = mockRes();
        await ctrl.uploadAvatar(req, res);
        expect(fs.writeFileSync).not.toHaveBeenCalled();
        expect(db.query).toHaveBeenCalledWith(
            'UPDATE users SET avatar_url=? WHERE user_id=?',
            ['https://lh3.googleusercontent.com/a/pic.jpg', 5]
        );
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ avatar_url: 'https://lh3.googleusercontent.com/a/pic.jpg' }));
    });

    test('javascript: scheme rejected — only http(s) URLs accepted', async () => {
        const req = { params: { id: '5' }, body: { avatar_url: 'javascript:alert(1)' } };
        const res = mockRes();
        await ctrl.uploadAvatar(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('data: URI passed as avatar_url (not image_base64) is rejected, not silently written to the URL column', async () => {
        const req = { params: { id: '5' }, body: { avatar_url: TINY_PNG_B64 } };
        const res = mockRes();
        await ctrl.uploadAvatar(req, res);
        expect(res.status).toHaveBeenCalledWith(422);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('missing both avatar_url and image_base64 -> 400', async () => {
        const req = { params: { id: '5' }, body: {} };
        const res = mockRes();
        await ctrl.uploadAvatar(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });
});
