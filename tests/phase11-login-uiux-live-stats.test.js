'use strict';
/**
 * Login page UI/UX refinement & real-time public stats.
 * Mocking strategy matches phase7/phase10: single hoisted jest.mock() per
 * dependency, reused across tests via mockResolvedValueOnce chains — no
 * jest.resetModules()/doMock() (see phase7-ui-auth-harmony.test.js's own
 * header comment for why that combination is unsafe in this codebase).
 */

const fs = require('fs');
const path = require('path');

jest.mock('../server/config/db', () => ({ query: jest.fn() }));
const db = require('../server/config/db');
const statsCtrl = require('../server/controllers/statsController');
const cache = require('../server/services/cacheManager'); // real module — Sprint 12 wrapped getPublicSummary in Cache-Aside

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

beforeEach(async () => { jest.clearAllMocks(); await cache.clear(); }); // each test must see its own fresh mock, not a hit from the previous test's cached value

/* ══════════════════════════════════════════
   1. statsController.getPublicSummary
══════════════════════════════════════════ */
describe('statsController.getPublicSummary', () => {
    test('returns real aggregate counts from a single query', async () => {
        db.query.mockResolvedValueOnce([[{
            totalRoutes: 42, totalPassengers: 1234, avgRating: '4.6',
            completedTrips: 900, canceledTrips: 100,
        }]]);
        const req = {}, res = mockRes();
        await statsCtrl.getPublicSummary(req, res);
        expect(db.query).toHaveBeenCalledTimes(1);
        expect(db.query.mock.calls[0][0]).toMatch(/FROM route WHERE status = 'ACTIVE'/);
        expect(db.query.mock.calls[0][0]).toMatch(/FROM users WHERE role = 'PASSENGER'/);
        expect(db.query.mock.calls[0][0]).toMatch(/FROM review/);
        expect(res.json).toHaveBeenCalledWith({
            totalRoutes: 42, totalPassengers: 1234, avgRating: '4.6', completionRate: 90,
        });
    });

    test('completionRate is null (not a fabricated 0%/100%) when no trips have finished yet', async () => {
        db.query.mockResolvedValueOnce([[{
            totalRoutes: 5, totalPassengers: 0, avgRating: 0,
            completedTrips: 0, canceledTrips: 0,
        }]]);
        const req = {}, res = mockRes();
        await statsCtrl.getPublicSummary(req, res);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ completionRate: null }));
    });

    test('DB failure -> 500, no partial/fake data returned', async () => {
        db.query.mockRejectedValueOnce(new Error('connection lost'));
        const req = {}, res = mockRes();
        await statsCtrl.getPublicSummary(req, res);
        expect(res.status).toHaveBeenCalledWith(500);
    });
});

describe('server.js / statsRoutes.js — wiring', () => {
    test('GET /api/stats/public-summary is registered, mounted with no auth middleware (matches the google-config/facebook-config public-route convention)', () => {
        const routesSrc = fs.readFileSync(path.join(__dirname, '../server/routes/statsRoutes.js'), 'utf8');
        expect(routesSrc).toMatch(/router\.get\(["']\/public-summary["'],\s*statsController\.getPublicSummary\)/);
        expect(routesSrc).not.toMatch(/\bauthenticate\(/);
    });

    test('server.js mounts statsRoutes at /api/stats', () => {
        const serverSrc = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
        expect(serverSrc).toMatch(/require\(["']\.\/routes\/statsRoutes["']\)/);
        expect(serverSrc).toMatch(/app\.use\(["']\/api\/stats["'],\s*statsRoutes\)/);
    });
});

/* ══════════════════════════════════════════
   2. login.html — content-level checks
══════════════════════════════════════════ */
describe('public/pages/auth/login.html — UI/UX refinements', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/pages/auth/login.html'), 'utf8');

    test('greeting and subtext updated', () => {
        expect(html).toMatch(/<h2>Chào mừng đến với SmartBusAI<\/h2>/);
        expect(html).toMatch(/Đăng nhập để trải nghiệm hệ thống đặt vé thông minh/);
    });

    test('email/password inputs have no hardcoded value and use the new placeholders', () => {
        expect(html).toMatch(/id="email" value="" placeholder="example@gmail\.com"/);
        expect(html).toMatch(/id="password" value="" placeholder="••••••••"/);
        expect(html).not.toMatch(/admin@gmail\.com/);
    });

    test('login button reads "ĐĂNG NHẬP →" (uppercase) in both markup and JS reset paths', () => {
        expect(html).toMatch(/<button class="login-btn" id="loginBtn" onclick="login\(\)">ĐĂNG NHẬP →<\/button>/);
        expect(html).not.toMatch(/textContent="Đăng nhập →"/); // old-case leftover would be a real bug
        expect(html).toMatch(/btn\.textContent="ĐĂNG NHẬP →"/);
    });

    test('login button is centered with a constrained width, not full-bleed', () => {
        expect(html).toMatch(/\.login-btn\{[^}]*max-width:85%;margin:16px auto 0;/);
    });

    test('no hardcoded stat numbers remain — hero stats are fetched, not baked into HTML', () => {
        expect(html).not.toMatch(/1\.300\+/);
        expect(html).not.toMatch(/120K\+/);
        expect(html).not.toMatch(/98\.2%/);
        expect(html).not.toMatch(/>4\.7★</);
    });

    test('stats-row elements start in the skeleton-loading state and are targeted by id', () => {
        for (const id of ['statNumRoutes', 'statNumPassengers', 'statNumOnTime', 'statNumRating']) {
            expect(html).toMatch(new RegExp(`<div class="stat-num skeleton" id="${id}"></div>`));
        }
    });

    test('loadPublicStats() calls the real public-summary endpoint and clears the skeleton on success', () => {
        expect(html).toMatch(/fetch\("\/api\/stats\/public-summary"\)/);
        expect(html).toMatch(/el\.classList\.remove\("skeleton","static"\)/);
    });

    test('on fetch failure, the skeleton is kept (static, non-animated) rather than falling back to fake numbers', () => {
        const fnSrc = html.slice(html.indexOf('async function loadPublicStats'), html.indexOf('loadPublicStats();'));
        expect(fnSrc).toMatch(/catch\(e\)\{/);
        expect(fnSrc).toMatch(/el\.classList\.add\("skeleton","static"\)/);
    });

    test('.stat-num.skeleton CSS defines a shimmer animation, and .static suppresses it', () => {
        expect(html).toMatch(/\.stat-num\.skeleton\{[^}]*animation:statSkeletonShimmer/);
        expect(html).toMatch(/\.stat-num\.skeleton\.static\{animation:none;/);
    });

    test('captcha box left edge and the "Mã xác nhận" label share the same box model (no left padding offset introduced)', () => {
        expect(html).not.toMatch(/\.captcha-code\{[^}]*padding-left:14px/);
    });

    test('captcha digits are horizontally centered (no left-biased padding hack)', () => {
        expect(html).toMatch(/\.captcha-code\{[^}]*justify-content:center;[^}]*text-align:center;/);
    });

    test('refresh button and captcha box share equal flex width, guaranteeing the refresh button\'s right edge lines up with the captcha input above it', () => {
        expect(html).toMatch(/\.captcha-code\{\s*flex:1;/);
        expect(html).toMatch(/\.refresh-btn\{\s*flex:1;/);
    });

    test('has no inline script syntax errors', () => {
        const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
        scripts.forEach(src => expect(() => new Function(src)).not.toThrow());
    });
});
