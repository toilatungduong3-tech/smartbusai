'use strict';
/**
 * TRUTHNODE — SPRINT 10: Vietnam Real-World Routing, In-Page Legal Modal
 * & Flexible Password Recovery.
 *
 * Follows established conventions: real-module require() for pure logic
 * (matching tests/route-visualization-forensics.test.js's own pattern for
 * routeInference.js), db-mocked controller tests (matching phase7/phase8),
 * and content-level file checks for static assets that can't be exercised
 * without a live server (matching phase5/phase7/phase9).
 *
 * Mocking strategy: every dependency is mocked ONCE at module level
 * (jest.mock, hoisted) and controlled per-test via mockResolvedValueOnce
 * chains on the SAME mock reference — no jest.resetModules()/doMock()
 * anywhere, per the documented lesson in tests/phase7-ui-auth-harmony.test.js
 * (that combination previously opened a real, unmocked MySQL connection
 * that outlived the test run).
 */

const fs = require('fs');
const path = require('path');

jest.mock('../server/config/db', () => ({ query: jest.fn(), getConnection: jest.fn() }));
jest.mock('../server/services/emailService', () => ({ sendPasswordReset: jest.fn().mockResolvedValue({}) }));

const db = require('../server/config/db');
const emailService = require('../server/services/emailService');
const authCtrl = require('../server/controllers/authController');
const routeStopCtrl = require('../server/controllers/routeStopController');

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

beforeEach(() => { jest.clearAllMocks(); });

/* ══════════════════════════════════════════
   1. seed_vietnam_real_routes.js — pathfinding logic
      No DB is touched by these tests — only the exported pure functions
      (PROVINCE_GEO, PROVINCE_ADJ, shortestPath, resolvePath, thin, canon).
══════════════════════════════════════════ */
describe('seed_vietnam_real_routes — resolvePath()', () => {
    const { resolvePath, PROVINCE_GEO, PROVINCE_ADJ } = require('../server/config/seed_vietnam_real_routes.js');

    test('Hà Nội -> TP. Hồ Chí Minh follows the real coastal QL1A corridor (Tier 1: curated ROUTE_DB), not a Tây Nguyên shortcut', () => {
        const path = resolvePath('Hà Nội', 'TP. Hồ Chí Minh');
        expect(path).not.toBeNull();
        expect(path).toContain('Đà Nẵng');
        expect(path).toContain('Khánh Hòa');
        // The exact bug this sprint fixed: an early unweighted-BFS draft
        // preferred a Tây Nguyên cut-through over the coast for this pair.
        expect(path).not.toContain('Kon Tum');
        expect(path).not.toContain('Gia Lai');
    });

    test('Hà Nội -> Đà Nẵng also follows the coastal curated corridor', () => {
        const path = resolvePath('Hà Nội', 'Đà Nẵng');
        expect(path).toContain('Nghệ An');
        expect(path).toContain('Huế');
    });

    test('every intermediate province in a resolved path has a real adjacency edge to its neighbors (no teleporting/ocean-crossing)', () => {
        const pairs = [
            ['Hà Giang', 'Cần Thơ'], ['Lai Châu', 'Cà Mau'], ['Quảng Ninh', 'Kiên Giang'],
            ['Đà Lạt', 'Hà Nội'], ['Nha Trang', 'TP. Hồ Chí Minh'],
        ];
        for (const [a, b] of pairs) {
            const p = resolvePath(a, b);
            expect(p).not.toBeNull();
            expect(p.length).toBeGreaterThan(1);
            for (let i = 1; i < p.length; i++) {
                const prev = p[i - 1], cur = p[i];
                const adjacent = prev === cur || (PROVINCE_ADJ[prev] && PROVINCE_ADJ[prev].has(cur));
                expect(adjacent).toBe(true);
            }
        }
    });

    test('same-canonical-province pairs (Nha Trang <-> Khánh Hòa) need no intermediate waypoints', () => {
        expect(resolvePath('Nha Trang', 'Khánh Hòa')).toBeNull();
        expect(resolvePath('Đà Lạt', 'Lâm Đồng')).toBeNull();
        expect(resolvePath('Huế', 'Thừa Thiên Huế')).toBeNull();
    });

    test('every province name used in the existing curated ROUTE_DB/HWY1 (routeInference.js) resolves to real coordinates via canon()', () => {
        const { ROUTE_DB, HWY1 } = require('../public/js/routeInference.js');
        const { canon } = require('../server/config/seed_vietnam_real_routes.js');
        const names = new Set(HWY1);
        Object.values(ROUTE_DB).forEach(arr => arr.forEach(n => names.add(n)));
        for (const name of names) {
            expect(PROVINCE_GEO[canon(name)]).toBeDefined();
        }
    });

    test('Phú Quốc (island) has coordinates for map display but no adjacency edges — never used as a fabricated overland waypoint', () => {
        expect(PROVINCE_GEO['Phú Quốc']).toBeDefined();
        expect(PROVINCE_ADJ['Phú Quốc']).toBeUndefined();
    });
});

describe('seed_vietnam_real_routes — thin()', () => {
    const { thin } = require('../server/config/seed_vietnam_real_routes.js');

    test('leaves short paths untouched', () => {
        expect(thin(['A', 'B', 'C'], 5)).toEqual(['A', 'B', 'C']);
    });

    test('caps long paths at `max` while always keeping first and last', () => {
        const long = Array.from({ length: 20 }, (_, i) => `P${i}`);
        const out = thin(long, 5);
        expect(out.length).toBe(5);
        expect(out[0]).toBe('P0');
        expect(out[out.length - 1]).toBe('P19');
    });
});

/* ══════════════════════════════════════════
   2. routeStopController — WAYPOINT rows never surface as a boarding point
══════════════════════════════════════════ */
describe('routeStopController.getNearestStops — excludes WAYPOINT rows', () => {
    test('route_id-scoped query excludes WAYPOINT unconditionally, even with no ?type= filter', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { query: { lat: '21.0', lng: '105.8', route_id: '1' } };
        const res = mockRes();
        await routeStopCtrl.getNearestStops(req, res);
        const sql = db.query.mock.calls[0][0];
        expect(sql).toMatch(/stop_type != 'WAYPOINT'/);
    });

    test('global (no route_id) query also excludes WAYPOINT unconditionally', async () => {
        db.query.mockResolvedValueOnce([[]]);
        const req = { query: { lat: '21.0', lng: '105.8' } };
        const res = mockRes();
        await routeStopCtrl.getNearestStops(req, res);
        const sql = db.query.mock.calls[0][0];
        expect(sql).toMatch(/stop_type != 'WAYPOINT'/);
    });

    test('createStop/updateStop accept WAYPOINT as a valid stop_type (migrate_v18.sql extended the enum)', () => {
        const src = fs.readFileSync(path.join(__dirname, '../server/controllers/routeStopController.js'), 'utf8');
        const matches = src.match(/VALID_TYPE = new Set\(\[[^\]]*\]\)/g) || [];
        expect(matches.length).toBeGreaterThan(0);
        matches.forEach(m => expect(m).toMatch(/'WAYPOINT'/));
    });
});

describe('migrate_v18.sql / migrate.js — WAYPOINT enum registration', () => {
    test('migrate_v18.sql extends stop_type to include WAYPOINT', () => {
        const sql = fs.readFileSync(path.join(__dirname, '../server/config/migrate_v18.sql'), 'utf8');
        expect(sql).toMatch(/ENUM\('PICKUP','DROPOFF','BOTH','WAYPOINT'\)/);
    });

    test('migrate.js registers migrate_v18.sql and verifies the WAYPOINT enum value', () => {
        const js = fs.readFileSync(path.join(__dirname, '../server/config/migrate.js'), 'utf8');
        expect(js).toMatch(/'migrate_v18\.sql'/);
        expect(js).toMatch(/WAYPOINT/);
    });
});

/* ══════════════════════════════════════════
   3. Forgot-password — email / username / phone identifier
      Mirrors phase7-ui-auth-harmony.test.js's mocking convention: mock
      once at module level, vary behavior per test via mockResolvedValueOnce.
══════════════════════════════════════════ */
describe('authController.checkEmail — accepts email, username, or phone', () => {
    test('looked up by username -> reset token always mailed to the account\'s real on-file email, not the identifier typed', async () => {
        db.query
            .mockResolvedValueOnce([[{ user_id: 53, full_name: 'Đức Anh', email: 'ducanh15094@gmail.com' }]]) // lookup
            .mockResolvedValueOnce([{}]) // invalidate old tokens
            .mockResolvedValueOnce([{}]); // insert new token

        const req = { body: { account_identifier: 'ducanh1234' } };
        const res = mockRes();
        await authCtrl.checkEmail(req, res);

        expect(db.query.mock.calls[0][0]).toMatch(/WHERE email = \? OR username = \? OR phone = \?/);
        expect(db.query.mock.calls[0][1]).toEqual(['ducanh1234', 'ducanh1234', 'ducanh1234']);
        expect(emailService.sendPasswordReset).toHaveBeenCalledWith(
            expect.objectContaining({ email: 'ducanh15094@gmail.com' }),
            expect.any(String)
        );
    });

    test('looked up by phone number works the same way', async () => {
        db.query
            .mockResolvedValueOnce([[{ user_id: 53, full_name: 'Đức Anh', email: 'ducanh15094@gmail.com' }]])
            .mockResolvedValueOnce([{}])
            .mockResolvedValueOnce([{}]);

        const req = { body: { account_identifier: '0395911456' } };
        const res = mockRes();
        await authCtrl.checkEmail(req, res);
        expect(emailService.sendPasswordReset).toHaveBeenCalledWith(
            expect.objectContaining({ email: 'ducanh15094@gmail.com' }),
            expect.any(String)
        );
    });

    test('still works with the old {email} field name (backward compatible)', async () => {
        db.query
            .mockResolvedValueOnce([[{ user_id: 1, full_name: 'X', email: 'x@x.com' }]])
            .mockResolvedValueOnce([{}])
            .mockResolvedValueOnce([{}]);
        const req = { body: { email: 'x@x.com' } };
        const res = mockRes();
        await authCtrl.checkEmail(req, res);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
        expect(emailService.sendPasswordReset).toHaveBeenCalled();
    });

    test('nonexistent identifier -> same generic message, no token issued, no email sent (anti-enumeration preserved)', async () => {
        db.query.mockResolvedValueOnce([[]]); // no match
        const req = { body: { account_identifier: 'no-such-account' } };
        const res = mockRes();
        await authCtrl.checkEmail(req, res);
        expect(db.query).toHaveBeenCalledTimes(1); // only the lookup — no INSERT
        expect(emailService.sendPasswordReset).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringMatching(/Nếu tài khoản tồn tại/),
        }));
    });

    test('missing identifier -> 400 with the new tri-field error message', async () => {
        const req = { body: {} };
        const res = mockRes();
        await authCtrl.checkEmail(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringMatching(/email, tên đăng nhập hoặc số điện thoại/i),
        }));
        expect(db.query).not.toHaveBeenCalled();
    });

    test('found account with no email on file is treated as not-found (reset delivery has no channel to use)', async () => {
        db.query.mockResolvedValueOnce([[{ user_id: 9, full_name: 'No Email', email: null }]]);
        const req = { body: { account_identifier: '0900000000' } };
        const res = mockRes();
        await authCtrl.checkEmail(req, res);
        expect(db.query).toHaveBeenCalledTimes(1);
        expect(emailService.sendPasswordReset).not.toHaveBeenCalled();
    });
});

/* ══════════════════════════════════════════
   4. Forgot-password frontend — flexible label/validation
══════════════════════════════════════════ */
describe('public/pages/auth/forgot-password.html — flexible identifier UI', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/pages/auth/forgot-password.html'), 'utf8');

    test('label and placeholder no longer say "email only"', () => {
        expect(html).toMatch(/Email, Tên đăng nhập hoặc Số điện thoại/);
    });

    test('input is no longer type="email" (would block username/phone entry)', () => {
        expect(html).not.toMatch(/type="email" id="emailInput"/);
    });

    test('submits account_identifier to the backend, not a hardcoded {email}-only body', () => {
        expect(html).toMatch(/account_identifier\s*:\s*identifier/);
    });

    test('has no inline script syntax errors', () => {
        const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
        scripts.forEach(src => expect(() => new Function(src)).not.toThrow());
    });
});

/* ══════════════════════════════════════════
   5. In-page Legal Modal
══════════════════════════════════════════ */
describe('public/js/legalModal.js — component structure', () => {
    const js = fs.readFileSync(path.join(__dirname, '../public/js/legalModal.js'), 'utf8');

    test('exposes openLegalModal/closeLegalModal globally', () => {
        expect(js).toMatch(/window\.openLegalModal\s*=\s*openLegalModal/);
        expect(js).toMatch(/window\.closeLegalModal\s*=\s*closeLegalModal/);
    });

    test('fetches the real standalone pages rather than duplicating their content', () => {
        expect(js).toMatch(/\/pages\/legal\/privacy-policy\.html/);
        expect(js).toMatch(/\/pages\/legal\/terms-of-service\.html/);
    });

    test('listens for Escape to close', () => {
        expect(js).toMatch(/key\s*!==\s*'Escape'|key\s*===\s*'Escape'/);
    });

    test('has no syntax errors', () => {
        expect(() => new Function(js)).not.toThrow();
    });
});

describe('public/css/style.css — .sb-legal-* modal styles', () => {
    const css = fs.readFileSync(path.join(__dirname, '../public/css/style.css'), 'utf8');
    test('backdrop, modal, header, body, footer, and close/agree controls are all styled', () => {
        for (const cls of ['.sb-legal-backdrop', '.sb-legal-modal', '.sb-legal-header', '.sb-legal-body', '.sb-legal-footer', '.sb-legal-close', '.sb-legal-agree']) {
            expect(css).toMatch(new RegExp(cls.replace('.', '\\.') + '\\{'));
        }
    });
    test('body has a scrollbar (overflow-y:auto), not clipped content', () => {
        expect(css).toMatch(/\.sb-legal-body\{[^}]*overflow-y:auto/);
    });
});

describe('Legal links open the in-page modal instead of navigating away', () => {
    const pages = [
        'public/pages/auth/login.html', 'public/pages/auth/register.html',
        'public/pages/passenger/booking.html', 'public/pages/passenger/hotro.html',
        'public/pages/passenger/index.html', 'public/pages/passenger/nha-xe.html',
        'public/pages/passenger/profile.html',
    ];

    test.each(pages)('%s loads legalModal.js and wires its legal links to openLegalModal(), not a plain navigation', (rel) => {
        const html = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
        expect(html).toMatch(/<script src="\/js\/legalModal\.js"><\/script>/);
        /* Bug found live (2026-08-22): register.html had TWO onclick
           attributes on each legal link — `onclick="event.stopPropagation()"
           onclick="openLegalModal(...)"`. HTML keeps only the FIRST
           duplicate attribute (unlike CSS, which keeps the last), so the
           real one silently never ran — the link fell through to its
           `href` and navigated the whole page away, losing any in-progress
           registration form data. This exact regex still matched that
           broken markup, because it does a raw-text search over the whole
           file rather than checking what onclick value a browser would
           actually use — the literal string `onclick="openLegalModal(...)`
           was present, just as the second, dead attribute. Loosened to
           tolerate an optional prefix before openLegalModal() (register.html
           now correctly combines both calls into one onclick), and paired
           with the no-duplicate-onclick assertion below, which is what
           actually would have caught this. */
        expect(html).toMatch(/onclick="[^"]*openLegalModal\('terms'\)[^"]*;return false;"/);
        expect(html).toMatch(/onclick="[^"]*openLegalModal\('privacy'\)[^"]*;return false;"/);
        // No more target="_blank" on these specific links now that navigation
        // never happens — a leftover would be harmless but is a smell.
        expect(html).not.toMatch(/href="\/pages\/legal\/[^"]*" target="_blank"/);
    });

    test.each(pages)('%s has no element with a duplicate onclick attribute (the real bug behind the register.html regression)', (rel) => {
        const html = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
        // Matches any tag with two or more onclick="..." attributes — a
        // browser silently keeps only the first and drops the rest, which
        // is exactly how register.html's legal links stopped calling
        // openLegalModal() without ever throwing an error anywhere.
        const tagsWithDuplicateOnclick = html.match(/<[a-z]+\b[^>]*\bonclick="[^"]*"[^>]*\bonclick="[^"]*"[^>]*>/gi) || [];
        expect(tagsWithDuplicateOnclick).toEqual([]);
    });

    test('passenger/index.html\'s "Hoàn vé & đổi vé" link opens the terms modal scrolled to the #refund section', () => {
        const html = fs.readFileSync(path.join(__dirname, '../public/pages/passenger/index.html'), 'utf8');
        expect(html).toMatch(/openLegalModal\('terms','refund'\)/);
    });

    test.each(pages)('%s has no inline script syntax errors after the link rewiring', (rel) => {
        const html = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
        const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
        scripts.forEach(src => expect(() => new Function(src)).not.toThrow());
    });
});

/* ══════════════════════════════════════════
   6. Topbar CSS hardening — overflow:visible + min-width:0
══════════════════════════════════════════ */
describe('Topbar container hardening — overflow:visible + min-width:0 on all 18 pages', () => {
    const hdrActionsPages = [
        'public/pages/admin/admin.html', 'public/pages/admin/defense-dashboard.html',
        'public/pages/admin/operators.html', 'public/pages/admin/settings.html',
        'public/pages/admin/support.html', 'public/pages/admin/users.html',
        'public/pages/operator/bookings.html', 'public/pages/operator/operator.html',
        'public/pages/operator/revenue.html', 'public/pages/operator/seats.html',
        'public/pages/operator/trips.html', 'public/pages/operator/vehicles.html',
    ];
    const navRightPages = [
        'public/pages/passenger/booking.html', 'public/pages/passenger/hotro.html',
        'public/pages/passenger/index.html', 'public/pages/passenger/nha-xe.html',
        'public/pages/passenger/profile.html',
    ];

    test.each(hdrActionsPages)('%s .hdr-actions has overflow:visible !important + min-width:0', (rel) => {
        const html = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
        expect(html).toMatch(/\.hdr-actions\{[^}]*overflow:visible !important;min-width:0;\}/);
    });

    test.each(navRightPages)('%s .nav-right has overflow:visible !important + min-width:0', (rel) => {
        const html = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
        expect(html).toMatch(/\.nav-right\{[^}]*overflow:visible !important;min-width:0;\}/);
    });

    test('operator/scan.html (no .hdr-actions wrapper — #sbProfile sits directly in .hdr) hardens .hdr itself', () => {
        const html = fs.readFileSync(path.join(__dirname, '../public/pages/operator/scan.html'), 'utf8');
        expect(html).toMatch(/\.hdr\{[^}]*overflow:visible !important;min-width:0;\}/);
    });
});
