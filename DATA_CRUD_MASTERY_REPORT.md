# DATA & CRUD MASTERY REPORT — Sprint 6: Data Integrity, Route Map & Seat Map Mastery

**Scope:** 100% real, grounded `route_stop` coverage; a Dynamic Seat Layout Engine (floor/row/column/aisle JSON matrix) replacing the old one-size-fits-all flat seat grid; CRUD guards that block structural edits/deletes on booked buses and trips; passenger profile auto-fill + a saved-passengers companion list + a consolidated stats endpoint; opt-in, capped pagination on the three previously-unbounded list endpoints; and a real data-sanitization script. Every number below is either a live measurement against the real database this session or a passing automated test — nothing here is estimated.

---

## 1. Route Map Data Completion

**Before:** 181/1,095 routes (16.5%) had any `route_stop` row at all — `seed_full.js`'s own stop-seeding logic only ever runs once (gated behind `stopCount.cnt < 100`), and had been permanently skipped since an early, partial run.

**A real data-quality issue found first, before writing anything new:** route_id=1 had 67 junk rows mixed in with its 5 real curated stops — `stop_name` literally `"Bến xe A"`, `lat=lng=0`, `stop_order=0`, inserted repeatedly (every 20-90 minutes) across a full month (2026-07-16 to 2026-08-16). Confirmed via `grep` that no current code path hardcodes this value — a one-time manual/test-session cleanup, not a live bug. Removed as part of the same pass.

**`server/config/generate_route_stops.js` (new)** — reuses `seed_full.js`'s own `BUS_STATIONS` (62/63 provinces have a real, named, addressed bus station — now exported from `seed_full.js` rather than duplicated) and `PROVINCES` (real province-center coordinates) for the fallback case. Grounding rule, identical in spirit to the Sprint 4 map rule ("never a fabricated coordinate"): a stop is only created from a real curated station or a real province-center coordinate — never invented.

**`migrate_v13.sql`** adds `route_stop.estimated_min_from_origin` (nullable INT) — computed from `route.distance_km / 50 km/h`, where **50 km/h was calibrated against this database's own real trip data** (2,000-row sample of `TIMESTAMPDIFF(MINUTE, departure_time, arrival_time)` vs `distance_km`: avg 49.2 km/h, median 47.9 km/h — not an arbitrary guess).

**Live result:**
```
Before: 181/1,095 routes covered (16.5%)
After:  1,089/1,095 routes covered (99.5%)
        908 routes fixed, 2,019 stops created, 67 junk rows removed
```
**Honestly not covered — 6 routes, all involving Phú Quốc** (an island with no real intercity bus terminal — reached by air/sea, not road). Rather than fabricate a coastal terminal, these are reported as skipped; flagged as a genuine upstream data anomaly worth a human decision (why does an intercity bus-route database contain Phú Quốc routes at all?), not silently patched over.

## 2. Dynamic Seat Layout Engine

**`migrate_v14.sql`** adds `bus.seat_layout_config JSON` — a floor/row/column/aisle/special-seat blueprint. The existing `seat` table (booking-relevant ground truth) is intentionally unchanged — seats are generated *from* this blueprint, so no existing booking/seat-map code path changes shape.

**`server/services/seatLayoutService.js` (new)** classifies `bus_type` into SEATER / LIMOUSINE / SLEEPER using the same keyword-matching approach already established and tested in `tripController.js`'s search filter — not a new taxonomy:

| Category | Trigger | Layout |
|---|---|---|
| SEATER | default (e.g. "Ghế ngồi 45 chỗ") | 1 floor, 4-across (A-D), first 2 rows VIP — matches the exact pre-Sprint-6 layout |
| LIMOUSINE | "VIP"/"Limousine" | 1 floor, spacious 2-across (A-B), all VIP |
| SLEEPER | "Giường nằm"/"Sleeper" | 2 floors, 2-across berths, floor-2 seat numbers prefixed to avoid A1/A1 collisions |

Verified for every real bus-type/seat-count combination actually seeded in this database (45/29/22/16/40/34-seat variants): exact seat count generated every time, zero duplicate seat numbers.

**Live-verified against a real bus** (`bus_id=1`, "Giường nằm 40 chỗ"): `GET /api/buses/1/seat-layout` correctly returns 2 floors, 40 total seats, category `SLEEPER`.

## 3. CRUD Validation — blocked when actively booked

**Root problem:** `updateBus`/`deleteBus` had **zero** protection — any bus, however booked, could have its type/seat-count changed or be hard-deleted, silently invalidating every ticket sold against it. `updateTrip` had the same gap for route/bus/departure/arrival changes (only `deleteTrip` had a partial guard — soft-cancel instead of hard-delete if *any* booking history existed).

**Fix — scoped precisely, not a blanket lock:** `updateBus`/`deleteBus`/`updateTrip` now check for `PAID`/`PENDING` bookings only when a *structural* field is actually changing (`bus_type`/`total_seats` for buses; `route_id`/`bus_id`/`departure_time`/`arrival_time` for trips) — re-submitting identical values, or only touching `status`/`price`/`description`, is unaffected (so the auto-advance cron job and dynamic pricing keep working exactly as before).

**Live-verified against a real bus with 19 real active bookings** (`bus_id=5`):
```
PUT bus_type+total_seats change:  409 "...xe này đang có 19 vé ở trạng thái đã đặt/chờ thanh toán"
PUT same bus_type/total_seats, only description changed:  200 OK
```

## 4. User Profile & Personalization

**`migrate_v15.sql`** adds `users.id_number`/`default_pickup`/`default_dropoff` (nullable, additive) and a new `saved_passenger` table (proper one-to-many relation — a companion list, not a JSON blob, since it genuinely is one).

**New endpoints:**
- `GET/POST /api/users/:id/saved-passengers`, `DELETE /api/users/:id/saved-passengers/:passengerId` — capped at 20 saved passengers/user; delete is scoped to both IDs (cannot delete another user's saved passenger even by guessing an ID).
- `GET /api/users/:id/stats-summary` — **composes the three already-existing endpoints** (`getUserStats`, `getTravelProfile`, `loyaltyService.getUserLoyalty`) into one response, reusing their real SQL verbatim (via a throwaway `res` capture, not a rewrite) rather than duplicating it. `updateUser` extended with the same `IFNULL(?, column)` omit-preserves-existing pattern already used for every other profile field.

**Live-verified against a real user with real booking history** (`user_id=1`):
```
GET /api/users/1/stats-summary →
  total_trips: 36, total_spent: 12,265,500đ, favorite_route: "Hà Nội → Hải Phòng",
  km_traveled: 14,780, loyalty_points: 6,895, membership_tier: "DIAMOND"
POST saved-passengers → add/list/delete all confirmed working, test record cleaned up
```

## 5. Pagination

**Investigated first, not assumed:** a full inventory of every frontend call site for `GET /api/trips`, `/api/bookings`, `/api/buses` found **at least 8 call sites that need the complete, unbounded dataset to keep working correctly** — the passenger homepage's entire client-side search + AI-chatbot dataset, admin DB backup/export, and cross-operator aggregate fleet scoring among them. A blanket always-on `limit=20` default would have silently corrupted all of those (wrong search results, incomplete backups, wrong platform-wide stats), not just made a list shorter.

**Implemented instead: opt-in, capped pagination.** `?page=`/`?limit=` (default 20, max 100 — server/utils/pagination.js) on all three endpoints. Omitting both params preserves the **exact prior behavior** (raw unbounded array) — nothing that currently depends on getting everything silently breaks.

**Live-verified, all three endpoints:**
```
GET /api/trips (no params):        raw array, 12,356 items (unchanged)
GET /api/trips?page=1&limit=5:     {data:[5 items], pagination:{total:12356, totalPages:2472}}
GET /api/trips?page=2&limit=5:     different 5 items than page 1 (correctly paginated)
GET /api/buses?page=1&limit=3:     {data:[3 items], pagination:{total:53, totalPages:18}}
GET /api/bookings?page=1&limit=5:  {data:[5 items], pagination:{total:104, totalPages:21}}
GET /api/trips?limit=99999:        capped at limit:100
```

**Not converted — three frontend tables, on purpose, not by oversight:** `operator/trips.html`, `operator/bookings.html`, and `operator/vehicles.html` already have their own client-side pager, and were the natural conversion candidates. Investigated and found each one's KPI tiles (`updateKPI()`) aggregate over the *full* in-memory array (`allTrips.length`, `allVehicles.filter(...).length`, etc.) — switching them to fetch only one server-side page at a time would silently make those KPI numbers wrong (e.g. "total buses: 9" instead of 53), trading one bug for another. Converting these safely needs either a dedicated lightweight stats endpoint or restructuring their KPI logic — scoped honestly as follow-up work rather than rushed within this sprint.

## 6. Data Sanitization

**`server/config/sanitize_data.js`** + `npm run db:sanitize` (and `db:sanitize:dry-run`). Every check below was run against the real database *before* being written, not assumed:

| Check | Found | Action |
|---|---|---|
| Orphaned seats (bus_id not in bus) | 0 | Auto-fix (delete) — kept as an ongoing guard |
| Orphaned booking_detail | 0 | Auto-fix (delete) — ongoing guard |
| route_stop junk placeholder rows | 0 (already cleaned in §1) | Auto-fix — ongoing guard against recurrence |
| **Broken trips** (route_id/base_price NULL) | **3** (trip_id 4, 12, 15) | **Report only — never auto-fixed** |
| Invalid phone format | 0 | Auto-normalize (strip spaces/dashes/dots) when the result is a valid VN phone shape; report anything else |

**The 3 broken trips are a real, serious pre-existing issue:** `route_id`, `departure_time`, and `base_price` are all `NULL`, yet **7 real `PAID` bookings reference them, totaling ₫2,200,000 in revenue**. There is no way to recover what the original route/price/date should have been, and deleting these rows would silently orphan real paid bookings — so the script deliberately reports them (with the exact booking IDs and revenue at risk) for a human to investigate, rather than guessing.

**Auto-fix path verified for real**, not just the report path: inserted a disposable test user with phone `"090-123 456.7"`, ran `npm run db:sanitize`, confirmed it normalized to `"0901234567"` in the database, then deleted the test record.

## 7. Tests

**`tests/phase6-data-mastery.test.js` (new, 41 tests)** — seat-layout category classification and JSON-matrix generation (parameterized across every real bus-type/seat-count combination in this database, checking exact seat count + zero duplicates), CRUD-guard 409/200 behavior for `updateBus`/`deleteBus`/`updateTrip` (both the blocked and the allowed paths), `parsePagination`/`paginatedResponse` pure-logic edge cases plus controller-level pagination behavior for all three endpoints, saved-passenger CRUD (including the 20-passenger cap and cross-user delete protection), `getStatsSummary`'s composition of the three existing endpoints, `updateUser`'s new field handling, and `generate_route_stops`'s no-fabrication guarantee (a route with no real data available is skipped, never given fake coordinates; a route with real data gets exactly those real coordinates, never `0,0`).

```
tests/phase6-data-mastery.test.js:  41 passed, 41 total
```

**A real regression caught and fixed while building this:** `parsePagination(req.query)` threw when `req.query` was `undefined` — true for many existing test fixtures that never needed a `query` object before pagination existed. The uncaught throw happened *before* any `db.query` call, which desynchronized the shared `mockResolvedValueOnce` queue for every subsequent test in that file, cascading into 10 unrelated failures (`authController.login`, `seatController.getSeatsByBus`, `operatorScope.attachOperatorId` — files untouched this sprint) purely from queue misalignment. Fixed by guarding `parsePagination` against a missing `query` object; full suite confirmed green immediately after.

## Full regression suite

```
Test Suites: 31 passed, 31 total
Tests:       432 passed, 432 total
```

391 tests carried over from Sprints 1-5 (zero behavior regressions) + 41 new this sprint. Server restarted clean multiple times this session, each time showing all 15 migrations (`migrate_v2.sql` through `migrate_v15.sql`) complete and `✅ [migrate] schema verified — all required objects present` before `🚀 SmartBus Server Running`.

## Files created

- `server/config/generate_route_stops.js`, `server/config/sanitize_data.js`
- `server/services/seatLayoutService.js`
- `server/utils/pagination.js`
- `server/config/migrate_v13.sql`, `migrate_v14.sql`, `migrate_v15.sql`
- `tests/phase6-data-mastery.test.js`

## Files modified

- `server/config/seed_full.js` — exported `PROVINCES`/`BUS_STATIONS` for reuse (no duplication).
- `server/config/migrate.js` — registered v13-v15, extended `verifySchema()` with 3 new checks.
- `server/controllers/routeStopController.js` — `estimated_min_from_origin` in create/update.
- `server/controllers/busController.js` — seat-layout generation on create, structural-change booking guard + regeneration on update, booking guard on delete, new `getBusSeatLayout`, opt-in pagination.
- `server/controllers/tripController.js` — structural-change booking guard on `updateTrip`, opt-in pagination.
- `server/controllers/seatController.js` — `generateSeats` now layout-driven with legacy fallback.
- `server/controllers/bookingController.js` — opt-in pagination.
- `server/controllers/userController.js` — extended `updateUser`, `getUserById`; new `getStatsSummary`/`getSavedPassengers`/`addSavedPassenger`/`deleteSavedPassenger`.
- `server/routes/busRoutes.js`, `userRoutes.js` — new routes.
- `package.json` — `db:sanitize`, `db:sanitize:dry-run`, `db:seed-stops` scripts.
- `tests/phase1-migration.test.js`, `tests/phase2d-trip-integrity.test.js` — updated for the new `verifySchema()` checks and the new booking-count query in `updateTrip`'s call sequence.

## Upgrade guidance

1. Run migrations (automatic on server start — `migrate_v13.sql` through `v15.sql`).
2. Run `npm run db:seed-stops` once to backfill `route_stop` coverage on any environment that hasn't had it run yet (idempotent — safe to re-run, only targets routes with zero existing stops).
3. Run `npm run db:sanitize:dry-run` to review findings before applying; `npm run db:sanitize` to apply the safe auto-fixes. **The 3 broken-trip rows it reports require manual investigation** — decide per-trip whether to reconstruct (if the original route can be inferred from context) or cancel-and-refund-track, then handle directly; the script will not guess.
4. Existing buses created before this sprint have `seat_layout_config = NULL` — they fall back to the legacy flat layout automatically; no migration action needed unless an operator wants to explicitly regenerate one (via any `PUT /api/buses/:id` that changes `bus_type`/`total_seats`).

## Not claimed

Consistent with every report in this engagement: 6 Phú Quốc routes remain without route_stop data (no real bus terminal exists there — flagged as a data-model question, not patched over). The 3 broken trip rows are reported, not fixed — no safe automatic fix exists. Three frontend list pages were deliberately not converted to consume server-side pagination (would break their KPI accuracy without additional stats-endpoint work) — the backend capability is real and tested, the frontend adoption is partial by design, not by oversight. Seat-layout manual cell-by-cell editing (beyond auto-generation from bus_type/total_seats) was not built — out of scope for this pass. Everything else in this report was implemented, live-verified against the real server and database, and is covered by a passing automated test.
