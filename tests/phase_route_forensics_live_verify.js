'use strict';
/**
 * Route-forensics fix — live verification. Replicates resolveRouteStops()
 * / inferRoute()'s exact logic (as now implemented in index.html) against
 * the REAL running server (GET /api/stops) and REAL DB (trip origin_lat/
 * origin_lng/dest_lat/dest_lng), to prove the fix against real data
 * without requiring a browser. NOT a substitute for browser/DOM
 * verification — reported honestly as such.
 */
const BASE = 'http://localhost:2704/api';
require('dotenv').config();
const db = require('../server/config/db');

// Now requires the REAL shared module the browser loads (public/js/routeInference.js)
// instead of a hand-copied duplicate — stronger fidelity, single source of truth.
const { inferRoute } = require('../public/js/routeInference');

async function resolveRouteStops(t){
  if(t.route_id){
    const res = await fetch(`${BASE}/stops?route_id=${t.route_id}`);
    if(res.ok){
      const rows = await res.json();
      const real = (Array.isArray(rows)?rows:[])
        .filter(s=>s.lat!=null&&s.lng!=null&&Number(s.lat)!==0&&Number(s.lng)!==0)
        .sort((a,b)=>(a.stop_order||0)-(b.stop_order||0));
      if(real.length) return { tier: 'REAL_DB', stops: real.map(s=>s.stop_name) };
    }
  }
  const curated = inferRoute(t.origin, t.destination);
  if(curated && curated.length>2) return { tier: 'CURATED_ESTIMATE', stops: curated };
  return { tier: 'ORIGIN_DEST_ONLY', stops: [t.origin, t.destination] };
}

const TEST_PAIRS = [
  ['Bắc Giang','Tuyên Quang'],   // CASE A
  ['Hòa Bình','Ninh Bình'],       // CASE B
  ['Hà Nội','Hải Phòng'],
  ['Hà Nội','Hồ Chí Minh'],
  ['Sơn La','Điện Biên'],         // mountain route
  ['Đà Nẵng','Huế'],              // central route
  ['Cần Thơ','An Giang'],         // southern route
];

(async () => {
  const results = [];
  for (const [origin, destination] of TEST_PAIRS) {
    const [[route]] = await db.query('SELECT route_id, origin, destination, origin_lat, origin_lng, dest_lat, dest_lng FROM route WHERE origin=? AND destination=?', [origin, destination]);
    if (!route) { results.push({ origin, destination, found: false }); continue; }
    const r = await resolveRouteStops(route);
    const bannedCities = ['Hải Phòng','Hải Dương','Quảng Ninh','Hà Nội','Bắc Ninh'];
    const violatesBan = (origin !== 'Hà Nội' && destination !== 'Hà Nội') &&
      r.stops.some(s => bannedCities.includes(s) && s !== origin && s !== destination);
    results.push({ origin, destination, route_id: route.route_id, tier: r.tier, stops: r.stops, violatesBan });
  }
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
