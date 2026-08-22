# SmartBusAI — Master Product Completion Matrix

**Audit type:** Read-only forensic product-completion audit (no source, DB, or config was modified during this phase).
**Scope:** Full-stack — frontend (passenger/admin/operator/auth), backend (routes/controllers/middleware/services/AI), MariaDB 10.4.32 schema (`smartbusai`, 21 tables), and the test suite.
**Method:** Direct live investigation (process/port/DB checks, live SQL, live HTTP timing) plus six parallel read-only research passes, each independently evidence-gated (exact `file:line`, quoted code/SQL, live query/HTTP results). No finding below is speculative; anything that could not be verified is explicitly marked `UNVERIFIED` rather than assumed.
**Non-claim:** This document does not certify production-readiness. Several P0 findings are *currently active data-corruption and security defects in the live database*, not theoretical risks.

---

## 0. SAFETY GATE

| Check | Result |
|---|---|
| Node process | Single `node server/server.js`, PID 17868, healthy |
| Port 2704 | LISTENING (0.0.0.0 and ::), no conflicts |
| DB connectivity | Live-verified via app's own `mysql2` pool — connects successfully |
| DB engine/version/name | MariaDB **10.4.32**, database `smartbusai`, host `DESKTOP-ET8DAVT`, 21 tables |
| Config in use | `D:\smartbusai\.env` → `DB_HOST=localhost, DB_USER=root, DB_PASSWORD=(empty), DB_NAME=smartbusai, DB_PORT=3306, PORT=2704` |
| Migration runner connection | `server/config/migrate.js` → `require('./db')` — same pool as the app |
| Seed runner connection | `server/config/seed_full.js` → same pool |
| `sql_mode` | `IGNORE_SPACE,NO_ZERO_IN_DATE,NO_ZERO_DATE,NO_ENGINE_SUBSTITUTION` — **no `STRICT_TRANS_TABLES`**, so invalid enum writes are silently truncated to `''` instead of rejected. This is the direct mechanism behind Finding **A2** below. |

### `MySQL Connection Failed: connect ETIMEDOUT` / `[migrate] Skipped: connect ETIMEDOUT` — traced, not reproduced live

No `ETIMEDOUT` occurred during this session's live check. However, the code path was fully traced and is a **confirmed structural defect**, independent of whether it fires today:

- `server/server.js:41` — `runMigration()` called **without `await`** (fire-and-forget).
- `server/server.js:45` — `setTimeout(runSeedIfNeeded, 2000)` — also disconnected from startup flow.
- `server/config/db.js:17-25` — the pool's own connectivity self-test is an unawaited IIFE; on failure it only does `console.error("❌ MySQL Connection Failed:", err.message)` — no throw, no retry, no process exit.
- `server/config/migrate.js:17-26` — every SQL statement is wrapped in try/catch; failures are swallowed unless `err.errno` is outside `{1050,1060,1061,1064}`. An `ETIMEDOUT` (no matching `errno`) falls into `console.warn('[migrate] Skipped:', ...)` and is silently skipped, statement by statement, for the whole file.
- `server/server.js:279` (`server.listen(PORT, ...)`) has **zero dependency** on migration or seed completion.

**Verdict:** if MariaDB is slow to accept connections at boot (service race, network blip, container cold-start), the server will print `🚀 SmartBus Server Running` and begin serving traffic against a schema that may be missing v2/v3/v4 migrations, with no operator-visible error beyond an easily-missed console line. Logged as **Backend Risk — see BR-1**.

---

## 1. SOURCE-OF-TRUTH INVENTORY (condensed)

**Frontend** (`public/pages/`): auth (login, register, forgot-password), passenger (index — 7,763 lines/394KB, booking — 6,120 lines, profile — 5,169 lines, payment-result, hotro, nha-xe), admin (admin, users, operators, support, settings), operator (operator, vehicles, seats, trips, bookings, revenue, scan). Shared JS: `public/js/{api,app,register,admin-notif,routeInference}.js`.

**Backend**: 16 route files, 14 controllers, 3 middleware (`authMiddleware.js`, `operatorScope.js`, `rateLimiter.js`), 5 services (payment, pricing, QR, email, loyalty), 2 AI modules (`recommendation.js`, `transitRouter.js`).

**Database** (live-queried, 21 tables incl. 2 dated backup tables `trip_orphan_cleanup_backup_20260815` / `trip_status_recovery_backup_20260815` — evidence of a prior manual data-repair incident, not from this audit): `users`, `bus_operator`, `bus`, `seat`, `route`, `route_stop`, `trip`, `booking`, `booking_detail`, `payment`, `review`, `operator_review`, `support_request`, `ai_recommendation`, `user_behavior`, `search_log`, `location`, `loyalty_transactions`, `password_reset_tokens`. Live row counts of note: `trip` = **13,401**, `route` = 1,095, `booking` = 102, `bus` = 53.

**Tests** (`tests/`, 60 files, all read individually): 20 real Jest suites (209/209 passing), 3 reusable diagnostics, 11 temporary live-verification scripts, ~30 temporary setup/cleanup/snapshot files, 4 genuinely destructive hardcoded-ID cleanup scripts. Full classification in §8.

**Docs**: `README.md` + 12 files under `docs/` (API docs, DB docs, feature matrix, requirement traceability, audit summaries). Treated as claims to verify, not ground truth — see §10.

---

## 2. REQUIREMENT TRACEABILITY MATRIX

| Requirement | UI | API | Controller | DB | Status |
|---|---|---|---|---|---|
| Registration | register.html | POST /api/auth/register | authController.register | users | FULLY IMPLEMENTED |
| Login | login.html | POST /api/auth/login | authController.login | users | **PARTIALLY IMPLEMENTED** — auth works, account-block enforcement is BROKEN (A1) |
| Trip search (core filters) | index.html | GET /api/trips/search | tripController.searchTrips | trip/route/bus | FULLY IMPLEMENTED |
| Trip search (bus-type/sort/time-of-day/arrival/operator filters) | index.html | GET /api/trips/search | tripController.searchTrips | trip/route/bus | **PARTIALLY IMPLEMENTED / MOCK / MISSING** — see §6 |
| Seat selection + soft lock | booking.html | GET /api/seats/trip/:id + Socket.IO | seatController + server.js:184-262 | seat/booking_detail | FULLY IMPLEMENTED (soft lock is cosmetic only, see SB1) |
| Booking creation | booking.html | POST /api/bookings | bookingController.createBooking | booking, booking_detail (transaction, `FOR UPDATE`) | FULLY IMPLEMENTED but **not constraint-safe** (SB1) |
| Payment — MoMo/VNPay | payment-result.html | POST /api/payment/create | paymentService.js | booking, payment | FULLY IMPLEMENTED against **sandbox** endpoints with demo fallback credentials — see §7 |
| Payment — VietQR | payment-result.html | POST /api/payment/create | paymentService.getVietQRUrl | payment | **MOCK** — explicitly documented in-code as simulated, no real bank-signature verification |
| Payment — manual/cash (`payBooking`) | operator UI | POST /bookings/:id/pay | bookingController.payBooking | booking, payment | **MOCK for MOMO/ZALOPAY/BANK methods** — no gateway call, direct status flip (atomically guarded, so not racy — just not real) |
| Reviews (trip/operator) | index.html, nha-xe.html | POST /api/reviews, /api/reviews/operator | reviewController | review, operator_review | FULLY IMPLEMENTED |
| Admin: users/operators/routes/buses/locations CRUD | admin/*.html | /api/users, /api/operators, /api/admin/routes, /api/buses, /api/admin/locations | userController, operatorController, adminController | users, bus_operator, route, bus, location | FULLY IMPLEMENTED (real CRUD; data-quality bug A2/A3) |
| Admin: bookings/payments dashboard | admin.html | /api/admin/* | adminController | booking, payment | FULLY IMPLEMENTED, correctly authenticated/paginated |
| Operator dashboard (stats/revenue/etc.) | operator.html, revenue.html | /api/operators/dashboard/* | operatorController | booking/trip/bus (operator-scoped) | FULLY IMPLEMENTED, correctly tenant-isolated (verified positive) |
| Operator vehicles/seats management | vehicles.html, seats.html | /api/buses, /api/seats | busController, seatController | bus, seat | **PARTIALLY IMPLEMENTED** — writes ownership-checked, reads leak all operators' fleets (O2) |
| Operator bookings management | bookings.html | GET /api/bookings | bookingController.getAllBookings | booking (JOIN users) | **BROKEN** — unauthenticated, unscoped, platform-wide PII leak (O1) |
| AI recommendations (passenger-facing) | index.html, profile.html | /api/ai/recommend/:id, /api/recommendations/me | passengerAIController | ai_recommendation, user_behavior, booking | FULLY IMPLEMENTED — real DB-driven heuristic, genuinely explainable, not ML |
| AI recommendations (admin analytics) | admin.html | /api/admin/ai/* | server/ai/recommendation.js | booking, trip, route | FULLY IMPLEMENTED — heuristic/statistical (linear regression, time-decay averages, threshold anomaly detection), not ML; duplicate engine from the passenger one (AI5) |
| Multi-hop transit search | index.html | POST /api/search/transit | transitRouter.js | trip, route | FULLY IMPLEMENTED but **~35s per request live-measured** (PF1) |
| Route visualization (passenger map) | index.html | GET /api/stops | routeStopController | route_stop, route | FULLY IMPLEMENTED — real 4-tier priority pipeline fixed in a prior audit pass, re-confirmed intact this pass |
| Support/help | hotro.html, admin/support.html | /api/support/* | supportController | support_request | FULLY IMPLEMENTED |
| Trip reminder emails | (background) | — | server.js setInterval | booking, trip, users | FULLY IMPLEMENTED, correct window logic — but downstream `departure_time` values may already be corrupted by TD1 |
| Recurring/auto-generated trips | (background) | — | tripController.autoGenerateRecurringTrips | trip | **BROKEN** — see TD1 |

---

## 3. CORE PRODUCT AUDIT — summarized (full detail in §4-§7 findings)

- **A. Search**: origin/destination/date/price fully wired end-to-end. Bus-type and sort chips are UI-only — wired to dead hidden `<select>` elements, never reach the backend (client-side re-filter/re-sort masks this for the user, except `sort=rating` which has no backend implementation at all). Departure-time-of-day filter is pure client-side MOCK — no backend capability exists. Arrival-time and operator filters are MISSING entirely. Pagination is client-side only over an unbounded server payload.
- **B. Route visualization**: already fixed in a prior audit pass (see `tests/route_visualization_forensic_audit.md`); re-confirmed this pass that the fabrication bug has not regressed and the 4-tier priority pipeline (real DB → curated estimate → honest origin/destination-only) is intact.
- **C. Booking**: real DB transaction with `FOR UPDATE` row locking — sound design, but **no DB-level constraint backs it up**, and live data proves the guarantee has already been violated at least 5 times (real, currently-active double-booked seats with completed payments). Cancellation correctly frees seats (single source-of-truth status join, no secondary flag to desync). No auto-expiry for abandoned `PENDING` bookings — 8 currently stuck, permanently locking seat inventory.
- **D. AI/Smart Recommendation**: genuinely real, DB-driven, heuristic/statistical (not trained ML) — collaborative filtering by co-occurrence, OLS linear regression for pricing, time-decay weighted averages for demand, threshold-based anomaly detection, keyword-matching "classifier" mislabeled as NLP in comments. Two independent, duplicate recommendation-scoring engines exist for conceptually the same feature. Three backend endpoints are fully implemented but never called by any frontend code (orphaned).
- **E. Admin**: CRUD is genuinely real everywhere checked, no mocking found. The one broken control is account-blocking, which has zero enforcement in the auth path.
- **F. Operator**: dashboard aggregate endpoints are correctly, robustly tenant-isolated (verified positive finding). But `bookings.html`, `vehicles.html`, and `seats.html` do not follow that same pattern — one is a full unauthenticated cross-tenant PII leak, two are unscoped cross-tenant fleet-data leaks. Suspending an operator account does not actually revoke their ability to operate.

---

## 4. TOP 20 BLOCKERS

*(Ranked by defense-day/production risk. Genuinely severe, evidence-backed P0 items — 16 identified; not padded to 20.)*

| # | Sev | File | Function | Evidence | Impact | Root cause | Fix | Regression test |
|---|---|---|---|---|---|---|---|---|
| 1 | P0 | `server/controllers/tripController.js:390-393,442-456` | `autoGenerateRecurringTrips` → `fmtUTC()` | `fmtUTC` extracts `getUTC*` fields and writes them as a raw `DATETIME` literal into a column whose established convention (MySQL `time_zone=SYSTEM=Asia/Bangkok`) is **local** fields. Live data: one recurring bus service (bus_id=12/route_id=2) drifted through nearly every hour of the day over 338 trips generated in ~31 days | Every daily auto-advance silently shifts departure/arrival by 7h, compounding on each subsequent advance; can flip overnight trips into same-day trips | UTC-field extraction used to serialize a `Date` back into a local-convention column | Use local-field formatter or pass `Date` objects directly to `db.query` (proven correct everywhere else in the codebase) | Yes — assert local-hour-of-day is preserved across ≥3 consecutive advance cycles |
| 2 | P0 | `public/pages/operator/trips.html:1497-1498` | `openEdit()` | `t.departure_time.slice(0,16)` takes a UTC-`Z` ISO string and drops it raw into a `datetime-local` input, which the HTML spec treats as unqualified local time | Editing *any* field (e.g. just the price) on a trip and saving silently corrupts departure/arrival by 7h — the form even *displays* the wrong time before any edit is made | Raw string slicing of a UTC-tagged ISO string instead of timezone-aware conversion | Use the offset-correction pattern already present in the same file at line 1330 (`liveUpdateEta`) | Yes — mock API response, assert form field shows local time not raw UTC slice |
| 3 | P0 | `public/pages/operator/trips.html:1344` | `saveLiveEta()` | `new Date(newTime).toISOString()...` converts a correctly-parsed local value back to UTC text before sending it to a local-convention column | Accepting the pre-filled ETA value (a common no-op save) corrupts `arrival_time` by 7h in the opposite direction; can collapse "arrives next morning" into "arrives same evening" | Same UTC/local field-extraction confusion as #1/#2, applied to `toISOString()` | Send the raw local `datetime-local` string as-is; backend already accepts naive local strings | Yes — assert PUT body resolves to the intended local time when re-read |
| 4 | P0 | `server/ai/transitRouter.js: loadAvailableTrips (52-127), findTransitRoutes (142-213)` | multi-hop transit search | Live-measured twice: `searchWithTransit({origin:'Hà Nội',destination:'TP. Hồ Chí Minh'})` took **35,144ms** and **36,022ms** | Core passenger feature (`POST /api/search/transit`) will exceed browser/proxy timeouts today; gets worse daily as `trip` grows via the (also-broken) auto-advance job | 16-day×8,000-trip virtual-trip projection rebuilt from scratch per request (up to 128,000 objects) + BFS that linearly re-scans the full ~136k-element array per dequeue + `queue.sort()` every iteration instead of a heap | Pre-bucket trips by city in a Map, use a heap instead of full-array sort, cap virtual-projection window, add the missing DB index (blocker #8) | Yes — integration test asserting completion within a time budget on a representative-size seed |
| 5 | P0 | `server/routes/bookingRoutes.js:15`, `server/controllers/bookingController.js:20-65` | `getAllBookings` | `router.get("/", bookingController.getAllBookings)` — **no** `authenticate`, **no** role check, **no** `WHERE` clause. Returns every booking on the platform with `u.full_name, u.email`, seat numbers, payment method/status, plate numbers | Any HTTP client, authenticated or not, can dump the entire booking ledger — full cross-tenant, cross-user PII leak. Actively exploited by the app itself: `operator/bookings.html` fetches this with no token and no operator filter, showing every operator's revenue and every passenger's PII to any logged-in operator | Endpoint shared indiscriminately between a public marketing ticker (needs 20 rows) and an operator management view (needs auth + tenant scope) with neither applied | Add `authenticate, requireAdminOrOperator, attachOperatorId`; scope SQL by `bs.operator_id`; give the public ticker its own minimal, limited endpoint | Yes — unauthenticated request rejected; Operator A never sees Operator B's rows |
| 6 | P0 | `server/controllers/authController.js:204-314` (`login`), `server/middleware/authMiddleware.js:22-38,321-352` | `login`, `authenticate`, `refreshToken` | `login()` never reads/checks `user.status`. `authenticate()` only does `jwt.verify()`, never re-queries DB status. `refreshToken()` reissues tokens purely from JWT payload. (`googleAuth()`'s partial check compares against `'BANNED'`, which is not a member of the live `enum('ACTIVE','BLOCKED')` — unreachable dead code) | Admin's "block user" control (`users.html`) has zero effect — a blocked user can log in fresh, and any already-issued token keeps working for up to 15min (access) / 7 days (refresh) after being blocked | Status enforcement was never wired into the auth path | Reject non-`ACTIVE` status at login (403); re-check status in `refreshToken()` at minimum | Yes — blocked user cannot log in; refresh token for a since-blocked user is rejected |
| 7 | P0 | `server/config/db.js`, `server/controllers/bookingController.js:199-212` (schema: `booking_detail`) | `createBooking` seat-lock | `SHOW CREATE TABLE booking_detail` confirms only non-unique `KEY` indexes on `booking_id`/`seat_id` — **no UNIQUE constraint** on `(trip_id, seat_id)`. Live query found **5 currently double-booked seats** with two simultaneously-active `PAID` bookings each and matching successful `payment` rows (not seed data — AUTO_INCREMENT far past the static seed file's row count) | Two different passengers hold a paid ticket for the identical seat on the identical trip — a real boarding-conflict/overselling condition with zero automatic detection | Entire seat-uniqueness guarantee is application-code discipline (`SELECT...FOR UPDATE`) with no DB-layer backstop; something has already bypassed it at least 5 times | Add a DB-level uniqueness guard (dedicated `(trip_id, seat_id)`-unique table or trigger); data-repair the 5 existing conflicts | Yes — a direct insert bypassing the app logic must fail at the DB layer |
| 8 | P0 | live `SHOW INDEX FROM trip` / `EXPLAIN` | all `trip`-querying controllers | `trip` has 13,401 rows; indexes exist only on `bus_id`/`route_id` (FK-derived). `EXPLAIN` on `WHERE status='OPEN' AND departure_time>=...` shows `type=ALL, rows=13160` — full table scan | Every trip listing/search/transit-search/dashboard query full-scans the largest table in the schema; directly feeds blocker #4; `/api/trips` measured at 315ms for an unbounded 7,141-row scan | No index was ever added for the columns actually used in nearly every `WHERE`/`ORDER BY` on this table | `ALTER TABLE trip ADD INDEX idx_status_departure (status, departure_time)` | Yes — `EXPLAIN` assertion that the query plan is no longer `type=ALL` |
| 9 | P0 | `server/server.js:41,45,279`, `server/config/migrate.js:17-26`, `server/config/db.js:17-25` | startup sequence | Migration and seed both fire unawaited; both swallow errors internally with only a console log; `server.listen()` has zero dependency on either completing (full trace in §0) | A DB cold-start race or transient connectivity blip lets the server report "running" and serve traffic against a partially-migrated schema, with no operator-visible failure | No readiness gating between DB/schema state and HTTP listener start | `await runMigration()` before `server.listen()`; fail loudly (exit or health-endpoint-flag) on migration failure rather than logging and continuing | Yes — simulate a migration failure and assert the server does not report healthy/ready |
| 10 | P0 | `server/config/seed_full.js:414-420` | bus seed | `INSERT INTO bus (...) VALUES (...,'ACTIVE')` — `bus.status` enum is `enum('AVAILABLE','MAINTENANCE')`; `'ACTIVE'` silently truncates to `''` under the confirmed non-strict `sql_mode`. Live: **40 of 53 buses have `status=''`** | 75% of the fleet falls into neither status bucket the UI filters/counts by (`operator/vehicles.html`); KPI counts and status badges are wrong for most of the fleet, live, right now | Seed literal was never a valid enum member; non-strict SQL mode masked it at insert time instead of erroring | Fix the seed literal to `'AVAILABLE'`; data-repair existing `status=''` rows; consider enabling `STRICT_TRANS_TABLES` | Yes — assert every seeded row has a valid enum status |
| 11 | P0 | `server/controllers/tripController.js` (`checkAndAdvanceIfNeeded`, 60s poll) | auto-advance cadence | 338 trip rows for one recurring service over 31 days (~11/day, not ~1/day) — consistent with blocker #1's corrupted timestamps landing in the past and immediately re-triggering another clone-and-corrupt cycle | Compounding: excess trip generation inflates `trip` row growth (feeding blocker #8/#4) and multiplies the corruption from blocker #1 | Likely side effect of #1 — a freshly-created clone whose timestamp was just shifted 7h earlier can immediately qualify as "already completed" on the next 60s poll | Fix blocker #1 first; add a per-bus/route/day clone-count metric to confirm cadence returns to ~1/day | Yes — after fixing #1, assert ≤1 new clone per bus/route per simulated day |
| 12 | P0 | `public/pages/passenger/index.html:6763`, `server/controllers/bookingController.js:20-65` | homepage "recent bookings" ticker | Same unauthenticated, unbounded, 7-table-join `GET /api/bookings` as blocker #5, called to render a 20-item decorative widget with `.slice(0,20)` applied client-side *after* the full table has already been fetched over the wire | Every additional booking row makes every anonymous homepage visitor's page load slower; currently masked by low row count (102) but this is the fastest-growing table in the schema | No `LIMIT`, no dedicated lightweight endpoint for the ticker's actual needs | Add `LIMIT 20` server-side or a dedicated minimal-column endpoint | Yes — assert ticker response is ≤20 rows via a single indexed query |
| 13 | P0 | `public/pages/passenger/index.html` | whole file | 7,763 lines / 394KB, one ~5,500-line inline `<script>` block; full parse/compile/execute cost on every homepage load regardless of which feature a visitor uses | Baseline page-weight/performance ceiling that compounds every other frontend finding in this document; not fixable within a thesis timeline as a rewrite, but is a legitimate blocker for any performance grading criterion | Organic feature accretion into one file with no build step/code-splitting | Out of scope to restructure now; flag explicitly in the thesis writeup as a known architectural limitation rather than claim otherwise | N/A (structural) |
| 14 | P0 | `public/pages/operator/vehicles.html:619`, `seats.html:667`, `server/controllers/busController.js:7-29` | fleet listing reads | Neither frontend page ever sends `operator_id`; `getBuses` only filters *if* the caller supplies it. `GET /api/buses` is intentionally public (no auth) | Any operator managing their own vehicle/seat list sees every competitor's plate numbers, bus types, seat counts, maintenance status, in their own dashboard | Client never opts into the scoping the server supports; server doesn't default-scope an authenticated operator's own request | Apply the pattern already used correctly in `operator/trips.html` (append `operator_id` from the logged-in user); better, make the server default-scope via `attachOperatorId` | Yes — an authenticated operator's fleet read never returns another operator's `bus_id`s |
| 15 | P0 | `server/middleware/operatorScope.js:27-52` | `attachOperatorId`, `ownsOperator` | Both resolve/compare purely by `operator_id`; neither checks `bus_operator.status` | Admin "suspending" a bus company (the only disable action in `admin/operators.html`) does not stop that company's OPERATOR user(s) from creating buses/trips or viewing dashboards — every write/read check is FK-existence-based, not status-based | Suspension was implemented as a data-model status flag but never wired into the authorization middleware that everything else keys off of | In `attachOperatorId`, additionally check resolved `bus_operator.status` and fail closed if not `ACTIVE` | Yes — suspend an operator, assert their subsequent writes/reads are rejected/empty |
| 16 | P0 | `server/controllers/userController.js:280` | `deleteUser` (soft delete) | `UPDATE users SET status='INACTIVE' ...` — `users.status` enum is `enum('ACTIVE','BLOCKED')`; `'INACTIVE'` is not a member and will silently truncate to `''` under the confirmed non-strict `sql_mode` — same mechanism as blocker #10, not yet manifested in current data but confirmed by direct code+schema inspection | A "soft-deleted" user with booking history ends up with `status=''`, which (per blocker #6) still isn't blocked from login anyway, and won't display correctly in admin's status filter | Enum value used in application code was never added to the schema | Add `'INACTIVE'` to the enum, or reuse `'BLOCKED'` for this path | Yes — soft-delete a user with bookings, assert resulting status is a schema-valid, filter-recognized value |

*(Only 16 items meet the bar for "blocker" — i.e., live-confirmed or directly-traced P0 defects with concrete production impact. Padding to 20 with lower-severity items would misrepresent severity; the remaining 4 slots are intentionally left unfilled. See §5 for the fuller P1-P3 bug catalog.)*

---

## 5. TOP 20 BUGS

*(Broader catalog, P1-P3, not necessarily defense-blocking but real, evidence-backed defects. All items already have Severity/File/Function/Evidence/Impact/Root cause/Fix/Test in the source agent reports; condensed here to keep this section scannable — full detail available on request.)*

| # | Sev | Area | Finding |
|---|---|---|---|
| 1 | P1 | Booking | 8 bookings stuck in `PENDING` >1 day (oldest since 2025-03-18), permanently locking seats out of inventory — no expiry job exists anywhere in `server.js` |
| 2 | P1 | Admin/Data | `bus.status=''` on 40/53 rows (see blocker #10) — listed here too as it independently breaks operator KPI displays |
| 3 | P1 | Operator | Cross-tenant fleet-data leak on vehicles/seats read (see blocker #14) |
| 4 | P1 | Operator | Suspended-operator enforcement gap (see blocker #15) |
| 5 | P1 | Performance | `GET /api/trips` / `/api/trips/search` return unbounded result sets (7,141 rows measured), paginated only client-side |
| 6 | P1 | Performance | Dynamic-price N+1 — 10 extra HTTP+DB round trips per search-results page for data derivable from the already-fetched listing |
| 7 | P1 | Performance | AI "top recommended routes" admin panel issues up to 61 sequential DB queries plus `ORDER BY RAND()` on `booking` |
| 8 | P1 | Performance | Cache-busting `?nocache=Date.now()` on the unbounded `/api/trips` call, including inside a 20s polling retry loop — guarantees repeated full scans, defeats all caching |
| 9 | P2 | Time/Date | `emailService.js` uses `toLocaleString('vi-VN')`/`toLocaleTimeString('vi-VN')` with no explicit `timeZone` — correct today only because Node's host TZ happens to equal Vietnam's; silently wrong on any deploy target with a different default TZ |
| 10 | P2 | Booking | VietQR "confirm payment" is explicitly a trust-based simulation (documented in-code as such) — server flips to `PAID` on a client claim with zero bank-signature verification |
| 11 | P2 | Booking | Manual `payBooking` for MOMO/ZALOPAY/BANK methods makes no actual gateway call — direct status flip (atomically guarded so not racy, just not real) |
| 12 | P2 | AI | Two independent, duplicate recommendation-scoring engines exist for the same conceptual feature (admin CF-only vs. passenger 4-factor weighted heuristic) — maintenance/audit risk, not a functional bug |
| 13 | P2 | AI | `classifySupportTicket` is documented in-code as "NLP Classification" but is pure Vietnamese keyword/substring matching with canned templates — misleading to any technical reviewer |
| 14 | P2 | AI | `/api/recommendations/trending` (the one the frontend actually calls) contains hardcoded score constants (`popularity: {score:80}`, `price_attract:{score:60,basis:'+0%'}`) instead of computing them, while a more rigorous, genuinely-computed sibling endpoint (`/api/ai/trending`) sits completely unused |
| 15 | P2 | Performance | `booking.status`/`booking.booking_time` have no index, hit by ~10 different admin/operator dashboard aggregate queries — cheap today (102 rows) but this is the fastest-growing table in the schema |
| 16 | P2 | Search | Bus-type and sort UI chips are wired to dead hidden `<select>` elements; the value that actually reaches the backend for these two filters is always empty (client-side re-filter masks it visually, except `sort=rating`, which has no backend implementation at all) |
| 17 | P2 | Operator | QR ticket verification (`/verify-qr`) is unauthenticated and not tenant-scoped — lower severity than the booking-list leak since it requires possessing a specific QR and only returns pass/fail + trip summary |
| 18 | P3 | AI | `haversine()` in `transitRouter.js` is defined/exported but never called anywhere — the module's implied "geographic pruning" doesn't exist; city matching is pure string comparison |
| 19 | P3 | AI | `/api/search/suggestions` and `/api/search/popular-transfers` are both fully implemented, real DB-backed endpoints with **zero frontend callers** — dead code paths |
| 20 | P3 | Route viz | `resolveRouteStops()`'s `findGeo()` fallback silently plots `[0,0]` (Gulf of Guinea) if a curated corridor city name fails to resolve, instead of omitting the point — low-severity edge case, not a regression of the previously-fixed fabrication bug |

---

## 6. TOP 10 BACKEND RISKS

| # | Sev | Risk | Evidence | Fix |
|---|---|---|---|---|
| 1 | P0 | Unauthenticated, unscoped `GET /api/bookings` (blockers #5, #12) | See §4 | Auth + tenant-scope + limit |
| 2 | P0 | No DB-level seat-uniqueness constraint (blocker #7) | 5 live double-booked seats | Add DB constraint |
| 3 | P0 | Migration/seed not gated on server startup (blocker #9) | Full trace in §0 | Await + fail loudly |
| 4 | P0 | Account-block has no enforcement in auth path (blocker #6) | See §4 | Check status at login + refresh |
| 5 | P1 | Suspended-operator status not checked in authz middleware (blocker #15) | See §4 | Check `bus_operator.status` |
| 6 | P1 | Cross-tenant fleet-data leak on unscoped reads (blocker #14) | See §4 | Scope reads to caller's operator |
| 7 | P1 | Enum-value/schema mismatches silently truncate due to non-strict `sql_mode` (blockers #10, #16) | Confirmed live for `bus.status`, traced for `users.status` | Fix literals; consider `STRICT_TRANS_TABLES` |
| 8 | P2 | Transaction usage across controllers is ad hoc, not a systematic house rule — only added reactively where a prior security pass found a specific race (payment, loyalty-point redemption) | `getConnection`/`beginTransaction` appear only in `bookingController.js` (3 uses) and `adminController.js` (1 use); every other multi-step-write controller uses plain sequential `db.query()` | Document an explicit "when to use a transaction" convention (e.g. in project memory/README) so it's applied proactively |
| 9 | P2 | VietQR payment confirmation trusts a client-supplied claim with no bank-signature verification | In-code comment self-documents this ("mô phỏng, không phải xác thực chữ ký ngân hàng thật") | Label clearly in UI/docs as demo-only; do not present as production-grade in the thesis defense |
| 10 | P2 | No auto-expiry for abandoned `PENDING` bookings | 8 live bookings stuck >1 day, permanently locking seats | Add a scheduled job (same pattern as existing `setInterval` jobs) |

---

## 7. TOP 10 TIME/DATE BUGS

*(Only 6 genuine, distinct findings exist in this category — listed in full rather than padded.)*

| # | Sev | Finding |
|---|---|---|
| 1 | P0 | `fmtUTC()` in `autoGenerateRecurringTrips` corrupts every auto-advanced trip's departure/arrival by ~7h, compounding on each advance — **live-confirmed with real drifting production data** (blocker #1) |
| 2 | P0 | Operator "Edit Trip" form (`openEdit`) displays and silently writes the wrong departure/arrival time on any save (blocker #2) |
| 3 | P0 | "Live ETA" quick-update (`saveLiveEta`) writes `arrival_time` 7h off in the opposite direction (blocker #3) |
| 4 | P1 | Auto-advance cadence anomaly (338 trips/31 days for one service, ~11× expected) — likely a compounding side effect of #1 (blocker #11) |
| 5 | P2 | `emailService.js` timezone-formatting has no explicit `timeZone` option — deploy-environment-dependent correctness (bug #9 in §5) |
| 6 | P3 | `isValidTripDate`/`updateTrip`'s forced-`Z` parsing is currently dead/safe but is the same anti-pattern as #1-#3 and is fragile against future refactors (e.g. enabling `dateStrings:true` on the pool) |

**Timezone-consistency verdict:** MIXED — the overall system design (MySQL `time_zone=SYSTEM=Asia/Bangkok`, mysql2 `timezone:'local'`, matching Node's own local TZ) is internally consistent and correctly honored by the vast majority of the codebase (trip creation, pricing engine, transit router, reminder-email window, all display/sort code). The break is isolated to exactly the three sites above that manually round-trip a `Date` through UTC-field extraction instead of local-field extraction — but two of those three are in the most-executed production code paths (a 60-second poller and the routine trip-edit UI), so the practical impact is severe and ongoing, not theoretical.

**Overnight-trip verdict:** duration/ETA *arithmetic* is sound everywhere (epoch-millisecond subtraction throughout, correctly handles midnight/month rollover by construction) — the failure is entirely in the storage round-trip (findings #1-#3 above), not the math.

---

## 8. TOP 10 PERFORMANCE PROBLEMS

*(Reproduced from the performance agent's live-measured ranking — exactly 10 genuine findings.)*

1. **Transit search takes ~35s per request, live-measured today** (`server/ai/transitRouter.js`) — O(hops × queue × 136k-element array) BFS, 16-day×8,000-trip virtual projection rebuilt per call, no supporting index.
2. **`trip` table (13,401 rows) has no index on `status`/`departure_time`** — forces full scans on the single most-queried table in the schema; root cause behind #1 and #3.
3. **`GET /api/trips` returns all 7,141 upcoming trips unbounded** (measured 315ms), paginated only client-side.
4. **`GET /api/bookings`** — unauthenticated, unpaginated, 7-table join, used by a decorative 20-item homepage ticker and by the operator bookings page.
5. **Dynamic-price N+1**: 10 extra HTTP+DB round trips per page of search results, for data derivable from the already-fetched trip listing.
6. **AI "top recommended routes" N+1**: up to 61 sequential DB queries for one admin dashboard panel, plus `ORDER BY RAND()` over `booking`.
7. **`booking.status`/`booking.booking_time` unindexed** — hit by ~10 different dashboard aggregate endpoints; currently cheap but the fastest-growing table in the schema.
8. **Passenger homepage is a 394KB/7,763-line single-file monolith** with one ~5,500-line inline script — full parse/compile cost on every visit regardless of feature used.
9. **`SELECT *` on multi-join aggregation endpoints** (`operatorController.getOperators`, `busController.getBuses`/`getBusById`, `adminController.getLocations`) — low impact now, grows with `bus`/`bus_operator`/`review`.
10. **Cache-busting (`?nocache=Date.now()`) on the unbounded `/api/trips` call**, including inside a 20s polling retry loop — guarantees the expensive query in #3 re-runs repeatedly and can never be cached.

**Verified clean (checked, no leak found):** Chart.js instance lifecycle (all re-render paths destroy before recreate) and Leaflet map lifecycle (all re-init paths remove/guard) — both correctly implemented despite being common bug classes.

---

## 9. TOP 10 INCOMPLETE FEATURES

| # | Feature | Status | Gap |
|---|---|---|---|
| 1 | Search — arrival-time filter | MISSING | No control in UI, no backend param |
| 2 | Search — operator filter | MISSING | No control in UI, no backend param on `searchTrips` |
| 3 | Search — sort by rating | MISSING (server-side) | Client fetches unsorted, re-sorts array locally; no backend capability exists at all |
| 4 | Search — bus-type / sort chips | PARTIALLY IMPLEMENTED | Backend supports both correctly; frontend wiring sends neither (dead hidden `<select>` elements) |
| 5 | Search — departure-time-of-day filter | MOCK | Pure client-side array filter; no backend WHERE clause exists to support it even if wired |
| 6 | Booking — abandoned-checkout recovery | MISSING | No expiry/auto-cancel job for stale `PENDING` bookings; 8 currently stuck |
| 7 | Operator suspension enforcement | PARTIALLY IMPLEMENTED | Status flag exists and is settable by admin, but never checked by any authorization middleware |
| 8 | Account block enforcement | BROKEN | UI toggle exists, has zero backend effect (see blocker #6) |
| 9 | AI "top recommended routes" (admin) vs. passenger recommendations | PARTIALLY IMPLEMENTED / inconsistent | Two different, non-unified scoring engines for the same concept |
| 10 | Route-stop real data coverage | PARTIALLY IMPLEMENTED (carried over from prior audit pass, re-confirmed) | 83.5% of routes (914/1,095) have zero curated `route_stop` rows — honestly falls back to origin/destination-only rather than fabricating, but real coverage is still low |

---

## 10. TOP 10 MOCK/HARDCODED FEATURES

| # | Feature | Nature |
|---|---|---|
| 1 | VietQR payment confirmation | Explicitly documented in-code as a simulation — no real bank-signature verification |
| 2 | Manual `payBooking` for MOMO/ZALOPAY/BANK | No actual gateway call — direct DB status flip |
| 3 | MoMo/VNPay integration | Real signed-request code, but pointed at **sandbox** endpoints with hardcoded demo fallback credentials (`partnerCode:'MOMO'`, `tmnCode:'DEMOV210'`) if env vars are unset |
| 4 | `/api/recommendations/trending` (the endpoint actually used by the frontend) | Contains hardcoded score constants (`popularity:{score:80}`, `price_attract:{score:60,basis:'+0%'}`) instead of computing them from data |
| 5 | `classifySupportTicket` | Documented as "NLP Classification" in code comments; is pure Vietnamese keyword/substring matching against a static word list with canned response templates |
| 6 | City autocomplete on the search form | Uses a static local `/data/vietnam-location.json` file rather than the real, fully-implemented, DB-backed `/api/search/suggestions` endpoint that sits unused |
| 7 | `haversine()`-implied "geographic pruning" in transit search | Function exists and is exported but is never called anywhere — no geographic pruning actually occurs |
| 8 | Curated route corridors (`ROUTE_DB`/`HWY1`) | Legitimately labeled as "estimated" tier per the prior route-visualization fix — not hidden, but worth restating here as non-real-data content the UI does show under honest labeling |
| 9 | Admin "AI top recommended routes" panel | Real algorithm, but computed from a `ORDER BY RAND() LIMIT 30` sample of users rather than the full population — a sampling shortcut, not fabricated data, but worth flagging as non-deterministic/non-exhaustive |
| 10 | Socket.io seat lock | Presented to users as "this seat is reserved for you" — real-time UX, but purely in-memory/per-process and never actually consulted by the REST booking endpoint; the real guarantee is a separate, invisible DB transaction lock |

---

## 11. TEST CLEANUP CANDIDATES

Full file-by-file classification (60 files, all read individually — see agent transcript for the complete table). Summary:

- **Category A (permanent regression tests, KEEP — 20 files):** all `*.test.js` files. **209/209 passing**, 0 failures, `npx jest tests/` confirmed live this session.
- **Category B (reusable diagnostic tools, KEEP — 3 files):** `phase2i_step3_forensic.js` (generic DB integrity checker, no hardcoded ephemeral IDs), plus the two `.md` audit docs (durable root-cause references, valuable for the thesis writeup itself).
- **Category C (temporary live-verification scripts, LOW PRIORITY DELETE CANDIDATES — 11 files):** each already superseded by an equivalent, permanent, mocked Jest test — e.g. `phase2i_step3_payment_runtime.js` duplicates `phase2i-payment-amount-tampering.test.js`; `phase2i_step3_rbac_matrix.js`/`phase2i_step2_live_rbac.js`/`phase2i_step4_live_rbac.js`/`phase2i_final_live_verification.js` all duplicate coverage already in the mocked RBAC suite.
- **Category D (temporary setup/cleanup/snapshot files, DELETE CANDIDATES — ~30 files):** baseline JSON snapshots, ID trackers, and one-shot fixture-setup scripts tied to now-closed investigation sessions (e.g. `phase2i_final_baseline_after.json`, `phase2i_step3_testdata.json`, `phase2i_step4_created_ids.json`). No ongoing diagnostic value.
- **Category E (obsolete/duplicate):** **none found** — no file is a strict superset/subset of another despite topical overlap.
- **Category F (unsafe/destructive, HIGH-PRIORITY DELETE CANDIDATES — 4 files):** `phase2i_final_cleanup.js`, `phase2i_step2_cleanup.js`, `phase2i_step3_cleanup.js`, `phase2i_step4_cleanup.js` — each runs hardcoded-literal-PK `DELETE` statements. If those IDs have since been reassigned to real rows (plausible after any reseed), a careless re-run would silently delete real data. **Recommend deleting these four specifically, first, regardless of anything else.**

**Consolidation proposals** (no merge needed on the Jest side — all target `.test.js` files already exist and already pass):
- Retire the 4 payment/RBAC live-verification scripts once confidence in the mocked suite is established (they add no coverage the mocked suite lacks).
- `phase2i_step3_password_reset.js` covers one thing the mocked suite doesn't: the dev-mode token-logging side channel. Port one assertion into `phase2h-password-reset.test.js` (spy on the log call) before deleting it, if that channel is still considered load-bearing.
- The four near-identical baseline/snapshot generator scripts (`*_baseline.js`) should be merged into one parameterized DB-health-snapshot tool if kept at all going forward, rather than four separate near-duplicates.

**Nothing in category A or B is a deletion candidate. No deletions were performed in this phase.**

---

## 12. ARCHITECTURE DEBT

| # | Sev | Finding | Evidence | Impact |
|---|---|---|---|---|
| 1 | P2 | Money formatting reimplemented 3 different ways across passenger pages | `formatMoney`/`formatDate` exist in `public/js/api.js` but are called **zero** times in `index.html`/`booking.html`/`profile.html`; each defines its own local `fmt()` with different output (`toLocaleString` no suffix vs. `+" VNĐ"` vs. `Intl.NumberFormat` currency style) | Three visually different money formats across pages in one user session; any locale/currency change requires 4+ edits |
| 2 | P2 | `logout()` shadowed per-page, silently skipping the server-side session-invalidation call | `api.js`'s `logout()` calls `POST /auth/logout` before clearing storage; `index.html`/`profile.html`/`hotro.html`/`nha-xe.html` each redefine a local `logout()` = `localStorage.clear()` only, with no server call | Low severity today (JWT-stateless), but a real, silent divergence between the documented shared utility and what actually executes |
| 3 | P3 | A non-trivial PRNG helper (`mb32`, mulberry32) copy-pasted byte-for-byte into 4 files | `index.html`, `booking.html`, `profile.html`, `hotro.html` | Signal of copy-paste rather than shared-module evolution; low functional risk since the function is pure/deterministic |
| 4 | P2 | ~21,500 combined lines across 4 passenger HTML files with substantial undocumented logic duplication | 8-10 identically-named functions independently defined across pairwise file comparisons (`fmt`, `mb32`, `logout`, `resize`, tour-guide functions, etc.) | Any bugfix in shared logic must be manually propagated to every file — already hasn't been, in at least 3 places (findings #1, #2, #3) |
| 5 | P2 | Transaction usage across controllers is reactive, not systematic | Only `bookingController.js` (3 uses) and `adminController.js` (1 use) wrap multi-step writes in a transaction; every other multi-step-write controller uses plain sequential queries | No established house rule for "when to use a transaction" — future controllers are one copy-paste away from introducing an unprotected race, which is very plausibly how the 5 live double-booked seats (blocker #7) came to exist |
| 6 | P2 | Two independent, duplicate AI recommendation-scoring engines | See bug #12 in §5 | Maintenance burden; a reviewer reading only one implementation draws an incomplete picture of "what the AI does" |
| 7 | P1 | Frontend monolith (see blocker #13) | `index.html` 7,763 lines / 394KB single inline script | Baseline performance ceiling; out of scope to restructure within a thesis timeline, documented as a known limitation |

---

## 13. THESIS/DOCUMENTATION MISMATCH

- **"NLP Classification" claim vs. reality**: `server/ai/recommendation.js`'s header comment explicitly claims `"Algorithms: ... NLP Classification"`. The actual implementation (`classifySupportTicket`) is Vietnamese keyword/substring matching against a static word list with canned response templates — no tokenization, stemming, embeddings, or trained model of any kind. **If the thesis document makes an equivalent claim, it should be corrected to "rule-based keyword classifier" before defense.**
- **Implied geographic-pruning capability in `transitRouter.js` vs. reality**: `haversine()` is defined, documented via its presence, and exported, but is never called by the BFS/Dijkstra search — city matching is pure string comparison. A reviewer who reads the module and assumes lat/lng-based routing pruning exists would be incorrect.
- **`docs/` directory exists and describes prior "Phase 2I"/"Phase 2D" audit passes** (feature matrix, requirement traceability, technical debt docs) — these were treated as claims to verify in this pass, not as ground truth, and this audit's findings were independently re-derived from live code + live DB rather than assumed from those docs. Where this audit's findings differ from what `docs/` may claim (e.g., any claim that account-blocking, booking-list access control, or double-booking protection is "fixed"/"verified" from an earlier pass), **this document's live-evidence findings supersede the older docs** — those older docs should be reconciled or marked superseded before being cited in the thesis defense.
- **"Smart"/"AI" branding vs. actual technique**: the passenger- and admin-facing recommendation, pricing, and demand-forecasting features are genuinely real, non-trivial, DB-driven, and (for the passenger-facing one) meaningfully explainable — but they are heuristic/statistical (collaborative filtering by co-occurrence count, OLS linear regression, time-decay weighted averages, threshold-based anomaly detection), not trained machine learning. If thesis documentation or defense framing implies a trained ML model, it should be corrected to describe the actual, still-legitimate technique used.

---

## Closing note

This document is a snapshot from a single read-only investigation pass (2026-08-16). No source, database, or configuration was modified to produce it. Several findings above (blockers #1, #2, #3, #7, #10 especially) describe **currently active, live data corruption or security exposure in the running database** — not hypothetical risks — and should be treated as the highest-priority items for any subsequent fix phase. This matrix is intended as the source-of-truth baseline for all such future phases.
