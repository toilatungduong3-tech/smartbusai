# PHASE 2 — Passenger Search Engine Correctness — Final Report

**Scope:** `public/pages/passenger/index.html` and every backend API it calls. Full pipeline traced for every filter: UI → JS state → request → API → controller → SQL → returned data → frontend filtering → sorting → pagination → rendered result. No fix stopped at the UI layer without proof of the underlying mechanism.

---

## Reported bug: "lọc giá ở index.html không hoạt động" — root-caused and fixed

**Not accepted at face value.** Traced the entire pipeline before touching anything. Finding: **the backend was already correct.** `tripController.searchTrips`'s `minPrice`/`maxPrice` handling has been sound since a prior phase — live-proven again this phase across the full required matrix (0, 100000, 200000, 500000, min-only, max-only, min>max→422, min===max exact match, empty→ignored, invalid→422, decimal). See the live evidence table in §1.

**The actual bug was 100% frontend**, and specifically not where it looked. `index.html` has two rendering paths sharing one function, `renderPage()`:
1. The **explicit search flow** (`searchTrips()`, triggered by the Search button) — correctly sends `minPrice`/`maxPrice` to the backend.
2. The **homepage default trip listing** (`loadAllTrips()`, what every visitor actually sees first, before typing anything) — client-side paginated via the same `renderPage()`.

`renderPage()`'s filter pipeline applied `_timeFilter`, `_busTypeFilter`, and `_sortMode` before pagination — but **never read `_minPrice`/`_maxPrice` at all**. `setPriceFilter()` also only re-fetched `if(_searchDone)`. Net effect: on the homepage's default view — the most common first interaction — clicking a price chip visually activated it and did **nothing else**. The trip list never changed. This matches the reported complaint exactly.

**Fix** (`public/pages/passenger/index.html`):
- `renderPage()` now filters `allTripsData` by `_minPrice`/`_maxPrice` (numeric comparison on the raw `base_price` field) before the `.slice()` pagination step — mirroring the pattern already used correctly for the other three chip filters.
- `setPriceFilter()` now always re-renders immediately from currently-loaded data, in addition to the existing server-side re-fetch when a search is active.

---

## 1. PRICE FILTER — full trace, live-verified

| Test case | Backend result | Verdict |
|---|---|---|
| `minPrice=0` | count = 7128 (identical to unfiltered baseline) | ✅ correct — 0 is a valid, meaningful bound, not treated as falsy |
| `minPrice=200000` | 5395 rows, every `base_price >= 200000` | ✅ |
| `maxPrice=200000` | 1839 rows, every `base_price <= 200000` | ✅ |
| `minPrice=100000&maxPrice=200000` | 1473 rows, all strictly bounded | ✅ |
| `min > max` (500000 > 100000) | 422 `"minPrice không được lớn hơn maxPrice"` | ✅ |
| `min === max` (200000) | 106 rows, exact-price match, boundary-inclusive | ✅ |
| empty string (`minPrice=`) | treated as "not provided" (same as omitted) | ✅ |
| invalid (`minPrice=abc`) | 422, never reaches SQL | ✅ |
| decimal (`minPrice=99999.99`) | accepted, bound as `99999.99` | ✅ |
| NULL / currency / string vs number | `base_price` returned as a raw JSON number in every response, never a formatted display string — confirmed live | ✅ |
| Vietnamese-formatted `"318.000đ"` | 422 (rejected — see hardening below) | fixed this phase |

**New hardening found and fixed this phase** (none of these were reachable from the current UI — no free-text price input exists, only 4 fixed chips with hardcoded numeric literals — but a direct API caller or future UI change could trigger them):
- `minPrice=0x10` (hex) — previously silently parsed as `16` via `Number()`. Now rejected with 422.
- `minPrice=1e2` (exponential) — previously silently parsed as `100`. Now rejected.
- `minPrice=Infinity` — previously passed `isNaN`/`>=0` validation and **crashed into a raw 500** when mysql2 tried to serialize it as a bound parameter (live-reproduced before the fix). Now rejected with 422 — a client input error, not a server fault.
- `"318.000đ"` — now rejected (strict `^\d+(\.\d+)?$` regex, trimmed for incidental whitespace).

Fix: `tripController.js`'s `searchTrips` now validates with a strict decimal-only regex before `Number()` coercion, and checks `Number.isFinite()` instead of bare `!isNaN()`.

**"Không được filter sau khi pagination"**: confirmed both the backend (`WHERE` before any `LIMIT`/`ORDER BY`) and the fixed frontend (`renderPage()`'s price filter runs before `.slice(start,end)`) apply price filtering strictly before pagination.

---

## 2. SEARCH FILTER MATRIX

| Filter | State | API param | Backend validation | SQL condition | Response evidence |
|---|---|---|---|---|---|
| origin | text input, autocomplete | `origin` | none needed (free text) | `r.origin LIKE ?` (parameterized) | live-verified: no SQL injection surface, no string concatenation |
| destination | text input, autocomplete | `destination` | none needed | `r.destination LIKE ?` | same |
| date | custom date-picker (hidden `#date` input) | `date` | none | `DATE(t.departure_time) = ?` | live-verified against server's own local "today" |
| price | 4 fixed chips | `minPrice`/`maxPrice` | strict regex + `Number.isFinite` (this phase) | `t.base_price >= ?` / `<= ?` | see §1 |
| departure time-of-day | 5 chips (Đêm/Sáng/Chiều/Tối) | **none** | N/A | **no backend capability** | **PARTIALLY IMPLEMENTED** — client-side only (`_timeFilter` in `renderPage()`), correctly applied before pagination; pre-existing, unaffected by this phase, verified still correct |
| arrival time | — | — | — | — | **MISSING** — no UI control anywhere |
| vehicle type | 4 chips (Tất cả/Thường/VIP/Limousine) | `busType` | fixed value set | **fixed this phase** — see below | now returns correct, non-empty results |
| operator | — | — | — | — | **MISSING** — no UI control; `searchTrips` accepts no `operator_id` param at all (confirmed: passing one is silently ignored, zero effect on the query — live-verified) |
| seat availability | — | — | — | — | **MISSING** — no "hide sold-out" toggle exists; sold-out trips are deliberately still returned and shown with a "Hết vé" badge, not filtered out. Not a bug — a design choice, but no filter exists to change it |
| sort | 4 chips (giá thấp/cao, khởi hành sớm, đánh giá) | `sort` | fixed value set | `ORDER BY t.base_price ASC/DESC` or default `departure_time ASC` | see §3 |
| pagination | client-side, `PAGE_SIZE=10` | — | — | — | see §6 |

### Vehicle-type filter — a second, independent bug found and fixed

Two separate defects stacked on this one filter:

1. **Wiring bug**: `searchTrips()` read `busType`/`sort` from two hidden `<select>` elements (`#busType`, `#sortPrice`) that `setBusTypeFilter()`/`setSortFilter()` never actually wrote to — real chip state lived only in `_busTypeFilter`/`_sortMode`. The explicit-search backend request always received `busType=''`/`sort=''` regardless of which chip was active. **Fixed**: `searchTrips()` now reads `_busTypeFilter`/`_sortMode` directly.

2. **Data-shape bug, found while verifying the wiring fix**: `bus.bus_type` is a free-text `VARCHAR(50)`, not the clean `ENUM('NORMAL','VIP','LIMOUSINE')` the three UI chips assume. Live query of the real data:
   ```
   EXPRESS, "Ghế ngồi 45 chỗ", "Giường nằm 34 chỗ", "Giường nằm 40 chỗ",
   LIMOUSINE, SLEEPER, STANDARD, "VIP Limousine 16 chỗ", "VIP Limousine 22 chỗ"
   ```
   The old exact-match `WHERE b.bus_type = ?` matched **zero** buses for the "VIP" and "NORMAL" chips, and only the 10 buses literally named `LIMOUSINE` for the third (missing the "VIP Limousine ..." buses entirely). **Fixed** (both backend SQL and the mirrored client-side `renderPage()` filter): keyword-matched — `VIP` → `LIKE '%VIP%'`, `LIMOUSINE` → `LIKE '%LIMOUSINE%'`, `NORMAL` → excludes both keywords. A "VIP Limousine" bus intentionally matches both the VIP and Limousine chips — both labels genuinely apply given the real data.

   Live-verified after the fix: `busType=VIP` → 1631 rows, all `"VIP Limousine 16/22 chỗ"`; `busType=NORMAL` → 5497 rows, correctly excluding every VIP/Limousine bus.

---

## 3. SORTING — verified numeric, not string-based

| Sort | Mechanism | Verified |
|---|---|---|
| price asc | Backend: `ORDER BY t.base_price ASC` (real numeric `DECIMAL`/`FLOAT` column). Client: `Number(a.base_price)-Number(b.base_price)` | ✅ live: `[20000,20000,20000,20000,20000,...]` — non-decreasing |
| price desc | Backend: `ORDER BY t.base_price DESC`. Client: mirrored subtraction | ✅ live: non-increasing |
| departure asc | Client: `new Date(a.departure_time)-new Date(b.departure_time)` (real epoch subtraction). Backend default `ORDER BY t.departure_time ASC` | ✅ correct, real `DATETIME` comparison |
| departure desc | **no UI chip exists** for this direction | MISSING (documented, not added — see note below) |
| duration asc/desc | **no UI chip, no backend capability** | MISSING |
| rating | Client-side only: `Number(b.avg_rating||0)-Number(a.avg_rating||0)`; backend `sort` param doesn't recognize `'rating'`, falls through to default departure-time order (client-side sort still corrects the final displayed order) | Works end-to-end for the user, but the backend response order is discarded/redundant for this case |

**"Không được sort formatted strings"**: exhaustively confirmed **no such bug exists anywhere in this codebase**. Every sort — backend SQL and frontend JS — operates on the raw numeric/date field (`base_price`, `departure_time`), never on a display string like `"99.000đ"` or `"1.200.000đ"`. Live-verified: `base_price` in every API response is a plain JSON number.

**Gaps documented, not fixed**: departure-desc and duration-asc/desc have no UI entry point at all. Per this phase's explicit "no UI redesign" constraint, no new chips were added — this is reported as a missing capability, not silently expanded.

---

## 4. DATE — timezone-safety audit

Found and fixed one real inconsistency; confirmed everything else already correct.

**Fixed**: `searchTrips()`'s past-date validation used `new Date(dt)` where `dt` is a bare `"YYYY-MM-DD"` string. Per the ECMAScript spec, a date-only ISO string parses as **UTC midnight** — for Vietnam (UTC+7) that's actually local 07:00 the same day, not local midnight. This happened to still produce the correct past/future verdict today only because a same-day, same-direction +7h shift never crosses the date boundary being tested — an accidental correctness, not a provable one, and exactly the kind of "happens to work because the offset is positive and small" pattern Phase 1 established should never be relied on. Fixed to `new Date(dt+'T00:00:00')`, matching the codebase's established local-time contract (`server/utils/dateTime.js`).

**Confirmed already correct** (no changes needed):
- The custom date-picker widget (`dpPickDay`/`fmt()`) already builds date strings from local `getFullYear()/getMonth()/getDate()` and parses them back with `new Date(dateStr+'T00:00:00')` — the same safe pattern now applied consistently everywhere.
- Backend: `DATE(t.departure_time) = ?` operates directly on the local-convention `DATETIME` column (per Phase 1's contract) against a plain date string — no implicit UTC conversion anywhere in this path.
- Live-verified: querying with the server's own local "today" (`DATE_FORMAT(NOW(),'%Y-%m-%d')`) returns exactly the trips whose `departure_time` date matches, with zero drift.

---

## 5. EMPTY / EDGE CASE — a bug found, directly caused by fixing §1/§2

`renderPage()`'s "no results" message only fired when `allTripsData` itself was empty (no trips loaded at all). If a chip filter narrowed a **non-empty** `allTripsData` down to zero matches, execution fell through to the pagination/render code with an empty `paginated` array — the render loop did nothing, leaving a **blank panel with no explanation**, indistinguishable from a stuck loading state.

This was latent and essentially unreachable before this phase, because price filtering never actually narrowed anything (§1's bug) — now that price and bus-type filtering genuinely work, a user filtering down to zero matches is a real, common scenario that needed handling.

**Fixed**: `renderPage()` now explicitly detects `total===0 && allTripsData.length>0` and shows a distinct "no trips match your current filters" message (different wording from "no trips at all"), states how many trips exist in total, and offers a new "Xoá bộ lọc" (clear filters) action (`resetTripFilters()`, new function) that resets every chip filter to its default and re-renders.

**Verified, no changes needed**:
- "No trips at all" state (unchanged): clear message, suggested searches, AI-recommendation pointer — was already correct.
- No crash on empty results — confirmed via code path review (the render loop over an empty array is a no-op, not an exception).
- No stale data retained — `list.innerHTML=""` is set unconditionally at the top of every `renderPage()` call before either branch.
- No infinite loading — `searchTrips()`'s `finally` block always restores the button state and clears `_isSearching`, regardless of success/failure/exception.
- Count accuracy — see the badge fix below.

**Second, related bug fixed**: `tripCountBadge` (the small counter near the filter bars) was only ever set once, in `renderTrips()`, with the **unfiltered** total. After applying any chip filter, it kept showing the stale original count (e.g. still "8184 chuyến" while the visible list was filtered down to a handful) — a "báo sai số lượng" violation. Fixed: the badge is now recomputed from the actual filtered `total` on every `renderPage()` call. (The separate pagination footer's count was already correct — it was independently computed from `filtered.length` — only the badge was stale.)

---

## 6. PERFORMANCE

**Audited, not restructured** — per this phase's explicit instruction not to make large architecture changes without proven necessity.

| Finding | Live measurement | Action |
|---|---|---|
| `GET /api/trips` unbounded (`loadAllTrips()`, hit on every homepage visit) | **7,977 rows, 4.14 MB, 1,332 ms** before this phase's fix | **Not restructured into paginated form** — would be a real API-contract change touching the frontend's entire client-side filter/sort/paginate model, explicitly out of scope without proven necessity beyond what an index fixes. Documented as a known, quantified, unresolved limitation (already flagged in Phase 1's audit; re-measured here to confirm it's grown, not shrunk) |
| `trip` table had no index on `(status, departure_time)` — the columns every hot-path query filters/orders on | `EXPLAIN` showed `type=ALL`, full scan of 13,160 rows | **Fixed** — purely additive index (`migrate_v10.sql`), zero API/architecture change. Re-measured after: `EXPLAIN` now shows `type=index` using `idx_trip_status_departure`; `GET /api/trips` dropped to **619 ms** (from 1,332 ms) for a similarly-sized result set — roughly 2.2× faster, same payload size (the endpoint itself is still unbounded, only the query execution improved) |
| `SELECT *` | Not found — `baseSelect` already explicitly enumerates every column in both `getTrips` and `searchTrips` | No action needed |
| Duplicate requests | Not found — `loadAllTrips()`'s 5-minute periodic refresh is guarded by `if(!_searchActive)`; no call site fires it redundantly | No action needed |
| Search request race condition | `searchTrips()` already has `if(_isSearching) return;` — blocks re-entrant submission (double-click / rapid Enter) rather than canceling, which is the correct behavior for an explicit user-initiated action | No action needed |
| Debounce on fast typing | The one live-network-triggered keystroke path (`_triggerAISearchInsight`, the AI insight pills shown while both origin+destination are set) is **already correctly debounced** (280ms `setTimeout` + `clearTimeout`) — verified by reading, not assumed | No action needed |
| AbortController | Not present anywhere; not added — the only debounced path already serializes correctly via `clearTimeout`, and the main search flow's re-entry block makes a cancel-in-flight unnecessary for the common case. Assessed as unnecessary complexity for the actual risk present, consistent with "don't add for problems not proven to exist" | Documented, not added |
| The origin/destination autocomplete dropdown | Filters a small, already-loaded in-memory array on every keystroke — no network call at all, no race possible | Verified clean |

---

## 7. REGRESSION TEST MATRIX

All new tests pass; full suite has zero regressions.

```
Test Suites: 25 passed, 25 total
Tests:       277 passed, 277 total
```

- `tests/phase2-price-filter.test.js` (20 tests) — the full required price matrix (0/100000/200000/500000/min-only/max-only/min>max/equal/empty/invalid/decimal) plus the hex/exponential/Infinity/formatted-currency/whitespace hardening found this phase, plus sort-is-numeric-SQL assertions.
- `tests/phase2-search-filter-matrix.test.js` (10 tests) — origin/destination parameterization, date's `DATE()` SQL condition, the bus-type keyword-match fix (both the VIP/LIMOUSINE/NORMAL branches and the "no param → no clause" case), and explicit confirmation that operator/seat-availability params have zero effect (proving they're genuinely unimplemented, not silently broken).
- `tests/phase2-search-filter-live.js` — 16-point live HTTP+DB script against the real running server, covering price/busType/sort/date/performance end-to-end. **16/16 passed** this session, including direct proof that `Infinity` no longer crashes into a 500, that `busType=VIP` returns real (non-empty, correctly-shaped) results, and that the new DB index is actually selected by the query planner.
- Pre-existing `tests/sprint3.test.js` price-validation tests (non-numeric/negative/min>max) — unaffected, still pass.
- `tests/phase1-migration.test.js` — extended with a 5th `verifySchema()` check (the new `migrate_v10.sql` index) and a dedicated missing-index test.

**The specific reported bug** ("lọc giá ở index.html không hoạt động") is covered end-to-end by: `phase2-price-filter.test.js`'s backend matrix (proves the backend was never the problem) + a manual, documented trace of `renderPage()`/`setPriceFilter()` (proves and fixes the actual frontend defect) + `phase2-search-filter-live.js`'s live proof that price filtering now produces correctly-bounded results through the real request/response cycle.

**Verification limitation, stated honestly**: browser-level DOM interaction (actually clicking a price chip in a rendered page and observing the trip list change) was attempted via the Browser pane tool and blocked by the same session-level policy restriction on `localhost:2704` encountered in earlier phases of this engagement. All inline `<script>` blocks were syntax-validated (`new Function()`, 7/7 pass, 0 errors) and the exact logic changes were traced by direct source reading against the live-verified backend responses — not fabricated as "browser-verified" when it was not.

---

## Files modified

- `server/controllers/tripController.js` — price-parameter hardening (regex + `Number.isFinite`), bus-type keyword-matching.
- `public/pages/passenger/index.html` — `renderPage()` (price filter applied before pagination, filtered-to-zero empty state, badge sync, bus-type keyword-match), `setPriceFilter()` (always re-renders), `searchTrips()` (reads real chip state instead of dead hidden selects; timezone-safe past-date check), new `resetTripFilters()`.
- `server/config/migrate_v10.sql` (new), `server/config/migrate.js` — additive `trip(status, departure_time)` index + schema verification.
- `tests/phase2-price-filter.test.js`, `tests/phase2-search-filter-matrix.test.js`, `tests/phase2-search-filter-live.js` (new).
- `tests/phase1-migration.test.js` — extended for the new index check.

## Not claimed

Operator filtering, seat-availability filtering, departure-time-descending sort, and duration sort remain genuinely unimplemented (no UI, no backend). `/api/trips` remains architecturally unbounded (index-accelerated, not paginated). Both are documented, quantified limitations — not silently fixed, not silently ignored.
