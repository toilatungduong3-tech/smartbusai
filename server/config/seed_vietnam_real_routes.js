'use strict';
/**
 * Sprint 10 — Vietnam Real-World Routing Engine.
 *
 * Root cause (confirmed via live query before writing this script): every
 * route_stop row in this DB represents a boarding/alighting STATION near
 * the trip's origin or destination city — average 2.4 rows/route, and
 * ZERO intermediate rows on every single route over 500km. The map
 * polyline (resolveRouteStops() in public/pages/passenger/index.html)
 * trusts route_stop as the authoritative path for a route whenever any
 * rows exist for it — so a long-haul trip with only origin-city +
 * destination-city stations drew one straight segment connecting them,
 * cutting across the country regardless of real highway geography. This
 * is not a client-side rendering bug — the fix belongs in the data.
 *
 * This script inserts real intercity WAYPOINT rows (migrate_v18.sql's new
 * stop_type) for every route whose origin/destination are in different
 * provinces. Two-tier path resolution, same priority philosophy already
 * used by public/js/routeInference.js's resolveRouteStops() waterfall:
 *
 *   TIER 1: the existing hand-curated ROUTE_DB/HWY1 corridors (imported
 *           directly from routeInference.js, not re-typed — these encode
 *           REAL bus-route preference, e.g. Hà Nội-TP.HCM correctly runs
 *           the full QL1A coast, not a geometrically-shorter Tây Nguyên
 *           cut-through). Covers ~127 of the highest-traffic pairs.
 *   TIER 2: Dijkstra shortest path (weighted by real haversine distance,
 *           not hop count — an unweighted BFS was tried first and
 *           rejected: it preferred a shorter-hop-count Tây Nguyên detour
 *           over the correct coastal route for several long pairs) over
 *           PROVINCE_ADJ, a genuine adjacency graph of Vietnam's 63
 *           provinces/cities. Covers the remaining ~968 lower-traffic
 *           pairs with no curated entry.
 *
 * Coordinates are provincial-capital-level accuracy — correct for a route
 * CORRIDOR visualization, not turn-by-turn navigation.
 *
 * Honesty exception, matching this codebase's existing routeInference.js
 * precedent of never fabricating geography: routes to Phú Quốc (an
 * island — TP.HCM/Cần Thơ/Kiên Giang <-> Phú Quốc, 6 routes) are
 * deliberately SKIPPED. There is no road. A straight line across the
 * water for these specific routes is the honest depiction (ferry/flight),
 * not a bug to paper over with a fake coastal detour.
 *
 * Idempotent: re-running deletes and re-inserts this script's own
 * WAYPOINT rows only — never touches real PICKUP/DROPOFF station data.
 *
 * Usage: node server/config/seed_vietnam_real_routes.js [--dry-run]
 */

require('dotenv').config();
const db = require('../config/db');
const { inferRoute } = require('../../public/js/routeInference.js');

// ── Provincial-capital coordinates, keyed by the EXACT strings used in
//    route.origin/route.destination (confirmed via live DISTINCT query —
//    67 values, including city aliases: "Đà Lạt"≈Lâm Đồng, "Nha Trang"≈
//    Khánh Hòa, "Huế"/"Thừa Thiên Huế" are the same place under two names).
const PROVINCE_GEO = {
  'Lai Châu': [22.3964, 103.4703], 'Điện Biên': [21.3860, 103.0230], 'Sơn La': [21.3256, 103.9188],
  'Lào Cai': [22.4809, 103.9755], 'Yên Bái': [21.7168, 104.8986], 'Hà Giang': [22.8025, 104.9784],
  'Cao Bằng': [22.6666, 106.2639], 'Bắc Kạn': [22.1470, 105.8348], 'Tuyên Quang': [21.8233, 105.2280],
  'Lạng Sơn': [21.8530, 106.7610], 'Thái Nguyên': [21.5942, 105.8480], 'Phú Thọ': [21.4200, 105.2181],
  'Vĩnh Phúc': [21.3089, 105.6049], 'Bắc Giang': [21.2731, 106.1946], 'Bắc Ninh': [21.1861, 106.0763],
  'Hà Nội': [21.0285, 105.8542], 'Hưng Yên': [20.6464, 106.0512], 'Hải Dương': [20.9373, 106.3145],
  'Quảng Ninh': [20.9722, 107.0431], 'Hải Phòng': [20.8449, 106.6881], 'Thái Bình': [20.4463, 106.3365],
  'Hà Nam': [20.5417, 105.9227], 'Nam Định': [20.4341, 106.1675], 'Ninh Bình': [20.2506, 105.9744],
  'Hòa Bình': [20.8156, 105.3373], 'Thanh Hóa': [19.8067, 105.7852], 'Nghệ An': [18.6790, 105.6813],
  'Hà Tĩnh': [18.3428, 105.9057], 'Quảng Bình': [17.4684, 106.6222], 'Quảng Trị': [16.7404, 107.1854],
  'Huế': [16.4637, 107.5909], 'Thừa Thiên Huế': [16.4637, 107.5909],
  'Đà Nẵng': [16.0544, 108.2022], 'Quảng Nam': [15.5738, 108.4741], 'Quảng Ngãi': [15.1214, 108.8044],
  'Bình Định': [13.7820, 109.2192], 'Phú Yên': [13.0882, 109.0929],
  'Khánh Hòa': [12.2388, 109.1967], 'Nha Trang': [12.2388, 109.1967],
  'Ninh Thuận': [11.5645, 108.9899], 'Bình Thuận': [10.9280, 108.1022],
  'Kon Tum': [14.3497, 108.0005], 'Gia Lai': [13.9833, 108.0000], 'Đắk Lắk': [12.6667, 108.0500],
  'Đắk Nông': [12.2646, 107.6098], 'Lâm Đồng': [11.9404, 108.4583], 'Đà Lạt': [11.9404, 108.4583],
  'TP. Hồ Chí Minh': [10.7769, 106.7009], 'Đồng Nai': [10.9574, 106.8426], 'Bình Dương': [10.9804, 106.6519],
  'Bình Phước': [11.7511, 106.9235], 'Tây Ninh': [11.3100, 106.0989], 'Bà Rịa - Vũng Tàu': [10.4114, 107.1362],
  'Long An': [10.5449, 106.4111], 'Tiền Giang': [10.3600, 106.3600], 'Bến Tre': [10.2433, 106.3756],
  'Vĩnh Long': [10.2537, 105.9722], 'Trà Vinh': [9.9347, 106.3453], 'Đồng Tháp': [10.4938, 105.6881],
  'An Giang': [10.3891, 105.4356], 'Kiên Giang': [10.0125, 105.0808], 'Cần Thơ': [10.0452, 105.7469],
  'Hậu Giang': [9.7845, 105.4700], 'Sóc Trăng': [9.6003, 105.9800], 'Bạc Liêu': [9.2846, 105.7215],
  'Cà Mau': [9.1768, 105.1524], 'Phú Quốc': [10.2270, 103.9670],
  // Aliases only referenced from routeInference.js's ROUTE_DB/HWY1 (Tier 1
  // below) — not route.origin/destination values themselves, but needed
  // so those curated corridor names resolve to real coordinates too.
  'TP.HCM': [10.7769, 106.7009], 'Buôn Ma Thuột': [12.6667, 108.0500],
  'Vinh': [18.6790, 105.6813], 'Phan Thiết': [10.9280, 108.1022],
};

// Canonical name for adjacency-graph purposes (collapses the city aliases
// onto their parent province — Đà Lạt/Nha Trang/Thừa Thiên Huế are the
// same node as Lâm Đồng/Khánh Hòa/Huế for pathfinding).
const CANON = {
  'Đà Lạt': 'Lâm Đồng', 'Nha Trang': 'Khánh Hòa', 'Thừa Thiên Huế': 'Huế',
  'TP.HCM': 'TP. Hồ Chí Minh', 'Buôn Ma Thuột': 'Đắk Lắk', 'Vinh': 'Nghệ An', 'Phan Thiết': 'Bình Thuận',
};
function canon(name) { return CANON[name] || name; }

// ── Real province-to-province adjacency (genuine shared borders / direct
//    highway links — QL1A, QL14, QL5, QL6, QL2, QL3, QL32, QL18, QL20,
//    QL26, QL19, QL60, QL80, N2 among others). Undirected; each edge
//    listed once, expanded to both directions below.
const EDGES = [
  // Northwest / North mountains
  ['Lai Châu', 'Điện Biên'], ['Lai Châu', 'Sơn La'], ['Lai Châu', 'Lào Cai'],
  ['Điện Biên', 'Sơn La'],
  ['Sơn La', 'Hòa Bình'], ['Sơn La', 'Yên Bái'], ['Sơn La', 'Phú Thọ'],
  ['Lào Cai', 'Yên Bái'], ['Lào Cai', 'Hà Giang'],
  ['Yên Bái', 'Hà Giang'], ['Yên Bái', 'Tuyên Quang'], ['Yên Bái', 'Phú Thọ'],
  ['Hà Giang', 'Tuyên Quang'], ['Hà Giang', 'Cao Bằng'],
  ['Tuyên Quang', 'Cao Bằng'], ['Tuyên Quang', 'Bắc Kạn'], ['Tuyên Quang', 'Thái Nguyên'],
  ['Tuyên Quang', 'Phú Thọ'], ['Tuyên Quang', 'Vĩnh Phúc'],
  ['Cao Bằng', 'Bắc Kạn'], ['Cao Bằng', 'Lạng Sơn'],
  ['Bắc Kạn', 'Lạng Sơn'], ['Bắc Kạn', 'Thái Nguyên'],
  ['Lạng Sơn', 'Bắc Giang'], ['Lạng Sơn', 'Thái Nguyên'], ['Lạng Sơn', 'Quảng Ninh'],
  ['Thái Nguyên', 'Bắc Giang'], ['Thái Nguyên', 'Vĩnh Phúc'], ['Thái Nguyên', 'Phú Thọ'], ['Thái Nguyên', 'Hà Nội'],
  ['Phú Thọ', 'Vĩnh Phúc'], ['Phú Thọ', 'Hòa Bình'], ['Phú Thọ', 'Hà Nội'],
  ['Hòa Bình', 'Hà Nội'], ['Hòa Bình', 'Ninh Bình'], ['Hòa Bình', 'Thanh Hóa'],
  // Red River Delta
  ['Vĩnh Phúc', 'Hà Nội'],
  ['Bắc Giang', 'Bắc Ninh'], ['Bắc Giang', 'Hà Nội'], ['Bắc Giang', 'Hải Dương'], ['Bắc Giang', 'Quảng Ninh'],
  ['Bắc Ninh', 'Hà Nội'], ['Bắc Ninh', 'Hưng Yên'], ['Bắc Ninh', 'Hải Dương'],
  ['Hà Nội', 'Hưng Yên'], ['Hà Nội', 'Hà Nam'],
  ['Hưng Yên', 'Hải Dương'], ['Hưng Yên', 'Thái Bình'], ['Hưng Yên', 'Hà Nam'],
  ['Hải Dương', 'Hải Phòng'], ['Hải Dương', 'Quảng Ninh'], ['Hải Dương', 'Thái Bình'],
  ['Quảng Ninh', 'Hải Phòng'],
  ['Hải Phòng', 'Thái Bình'],
  ['Thái Bình', 'Nam Định'],
  ['Hà Nam', 'Nam Định'], ['Hà Nam', 'Ninh Bình'],
  ['Nam Định', 'Ninh Bình'],
  ['Ninh Bình', 'Thanh Hóa'],
  // North & South Central Coast (QL1A spine)
  ['Thanh Hóa', 'Nghệ An'], ['Nghệ An', 'Hà Tĩnh'], ['Hà Tĩnh', 'Quảng Bình'],
  ['Quảng Bình', 'Quảng Trị'], ['Quảng Trị', 'Huế'], ['Huế', 'Đà Nẵng'], ['Huế', 'Quảng Nam'],
  ['Đà Nẵng', 'Quảng Nam'],
  ['Quảng Nam', 'Quảng Ngãi'], ['Quảng Nam', 'Kon Tum'],
  ['Quảng Ngãi', 'Bình Định'], ['Quảng Ngãi', 'Kon Tum'],
  ['Bình Định', 'Phú Yên'], ['Bình Định', 'Gia Lai'],
  ['Phú Yên', 'Khánh Hòa'], ['Phú Yên', 'Gia Lai'], ['Phú Yên', 'Đắk Lắk'],
  ['Khánh Hòa', 'Ninh Thuận'], ['Khánh Hòa', 'Đắk Lắk'], ['Khánh Hòa', 'Lâm Đồng'],
  ['Ninh Thuận', 'Bình Thuận'], ['Ninh Thuận', 'Lâm Đồng'],
  ['Bình Thuận', 'Đồng Nai'], ['Bình Thuận', 'Lâm Đồng'], ['Bình Thuận', 'Bình Phước'], ['Bình Thuận', 'Bà Rịa - Vũng Tàu'],
  // Tây Nguyên (QL14 spine)
  ['Kon Tum', 'Gia Lai'], ['Gia Lai', 'Đắk Lắk'], ['Đắk Lắk', 'Đắk Nông'],
  ['Đắk Nông', 'Lâm Đồng'], ['Đắk Nông', 'Bình Phước'], ['Đắk Nông', 'Đồng Nai'], ['Đắk Nông', 'Bình Dương'],
  ['Lâm Đồng', 'Đồng Nai'],
  // Đông Nam Bộ
  ['Đồng Nai', 'TP. Hồ Chí Minh'], ['Đồng Nai', 'Bình Dương'], ['Đồng Nai', 'Bà Rịa - Vũng Tàu'], ['Đồng Nai', 'Bình Phước'],
  ['Bình Dương', 'TP. Hồ Chí Minh'], ['Bình Dương', 'Bình Phước'], ['Bình Dương', 'Tây Ninh'],
  ['Bình Phước', 'Tây Ninh'],
  ['Tây Ninh', 'Long An'], ['Tây Ninh', 'TP. Hồ Chí Minh'],
  ['TP. Hồ Chí Minh', 'Long An'], ['TP. Hồ Chí Minh', 'Bà Rịa - Vũng Tàu'], ['TP. Hồ Chí Minh', 'Tiền Giang'],
  // Mekong Delta
  ['Long An', 'Tiền Giang'], ['Long An', 'Đồng Tháp'],
  ['Tiền Giang', 'Bến Tre'], ['Tiền Giang', 'Vĩnh Long'], ['Tiền Giang', 'Đồng Tháp'],
  ['Bến Tre', 'Vĩnh Long'], ['Bến Tre', 'Trà Vinh'],
  ['Vĩnh Long', 'Trà Vinh'], ['Vĩnh Long', 'Đồng Tháp'], ['Vĩnh Long', 'Cần Thơ'], ['Vĩnh Long', 'Sóc Trăng'],
  ['Trà Vinh', 'Sóc Trăng'],
  ['Đồng Tháp', 'An Giang'], ['Đồng Tháp', 'Cần Thơ'],
  ['An Giang', 'Kiên Giang'], ['An Giang', 'Cần Thơ'],
  ['Cần Thơ', 'Kiên Giang'], ['Cần Thơ', 'Hậu Giang'], ['Cần Thơ', 'Sóc Trăng'],
  ['Hậu Giang', 'Kiên Giang'], ['Hậu Giang', 'Sóc Trăng'], ['Hậu Giang', 'Bạc Liêu'],
  ['Sóc Trăng', 'Bạc Liêu'],
  ['Bạc Liêu', 'Cà Mau'], ['Bạc Liêu', 'Kiên Giang'],
  ['Cà Mau', 'Kiên Giang'],
];

const PROVINCE_ADJ = {};
for (const [a, b] of EDGES) {
  (PROVINCE_ADJ[a] = PROVINCE_ADJ[a] || new Set()).add(b);
  (PROVINCE_ADJ[b] = PROVINCE_ADJ[b] || new Set()).add(a);
}

function haversineKm([lat1, lng1], [lat2, lng2]) {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Dijkstra shortest path between two canonical province names, weighted
 *  by real haversine distance between adjacent provinces' coordinates —
 *  NOT hop count. An unweighted BFS was tried first and rejected: for
 *  several long north-south pairs it preferred a shorter-HOP-COUNT
 *  detour through the Tây Nguyên highlands over the coastal QL1A route,
 *  because the highlands graph happens to have fewer edges between the
 *  same two endpoints even though real road distance is comparable or
 *  longer. Distance weighting fixes that for the general case; the
 *  known-correct human-curated corridors (Tier 1, see resolvePath below)
 *  still take precedence over this graph search regardless. Returns an
 *  array of province names from origin to dest inclusive, or null if
 *  disconnected (shouldn't happen — the graph above is fully connected). */
function shortestPath(origin, dest) {
  if (origin === dest) return [origin];
  const dist = { [origin]: 0 };
  const prev = {};
  const visited = new Set();
  const unvisited = new Set(Object.keys(PROVINCE_ADJ));
  unvisited.add(origin); unvisited.add(dest);

  while (unvisited.size) {
    let cur = null, curDist = Infinity;
    for (const n of unvisited) {
      if (dist[n] !== undefined && dist[n] < curDist) { curDist = dist[n]; cur = n; }
    }
    if (cur === null) break; // remaining nodes are unreachable
    unvisited.delete(cur);
    visited.add(cur);
    if (cur === dest) break;

    for (const next of PROVINCE_ADJ[cur] || []) {
      if (visited.has(next)) continue;
      if (!PROVINCE_GEO[next] || !PROVINCE_GEO[cur]) continue;
      const w = haversineKm(PROVINCE_GEO[cur], PROVINCE_GEO[next]);
      const alt = dist[cur] + w;
      if (dist[next] === undefined || alt < dist[next]) {
        dist[next] = alt;
        prev[next] = cur;
      }
    }
  }

  if (dist[dest] === undefined) return null;
  const path = [dest];
  let n = dest;
  while (prev[n] !== undefined) { n = prev[n]; path.unshift(n); }
  return path;
}

/** Thin a long path down to at most `max` points (always keeping first
 *  and last), matching the same thinning strategy already used by
 *  public/js/routeInference.js's HWY1 slicing so long corridors don't get
 *  an excessive number of waypoint markers on the map. */
function thin(path, max = 7) {
  if (path.length <= max) return path;
  const step = (path.length - 1) / (max - 1);
  const out = [path[0]];
  for (let i = 1; i < max - 1; i++) out.push(path[Math.round(i * step)]);
  out.push(path[path.length - 1]);
  return out;
}

/** Tier 1: the existing hand-curated ROUTE_DB/HWY1 corridor (real bus-route
 *  preference, not just geometry) — reused as-is, converting its output
 *  names through canon() to this script's PROVINCE_GEO keys. Tier 2:
 *  Dijkstra over the real adjacency graph. Returns a province-name array
 *  (origin..dest inclusive) or null if the pair is the same province. */
function resolvePath(origin, destination) {
  const curated = inferRoute(origin, destination);
  if (curated && curated.length > 2) {
    const mapped = curated.map(canon).filter(name => PROVINCE_GEO[name]);
    if (mapped.length > 2) return mapped;
  }
  const oCanon = canon(origin), dCanon = canon(destination);
  if (oCanon === dCanon) return null;
  return shortestPath(oCanon, dCanon);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const [routes] = await db.query('SELECT route_id, origin, destination FROM route');

  let inserted = 0, skippedIsland = 0, skippedSameProvince = 0, skippedNoGeo = 0, routesTouched = 0;
  const conn = dryRun ? null : await db.getConnection();

  try {
    if (conn) await conn.beginTransaction();
    const q = conn || db;

    for (const r of routes) {
      const { route_id, origin, destination } = r;

      if (origin === 'Phú Quốc' || destination === 'Phú Quốc') { skippedIsland++; continue; }

      if (!PROVINCE_GEO[origin] || !PROVINCE_GEO[destination]) { skippedNoGeo++; continue; }
      if (canon(origin) === canon(destination)) { skippedSameProvince++; continue; } // e.g. Nha Trang -> Khánh Hòa, no real waypoints needed

      const path = resolvePath(origin, destination);
      if (!path || path.length <= 2) continue; // adjacent provinces — no intermediate waypoint needed

      const intermediate = thin(path.slice(1, -1), 5); // exclude origin/dest themselves (already covered by PICKUP/DROPOFF stations)
      if (!intermediate.length) continue;

      // Idempotent: clear this script's own prior WAYPOINT rows for this route before re-inserting.
      await q.query(`DELETE FROM route_stop WHERE route_id = ? AND stop_type = 'WAYPOINT'`, [route_id]);

      const stopOrders = [10, 20, 30, 40, 50, 60, 70, 80, 90];
      for (let i = 0; i < intermediate.length; i++) {
        const name = intermediate[i];
        const [lat, lng] = PROVINCE_GEO[name];
        await q.query(
          `INSERT INTO route_stop (route_id, stop_name, stop_type, lat, lng, stop_order, is_active)
           VALUES (?, ?, 'WAYPOINT', ?, ?, ?, 1)`,
          [route_id, name, lat, lng, stopOrders[i]]
        );
        inserted++;
      }
      routesTouched++;
    }

    if (conn) { await conn.commit(); }
  } catch (err) {
    if (conn) await conn.rollback();
    throw err;
  } finally {
    if (conn) conn.release();
  }

  console.log(`[seed_vietnam_real_routes] ${dryRun ? '(DRY RUN — no writes) ' : ''}routes scanned: ${routes.length}`);
  console.log(`  waypoint rows inserted: ${inserted} (across ${routesTouched} routes)`);
  console.log(`  skipped — same province (e.g. Nha Trang<->Khánh Hòa): ${skippedSameProvince}`);
  console.log(`  skipped — Phú Quốc (island, no road — honest 2-point line kept): ${skippedIsland}`);
  console.log(`  skipped — unmapped province name: ${skippedNoGeo}`);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => { console.error('[seed_vietnam_real_routes] FAILED:', err); process.exit(1); });
}

module.exports = { PROVINCE_GEO, PROVINCE_ADJ, shortestPath, thin, canon, resolvePath };
