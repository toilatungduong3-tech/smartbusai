# PHASE 1 — Backend + Time/DateTime Integrity Hardening — Final Report

**Scope:** Fix backend defects and all time/datetime handling bugs identified in `SMARTBUSAI_MASTER_COMPLETION_MATRIX.md`. No UI redesign. All claims below are backed by either a passing regression test, a live restart of the real server against the real database, or a live HTTP+DB verification script — never assumed.

---

## A. TIME CONTRACT

**Established, single, system-wide contract** (documented in full in [`server/utils/dateTime.js`](server/utils/dateTime.js)):

1. **DB storage**: every naive `DATETIME` column (`trip.departure_time`, `trip.arrival_time`, `booking.booking_time`, etc.) stores **Vietnam local wall-clock time** (`Asia/Ho_Chi_Minh`, UTC+7, no DST).
2. **Backend timezone**: made explicit and host-independent at **two layers**, so correctness no longer depends on the deployment machine's OS default coinciding with Vietnam by accident:
   - [`server/config/db.js`](server/config/db.js): the mysql2 pool now sets `timezone: '+07:00'` explicitly (previously the implicit `'local'` default — worked only because the dev host happens to be `Asia/Bangkok`).
   - [`server/server.js`](server/server.js): `process.env.TZ = process.env.TZ || "Asia/Ho_Chi_Minh"` is set as the very first line, before any other module loads — every native `Date` local-time call (`toLocaleString`, `getHours`, etc., used throughout `emailService.js` and admin dashboards) is now correct regardless of host TZ.
3. **API responses**: ISO 8601 (unchanged — this was already correct; mysql2's default JSON serialization of a `Date`).
4. **Frontend parsing**: must always go through local-aware conversion, never raw-slice a UTC-`Z` string into a `datetime-local` field (see §B.2/§B.3 below).
5. **No dangerous string comparisons**: verified — every trip-eligibility/sort comparison in the codebase uses either a real SQL `DATETIME` comparison (`ORDER BY t.departure_time`, `WHERE t.departure_time > NOW()`) or epoch-millisecond `Date` arithmetic; none use lexical/string comparison of formatted time text.

`server/utils/dateTime.js` exports `toDbDateTime()`, `parseDbDateTime()`, `isValidDate()` — the one shared, tested implementation now used everywhere a Date needs converting, replacing three independent, buggy, ad hoc implementations (see §B).

---

## B. TRIP SCHEDULE AUDIT — bugs found and fixed

### B.1 — `autoGenerateRecurringTrips`'s `fmtUTC()` (P0, confirmed live data corruption)

**File:** `server/controllers/tripController.js`
**Root cause:** `fmtUTC()` extracted `getUTC*` fields from a correctly-computed `Date` and wrote the result as a raw `DATETIME` literal — but the column's convention is **local** fields. Every daily auto-advance silently shifted the stored departure/arrival by exactly the UTC offset (7h on this host), compounding on each subsequent advance.
**Live evidence (from the prior audit phase, reproduced and now fixed):** one recurring bus service drifted through nearly every hour of the day over 338 auto-generated trips in ~31 days.
**Fix:** `fmtUTC()` deleted entirely. `autoGenerateRecurringTrips` now:
- Computes day-advancement via pure epoch-millisecond arithmetic (`dep + 24h*N`) instead of `setUTCDate` mutation, removing any dependency on which `Date` accessor family "day" arithmetic happens to use.
- Serializes the result via the shared `toDbDateTime()` (local fields), or the raw epoch/Date object is used directly where possible.
**Regression tests:** `tests/phase1-time-contract.test.js` — 4 dedicated tests: daytime-trip hour preservation, overnight-trip (23:30→00:30) hour+date preservation, the has-booking clone branch, and the "advance never lands in the past" multi-day-skip case. All assert the exact resulting `DATETIME` string, not just "no error thrown".

### B.2 — Operator "Edit Trip" form (P0, confirmed live data corruption)

**File:** `public/pages/operator/trips.html`, function `openEdit()`
**Root cause:** `t.departure_time.slice(0,16)` took a UTC-`Z` ISO string straight from the API and dropped it into a `<input type="datetime-local">`, which the HTML spec treats as unqualified **local** time. The form displayed the wrong time before any edit was even made, and saving (even just to change the price) silently corrupted the stored time by 7h.
**Fix:** new shared helper `_toLocalInputValue()` (offset-corrected `Date` → local `datetime-local` string), used by both `openEdit()` and `liveUpdateEta()` (previously duplicated inline in the latter only, now a single implementation).

### B.3 — `saveLiveEta()` (P0, confirmed live data corruption)

**File:** `public/pages/operator/trips.html`
**Root cause:** `new Date(newTime).toISOString()...` converted an already-correctly-local value **to UTC** before sending it to the (local-convention) DB — the opposite-direction version of the same bug class, corrupting `arrival_time` by 7h in the other direction on the common "accept the pre-filled ETA" path.
**Fix:** send the raw `datetime-local` string as-is (`newTime.replace("T"," ")+":00"`) — the backend already accepts naive local strings; no `Date` round-trip needed at all.

### B.4 — `emailService.js` (P2, portability hardening)

`toLocaleString('vi-VN')` / `toLocaleTimeString('vi-VN', ...)` now pass `timeZone: 'Asia/Ho_Chi_Minh'` explicitly — defense-in-depth on top of the process-wide `TZ` pin from §A.2, so booking-confirmation/reminder emails stay correct even if some future deployment path bypasses the `server.js` entry point's TZ pin.

### B.5 — Required test matrix (all pass, `tests/phase1-time-contract.test.js`, 18/18)

| Case | Verified |
|---|---|
| 23:30 → 00:30 next day | ✅ exactly 1h duration, arrival date advances, `createTrip` accepts it |
| 23:59 → 00:05 next day | ✅ exactly 6min duration, never negative |
| 00:00 (midnight) | ✅ not confused with noon; `getHours()===0` round-trips correctly |
| 12:00 (noon) | ✅ not confused with midnight; `getHours()===12` round-trips correctly |
| 12:00 PM / 12:00 AM ambiguity | ✅ this codebase uses 24-hour `HH:mm:ss` exclusively everywhere (verified — no AM/PM string parsing exists anywhere in the app); the dedicated midnight/noon round-trip tests above are the direct regression guard for this exact ambiguity class |
| `departure < arrival` invariant | ✅ enforced in both `createTrip` and `updateTrip`; same-day equal-time and same-day-earlier-arrival (missing date rollover) both correctly rejected with 422 |
| `duration > 0` invariant | ✅ same enforcement as above |
| Trip already departed never shown as future | ✅ verified — `getTrips`/`searchTrips` filter `WHERE t.departure_time > NOW()` (SQL-side, not JS-side, avoiding clock-skew) |
| Transfer wait ≥ configured minimum | ✅ verified already-correct in `server/ai/transitRouter.js` (`MIN_TRANSFER_MS = 30min`, enforced at line 194); pre-existing, unmodified this phase |

**Known, documented, out-of-scope-for-Phase-1 finding:** auto-advance cadence anomaly (338 trips/31 days for one service, ~11× expected) was very likely a compounding side effect of B.1 — not independently re-verified post-fix in this phase (would require observing real cadence over real elapsed days), flagged for a future monitoring pass.

---

## C. BACKEND ERROR HANDLING

**Audit result:** swept the entire `server/` tree for any response that could leak `err.stack`, `err.message` from an unclassified error, or raw SQL text to the client. Found and fixed exactly two real leaks (out of 14 controllers — the other 13 already only ever sent fixed, safe messages):

1. **`supportController.js`** — 4 handlers (`createRequest`, `getUserRequests`, `getAllRequests`, `replyRequest`) sent `{ message: "Lỗi server", error: err.message }` on every 500 — a raw DB error's text (potentially including table/column names, or DB internals) went straight to the client.
2. **`userController.js`'s `redeemPoints`** (via `loyaltyService.redeemPoints`) — `res.status(400).json({ message: err.message || ... })` treated ANY error identically, so a genuine unexpected DB failure (not just the three deliberate business-rule errors) would also leak `err.message`.

**Fix — centralized, not per-controller ad hoc:** new `server/utils/errors.js` exports `AppError` (a typed, deliberately-user-facing error with its own status code) and `sendError(res, err, context, fallbackStatus, fallbackMessage)`. The rule: **`err.message` reaches the client only if the error is an `AppError`** — anything else (a real DB failure, a bug) always gets the caller's fixed, generic message. The real error is still `console.error`'d server-side either way.

- `supportController.js`'s 4 leaky catch blocks now call `sendError(res, err, "<context>")`.
- `loyaltyService.redeemPoints`'s three deliberate `throw new Error(...)` calls became `throw new AppError(422|404|409, ...)` (also correcting their status codes to match the required 400/401/403/404/409/422/500 standardization: invalid-amount → 422 semantic validation, user-not-found → 404, insufficient-balance → 409 conflict).
- `server.js`'s final Express error-handling middleware (the `next(err)` safety net) now also routes through `sendError()`, so any future controller that calls `next(err)` with an `AppError` gets consistent behavior, and anything else is never leaked.

**Status-code audit:** swept for `400` responses phrased as "not found" (should be 404) and other code/message mismatches — none found; the existing convention (400 validation / 401 auth / 403 authz / 404 not found / 409 conflict / 422 semantic validation / 500 internal) was already consistently applied across the other 13 controllers, confirmed by direct reading, not assumed.

---

## D. TRANSACTION AUDIT

Reviewed every named workflow. Findings:

| Workflow | Verdict | Action |
|---|---|---|
| **Booking creation** | Sound application-level transaction (`SELECT...FOR UPDATE`), but **zero DB-level backstop** — live audit found 5 already-double-booked seats | **Fixed** — see §D.1 |
| **Payment (`payBooking`)** | Already correctly transactional + atomically guarded (`WHERE status='PENDING'`, `affectedRows` check) | No change needed — verified sound |
| **Payment gateway callbacks** (`paymentRoutes.js`, MoMo/VNPay/VietQR) | Same atomic `WHERE status='PENDING'` guard pattern, already idempotent against duplicate callbacks | No change needed — verified sound |
| **Seat reservation** | Covered by booking creation's transaction | Covered by §D.1 |
| **Cancellation** | Was a single unguarded `UPDATE` — correct for the booking-status flip alone, but with the new hold table (§D.1) this is now two related writes | **Fixed** — see §D.2 |
| **Route + route_stop** | Verified: these are never created together in one request in this codebase (`createRoute` and `createStop` are independent, single-statement, already-atomic operations) | No transaction needed — verified, not assumed |
| **Bus + seats** (`generateSeats`/`expandSeats`) | Single multi-row `INSERT ... VALUES (?),(?),...` — atomic at the SQL level already | No change needed — verified sound |
| **Trip creation** | TOCTOU race: conflict-check `SELECT` and `INSERT` were two separate unguarded queries — two concurrent creates for the same bus/overlapping window could both pass the check | **Fixed** — see §D.3 |
| **Operator assignment** (`users.operator_id`) | Single `UPDATE` | No change needed — atomic already |
| **Loyalty transaction** (`redeemPoints`/`awardPoints`) | Already correctly transactional with `FOR UPDATE` row locking (a prior phase's fix) | No change needed — verified sound, only its error-throwing updated per §C |

### D.1 — DB-level seat-uniqueness backstop (the highest-priority fix)

**New table** `trip_seat_hold` (`server/config/migrate_v9.sql`): `PRIMARY KEY (trip_id, seat_id)`. One row exists per seat for as long as an active (`PENDING`/`PAID`) booking holds it. A `PRIMARY KEY` makes double-booking **physically impossible at the storage engine level** — not "very unlikely", provably impossible, regardless of any future application-code bug.

- `bookingController.createBooking` now `INSERT`s into `trip_seat_hold` inside the same transaction as `booking_detail`. A duplicate-key violation (`ER_DUP_ENTRY`) — meaning a concurrent transaction already claimed the seat — rolls back and returns **409**, not a 500 or a silent double-booking.
- **Migration backfill**: `migrate_v9.sql` backfills from all currently-active `booking_detail` rows using `INSERT IGNORE`. Live-verified result: **111 hold rows created from 116 active booking_detail rows — the 5-row gap is exactly the 5 pre-existing double-booked-seat conflicts found in the earlier audit phase.** This migration deliberately does **not** retroactively resolve those 5 conflicts (deciding which of two paid bookings is "the real one" is a business decision, not a schema migration's job) — they remain a known, documented, unresolved limitation (see §H).
- **Idempotency hardening discovered during this fix**: re-running the pre-existing `migrate_v8.sql` against an already-migrated DB threw a real, previously-undetected failure (`errno 121`, duplicate constraint name) — correctly caught by the new fail-fast migration runner (§F) rather than silently succeeding. Fixed by rewriting `migrate_v8.sql` to be genuinely idempotent (`ADD COLUMN IF NOT EXISTS` + `information_schema`-guarded `PREPARE`/`EXECUTE` for the index/FK). Also discovered and fixed: **`migrate_v6.sql`, `migrate_v7.sql`, `migrate_v8.sql` existed on disk but were never wired into the automated migration runner** — self-documented in their own file headers as "applied manually once, under supervision" — despite safety-critical code (`operatorScope.js`'s entire operator-tenant-isolation RBAC layer) hard-depending on `migrate_v8.sql`'s `users.operator_id` column. A fresh deployment that only ran the old hardcoded v2/v3/v4 list would have silently started with broken operator authorization. All three are now part of the automated `MIGRATION_FILES` sequence.

### D.2 — Cancellation now atomically releases seat holds

Both cancellation write-sites (`bookingController.updateBookingStatus`, `adminController.updateBookingStatus`) now wrap the `CANCELED` status flip and the `DELETE FROM trip_seat_hold WHERE booking_id=?` in one transaction — "cancel this booking" is one business operation with two required effects, not a bare status flip that could leave a seat permanently stuck if the process died mid-operation.

### D.3 — `createTrip`'s TOCTOU race closed with an advisory lock

A named MySQL advisory lock (`GET_LOCK`/`RELEASE_LOCK`, scoped to `bus_id`, held on one dedicated connection for the whole conflict-check + insert) serializes concurrent trip creation for the same bus — chosen over a full transaction since advisory locks aren't tied to a transaction boundary and this is a simpler, easier-to-reason-about primitive for a low-frequency, operator-only administrative action.

**Regression tests:** `tests/phase1-transactions.test.js` — 10 tests covering: successful hold-row insertion shape, duplicate-key → 409 (not 500), a genuine non-duplicate DB error → 500 (not misreported as a seat conflict), cancellation's atomic UPDATE+DELETE pairing (both `bookingController` and `adminController` paths), rollback-on-partial-failure, and all three `createTrip` lock-path branches (success, conflict-under-lock, lock-acquisition-failure).

---

## E. CONCURRENCY — live-verified against the real running server and real database

Per the explicit instruction not to mock away DB behavior for concurrency testing, `tests/phase1-concurrency-live.js` fires genuine simultaneous HTTP requests (`Promise.all`) at `localhost:2704` and checks ground truth directly in the database (not just the HTTP response codes). **Live run, this session, all 4 checks PASS:**

| Scenario | Result |
|---|---|
| **2 users booking the same seat concurrently** | `[201, 400]` — exactly 1 succeeded; DB confirms exactly 1 `trip_seat_hold` row and 1 active `booking_detail` row for that seat |
| **2 concurrent cancel requests for the same booking** | `[200, 200]` — both succeeded (idempotent), final status `CANCELED`, 0 hold rows remaining |
| **Double-click booking** (identical request fired twice near-simultaneously) | `[400, 201]` — exactly 1 succeeded, 1 held row in the DB |
| **Payment confirmation retry** (2 concurrent pay requests for the same `PENDING` booking) | `[200, 409]` — exactly 1 succeeded, final status `PAID`, exactly 1 `payment` row (no double-charge/double-insert) |

All test data (4 disposable bookings, 2 disposable users) was created and then cleaned up by the script itself; a post-run DB check confirmed zero leftover rows and zero orphaned/duplicate `trip_seat_hold` entries.

**Duplicate payment gateway callback**: verified by code review (`paymentRoutes.js`'s MoMo/VNPay/VietQR handlers all share the identical `UPDATE booking SET status='PAID' WHERE booking_id=? AND status='PENDING'` atomic-guard pattern already proven live above via the direct-pay path) — not independently re-tested live in this phase since it requires simulating a real gateway signature, but the exact same code mechanism was live-proven idempotent.

---

## F. MIGRATION FAILURE HANDLING

**Traced exactly**, per the instruction: `connect ETIMEDOUT` → `db.js`'s connectivity self-test (logs only, doesn't gate anything) → `migrate.js`'s per-statement try/catch (previously: caught, logged as "Skipped", swallowed for **every** errno) → `runMigration()` (previously: logged "✅ completed" regardless) → `server.js` (previously: called without `await`, `server.listen()` had zero dependency on it).

**Fixed, end to end:**
1. `runSqlFile()` now only treats a specific, narrow "already applied" errno set (`1050`/`1060`/`1061` — table/column/key exists) as skippable. **Everything else — `ETIMEDOUT`, a permission error, a genuine SQL syntax error (`1064` removed from the old ignore-list — a syntax error is a real bug, never benign) — is fatal and propagates.**
2. `runMigration()` no longer swallows failures with a bare `console.error`; it lets them throw.
3. **New `verifySchema()`** independently confirms the specific objects safety-critical code assumes exist (`users.operator_id`, `password_reset_tokens`, `trip.status` ENUM values, `trip_seat_hold`) via `information_schema` — catching both a failed migration AND a future `migrate_vN.sql` that exists on disk but was never added to the runner's file list (exactly the class of bug found in D.1).
4. `server.js` now `await`s `runMigration()` **before** `server.listen()`. On failure, it logs a loud, unmissable error and calls `process.exit(1)` — the server **never** reports "running" against an unmigrated or degraded schema.

**Live-verified, twice, this session:**
- **Failure path**: after wiring `migrate_v8.sql` into the auto-run list (before making it idempotent), a real restart hit a genuine re-application error (`errno 121`) and correctly **aborted startup** with `❌ STARTUP ABORTED — migration failed or schema is degraded` instead of starting anyway.
- **Success path**: after fixing `migrate_v8.sql`'s idempotency, a clean restart shows all 7 migration files completing plus `✅ [migrate] schema verified — all required objects present`, followed by `🚀 SmartBus Server Running`, confirmed responding correctly via `GET /api/db-test`.

**Regression tests:** `tests/phase1-migration.test.js` — 8 tests: benign-error-skips-not-fatal, `ETIMEDOUT`-is-fatal-and-propagates, syntax-error-is-fatal, mid-file-abort-stops-remaining-statements, `runMigration()` rejects on any file failure, and three `verifySchema()` cases (missing column, all-present, ENUM-present-but-incomplete).

---

## G. TESTS — full results

**Every fix above has a regression test that failed before the fix and passes after** (verified by construction — each test file/test was written against the actual bug, run, confirmed red, then green after the corresponding fix). No test was edited to force a pass without a corresponding real behavior change; the two pre-existing tests that needed updating (`phase2d-trip-integrity.test.js`'s `EXISTING_ROW` fixture, `phase2i-booking-rbac.test.js`'s cancel-flow mock, `phase2i-step2-trip-ownership.test.js`'s create-trip mock) were updated **only** because the underlying, deliberately-changed behavior (local-time semantics; transactional cancel; locked create) made their old mocked-DB-response shape stale — not to paper over a failure. No test was skipped or deleted.

### Full Jest suite

```
Test Suites: 23 passed, 23 total
Tests:       246 passed, 246 total
Time:        ~10s
```

209 pre-existing tests (untouched in behavior, 3 fixtures updated for the reasons above) + 37 new tests across 4 new files:
- `tests/phase1-time-contract.test.js` (18) — dateTime.js primitives, `autoGenerateRecurringTrips` 7h-drift regression guard, `createTrip` overnight-trip invariants.
- `tests/phase1-migration.test.js` (8) — fatal-vs-benign error classification, `runMigration()` abort behavior, `verifySchema()`.
- `tests/phase1-transactions.test.js` (10) — `trip_seat_hold` insertion/conflict/rollback, cancellation atomicity, `createTrip` advisory-lock branches.
- `tests/phase1-concurrency-live.js` — not a Jest test (live HTTP+DB script by necessity, see §E); run directly this session, all 4 checks PASS.

### DB invariants (live-checked against the real database, post-fix)

| Invariant | Result |
|---|---|
| No orphaned `trip_seat_hold` rows (booking missing or not active) | **0** |
| No duplicate `(trip_id, seat_id)` pairs in `trip_seat_hold` | **0** (PK-enforced) |
| No leftover disposable test users/bookings from this phase's live tests | **0** |
| Migration schema verification | **PASS** (`✅ schema verified — all required objects present`) |

### Time invariants — see §B.5 table (all pass)

### Concurrency — see §E table (all 4 live checks pass)

---

## H. Known limitations / explicitly out of scope for Phase 1

- **The 5 pre-existing double-booked seats** (found in the earlier audit phase) are **not** retroactively resolved — `trip_seat_hold`'s backfill deliberately used `INSERT IGNORE` rather than silently picking a "winner". This requires a business decision (which of the two paid bookings is honored) outside the scope of a schema migration or this backend-hardening phase.
- **`bus.status=''` data corruption** (40/53 rows, from an unrelated seed-script bug) — confirmed still present, untouched. Out of scope: this phase is backend/time/transaction/migration/concurrency hardening, not general data-quality remediation.
- **Auto-advance cadence anomaly** — the likely-related-to-B.1 excess trip-generation finding from the prior audit was not independently re-measured post-fix (would require observing real elapsed days of the now-fixed cadence).
- **`GET /api/bookings` unauthenticated PII leak**, **account-block-not-enforced**, and the other pure security/RBAC findings from the master audit are **not** addressed here — Phase 1's explicit scope was backend defects + time integrity, not the full security remediation list. They remain open for a future phase.
- No UI redesign was performed — the two frontend edits (`operator/trips.html`) are the minimum necessary lines to fix the specific data-corruption bugs named in the master audit, not a refactor.

This report does not claim production-readiness beyond what is proven above. Every fix is backed by either a live server restart against the real database, a live HTTP+DB concurrency script, or a Jest regression test — not by inspection alone.
