# Route Visualization Forensic Audit

Status: **investigation only**. No source code, database, or API was modified while producing this report.

## 1. Executive summary

The reported symptom (geographically nonsensical intermediate stops for the animated "route visualization" modal) is real, reproducible, and its root cause has been located with exact precision — not inferred, but **hand-computed against the actual coordinate data in the file and confirmed to reproduce both reported cases stop-for-stop, in the exact reported order.**

**Root cause**: `inferRoute()` in `public/pages/passenger/index.html` (line 5856) is a **pure client-side, database-independent heuristic** that fabricates a plausible-looking intermediate-stop list for the single-trip route-animation modal (`openRouteModal()`). When neither of its two curated lookup tables (`ROUTE_DB`, `HWY1`) has an entry for the requested origin/destination pair, it falls back to a "geographic fallback" (line 5871-5879) that selects candidate intermediate provinces **using only latitude**, with **no longitude constraint whatsoever**. For north-south-ish but geographically narrow routes (like both reported cases), this pulls in provinces that share a latitude band but sit far to the east or west of the real path — including coastal cities (Hải Phòng, Quảng Ninh) hundreds of kilometers from a route between two inland/northern provinces.

**Critical clarification**: this bug lives entirely in the **single-trip animated route-visualization modal** (`openRouteModal`/`RTE.stops`), which has **no connection to any database table** — it does not read `route`, `route_stop`, `stop`, or any backend endpoint. It is unrelated to the separate, backend-driven **multi-hop transfer-itinerary search** (`server/ai/transitRouter.js`, `POST /api/search/transit`), which was also audited and found architecturally sound for what it does (see Section 4.3) but has its own, different limitation worth flagging (no geographic pruning in its BFS, Section 4.4).

## 2. Route rendering architecture

Two entirely separate, unrelated systems in this codebase both touch the word "route" — conflating them would misdiagnose this bug:

| System | Trigger | Data source | Purpose |
|---|---|---|---|
| **Single-trip route animation** | Clicking a trip card → `openRouteModal(tripId)` | 100% client-side: `PROVINCE_GEO`, `HWY1`, `ROUTE_DB`, `HIGHWAY_DB` (all hardcoded JS objects/arrays in `index.html`) | Animate a bus icon traveling along an *inferred* path on a Leaflet map, for visual flair |
| **Multi-hop transfer search** | Searching a route with no direct trip → `searchTransit()` → `POST /api/search/transit` | Real DB: `trip`, `route`, `bus`, `bus_operator`, `booking`, `booking_detail` via `server/ai/transitRouter.js` | Find actual multi-leg bus itineraries with real scheduled trips |

The reported symptom — both examples show a "trip-level" origin→destination with intermediate cities — matches the **first** system (route animation), confirmed conclusively in Section 5 by exact reproduction.

## 3. Data flow (actual, traced from source)

```
User clicks a trip result card
  → openRouteModal(tripId)                                    [index.html:5917]
      RTE.trip = <trip object from allTripsData, already in memory>
      names = inferRoute(t.origin, t.destination)              [index.html:5856]
        1. ROUTE_DB[`${origin}|${dest}`]  — curated exact-match table, 24 entries [index.html:5796]
        2. HWY1 spine slice               — hardcoded 20-city N-S coastal highway list [index.html:5790]
        3. "Geographic fallback"          — PROVINCE_GEO filtered by LATITUDE ONLY [index.html:5871-5879]
      RTE.stops = names.map(name => ({name, geo: findGeo(name)}))   [index.html:5923]
      → buildTimeline()                — sidebar itinerary list, iterates RTE.stops in order
      → _startLeafletMap()              — map markers + buildRoadRoute(RTE.stops) for the polyline
          buildRoadRoute() walks RTE.stops pairwise, snaps each pair to the nearest
          HIGHWAY_DB polyline segment within 80km, or falls back to a straight
          line between the two raw coordinates if no highway is close enough. [index.html:5758]
```

No SQL, no `route_stop`/`stop` table, no API call, no backend code is involved anywhere in this chain. `RTE.stops` is the single source of truth for both the sidebar (layer D) and the polyline/markers (layers E/F) — **they are not built from different data**, so this is not a "frontend reorders correct API data" bug; the fabricated stop list itself is wrong before either renderer ever sees it.

## 4. Findings

### 4.1 — ROOT CAUSE, CRITICAL: latitude-only geographic fallback in `inferRoute()`

**File**: `public/pages/passenger/index.html`
**Function**: `inferRoute(origin, dest)`
**Region**: lines 5871–5879

```js
/* Geographic fallback */
const oG=findGeo(origin),dG=findGeo(dest);
if(!oG||!dG) return [origin,dest];
const[oLat]=oG,[dLat]=dG;
const minL=Math.min(oLat,dLat),maxL=Math.max(oLat,dLat);
const between=Object.entries(PROVINCE_GEO)
  .filter(([n,[lat]])=>normP(n)!==o&&normP(n)!==d&&lat>=minL-0.5&&lat<=maxL+0.5)
  .sort(([,a],[,b])=>oLat>dLat?b[0]-a[0]:a[0]-b[0]).slice(0,5).map(([n])=>n);
return [origin,...between,dest];
```

The `.filter()` predicate destructures `[lat]` from each `PROVINCE_GEO` entry and **never reads longitude at all** — `lng` isn't even bound to a variable. Any province whose latitude falls within a ±0.5° band of the origin/destination range is treated as a plausible waypoint, regardless of how far east or west it actually is.

**Evidence — exact reproduction of both reported cases**, computed by hand from the real coordinate values in the file (Section 5).

**Impact**: any origin/destination pair not present in the 24-entry `ROUTE_DB` and not both findable on the single 20-city `HWY1` coastal spine — i.e. most inland/northern provincial pairs — falls through to this fallback and can produce geographically incoherent intermediate stops. This is a **display-only** bug (it does not affect booking, pricing, search results, or any real data) but it is visibly, obviously wrong to anyone who knows Vietnamese geography, which is exactly what was reported.

**Severity**: HIGH (correctness/credibility bug in a visible, demo-relevant feature; not a security or data-integrity issue).

### 4.2 — Compounding issue: unlabeled straight-line fallback in `buildRoadRoute()`

**File**: `public/pages/passenger/index.html`
**Function**: `buildRoadRoute(stops)`
**Region**: lines 5758–5787

When no `HIGHWAY_DB` polyline has both endpoints within 80km of a given stop-pair (very likely for the erroneous stops from 4.1, since `HIGHWAY_DB` presumably only curates real highway corridors), the function silently falls back to a straight line between the two raw coordinates (`result.push(tG)`), with no visual distinction from a real road-snapped segment — directly matching the user's checklist question "does it use as-the-crow-flies distance but label it as a real route?" **Answer: yes.** This compounds finding 4.1 visually but is not itself the root cause — it would only produce a visibly-wrong *shape*, not the wrong *cities*, which is what was reported.

**Severity**: MEDIUM (contributes to the visual wrongness once 4.1 has already selected bad stops; not wrong in isolation for genuinely correct stop pairs far from any curated highway).

### 4.3 — Multi-hop transfer search (`transitRouter.js`) — architecturally sound, DB-correct, not implicated in the two reported cases

Full trace of `findTransitRoutes()`/`searchWithTransit()`:
- SQL in `loadAvailableTrips()` correctly `JOIN`s `trip`→`route`→`bus`→`bus_operator` with no missing `route_id`/`trip_id` conditions, and correctly `ORDER BY t.departure_time ASC` (no missing ORDER BY, no accidental cross-route mixing).
- `formatResult()`'s `transfer_points = node.legs.slice(0,-1).map(l => l.destination)` is internally consistent by construction — each leg's `destination` is exactly the next leg's `origin` because the BFS itself chains `city: t.destination` when expanding (verified in `findTransitRoutes`, lines 152-209) — there is no reordering, no sort-by-name, no sort-by-lat/lng, no LIMIT/OFFSET-induced misordering anywhere in this path.
- No random stop selection, no mock/demo data injection found anywhere in this file.

**This system was not the source of either reported case** — both CASE A and CASE B, as described (intermediate stops shown for a single displayed itinerary), match `inferRoute()`'s output pattern exactly, not the shape of a `transit[]` API response (which would show discrete scheduled legs with times/prices/operators, not a smooth city list).

### 4.4 — Separate, lower-severity limitation found in `transitRouter.js` (documented for completeness, not implicated in the reported symptom)

`findTransitRoutes()` performs a pure schedule-time/cost Dijkstra/BFS with **no geographic heuristic or pruning** — the exported `haversine()` function (line 20) is defined but **never called anywhere in the search logic**. This means the multi-hop search can, in principle, select a geographically circuitous path if it happens to have good schedule timing, since nothing in the algorithm penalizes moving away from the destination. This is architecturally distinct from 4.1 (it's a missing optimization, not a wrong-data bug) and was not the cause of the two reported cases, but is worth flagging as a related, adjacent risk for the same class of user-visible "why does my route go through there?" complaints, should they arise from the transfer-search feature specifically.

### 4.5 — Explicitly ruled out (checked directly against the user's checklist)

| Question | Finding |
|---|---|
| Random stop selection? | No — `inferRoute()` is fully deterministic given the same origin/destination |
| Stops pulled from a different route/route table? | No — no `route`/`route_stop`/`stop` table is queried anywhere in this code path |
| Missing/wrong `ORDER BY`? | N/A — no SQL involved in `inferRoute()` at all |
| Sort by name instead of sequence? | No — sorts by latitude (see 4.1), not name |
| Sort by lat/lng? | **Yes, by latitude only — this is the root cause (4.1)** |
| JOIN missing `route_id`/`trip_id`? | N/A here; confirmed correct in `transitRouter.js` (4.3) |
| Global data instead of route-specific? | Effectively yes — `PROVINCE_GEO` is a flat, global 63-province dictionary with no per-route relationship at all; "route-specific" selection is entirely improvised by the latitude-band filter |
| 14-day route projection affecting this? | No — that's `transitRouter.js`'s `loadAvailableTrips()` virtual-trip projection, a completely separate mechanism from `inferRoute()` |
| Frontend randomizing markers? | No |
| Polyline built from a different coordinate set than the sidebar? | No — `buildRoadRoute(RTE.stops)` consumes the exact same `RTE.stops` array/order as the sidebar timeline; see Section 3 |
| Straight-line distance mislabeled as a real route? | **Yes — see 4.2** |
| Frontend reordering an otherwise-correct API response? | No — there is no API response in this path; the data is wrong before any rendering happens |
| "Recommended stops" shown instead of actual route stops? | Effectively yes, and unlabeled as such — `inferRoute()`'s output is presented identically to a curated `ROUTE_DB` entry, with no UI indication that it's an heuristic guess rather than real data |
| Stale province names post administrative boundary changes? | No — all province names used in both reported cases are current, standard names |

## 5. Evidence — exact hand-computed reproduction of both reported cases

Real coordinate values, read directly from `PROVINCE_GEO` (`index.html` lines 5260–5335):

| Province | lat | lng |
|---|---|---|
| Bắc Giang | 21.2810 | 106.1880 |
| Tuyên Quang | 21.8230 | 105.2120 |
| Hòa Bình | 20.6900 | 105.3380 |
| Ninh Bình | 20.2544 | 105.9762 |
| Hà Nội | 20.9897 | 105.8434 |
| Hải Phòng | 20.8595 | 106.6843 |
| Hải Dương | 20.9440 | 106.3310 |
| Quảng Ninh | 20.9549 | 107.0772 |
| Bắc Ninh | 21.1860 | 106.0760 |
| Vĩnh Phúc | 21.3080 | 105.5970 |

**CASE A — Bắc Giang → Tuyên Quang**: neither `ROUTE_DB` nor `HWY1` has an entry for either city (`HWY1` only covers the coastal Hà Nội→TP.HCM spine; `ROUTE_DB` has no `'bắc giang|tuyên quang'` key) → falls to the geographic fallback.
- `minL = 21.2810`, `maxL = 21.8230` → band = `[20.7810, 22.3230]`
- Candidates in band (excluding origin/dest): Hải Phòng (20.8595), Hải Dương (20.9440), Quảng Ninh (20.9549), Hà Nội (20.9897), Bắc Ninh (21.1860), Vĩnh Phúc (21.3080), Thái Nguyên (21.5865)
- `oLat (21.281) > dLat (21.823)`? **False** → sort **ascending**
- Ascending order: Hải Phòng, Hải Dương, Quảng Ninh, Hà Nội, Bắc Ninh, Vĩnh Phúc, Thái Nguyên
- `.slice(0,5)` → **Hải Phòng, Hải Dương, Quảng Ninh, Hà Nội, Bắc Ninh**
- Final `inferRoute()` output: `[Bắc Giang, Hải Phòng, Hải Dương, Quảng Ninh, Hà Nội, Bắc Ninh, Tuyên Quang]` — **7 stops.**

**This is an exact match to the reported symptom**: "~7 điểm dừng... Hải Phòng, Hải Dương, Quảng Ninh, Hà Nội, Bắc Ninh" — same 5 intermediate cities, same order, same total count of 7.

**CASE B — Hòa Bình → Ninh Bình**: no `ROUTE_DB`/`HWY1` entry either → geographic fallback.
- `minL = 20.2544`, `maxL = 20.6900` → band = `[19.7544, 21.1900]`
- Candidates in band: Hà Nội (20.9897), Hải Phòng (20.8595), Hải Dương (20.9440), Quảng Ninh (20.9549), Bắc Ninh (21.1860), Hà Nam (20.5438), Thái Bình (20.4460), Nam Định (20.4195)
- `oLat (20.69) > dLat (20.2544)`? **True** → sort **descending**
- Descending order: Bắc Ninh, Hà Nội, Quảng Ninh, Hải Dương, Hải Phòng, Hà Nam, Thái Bình, Nam Định
- `.slice(0,5)` → **Bắc Ninh, Hà Nội, Quảng Ninh, Hải Dương, Hải Phòng**

**This is an exact match to the reported symptom**: "Bắc Ninh, Hà Nội, Quảng Ninh, Hải Dương, Hải Phòng" — identical cities, identical order.

The fact that both cases surface nearly the same 5 coastal/Red-River-Delta cities despite being completely different, non-overlapping origin/destination pairs is itself explained by the bug: all of northern Vietnam's provinces cluster within roughly latitude 19.7–22.3, so almost *any* northern route with no curated `ROUTE_DB` entry will pull from the same small pool of latitude-adjacent-but-longitude-irrelevant provinces.

## 6. Root causes (summary)

1. **Primary root cause**: `inferRoute()`'s geographic fallback filters candidate waypoints by latitude only, with no longitude constraint — `public/pages/passenger/index.html:5871-5879`.
2. **Contributing/compounding**: `buildRoadRoute()` silently substitutes an unlabeled straight line when no curated highway segment is within 80km, visually indistinguishable from a real snapped road segment — `public/pages/passenger/index.html:5758-5787`.
3. **Not a root cause of the reported symptom, but an adjacent, lower-severity finding**: `transitRouter.js`'s multi-hop search has no geographic pruning heuristic (`haversine()` defined but unused) — `server/ai/transitRouter.js:20, 142-213`.

## 7. Affected files
`public/pages/passenger/index.html` only (functions `inferRoute`, `findGeo`, `buildRoadRoute`, and the `ROUTE_DB`/`HWY1`/`PROVINCE_GEO`/`HIGHWAY_DB` data tables they read).

## 8. Affected endpoints
None. This entire code path is client-side only; no backend endpoint is involved. (The separate, unaffected multi-hop search uses `POST /api/search/transit` → `searchController.transitSearch` → `transitRouter.searchWithTransit`.)

## 9. Affected DB queries
None. No database table is read anywhere in the `inferRoute`/`openRouteModal`/`buildRoadRoute` chain.

## 10. Severity
- Finding 4.1 (root cause): **HIGH** — visibly, provably wrong for a geography-literate reviewer (e.g. a thesis committee member), affects any origin/destination pair outside the 24 curated `ROUTE_DB` entries and the 20-city `HWY1` spine, which is the large majority of possible province pairs in this app.
- Finding 4.2 (straight-line mislabeling): **MEDIUM** — compounds 4.1 visually, but not independently misleading for genuinely correct stop pairs.
- Finding 4.4 (transit search, no geo-pruning): **LOW/INFORMATIONAL** — not implicated in the reported symptom; a latent risk for the separate transfer-search feature.

## 11. Recommended fix plan (not implemented — investigation only, per instructions)

For 4.1, in order of increasing effort:
- **Minimal**: constrain the geographic fallback's filter by longitude as well as latitude (e.g. a bounding box around the straight line between origin and destination, or a maximum perpendicular distance from that line), instead of latitude alone.
- **Better**: replace the ad hoc lat/lng banding with an actual nearest-neighbor-along-the-line selection (project each candidate province onto the origin→destination segment and keep only those with a small perpendicular offset), which would also naturally produce a more sensible stop *order*.
- **Most robust**: expand `ROUTE_DB` with curated entries for common northern-province pairs (the current table is coastal/south-heavy), since a curated entry always takes precedence over the fallback and sidesteps the heuristic entirely for known routes.

For 4.2: label or visually distinguish (e.g. dashed line) any polyline segment that fell back to a straight line rather than a matched highway segment, so the map never implies road-following behavior it didn't actually compute.

For 4.4 (lower priority, separate feature): consider using the already-defined but unused `haversine()` to bias the BFS/Dijkstra queue ordering toward paths that reduce remaining distance to the destination, or to reject expansion candidates that increase distance-to-destination beyond some threshold.

## 12. Regression test plan (not implemented — investigation only)

- A pure-function unit test extracting/importing `inferRoute`/`findGeo` (would require lifting these out of the inline `<script>` into a testable module, or a lightweight DOM-less harness) asserting, for a curated set of known-bad pairs (including the two reported cases), that every returned intermediate province lies within a reasonable perpendicular distance of the straight line between origin and destination.
- A snapshot/regression test locking in `ROUTE_DB`/`HWY1` curated entries so future edits don't silently regress a currently-correct pair back into the fallback path.
- For 4.2, a test asserting that `buildRoadRoute()`'s output includes a machine-readable flag per segment indicating highway-snapped vs. straight-line fallback, once the frontend is changed to consume it.
- For 4.4, a targeted concurrency-style test is not applicable; instead, a correctness test asserting that `haversine(leg.destination) <= haversine(previous node)` (monotonically decreasing distance to destination) for the returned `transit[]` results, at least as a soft warning/logged assertion rather than a hard rejection (since legitimate detours can occur).
