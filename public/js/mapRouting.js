'use strict';
/* ══════════════════════════════════════════════════════════════════
   SmartBusAI — shared Leaflet map helpers: terrain tile base + real
   road-following routing (OSRM) + livelier stop markers.

   Used by: passenger/index.html (route simulation modal + transit
   transfer map), operator/trips.html (trip route preview),
   passenger/profile.html (journey map tile only).

   Plain global-scope script (no bundler in this project) — loaded via
   <script src="/js/mapRouting.js"> after Leaflet is available, exposes
   sbAddTerrainTile / sbFetchOsrmRoute / sbStopIcon on window.
═══════════════════════════════════════════════════════════════════ */

// Esri World Topo Map: free, no API key required, renders hillshade,
// rivers/lakes, forest cover, province/district boundaries and place
// names — the "địa hình tự nhiên phong phú" the old flat dark_all base
// (roads + labels only, no terrain) didn't have.
const SB_TERRAIN_TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}';
const SB_TERRAIN_TILE_OPTS = {
  maxZoom: 19,
  attribution: 'Tiles &copy; Esri — Esri, HERE, Garmin, FAO, NOAA, USGS'
};
// Esri's basemap ships a light/paper palette. This filter is applied to the
// Leaflet tile pane only (not markers/popups/labels layered on top of it),
// pushing it toward this site's dark theme while keeping the terrain detail
// (hillshade/rivers/forest) that's the whole point of the tile switch.
const SB_TERRAIN_DARK_FILTER = 'invert(1) hue-rotate(180deg) brightness(0.92) contrast(0.90) saturate(0.85)';

function sbApplyDarkTerrain(map) {
  const pane = map.getPane('tilePane');
  if (pane) pane.style.filter = SB_TERRAIN_DARK_FILTER;
}

/** Adds the terrain tile layer (dark-blended) to a Leaflet map and returns it. */
function sbAddTerrainTile(map) {
  const layer = L.tileLayer(SB_TERRAIN_TILE_URL, SB_TERRAIN_TILE_OPTS).addTo(map);
  sbApplyDarkTerrain(map);
  return layer;
}

// ── OSRM real-road routing ──────────────────────────────────────────
// router.project-osrm.org is OSRM's public demo server — no API key, but
// it's a shared, rate-limited resource not meant for production traffic.
// Fine for this project's scale; every call is cached in-memory per exact
// waypoint set so re-opening the same trip's map doesn't re-fetch, and
// every failure mode (offline, timeout, non-OK, malformed response)
// resolves to `null` rather than throwing — callers must treat a real
// road path as a best-effort upgrade over their own fallback geometry,
// never a hard dependency for the map to render at all.
const _sbOsrmCache = new Map();

/**
 * @param {[number,number][]} waypointsLatLng ordered [lat,lng] pairs (>=2)
 * @param {{timeoutMs?:number}} [opts]
 * @returns {Promise<{points:[number,number][], distanceKm:number, durationMin:number}|null>}
 */
async function sbFetchOsrmRoute(waypointsLatLng, opts) {
  opts = opts || {};
  const timeoutMs = opts.timeoutMs || 7000;
  if (!Array.isArray(waypointsLatLng) || waypointsLatLng.length < 2) return null;

  const key = waypointsLatLng.map(([lat, lng]) => lat.toFixed(4) + ',' + lng.toFixed(4)).join(';');
  if (_sbOsrmCache.has(key)) return _sbOsrmCache.get(key);

  // OSRM expects lon,lat order (GeoJSON convention) — the opposite of the
  // [lat,lng] convention used everywhere else in this codebase/Leaflet.
  const coordStr = waypointsLatLng.map(([lat, lng]) => lng.toFixed(6) + ',' + lat.toFixed(6)).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let result = null;
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (res.ok) {
      const data = await res.json();
      if (data.code === 'Ok' && data.routes && data.routes[0] && data.routes[0].geometry) {
        const points = data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        if (points.length > 1) {
          result = {
            points,
            distanceKm: Math.round(data.routes[0].distance / 1000),
            durationMin: Math.round(data.routes[0].duration / 60)
          };
        }
      }
    }
  } catch (e) {
    result = null; // network error, abort/timeout, or bad JSON — degrade silently
  } finally {
    clearTimeout(timer);
  }
  _sbOsrmCache.set(key, result);
  return result;
}

// ── Livelier stop marker (teardrop pin with a glyph) ────────────────
// Replaces plain colored dots for real infrastructure points (bus
// stations, rest stops, highway waypoints) so the map doesn't read as
// "đơn độc" (bare) — a recognizable pin shape + icon, not just a circle.
const SB_STOP_KIND_META = {
  STATION: { bg: '#6366f1', glyph: '🚏' }, // bến xe / điểm dừng chung
  PICKUP:  { bg: '#34d399', glyph: '📥' },
  DROPOFF: { bg: '#f59e0b', glyph: '📤' },
  BOTH:    { bg: '#6366f1', glyph: '🔄' },
  REST:    { bg: '#fb923c', glyph: '⛽' }, // trạm dừng nghỉ
  SIGN:    { bg: '#10b981', glyph: '🛣️' }  // biển báo QL/cao tốc
};

function sbStopIcon(kind, opts) {
  opts = opts || {};
  const size = opts.size || 26;
  const meta = SB_STOP_KIND_META[kind] || SB_STOP_KIND_META.STATION;
  const bg = opts.color || meta.bg;
  const glyph = opts.glyph || meta.glyph;
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${bg};border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;">
      <span style="transform:rotate(45deg);font-size:${Math.round(size * 0.5)}px;line-height:1;">${glyph}</span>
    </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size]
  });
}
