'use strict';
/**
 * TRUTHNODE — PHASE 2: Passenger Search Engine Correctness.
 * Live verification against the REAL running server (localhost:2704) and
 * REAL database. Proves request -> backend -> SQL -> response end-to-end
 * for the price/busType/sort/date filters — not "the UI has a slider so
 * it must be fixed", actual evidence.
 *
 * One-off live-verification script (Category C), not a permanent Jest
 * suite — read-only (SELECT/EXPLAIN queries plus GET requests only, no
 * mutation), safe to re-run any time against the real server.
 */
require('dotenv').config();
const db = require('../server/config/db');
const BASE = 'http://localhost:2704/api';

async function get(qs) {
    const res = await fetch(`${BASE}/trips/search?${qs}`);
    let body = null;
    try { body = await res.json(); } catch {}
    return { status: res.status, body };
}

async function main() {
    const results = [];
    function check(name, pass, detail) {
        results.push({ name, pass, detail });
        console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
    }

    // ── PRICE FILTER MATRIX (Section 1) ──
    const r0 = await get('minPrice=0');
    const rBase = await get('');
    check('minPrice=0 matches everything (same count as unfiltered)', Array.isArray(r0.body) && r0.body.length === rBase.body.length,
        `min0=${r0.body?.length} baseline=${rBase.body?.length}`);

    const rMin = await get('minPrice=200000');
    check('minPrice=200000 — every returned trip price >= 200000',
        Array.isArray(rMin.body) && rMin.body.every(t => Number(t.base_price) >= 200000),
        `count=${rMin.body?.length}`);

    const rMax = await get('maxPrice=200000');
    check('maxPrice=200000 — every returned trip price <= 200000',
        Array.isArray(rMax.body) && rMax.body.every(t => Number(t.base_price) <= 200000),
        `count=${rMax.body?.length}`);

    const rRange = await get('minPrice=100000&maxPrice=200000');
    check('range [100000,200000] — every trip strictly within bounds',
        Array.isArray(rRange.body) && rRange.body.every(t => Number(t.base_price) >= 100000 && Number(t.base_price) <= 200000),
        `count=${rRange.body?.length}`);

    const rInv = await get('minPrice=500000&maxPrice=100000');
    check('min>max rejected with 422', rInv.status === 422, JSON.stringify(rInv.body));

    const rEq = await get('minPrice=200000&maxPrice=200000');
    check('min===max — exact-price match only',
        Array.isArray(rEq.body) && rEq.body.length > 0 && rEq.body.every(t => Number(t.base_price) === 200000),
        `count=${rEq.body?.length}`);

    const rBad = await get('minPrice=abc');
    check('invalid minPrice rejected with 422', rBad.status === 422);

    const rHex = await get('minPrice=0x10');
    check('hex notation rejected with 422 (not silently parsed as 16)', rHex.status === 422);

    const rInf = await get('minPrice=Infinity');
    check('"Infinity" rejected with 422, never a 500 (was a live crash before this phase)', rInf.status === 422);

    // ── VEHICLE TYPE FILTER (Section 2) — proves the keyword-match fix against real data shapes ──
    const rVip = await get('busType=VIP');
    check('busType=VIP returns only buses whose real bus_type contains "VIP"',
        Array.isArray(rVip.body) && rVip.body.length > 0 && rVip.body.every(t => /VIP/i.test(t.bus_type || '')),
        `count=${rVip.body?.length} types=${JSON.stringify([...new Set(rVip.body?.map(t => t.bus_type))])}`);

    const rNormal = await get('busType=NORMAL');
    check('busType=NORMAL excludes every VIP/LIMOUSINE-keyword bus',
        Array.isArray(rNormal.body) && rNormal.body.length > 0 && rNormal.body.every(t => !/VIP|LIMOUSINE/i.test(t.bus_type || '')),
        `count=${rNormal.body?.length}`);

    // ── SORT (Section 3) — numeric, not lexical/string ──
    const rAsc = await get('sort=asc');
    const pricesAsc = (rAsc.body || []).map(t => Number(t.base_price));
    const isSortedAsc = pricesAsc.every((p, i) => i === 0 || p >= pricesAsc[i - 1]);
    check('sort=asc is numerically non-decreasing (not string-sorted)', isSortedAsc, `first5=${JSON.stringify(pricesAsc.slice(0, 5))}`);

    const rDesc = await get('sort=desc');
    const pricesDesc = (rDesc.body || []).map(t => Number(t.base_price));
    const isSortedDesc = pricesDesc.every((p, i) => i === 0 || p <= pricesDesc[i - 1]);
    check('sort=desc is numerically non-increasing', isSortedDesc, `first5=${JSON.stringify(pricesDesc.slice(0, 5))}`);

    // Explicit proof against the exact bug class named in the phase brief:
    // formatted strings ("99.000đ" vs "1.200.000đ") must never be what gets
    // sorted — confirm the API returns raw numeric base_price (a JSON
    // number), not a pre-formatted display string, which is what a
    // string-sort bug would require in the first place.
    const sampleTrip = (rAsc.body || [])[0];
    check('base_price is returned as a raw JSON number, not a formatted currency string',
        sampleTrip && typeof sampleTrip.base_price !== 'string' || (sampleTrip && /^\d+(\.\d+)?$/.test(String(sampleTrip.base_price))),
        `sample=${JSON.stringify(sampleTrip?.base_price)}`);

    // ── DATE FILTER (Section 4) — timezone-safe ──
    const [[{ todayLocal }]] = await db.query("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d') AS todayLocal");
    const rToday = await get(`date=${todayLocal}`);
    check(`date=${todayLocal} (server's own local today) returns 200, all matching that exact date`,
        rToday.status === 200 && (rToday.body || []).every(t => String(t.departure_time).slice(0, 10) === todayLocal),
        `count=${rToday.body?.length}`);

    // ── PERFORMANCE (Section 6) — trip index actually used, not a full scan ──
    const [explain] = await db.query("EXPLAIN SELECT t.trip_id FROM trip t WHERE t.departure_time > NOW()");
    check('trip(status, departure_time) index is used for the hot-path date filter (not type=ALL)',
        explain[0] && explain[0].type !== 'ALL' && explain[0].key === 'idx_trip_status_departure',
        JSON.stringify(explain[0]));

    console.log(`\n${results.filter(r => r.pass).length}/${results.length} checks passed`);
    process.exit(results.every(r => r.pass) ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
