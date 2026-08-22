# SPRINT 3 — Security, RBAC & Perf Hardening — Final Report

**Scope:** P0 security/PII fixes, RBAC enforcement (account block, suspended operator), the `users.status` enum truncation bug, abandoned-checkout cleanup, `transitRouter.js` performance, and thesis-compliance documentation accuracy. No UI redesign — every frontend edit is either an auth-header addition to an existing fetch call or a one-line transparency notice, never a layout/flow change. Every fix has a regression test that would have failed before the fix and passes after, plus live proof against the real server and real database.

---

## 1. `GET /api/bookings` PII leak — fixed

**Root cause:** the endpoint was fully public (no `authenticate`) and completely unscoped — any HTTP client could dump the entire platform's booking ledger, including every operator's revenue and every passenger's `full_name`/`email`. The homepage's decorative ticker widget used this same PII-bearing endpoint just to show 20 rows.

**Fix — split into two endpoints:**
- `GET /api/bookings/ticker` (**new**, public, no auth): hard-capped at 20 rows, selects only the 8 fields the ticker actually renders (`full_name, booking_time, total_amount, status, origin, destination, bus_type, seat_numbers`) — no email, phone, `booking_id`, `user_id`, `plate_number`, or payment fields at all. `full_name` is masked **server-side** ("Nguyễn Văn An" → "An N.") — the raw name never leaves the server, including via devtools/network inspection (previously the frontend received the full name and masked it only for display).
- `GET /api/bookings` (existing path): now requires `authenticate, requireAdminOrOperator, attachOperatorId`. An OPERATOR is scoped to `WHERE bus.operator_id = ?` using the server-derived `req.operatorId` — never a client-supplied value. ADMIN is unscoped (matches the already-correct pattern in `adminController`'s own booking list).

**Frontend retrofitted:** `operator/bookings.html` had no auth-header mechanism at all (this is exactly why the Phase 2I audit deferred this fix) — added the same `_authHeaders()` Bearer-token pattern already used by `vehicles.html`/`trips.html`/`seats.html`, applied to the GET load and both PUT status-update calls (the latter were separately discovered to be silently 401-ing already, since `PUT /api/bookings/:id` has required auth since Phase 2I). `index.html`'s ticker now calls `/api/bookings/ticker` and no longer re-masks an already-masked name (the client-side `maskName()` function, now dead code, was removed; the offline demo-fallback data was updated to pre-masked names for visual consistency).

**Live proof** (`tests/phase3-security-live.js`):
```
GET /api/bookings (no auth):        401
GET /api/bookings/ticker:           200, count=20, zero PII fields
```

## 2. Account-block enforcement — fixed at all three points

**Root cause:** `authController.login()` never checked `user.status`; `authMiddleware.authenticate()` only verified the JWT signature/expiry, never re-checked the DB; `refreshToken()` reissued access tokens purely from the token payload. A blocked user could log in fresh, and any already-issued token (or refresh token, for up to 7 days) kept working after being blocked.

**Fix:**
- `login()`: rejects with 403 if `user.status !== 'ACTIVE'`, checked immediately after password validation.
- `authenticate()`: now re-queries `SELECT status FROM users WHERE user_id=?` (a single indexed PK lookup) on **every** authenticated request and rejects with 403 if not ACTIVE — the whole point is catching a status change that happened after the token was minted, so it cannot be trusted from the token claims.
- `refreshToken()`: same re-check before issuing a new access token.

**Live proof, all three points in sequence** (`tests/phase3-security-live.js`, using a real disposable account, admin-blocked mid-test):
```
login while ACTIVE:                          200, tokens issued
GET /api/users/:id before block:              200
[account blocked by admin]
login while BLOCKED:                          403
GET /api/users/:id with pre-block token:      403  (not silently trusted)
POST /api/auth/refresh with pre-block token:  403  (cannot mint a fresh token)
```

## 3. Suspended-operator enforcement — fixed

**Root cause:** `operatorScope.attachOperatorId` resolved `req.operatorId` purely from `users.operator_id` FK existence, never checking `bus_operator.status`. Admin "suspending" a bus company (`admin/operators.html`'s only disable action) had zero effect — every OPERATOR user linked to that company kept full create/update/delete access via every `ownsOperator()` check in the codebase.

**Fix:** `attachOperatorId`'s query now joins `bus_operator` and checks `status`. A SUSPENDED operator's linked user gets `req.operatorId = undefined` — the exact same fail-closed value as an unlinked account — which automatically closes the gap everywhere `ownsOperator()` is already used, with no per-controller changes required. A new `req.operatorSuspended` flag is also set for callers that want a more specific message.

**Live proof**, using the real pre-existing SUSPENDED operator in this database ("Thiên Lộc Bus", `operator_id=8`) and a disposable user linked to it:
```
GET  /api/buses  (suspended operator's user): 200, empty list (fails closed, not an error)
POST /api/buses  (create attempt):            403
```

## 4. Fleet data leak — `GET /api/buses` and `GET /api/seats/bus/:busId` — fixed

**Root cause:** `GET /api/buses` was fully public; even its optional `?operator_id=` filter trusted the client-supplied value directly, so any caller (including one operator targeting a competitor) could either omit the param (see everyone) or pass another operator's ID (see them specifically). `GET /api/seats/bus/:busId` (the whole-bus seat-layout endpoint, distinct from the trip-scoped passenger seat map) had the identical gap.

**Fix:**
- `GET /api/buses`: requires `authenticate, requireAdminOrOperator, attachOperatorId`. An OPERATOR is **always** scoped to `req.operatorId`, ignoring any client-supplied `operator_id` (regression-tested explicitly: a spoofed `?operator_id=999` in the query string has zero effect for an OPERATOR caller). ADMIN may filter by an explicit `operator_id` or see all.
- `GET /api/seats/bus/:busId`: same auth requirement, plus an ownership check identical to the pattern already used by every write on this exact resource (`updateSeat`/`deleteSeat`/`expandSeats`) — fetch the bus's `operator_id`, then `ownsOperator()`.
- `GET /api/seats/trip/:tripId` (the passenger-facing seat map used by `booking.html`/`index.html`) was deliberately **left public** — booking a specific trip's seats with no login is a legitimate anonymous action, not a fleet-data leak; it has no bearing on another operator's fleet configuration.

**Frontend retrofitted** with the `_authHeaders()` pattern: `operator/vehicles.html`, `operator/trips.html` (its `loadBuses()`), `operator/seats.html` (its `loadSeats()`), `admin/operators.html`.

**Live proof:** `GET /api/buses` and `GET /api/seats/bus/:id` both confirmed 401 without a token (`tests/phase3-security-live.js`); scoping and spoofing-resistance covered by mocked regression tests (`tests/phase3-security.test.js`).

## 5. `users.status` `'INACTIVE'` enum-truncation bug — fixed

**Root cause:** `userController.deleteUser`'s soft-delete path (users with booking history are deactivated rather than hard-deleted) writes `status='INACTIVE'`, but `users.status` was `enum('ACTIVE','BLOCKED')` — `'INACTIVE'` is not a member. Under this database's non-strict `sql_mode` (no `STRICT_TRANS_TABLES`, confirmed in Sprint 1), the write silently truncated to `''` instead of erroring or storing the intended value.

**Fix:** `migrate_v11.sql` widens the enum to `enum('ACTIVE','BLOCKED','INACTIVE')` — additive, matches the exact pattern already used by `migrate_v6.sql` for `trip.status`. Chosen over reusing `'BLOCKED'` for this path: a soft-deleted account (has historical bookings, no longer usable) and an admin-blocked account (still exists, punitive action) are different states worth distinguishing in the admin user list. `authMiddleware.VALID_STATUSES` updated to recognize `'INACTIVE'` too, so both the admin user-list filter and the manual status-update validation work correctly for it.

**Live proof:**
```
users.status column (before): enum('ACTIVE','BLOCKED')
users.status column (after):  enum('ACTIVE','BLOCKED','INACTIVE')
Direct INSERT with status='INACTIVE', read back: {"status":"INACTIVE"}   (previously would have stored '')
```

## 6. Abandoned-checkout cleanup — new job

**Root cause:** a booking left in `PENDING` status has no other release path — `trip_seat_hold` (Sprint 1's DB-level seat-uniqueness table) only frees a seat when a booking is explicitly `CANCELED`. An abandoned checkout permanently locked that seat out of inventory. The Sprint 0 master audit had already found and documented **8 real bookings stuck in `PENDING` for over a day** in this exact database.

**Fix:** new `server/services/bookingCleanup.js`, registered in `server.js` via `setInterval(..., 5 * 60 * 1000)` (every 5 minutes). `cancelAbandonedBookings()` finds every `PENDING` booking older than 15 minutes and, for each, atomically (own transaction per booking, so one failure never blocks the others): `UPDATE booking SET status='CANCELED' WHERE booking_id=? AND status='PENDING'` (the same atomic guard already proven correct in `payBooking` — if the booking was paid/canceled by the user in the interim, `affectedRows=0` and it's skipped, never force-overwritten) then `DELETE FROM trip_seat_hold WHERE booking_id=?`.

**Live proof — this is not a synthetic demo, it retroactively fixed real, previously-broken production data:**
```
Before running cancelAbandonedBookings():  8 real PENDING bookings older than 15 minutes
                                            (one was this test's own disposable booking,
                                             seven were the pre-existing stuck bookings
                                             documented in the Sprint 0 master audit)
cancelAbandonedBookings() result:          { canceled: 8, skipped: 0 }
After:                                     0 stale PENDING bookings, 0 orphaned trip_seat_hold rows
```

## 7. `transitRouter.js` performance — ~35s → ~1.5s

**Root cause (three compounding factors, all fixed without changing search semantics):**
1. `loadAvailableTrips` had no upper bound on either the SQL date range or the virtual-projection window — every real trip (up to 8,000, `LIMIT`-capped but otherwise date-range-unbounded) was projected forward **16 days**, producing up to ~128,000 in-memory virtual-trip objects rebuilt from scratch on every request.
2. `findTransitRoutes`'s "find onward legs from this city" step linearly rescanned the **entire** trips array (real+virtual) on every BFS queue pop — O(hops × queue-size × array-size).
3. `queue.sort()` re-sorted the whole frontier on every single pop — O(n log n) per iteration instead of O(log n).

**Fix:**
1. `PROJECTION_DAYS` reduced from 16 to 5 (still generous: `MAX_HOPS=3` legs + 2×`MAX_TRANSFER_MS`=16h waits tops out around 2-3 days of real span for any single itinerary), with a matching SQL upper bound added (`AND t.departure_time < DATE_ADD(?, INTERVAL 7 DAY)`) so the real-trip fetch and the virtual-projection range are consistent instead of one silently over-provisioning for the other.
2. A one-time `Map`-based city index (`buildCityIndex`/`tripsFromCity`), built once before the BFS starts. Preserves `citiesMatch()`'s exact fuzzy (substring-inclusion) matching semantics — verified by a dedicated regression test comparing index-lookup results against direct `citiesMatch()` calls — by fuzzy-matching against the small set of *distinct* city names (dozens, not thousands) rather than scanning every trip; results are memoized per city name since BFS branches repeatedly converge on the same cities.
3. A binary min-heap (`MinHeap` class) replaces `queue.sort()` — O(log n) push/pop.

**Correctness preserved:** all 17 pre-existing tests in `tests/transitRouter.test.js` pass unchanged — same direct-route detection, same 1-hop transit detection, same min-30-minute-transfer rejection, same cost-mode ordering.

**Live proof, real server + real database, this session:**
```
Direct module call, 4 route pairs:
  Hà Nội → TP. Hồ Chí Minh:     1,546 ms  (direct=237, transit=5)
  Hòa Bình → Ninh Bình:         1,284 ms  (direct=9,   transit=5)
  Bắc Giang → Tuyên Quang:      1,153 ms  (direct=6,   transit=5)
  Hà Nội → Đà Nẵng:             1,156 ms  (direct=12,  transit=5)

Real HTTP endpoint, POST /api/search/transit (Hà Nội → TP. Hồ Chí Minh):
  1,643 ms and 1,479 ms across two separate runs — both well under the 2s target.

Compare to Sprint 0's live measurement: ~35,000 ms.  ≈ 22-24× faster.
```

## 8. Thesis-compliance documentation accuracy

- `server/ai/recommendation.js`: file header and the support-classifier section header corrected from "NLP Classification" to "Rule-based Keyword Classifier" — the function does Vietnamese substring/keyword matching against a static word list with canned response templates; no tokenization, embeddings, or trained model.
- `server/swagger.js`: the `/api/admin/ai/classify-ticket` OpenAPI summary corrected the same way — this is user-facing API documentation (`/api-docs`), not just an internal comment.
- `docs/SMARTBUSAI_TECHNICAL_REPORT.md` and `docs/SPRINT3_AUDIT_REPORT.md`: the same "NLP Classification" claim corrected in both.
- **VietQR / manual-pay transparency**: `confirmVietQR` already self-documented as a simulation in code (pre-existing, confirmed accurate — "mô phỏng, không phải xác thực chữ ký ngân hàng thật"). Added: (a) an explicit code comment on `payBooking` distinguishing `method=CASH` (a genuine real-world action — an operator physically receives cash, there's no gateway to call) from `method=MOMO/ZALOPAY/BANK` submitted through that same endpoint (a trust-based simulation, identical in kind to `confirmVietQR` — the real gateway-verified paths are the separate `/momo/notify`, `/vnpay/return`, `/vietqr/confirm` handlers); (b) a small, visible notice in the passenger payment QR modal (`booking.html`) — *"⚠️ Chế độ demo — thanh toán được mô phỏng cho mục đích đồ án, không kết nối cổng thanh toán/ngân hàng thật"* — shown for every payment method in that modal, not just VietQR, since the MoMo/ZaloPay QR codes there are also generated via a generic third-party QR-image API, not a real gateway call.

---

## Files modified

**Backend:** `server/controllers/bookingController.js` (ticker split, payBooking transparency comment), `server/controllers/authController.js` (login/refreshToken status checks), `server/middleware/authMiddleware.js` (authenticate status re-check, VALID_STATUSES), `server/middleware/operatorScope.js` (suspended-operator check), `server/controllers/busController.js` (getBuses scoping), `server/controllers/seatController.js` (getSeatsByBus ownership check), `server/routes/bookingRoutes.js`, `server/routes/busRoutes.js`, `server/routes/seatRoutes.js`, `server/ai/transitRouter.js` (full perf rewrite), `server/ai/recommendation.js` (doc correction), `server/swagger.js` (doc correction), `server/server.js` (cleanup job registration), `server/services/bookingCleanup.js` (new), `server/config/migrate_v11.sql` (new), `server/config/migrate.js` (wired v11 + schema check).

**Frontend:** `public/pages/passenger/index.html` (ticker endpoint switch, dead-code removal), `public/pages/passenger/booking.html` (demo-payment notice), `public/pages/operator/bookings.html`, `public/pages/operator/vehicles.html`, `public/pages/operator/trips.html`, `public/pages/operator/seats.html`, `public/pages/admin/operators.html` (all: `_authHeaders()` retrofit on the affected fetch calls).

**Docs:** `docs/SMARTBUSAI_TECHNICAL_REPORT.md`, `docs/SPRINT3_AUDIT_REPORT.md`.

**Tests (new):** `tests/phase3-security.test.js` (20), `tests/phase3-security-live.js` (10-point live script), `tests/phase3-booking-cleanup.test.js` (6), `tests/phase3-transit-perf.test.js` (12). **Tests (updated for a legitimate, non-cosmetic behavior change only):** `tests/phase1-migration.test.js` (refactored to a maintainable `queueAllPresent()` helper + new INACTIVE-enum-missing case).

---

## Full test suite

```
Test Suites: 28 passed, 28 total
Tests:       319 passed, 319 total
```

280 tests carried over from Sprints 1-2 (zero behavior regressions — re-verified clean at every step of this sprint) + 39 new across the four Sprint 3 test files. All inline `<script>` blocks in every modified HTML file re-validated with `new Function()` (0 syntax errors). Two clean server restarts this session both showed `✅ [migrate] schema verified — all required objects present` before `🚀 SmartBus Server Running`.

## Live verification summary

| Check | Method | Result |
|---|---|---|
| `GET /api/bookings` unauthenticated | live HTTP | 401 |
| `GET /api/bookings/ticker` shape/cap/masking | live HTTP | 200, 20 rows, 0 PII fields |
| `GET /api/buses` unauthenticated | live HTTP | 401 |
| Blocked-user login / pre-block token / refresh | live HTTP, real disposable account | 403 / 403 / 403 |
| Suspended-operator buses read/create | live HTTP, the real SUSPENDED operator in this DB | 200 (empty) / 403 |
| `users.status` accepts `'INACTIVE'` | live DB write+read | confirmed, no truncation |
| Abandoned-booking cleanup | live DB, real stuck data | 8 real bookings correctly canceled, seats released |
| Transit search latency | live HTTP + direct module calls, 4 route pairs | 1.15s-1.65s (target: <2s; was ~35s) |

## Not claimed

This report does not certify production-readiness beyond what is proven above. Out of this sprint's explicit scope and left untouched: `GET /api/trips`'s own unbounded-payload architecture (Sprint 2 already added an index there; full pagination was explicitly deferred as a "large architecture change" both times), the two duplicate AI recommendation engines noted in the Sprint 0 audit, and any UI visual redesign — none of that was requested or attempted here.
