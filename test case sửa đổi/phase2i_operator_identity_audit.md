# Phase 2I — Operator Identity Architecture Audit (Phase 1: read-only investigation)

Status: investigation only. No source code modified in this pass.

## 1. Complete identity lifecycle, traced from actual source

```
REGISTER  (authController.exports.register)
  INSERT INTO users (username, full_name, email, password_hash, phone, gender,
                      birth_date, province, district, address_detail)
  → role defaults to 'PASSENGER' (schema DEFAULT, register() never sets it).
  → No operator_id, no bus_operator row created or referenced anywhere in
    the register flow. An OPERATOR-role account cannot be self-registered
    through the public API at all — role must be set some other way
    (ADMIN via userController.updateUser's admin-gated role field, or a
    direct DB write, e.g. the original seed data).

LOGIN  (authController.exports.login, lines 204-306)
  SELECT * FROM users WHERE email = ?
  ... password check ...
  generateTokens(user) → jwt.sign({ user_id, role, email }, JWT_SECRET, ...)
    — JWT payload is EXACTLY {user_id, role, email}. No operator_id, no
      bus_operator reference of any kind is ever embedded in the token.
  if (user.role === 'OPERATOR') {
      SELECT operator_id, name FROM bus_operator WHERE email = ? LIMIT 1
      [user.email]   -- the LOGGED-IN USER's own email, not a stored link
  }
  → operator_id/operator_name are attached ONLY to the login RESPONSE BODY
    (for frontend display — e.g. showing the company name in a header),
    never to the JWT itself.

JWT VERIFICATION  (authMiddleware.authenticate)
  jwt.verify(token, JWT_SECRET) → req.user = { user_id, role, email }
  → operator_id is NOT part of req.user. Every request must re-derive it.

OPERATOR IDENTITY RESOLUTION AT REQUEST TIME  (server/middleware/operatorScope.js,
  added in the immediately preceding hardening pass)
  attachOperatorId(req):
    if req.user.role === 'ADMIN'    → req.operatorId = null   (bypass, global)
    if req.user.role !== 'OPERATOR' → req.operatorId = undefined
    else:
      SELECT operator_id FROM bus_operator WHERE email = ? LIMIT 1
      [req.user.email]   -- same exact-match lookup as login(), just
                             re-run per-request instead of trusting a
                             JWT claim (correct, since the JWT never
                             carries it) — req.operatorId = match or
                             undefined.

ROUTES using this:
  operatorRoutes.js  → dashboard/* : authenticate, requireAdminOrOperator, attachOperatorId
  busRoutes.js       → writes      : same
  seatRoutes.js      → writes      : same

CONTROLLERS:
  operatorController.js — every dashboard function branches on req.operatorId
    (null=global/ADMIN, a number=scoped/OPERATOR, undefined=unlinked→empty).
  busController.js / seatController.js — ownsOperator(req, targetOperatorId)
    compares req.operatorId against the resource's real bus.operator_id.

FRONTEND (operator/*.html, admin/operators.html)
  Reads user.operator_id / user.operator_name from the LOGIN RESPONSE (not
  the JWT) purely for display (e.g. operator/trips.html builds
  ?operator_id=<value> query strings from localStorage's cached login
  response — itself informational only; the server never trusts it, see
  below). No frontend page currently has any UI for an operator to manage
  which bus_operator they're linked to, or for an admin to link a user to
  an operator.
```

## 2. Answers to the specific questions posed

1. **Where is operator identity currently derived?** At request time, server-side, in `operatorScope.js`, by looking up `bus_operator` on the caller's own JWT-derived `email`.
2. **Basis:** `bus_operator.email` matched against `req.user.email` (itself decoded from the JWT, itself originally sourced from `users.email` at login time). Not `user_id`, not a JWT `operator_id` claim, not any other lookup.
3. **Does the JWT contain operator_id?** No — confirmed by reading `generateTokens()`: payload is exactly `{user_id, role, email}`.
4. **If not, where is it derived?** Freshly, per-request, via the email-match query in `operatorScope.js` (and separately, redundantly, in `login()` for the response body only).
5. **Does the app have a canonical user ↔ bus_operator relationship?** **No.** No FK, no join table, no unique mapping of any kind exists in the schema.
6. **Any FK representing it?** No. `users` has no `operator_id` column (reconfirmed via `information_schema.COLUMNS` in Step 0). `bus_operator` has no `user_id` column (reconfirmed via `DESCRIBE bus_operator`: `operator_id, name, address, phone, email, license_number, established_year, created_at, status` — nothing else).
7. **Any UNIQUE constraint?** `bus_operator.email` and `users.email` are each independently plausible unique-ish in practice (checked in Step 0: zero duplicate emails in either table currently), but there is no UNIQUE constraint enforcing email uniqueness in the schema for either table, and no constraint at all tying the two together.
8. **Any migration intended to establish the relationship?** No. `migrate_v2/v3/v4/v6/v7.sql` were all read — none touch `users` or `bus_operator` identity columns. `migrate_v6.sql` is unrelated (trip.status ENUM widening).
9. **Does `bus_operator` contain `user_id`?** No.
10. **Are operator accounts (`users` role=OPERATOR) and `bus_operator` records the same entity or separate?** Separate tables, and — critically — **evidence of an abandoned attempt to link them**, found in `server/config/seed_full.js` lines 369-384: the seeder `SELECT`s existing `role='OPERATOR'` users, computes `const userId = users[userIdx % users.length]?.user_id || null;` while creating each `bus_operator` row, increments `userIdx` — **and then never uses `userId` in the `INSERT INTO bus_operator (name, email, phone, status)` statement that follows.** This is dead/vestigial code. It is direct evidence that the original design intent was for each `bus_operator` row to reference a specific `users` row, and that this linkage was never finished being wired up — the email-match scheme now in use appears to be a later workaround bolted on to approximate the same effect without the real FK.
11. **Can one user own exactly one operator profile?** Under the current (and the seed script's evidently intended) model: yes, at most one — nothing in the codebase, schema, or frontend suggests or supports a user having multiple operator affiliations.
12. **Can one operator profile have multiple users?** No evidence either way in the current code — no UI, no query, no business logic anywhere handles or expects multiple staff accounts per company. The actual current data is also consistent with 0-or-1 users per operator (3 `OPERATOR`-role users total, mapped at most one-to-one against 8 `bus_operator` rows — see Phase 2 data below).
13. **Is an operator login account meant to represent:** Based on the seed script's dead linking code, the naming (`operator_id`, `operator_name` surfaced to the frontend as if there's exactly one canonical company per operator login), and the complete absence of any team/multi-user concept anywhere in the app: **(A) one bus company, via (C) one specific `bus_operator` record**, accessed by (in the current, real data) exactly one login account per company. Not (B) "one of several employees" — no such concept exists in the code.

## 3. Root cause of users 46/47/48 failing to resolve

- Confirmed via direct SQL (Step 0 and re-verified here): exactly **3** `role='OPERATOR'` users exist in the entire database — 46, 47, 48 — versus **8** `bus_operator` rows.
- None of the 3 users' `email` exactly matches any `bus_operator.email`:
  - `tuan.op@phuongtrang.com.vn` (user 46) vs. `contact@phuongtrang.com.vn` (`bus_operator` #1, "Phương Trang") — **same domain**, different local-part. Strong circumstantial match by company name/domain, but the exact-match lookup fails it.
  - `phuc.op@hoanglongasia.com` (user 48) vs. `contact@hoanglongasia.com` (`bus_operator` #3, "Hoàng Long") — same pattern, same-domain near-match, fails exact match.
  - `operator@gmail.com` (user 47) — no `bus_operator` row shares this domain or any recognizable name correspondence. Genuinely ambiguous from available evidence.
- None of these 3 accounts, nor any `bus_operator` row with the domains above, appear anywhere in `seed_full.js`, `seed_routes_v2.js`, or any `.sql` file in the repository (confirmed by repo-wide search for the literal email strings — zero matches). They were **not created by any tracked, reproducible script** — they exist only as live rows in the current database, most plausibly inserted by hand at some point during the project's development (created_at = `2024-01-01 08:00:00` for all three, a placeholder-looking timestamp rather than a real registration moment, consistent with a manual bulk insert rather than organic use).
- **Classification: combination of a seed-data defect and an application-architecture defect.** The architecture defect is primary and predates these three rows: the codebase's own seeder shows the *intended* mechanism (a real FK-style link) was never completed, so *no* email-based scheme — however careful — could have reliably linked operator accounts to companies; the current 3 accounts are simply the concrete case where that gap is visible today. The seed-data defect is that whoever created these 3 rows used plausible-but-not-exact "staff" style emails (`tuan.op@…`, `phuc.op@…`) instead of copying the `bus_operator.email` value exactly, which is exactly the failure mode a real FK would have made structurally impossible.

## 4. Recommended canonical relationship (analysis only — not implemented in this pass)

Given the evidence above — an abandoned `bus_operator`-references-`users` attempt in the seeder, an observed cardinality of "0 or 1 users per operator company" in the real data, and no code or UI anywhere contemplating multiple staff accounts per company — the best-supported model is:

**`users.operator_id` → `bus_operator.operator_id`, nullable, `ON DELETE SET NULL`, no UNIQUE constraint required (a `bus_operator` having zero linked users, or — should the business ever need it — more than one, both remain representable without a schema change).**

This is preferred over `bus_operator.user_id` (which would hard-code a strict 1:1 and require a schema change again the day a company needs a second staff login) and over a dedicated `operator_users` mapping table (unjustified complexity for a relationship the entire rest of the codebase treats as strictly single-valued today). This matches "Option B" from the instructions and is offered here as a recommendation only, per the explicit Phase 1 scope — no migration has been written or applied.

## 5. What is explicitly NOT concluded here

- Which existing `bus_operator` row (if any) user 47 (`operator@gmail.com`) should map to — no evidence supports a unique inference; Phase 4 will need to classify this one as unresolved and fail-closed rather than guess.
- Whether users 46/48's domain-based near-matches to operators #1/#3 constitute *sufficient* evidence to establish an authoritative mapping automatically, or whether that decision needs explicit sign-off before writing it to the database — reserved for Phase 4.
- No migration, no data mutation, no code change has been made in this pass.
