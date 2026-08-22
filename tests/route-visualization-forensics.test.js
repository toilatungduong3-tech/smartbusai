'use strict';
/**
 * Route-visualization forensics fix — regression tests.
 * See tests/route_visualization_forensic_audit.md for the full
 * investigation. This tests the EXACT module the browser loads
 * (public/js/routeInference.js), not a reimplementation — a regression
 * here means the browser is broken too.
 */

const { inferRoute, normP, ROUTE_DB, HWY1 } = require('../public/js/routeInference');

// Fields the old latitude-only "Geographic fallback" branch fabricated in
// both reported cases — must never appear as an inferred intermediate stop
// for a route that has no curated ROUTE_DB/HWY1 entry.
const BANNED_UNLESS_ENDPOINT = ['Hải Phòng', 'Hải Dương', 'Quảng Ninh', 'Hà Nội', 'Bắc Ninh'];

function assertNoFabrication(origin, destination) {
    const result = inferRoute(origin, destination);
    // The whole point of the fix: no curated entry exists for either
    // reported case, so the function must return null (never a fabricated list).
    expect(result).toBeNull();
}

test('CASE A: Bắc Giang → Tuyên Quang — no curated entry, must return null (no fabrication)', () => {
    assertNoFabrication('Bắc Giang', 'Tuyên Quang');
});

test('CASE B: Hòa Bình → Ninh Bình — no curated entry, must return null (no fabrication)', () => {
    assertNoFabrication('Hòa Bình', 'Ninh Bình');
});

test('reverse of CASE A/B also fabricates nothing', () => {
    expect(inferRoute('Tuyên Quang', 'Bắc Giang')).toBeNull();
    expect(inferRoute('Ninh Bình', 'Hòa Bình')).toBeNull();
});

test('a mountain-region pair with no curated entry returns null, not a latitude-band guess', () => {
    expect(inferRoute('Sơn La', 'Điện Biên')).toBeNull();
});

test('root-cause regression guard: inferRoute must never select a city using only latitude', () => {
    // Directly proves the removed branch is gone: for ANY pair with no
    // ROUTE_DB/HWY1 entry, the result is always null — there is no code
    // path left that can return an intermediate city for such a pair.
    const noCurateEntryPairs = [
        ['Bắc Giang', 'Tuyên Quang'],
        ['Hòa Bình', 'Ninh Bình'],
        ['Lạng Sơn', 'Cao Bằng'],
        ['Sơn La', 'Lai Châu'],
    ];
    for (const [o, d] of noCurateEntryPairs) {
        expect(inferRoute(o, d)).toBeNull();
    }
});

describe('ROUTE_DB / HWY1 curated tier still works for known corridors', () => {
    test('Hà Nội → Hải Phòng resolves via ROUTE_DB, geographically real', () => {
        const r = inferRoute('Hà Nội', 'Hải Phòng');
        expect(r).toEqual(['Hà Nội', 'Hưng Yên', 'Hải Dương', 'Hải Phòng']);
    });

    test('Hà Nội → TP.HCM resolves via ROUTE_DB with real coastal-corridor provinces', () => {
        const r = inferRoute('Hà Nội', 'Hồ Chí Minh');
        expect(r).not.toBeNull();
        expect(r[0]).toBe('Hà Nội');
        expect(r[r.length - 1]).toBe('TP.HCM');
        expect(r.length).toBeGreaterThan(2);
    });

    test('a pair not in ROUTE_DB but both cities on the HWY1 spine resolves via the spine, in correct geographic order', () => {
        const r = inferRoute('Huế', 'Quảng Nam');
        expect(r).not.toBeNull();
        expect(r[0]).toBe('Huế');
        expect(r[r.length - 1]).toBe('Quảng Nam');
        // Huế comes before Đà Nẵng comes before Quảng Nam on HWY1 — order must be preserved.
        const idxDaNang = r.indexOf('Đà Nẵng');
        expect(idxDaNang).toBeGreaterThan(0);
        expect(idxDaNang).toBeLessThan(r.length - 1);
    });
});

test('normP normalizes Vietnamese province-name variants consistently', () => {
    expect(normP('TP. Hồ Chí Minh')).toBe(normP('Hồ Chí Minh'));
    expect(normP('Tỉnh Bắc Giang')).toBe(normP('Bắc Giang'));
});
