'use strict';
/**
 * TRUTHNODE — SPRINT 9: Topbar Layout Hardening, Social OAuth UI Complete
 * & Legal Policy Pages.
 *
 * No live HTTP server is spun up here (no supertest dependency in this
 * repo) — matches the established convention already used by
 * tests/phase5-production-defense.test.js and tests/phase7-ui-auth-harmony
 * .test.js for things that can't be exercised without a live server/DB in
 * this suite: read the real files from disk and assert on their actual
 * content/structure. The legal pages and CSS hardening were additionally
 * live-verified against the real running server this session (real HTTP
 * 200s, DOM measurements) — see SPRINT9_FINAL_REPORT.md.
 */

const fs = require('fs');
const path = require('path');

const PASSENGER_PAGES = ['index.html', 'nha-xe.html', 'hotro.html', 'profile.html', 'booking.html'];
const ADMIN_PAGES = ['admin.html', 'users.html', 'operators.html', 'support.html', 'settings.html', 'defense-dashboard.html'];
const OPERATOR_PAGES = ['operator.html', 'trips.html', 'vehicles.html', 'bookings.html', 'seats.html', 'revenue.html', 'scan.html'];

function readPage(area, file) {
    return fs.readFileSync(path.join(__dirname, `../public/pages/${area}/${file}`), 'utf8');
}

/* ══════════════════════════════════════════
   1. Legal policy pages — structure & required content
══════════════════════════════════════════ */
describe('public/pages/legal/privacy-policy.html', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/pages/legal/privacy-policy.html'), 'utf8');

    test('is a well-formed HTML5 document that loads the shared stylesheet', () => {
        expect(html).toMatch(/<!DOCTYPE html>/i);
        expect(html).toMatch(/<html lang="vi">/);
        expect(html).toMatch(/<link rel="stylesheet" href="\/css\/style\.css">/);
        expect(html).toMatch(/<title>[^<]*Chính sách bảo mật[^<]*<\/title>/);
    });

    test('cites the correct legal basis (Nghị định 13/2023/NĐ-CP)', () => {
        expect(html).toMatch(/Nghị định số 13\/2023\/NĐ-CP/);
    });

    test('covers all required sections from the brief', () => {
        expect(html).toMatch(/Dữ liệu chúng tôi thu thập/);
        expect(html).toMatch(/Mục đích sử dụng dữ liệu/);
        expect(html).toMatch(/Chia sẻ dữ liệu với bên thứ ba/);
        expect(html).toMatch(/nhà xe/i); // explicit "shared with the operating bus company" carve-out
        expect(html).toMatch(/không bán, cho thuê/); // explicit no-sale-to-third-parties commitment
        expect(html).toMatch(/Bảo mật thông tin thanh toán/);
        expect(html).toMatch(/SSL\/TLS/);
        expect(html).toMatch(/PCI-DSS/);
        expect(html).toMatch(/Quyền của Quý khách/);
        expect(html).toMatch(/Quyền chỉnh sửa/);
        expect(html).toMatch(/Quyền xoá dữ liệu/);
    });

    test('has no inline <script> blocks with syntax errors (none expected — static content page)', () => {
        const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
        scripts.forEach(src => expect(() => new Function(src)).not.toThrow());
    });
});

describe('public/pages/legal/terms-of-service.html', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/pages/legal/terms-of-service.html'), 'utf8');

    test('is a well-formed HTML5 document that loads the shared stylesheet', () => {
        expect(html).toMatch(/<!DOCTYPE html>/i);
        expect(html).toMatch(/<link rel="stylesheet" href="\/css\/style\.css">/);
        expect(html).toMatch(/<title>[^<]*Điều khoản sử dụng[^<]*<\/title>/);
    });

    test('states the 15-minute PENDING auto-cancellation policy (matches bookingCleanup.js\'s real behavior, not an invented number)', () => {
        expect(html).toMatch(/PENDING/);
        expect(html).toMatch(/15 phút/);
        expect(html).toMatch(/tự động huỷ/);
    });

    test('has an anchor id="refund" matching the footer link\'s #refund fragment', () => {
        expect(html).toMatch(/id="refund"/);
    });

    test('covers required sections: booking/payment rules, passenger/operator responsibilities, liability limits', () => {
        expect(html).toMatch(/Quy định đặt vé và thanh toán/);
        expect(html).toMatch(/Trách nhiệm của Hành khách/);
        expect(html).toMatch(/Trách nhiệm của Nhà xe/);
        expect(html).toMatch(/Giới hạn trách nhiệm pháp lý/);
    });

    test('has no inline <script> blocks with syntax errors', () => {
        const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
        scripts.forEach(src => expect(() => new Function(src)).not.toThrow());
    });
});

/* ══════════════════════════════════════════
   2. Legal pages linked from every passenger page + both auth pages
══════════════════════════════════════════ */
describe('Legal page links — footer integration', () => {
    test.each(PASSENGER_PAGES)('passenger/%s links both terms-of-service.html and privacy-policy.html', (file) => {
        const html = readPage('passenger', file);
        expect(html).toMatch(/href="\/pages\/legal\/terms-of-service\.html/);
        expect(html).toMatch(/href="\/pages\/legal\/privacy-policy\.html/);
    });

    test('login.html links both legal pages near the OAuth buttons', () => {
        const html = fs.readFileSync(path.join(__dirname, '../public/pages/auth/login.html'), 'utf8');
        expect(html).toMatch(/href="\/pages\/legal\/terms-of-service\.html"/);
        expect(html).toMatch(/href="\/pages\/legal\/privacy-policy\.html"/);
    });

    test('register.html\'s terms checkbox links to real pages, not the old dead href="#" placeholders', () => {
        const html = fs.readFileSync(path.join(__dirname, '../public/pages/auth/register.html'), 'utf8');
        expect(html).toMatch(/href="\/pages\/legal\/terms-of-service\.html"/);
        expect(html).toMatch(/href="\/pages\/legal\/privacy-policy\.html"/);
        // The specific dead-link pattern this sprint fixed
        expect(html).not.toMatch(/<a href="#" onclick="event\.stopPropagation\(\)">Điều khoản dịch vụ<\/a>/);
    });
});

/* ══════════════════════════════════════════
   3. Topbar dropdown CSS hardening (.sb-profile / .sb-profile-menu)
══════════════════════════════════════════ */
describe('public/css/style.css — .sb-profile / .sb-profile-menu integrity', () => {
    const css = fs.readFileSync(path.join(__dirname, '../public/css/style.css'), 'utf8');

    test('.sb-profile-menu explicitly anchors right:0 and left:auto (Sprint 9 hardening)', () => {
        expect(css).toMatch(/\.sb-profile-menu\{[^}]*right:0[^}]*left:auto/);
    });

    test('.sb-profile-menu has a high z-index and viewport-relative max-width clamp', () => {
        expect(css).toMatch(/\.sb-profile-menu\{[^}]*z-index:4000/);
        expect(css).toMatch(/max-width:min\(280px,calc\(100vw - 24px\)\)/);
    });

    test('mobile bottom-sheet variant exists for narrow viewports', () => {
        expect(css).toMatch(/@media\(max-width:480px\)\{[\s\S]*\.sb-profile-menu\{position:fixed/);
    });

    test('OAuth button spinner (.oauth-spinner) is defined with a rotation animation', () => {
        expect(css).toMatch(/@keyframes oauthSpin\{to\{transform:rotate\(360deg\);\}\}/);
        expect(css).toMatch(/\.oauth-spinner\{[^}]*animation:oauthSpin/);
    });
});

/* ══════════════════════════════════════════
   4. Dead .btn-logout CSS removed from all 18 pages (Sprint 8 leftover)
══════════════════════════════════════════ */
describe('Dead .btn-logout CSS cleanup', () => {
    const allPages = [
        ...ADMIN_PAGES.map(f => ['admin', f]),
        ...OPERATOR_PAGES.map(f => ['operator', f]),
        ...PASSENGER_PAGES.map(f => ['passenger', f]),
    ];

    test.each(allPages)('%s/%s has no leftover .btn-logout rule (markup using it was removed in Sprint 8, the CSS rule itself was not)', (area, file) => {
        const html = readPage(area, file);
        expect(html).not.toMatch(/\.btn-logout\{/);
    });
});

/* ══════════════════════════════════════════
   5. profile.html — initProfileDropdown no longer runs before its
      container exists in the DOM (the real bug found live this sprint)
══════════════════════════════════════════ */
describe('passenger/profile.html — initProfileDropdown timing regression guard', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/pages/passenger/profile.html'), 'utf8');

    test('the head-level auth-guard IIFE no longer calls initProfileDropdown before <body> exists', () => {
        const headGuardMatch = html.match(/\(function\(\)\{var u;try\{u=JSON\.parse\(localStorage\.getItem\('user'\)[\s\S]*?\}\)\(\);/);
        expect(headGuardMatch).not.toBeNull();
        expect(headGuardMatch[0]).not.toMatch(/initProfileDropdown/);
    });

    test('initProfileDropdown is called inside the DOMContentLoaded handler instead, after #sbProfile exists', () => {
        const bodyIdx = html.indexOf('<body');
        const sbProfileIdx = html.indexOf('id="sbProfile"');
        const domReadyIdx = html.indexOf('document.addEventListener("DOMContentLoaded"');
        const initCallIdx = html.indexOf('initProfileDropdown("sbProfile")');
        expect(bodyIdx).toBeGreaterThan(0);
        expect(sbProfileIdx).toBeGreaterThan(bodyIdx);
        expect(initCallIdx).toBeGreaterThan(sbProfileIdx);
        expect(initCallIdx).toBeGreaterThan(domReadyIdx);
    });
});

/* ══════════════════════════════════════════
   6. OAuth login/register — role-based redirect (Sprint 9 fix)
      Previously hardcoded to passenger/index.html regardless of the
      account's real role — an existing ADMIN/OPERATOR account signing in
      via Google/Facebook landed on the wrong dashboard.
══════════════════════════════════════════ */
describe('OAuth handlers — role-based redirect after login/register', () => {
    function blockAfter(html, needle, windowSize = 1700) {
        const start = html.indexOf(needle);
        expect(start).toBeGreaterThan(-1);
        return html.slice(start, start + windowSize);
    }

    test('login.html\'s Google and Facebook handlers branch on data.user.role instead of hardcoding passenger/index.html', () => {
        const html = fs.readFileSync(path.join(__dirname, '../public/pages/auth/login.html'), 'utf8');
        const googleBlock = blockAfter(html, 'async function _processGoogleCredential');
        const fbBlock = blockAfter(html, 'async function _processFacebookToken');
        for (const block of [googleBlock, fbBlock]) {
            expect(block).toMatch(/role==="ADMIN"/);
            expect(block).toMatch(/role==="OPERATOR"/);
            expect(block).toMatch(/\/pages\/admin\/admin\.html/);
            expect(block).toMatch(/\/pages\/operator\/operator\.html/);
        }
    });

    test('register.html\'s Google and Facebook handlers also branch on role (an existing account can register-flow through OAuth too)', () => {
        const html = fs.readFileSync(path.join(__dirname, '../public/pages/auth/register.html'), 'utf8');
        const googleBlock = blockAfter(html, 'async function _processGoogleCredential');
        expect(googleBlock).toMatch(/role==="ADMIN"/);
        expect(googleBlock).toMatch(/role==="OPERATOR"/);
    });

    test('OAuth buttons show a real spinner (.oauth-spinner), not just dimmed static text, while connecting', () => {
        const login = fs.readFileSync(path.join(__dirname, '../public/pages/auth/login.html'), 'utf8');
        const register = fs.readFileSync(path.join(__dirname, '../public/pages/auth/register.html'), 'utf8');
        expect(login).toMatch(/<span class="oauth-spinner"><\/span>/);
        expect(register).toMatch(/<span class="oauth-spinner"><\/span>/);
    });
});

/* ══════════════════════════════════════════
   7. initProfileDropdown — guest (logged-out) state
      Live-reported regression: a guest visiting any page using the shared
      dropdown component (public/js/api.js) saw a completely empty topbar
      — no avatar, no login link, nothing — because initProfileDropdown
      returned early with the container left blank whenever getUser()
      found no session. Fixed to render a "Đăng nhập" link instead.
══════════════════════════════════════════ */
describe('public/js/api.js — initProfileDropdown renders a login link for guests instead of leaving the topbar empty', () => {
    const js = fs.readFileSync(path.join(__dirname, '../public/js/api.js'), 'utf8');
    const fnSrc = js.slice(js.indexOf('function initProfileDropdown'), js.indexOf('function initProfileDropdown') + 1200);

    test('does not bail out with an empty container when there is no logged-in user', () => {
        expect(fnSrc).not.toMatch(/if \(!user\) return;\s*\n\s*\n\s*const initial/);
    });

    test('renders a link to the login page for guests', () => {
        expect(fnSrc).toMatch(/if \(!user\) \{/);
        expect(fnSrc).toMatch(/href="\/pages\/auth\/login\.html"/);
        expect(fnSrc).toMatch(/Đăng nhập/);
    });
});
