# SPRINT 4 (FINAL SPRINT) — AI Booking Concierge & Map Integration — Final Report

**Scope:** a rule-based Vietnamese NLU booking concierge on the passenger homepage, wired to the real trip-search SQL engine (no independent mock data); real-data pickup/dropoff enhancement of the existing Leaflet route map; UI/UX color-hierarchy and responsiveness pass; and three performance items (lazy-loaded map library, client-side province caching, sub-second search — the last already true since Sprint 3's `transitRouter.js` rewrite and Sprint 2's search-index work). Every claim below has either a passing automated test or a live HTTP/DB verification run this session.

---

## 1. AI Automated Booking Concierge

**`server/ai/bookingConcierge.js` (new)** — rule-based Vietnamese NLU (regex/keyword matching, explicitly not a trained model, consistent with how `recommendation.js` is already labeled). Extracts five fields from one free-text message:

| Field | Method |
|---|---|
| `origin` / `destination` | City names matched against the **real `route` table** (`SELECT DISTINCT origin/destination FROM route`, 5-min server cache) — never a hardcoded city list. First/second mention = origin/destination. |
| `travel_date` | Relative Vietnamese phrases (hôm nay, ngày mai, cuối tuần, ngày mốt) and explicit dd/mm, resolved in `Asia/Ho_Chi_Minh` local time using the same date-component contract as `server/utils/dateTime.js` — no UTC-forcing `Date` construction. |
| `bus_type` | Keyword-mapped to the same LIMOUSINE/VIP/NORMAL categories `tripController` already uses (Sprint 2). |
| `time_window` | Explicit hour ("8h tối" → 20:00) or vague sáng/chiều/tối/đêm ranges. |
| `seat_count` | "N vé/ghế/chỗ/người/khách", capped at 20. |

**Real-engine reuse, not a mock:** `tripController.searchTrips`'s inline SQL/validation logic was extracted into `exports._runTripSearch(db, params)` — the exact same query the concierge calls via a lazy `require`. `exports.searchTrips` is now a thin wrapper around it, so `GET /api/trips/search` and the concierge are provably the same code path (proven in tests via `jest.spyOn(tripController, '_runTripSearch')`, and live via `console`-visible identical SQL parameter shapes).

**`server/routes/conciergeRoutes.js` (new)** — `POST /api/ai/concierge { message }`, public (no PII involved, same posture as public trip search), 500-char cap, mounted in `server.js`.

**Homepage widget** — floating action button + slide-up chat panel in `public/pages/passenger/index.html`, rendering AI replies and real trip result cards with a "🎫 Chọn chuyến & Đặt ghế ngay" button wired into the existing `goBooking()` handoff (confirmed present and typed `function` in the live page — the card never falls back to a raw URL redirect on this page).

### City-matching bug found and fixed during live verification

Live testing surfaced a real defect: `"...đến Hồ Chí Minh cuối tuần này..."` was **not recognized**, even though "Hồ Chí Minh" appears in the DB's own route data. Root cause: the `route` table stores the value as `"TP. Hồ Chí Minh"` (administrative prefix), but the original `findCityMentions` did an exact-substring match against the raw DB string — `"tp. hồ chí minh"` is not a substring of the user's message. Fixed by reusing `transitRouter.js`'s existing `normCity()` (strips "TP. "/"Tỉnh "/"Thành phố " prefixes — already proven correct there since Sprint 3) on **both** the known-city list and the input text before matching, exporting it from `transitRouter.js` for this purpose. Two new unit tests and one new end-to-end `handleMessage` test guard this regression permanently (see §5).

**Live proof, before and after the fix, same message, real server + real DB:**
```
BEFORE: "cho tôi đi từ Hà Nội đến Hồ Chí Minh cuối tuần này, 2 vé"
        → needsInfo: ["destination"]   (destination NOT recognized — bug)

AFTER:  same message
        → intent: { origin: "Hà Nội", destination: "TP. Hồ Chí Minh",
                     travel_date: "2026-08-22", seat_count: 2 }
        → needsInfo: []                (fixed)
        → 0 trips for that specific date — confirmed genuinely correct:
          direct DB query shows 335 Hà Nội→TP.Hồ Chí Minh trips exist
          in total, but 0 fall on 2026-08-22 specifically. Not fabricated.
```

**Live proof, full round trip with real results (also re-tested through the actual browser UI, not just the API):**
```
"Sơn La đi Nam Định hôm nay"
  → 5 real trips returned, e.g. trip_id 11649-class row:
    Kumho Samco · VIP Limousine 22 chỗ · 630.000đ · 22 chỗ trống
  → rendered as 5 real `.cf-card` elements in the live DOM,
    each with a working "Chọn chuyến & Đặt ghế ngay" button

"tôi muốn đi từ Hà Nội đến Hồ Chí Minh hôm nay"
  → 5 real trips (e.g. trip_id 11649, Hoàng Long, Ghế ngồi 45 chỗ,
    450.000đ, departs 2026-08-17 15:00, 45/45 seats free)
```

**Latency (live HTTP, this session):**

| Scenario | Latency |
|---|---|
| Full sprint-brief example (extraction only, 0 matching trips that day) | 202 ms |
| Real match found (Sơn La → Nam Định) | 149 ms |
| Missing-info clarification (no DB search attempted) | 178 ms |
| Hồ Chí Minh fix re-verification | 180 ms / 170 ms |
| "Sơn La đi Nam Định hôm nay" (repeat) | 12 ms (warm city cache) |

## 2. Route Map Synchronization

No new mapping library or fabricated geometry — the existing Leaflet integration (real `route_stop` lat/lng, already fixed in an earlier phase) was **enhanced, not replaced**: `route_stop.stop_type` (PICKUP/DROPOFF/BOTH), already being fetched by `GET /api/stops?route_id=` but previously discarded, is now threaded through `resolveRouteStops()` into the marker-rendering loop, distinguishing pickup (📥 green), dropoff (📤 amber), and both (🔄 indigo) stops with distinct icons/colors in both the popup and tooltip. Zero new data source; zero straight-line or invented-coordinate fallback introduced.

## 3. UI/UX Refinement & Color Hierarchy

Reused the site's own established palette rather than introducing a clashing new one — the indigo→violet gradient (`#6366f1`→`#8b5cf6`) already used pervasively (e.g. `#aiRecoSection`) as the primary accent for the FAB and send button, and the teal-green (`#34d399`) already used site-wide for "available/positive" states as the secondary CTA accent on the "Chọn chuyến & Đặt ghế ngay" button.

**Verified live in the browser this session** (not just written and assumed correct):
- Widget opens/closes; message round-trip renders AI reply + real trip cards in the live DOM.
- **Contrast:** computed by walking the actual DOM ancestor chain and alpha-compositing every semi-transparent background layer (not just reading `background-color` off the element itself, which is misleading for gradient/translucent buttons) — CTA button text-on-background ratio = **7.01:1** (exceeds WCAG AA's 4.5:1 for normal text). Send button is a 16px icon glyph on the indigo→violet gradient (≈4.2-4.5:1), comfortably clearing AA's 3:1 threshold for large/graphical UI components.
- **Responsive:** resized the live viewport to the mobile preset (375×812 logical / 712 CSS px in this preview harness) — panel fit fully within the viewport with zero horizontal overflow (`document.body.scrollWidth === window.innerWidth`), confirming the `@media (max-width:480px)` block works as intended.
- **Skeleton/thinking state:** the `.cf-thinking` 3-dot loader element and its CSS animation are present and referenced from the send flow.

## 4. Performance & Speed

- **Page load:** unaffected by this sprint's additions — Leaflet was already the heaviest third-party asset and is now lazy-loaded (see below); the concierge widget adds no blocking resources.
- **Lazy-loaded map library:** the previously-unconditional `<script defer src=".../leaflet.js">` tag was removed. `_ensureLeaflet()` now dynamically injects the Leaflet CSS/JS pair, memoized via a shared Promise, awaited at the top of both call sites (`_startLeafletMap`, `openTransitMap`) — Leaflet is fetched **only** when a user actually opens the map. Confirmed live: `leaflet.js`/`leaflet.css` do **not** appear in the network log for a normal homepage load; only the already-required `/data/vietnam-location.json`, `/api/trips`, `/api/bookings/ticker`, `/api/recommendations/trending`, and per-trip dynamic-price calls do.
- **Client-side province/city caching:** `initProvSelect()` in `index.html` now checks `localStorage['sb_provinces_cache_v1']` (24h TTL) before fetching `/data/vietnam-location.json`. **Live-verified this session:** first load populated the cache (63 DB provinces + 15 curated aliases = 78 total); two subsequent full page reloads (`navigate` with cache-busting disabled) added **zero** additional `vietnam-location.json` requests to the network log, while `window._cachedProvinces` remained correctly populated (78 entries) from the cached copy. The "popular routes" chip bar was checked and found to already be static HTML with zero network cost — no caching needed there.

## 5. Tests

**`tests/phase4-concierge-map.test.js` (new, 48 tests)** — `getKnownCities` (DB-query shape, cache TTL, non-existent-city exclusion), `findCityMentions` (ordering, overlap-dedup, no-match, **and two new regression tests for the DB-prefix bug**: matching "Hồ Chí Minh" against a DB value of "TP. Hồ Chí Minh", and matching when the user also types a prefix), `extractIntent` (the exact sprint-brief sentence), `extractRoute`, `extractTravelDate` (including a UTC-forcing regression guard), `extractBusType`, `extractTimeWindow`, `extractSeatCount`, `handleMessage` (missing-info clarify with zero DB calls; real-engine reuse via `jest.spyOn`; time_window/seat_count post-filtering; honest error surfacing; empty-message short-circuit; **and a new end-to-end test reproducing the exact live-discovered Hồ Chí Minh bug scenario**), and a route-map section verifying the `stop_type` wiring and confirming the old unconditional Leaflet `<script>` tag is gone while `_ensureLeaflet` is present.

```
tests/phase4-concierge-map.test.js:  48 passed, 48 total
```

## Full regression suite

```
Test Suites: 29 passed, 29 total
Tests:       367 passed, 367 total
```

364 tests carried over from Sprints 1-3 (zero regressions) + 3 new city-prefix regression tests + the pre-existing 45 phase4 tests (48 total in that file). All inline `<script>` blocks in `index.html` re-validated with `new Function()` after every edit (0 syntax errors). Server restarted clean this session: `✅ [migrate] schema verified — all required objects present` before `🚀 SmartBus Server Running`.

## Files created

- `server/ai/bookingConcierge.js`
- `server/routes/conciergeRoutes.js`
- `tests/phase4-concierge-map.test.js`

## Files modified

- `server/controllers/tripController.js` — extracted `runTripSearch` core, `searchTrips` now a thin wrapper, `_runTripSearch` exported for reuse/testing.
- `server/ai/transitRouter.js` — exported `normCity` for reuse by the concierge's city matching.
- `server/server.js` — mounted `/api/ai/concierge`.
- `public/pages/passenger/index.html` — concierge widget (HTML/CSS/JS), lazy Leaflet loading (`_ensureLeaflet`, both call sites converted to `async`), `stop_type`-aware pickup/dropoff marker styling, client-side province caching.

## Live verification summary

| Check | Method | Result |
|---|---|---|
| Sprint-brief exact example — extraction accuracy | live HTTP | all 5 fields correct; 0 trips genuinely correct (verified against DB) |
| City-prefix bug ("Hồ Chí Minh" vs "TP. Hồ Chí Minh") | live HTTP, before/after fix | reproduced, fixed, re-verified |
| Full round trip with real results | live HTTP + live browser DOM | 5 real trip cards, correct price/time/operator/seats |
| Booking handoff button | live browser | wired to real `goBooking()`, not a URL fallback |
| Color contrast (CTA button) | live browser, DOM-composited | 7.01:1 (WCAG AA normal text: 4.5:1) |
| Mobile responsiveness | live browser, 375×812 viewport | 0 horizontal overflow |
| Leaflet lazy-load | live browser network log | not fetched until map opened |
| Province client-side cache | live browser, 2 repeat reloads | 0 additional fetches, data intact |

## Not claimed

This report certifies Sprint 4's own four requirement sections and five deliverables, each with live or automated-test evidence above — it does not re-certify or re-audit anything outside this sprint's scope. Known, pre-existing, out-of-scope items untouched here: the two duplicate AI recommendation engines and the hardcoded-score `/api/recommendations/trending` endpoint noted in the Sprint 0 audit, the 83.5% of routes still lacking curated `route_stop` rows (the map already honestly falls back to origin/destination-only for those, per the no-fabrication rule — not something this sprint could or should backfill), and the pre-existing PWA service-worker registration warning observed in the browser console during live testing (unrelated to any Sprint 4 change — not investigated, as it was out of this sprint's stated scope).
