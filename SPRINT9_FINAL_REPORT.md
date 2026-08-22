# SPRINT 9 FINAL REPORT — Topbar Layout Hardening, Social OAuth UI Complete & Legal Policy Pages

**Scope:** re-verify and harden the Sprint 8 topbar/logout dropdown across all 18 pages (found and fixed one real regression along the way), complete the Google/Facebook OAuth frontend flow (role-based redirect, a real loading spinner), and build the two missing legal pages with real footer/auth-page integration. 43 new tests, 546/546 total passing. Every claim below is either a live measurement/request against the real running server this session, or a passing automated test.

---

## 1. Topbar "Đăng xuất" Overflow — Full Re-Verification + a Real Fix

Sprint 8's own final report flagged an honest gap: only 3 of 18 pages (one per role) had been live pixel-measured; the other 15 were assumed safe because they share the identical component. This sprint closed that gap properly — **all 18 pages were live-measured this session** (`getBoundingClientRect()` against the real running server, trigger + open dropdown menu + logout button, at 1280px with an intentionally long test user name to stress the layout).

**A real regression was found and fixed in the process.** `passenger/profile.html`'s topbar was completely non-functional — not overflowing, but entirely absent (an empty `<div class="sb-profile">` with no dropdown inside). Root cause: Sprint 8's edit called `initProfileDropdown("sbProfile")` from a `<head>`-level auth-guard script, which runs *before* `<body>` — and therefore before `#sbProfile` — exists in the DOM. `initProfileDropdown`'s own defensive `if (!container) return;` swallowed the failure silently, with no console warning, so this had shipped undetected. Verified this was unique to `profile.html` by comparing the source-line position of every page's init call against its own `<body>` and `#sbProfile` line numbers — all other 17 pages call it correctly, after both. Fixed by moving the call into `profile.html`'s existing `DOMContentLoaded` handler (the auth-guard redirect logic itself correctly stays in `<head>`, unchanged). Live re-verified: the dropdown now renders and behaves identically to every other page.

**Investigated the brief's specific claims against the actual codebase, rather than applying its suggested CSS as-is.** The brief named `.hdr-actions`, `.topbar`, `.header-right`, and separate `dashboard.css`/`admin.css` files as likely culprits. A direct search found: `.topbar` and `.header-right` don't exist anywhere in this codebase (the real container is `.hdr-actions`, already fixed in Sprint 8); `dashboard.css`/`admin.css` don't exist either — there is only `/public/css/style.css` plus each page's own inline `<style>` block. Applying the suggested selectors verbatim would have been dead CSS. Instead, hardened what actually exists:
- `.sb-profile-menu` now explicitly sets `left:auto` alongside `right:0` (defense-in-depth — guards against any future page-level CSS accidentally setting `left` in this stacking context; already-correct behavior, made explicit rather than implicit).
- Confirmed no `overflow:hidden` ancestor (header, body, or otherwise) clips the dropdown on any sampled page — `position:absolute` + `z-index:4000` keeps it above and outside any such container regardless.

**Genuine leftover cleanup, as explicitly requested:** Sprint 8's page-by-page rollout replaced the *markup* using `.btn-logout` on all 18 pages but left the now-dead `.btn-logout{...}`/`.btn-logout:hover{...}` CSS rule declarations behind in each page's own `<style>` block — no element referenced them anymore, but they were genuine dead code. Removed from all 18 files (6 admin + 7 operator + 5 passenger), verified via `grep` that zero references remain anywhere under `public/pages/`, and every file re-syntax-checked clean afterward.

**A separate, real finding — documented honestly, not silently fixed, because it is out of this sprint's scope.** Testing at a 375px mobile viewport revealed that `passenger/index.html` (ticker banner, filter chips, review carousel) and `admin/admin.html` (multi-item nav row with no collapse mechanism) both render a layout viewport far wider than the physical screen (~558px and ~1235px respectively) despite having a correct `<meta name="viewport" content="width=device-width">` tag — meaning these pages require horizontal scrolling/pinch-zoom on a real phone. **Critically, the topbar dropdown component itself was not the cause and was not affected** — in every one of these wide-viewport tests, `.sb-profile-menu` and the logout button still measured correctly bounded within whatever the effective viewport was (`menuOverflowRight:false`, `logoutBtnOverflow:false` in all cases). This is a pre-existing characteristic of these pages' own nav/widget layouts (no hamburger/collapse pattern for the header nav, decorative homepage widgets not designed for narrow screens) — a full mobile-responsive redesign of the admin/operator dashboards and the marketing homepage is a substantially larger effort than "fix the logout button" and was not attempted here. Flagged as a candidate for a future sprint rather than silently left undocumented.

## 2. Google & Facebook OAuth — Frontend Flow Completed

Verified the full flow end-to-end against the actual code (Sprint 7/8 already built the SDK loading, backend calls, and `localStorage` key names correctly — `accessToken`/`refreshToken`/`user`, exactly matching what `/js/api.js`'s `authFetch`/`getAccessToken` expect):

**A real bug found and fixed: all 4 OAuth success handlers (Google × login, Google × register, Facebook × login, Facebook × register) hardcoded the post-auth redirect to `/pages/passenger/index.html` regardless of the account's actual role.** The regular email/password `login()` flow already correctly branches on `role` (`ADMIN`→`admin.html`, `OPERATOR`→`operator.html`, else→passenger `index.html`) — the OAuth paths never did. Since Google/Facebook signup always creates a new `PASSENGER` account, this only manifested for an *existing* ADMIN/OPERATOR account signing in (or an existing account clicking the "register" OAuth buttons, which the backend correctly treats as a login via its find-or-create logic) — a real, if narrower, correctness bug regardless of frequency. Fixed identically in all 4 handlers, reusing the exact branching pattern already proven in `login()`. Verified the storage side live (stubbed the backend response with an `OPERATOR` role account, confirmed `localStorage.user`/`accessToken` were stored correctly); the redirect branch itself reuses `login()`'s already-tested logic verbatim.

**Loading state upgraded from static dimmed text to an actual spinner.** All 4 handlers previously just replaced the button's content with `<span style="opacity:.6">Đang kết nối…</span>` — no motion, easy to mistake for an unresponsive button on a slow connection. Added a small rotating-ring `.oauth-spinner` (shared CSS in `style.css`, `@keyframes oauthSpin`) alongside the text in all 4 loading states. Live-verified the spinner element renders with the correct animation applied.

## 3. Legal Policy Pages (new)

Built `public/pages/legal/privacy-policy.html` and `public/pages/legal/terms-of-service.html` — standalone, publicly-accessible pages (no login required, since a visitor deciding whether to register needs to be able to read them), matching the site's dark visual language without the heavier per-page galaxy-canvas machinery (kept deliberately lightweight and readable/printable).

**Privacy policy** covers, per the brief: purpose of data collection (name, phone, email, trip history), the explicit "no sale to third parties, except the operating bus company" commitment, payment security (SSL/TLS, PCI-DSS via MoMo/VNPay/ZaloPay), and user rights (access, correction, deletion) — cited against **Nghị định số 13/2023/NĐ-CP**, Vietnam's actual personal data protection decree, not a generic placeholder.

**Terms of service** covers booking/payment rules, the cancellation/refund policy (explicitly stating the real **15-minute PENDING auto-cancellation** behavior — matching `bookingCleanup.js`'s actual implemented behavior from Sprint 3, not an invented number), passenger and operator responsibilities, and SmartBusAI's liability limits as an intermediary platform (not the transport operator itself).

**Integration — found and fixed real gaps, not just added new links:**
- `passenger/index.html`'s footer already had a "Chính sách" (Policy) column with "Điều khoản sử dụng"/"Chính sách bảo mật" text — but rendered as inert `<span>`s with `cursor:default`, never linked to anything. Converted to real links.
- The other 4 passenger pages (`nha-xe.html`, `hotro.html`, `profile.html`, `booking.html`) had **no footer at all**. Added a lightweight footer bar with both legal links to each.
- `register.html` already had a "Tôi đồng ý với Điều khoản dịch vụ và Chính sách bảo mật" consent checkbox above the submit button — a good pattern already in place — but both links were literal `href="#"` placeholders. Wired to the real pages (`target="_blank"`, so an in-progress registration form isn't lost by navigating away).
- `login.html` had no terms/privacy mention at all. Added consent text with working links directly under the Google/Facebook buttons — closing a real gap: a first-time visitor signing in via OAuth on the *login* page auto-creates a new account without ever seeing `register.html`'s checkbox.

Live-verified: both pages return `200 OK` and render their full content correctly; all 6 pages that should link to them (5 passenger + both auth pages, `register.html`+`login.html`) confirmed via DOM query to contain both `href="/pages/legal/..."` links.

## 4. Tests

**`tests/phase9-layout-legal-harmony.test.js` (new, 43 tests)** — no live HTTP server is spun up (no `supertest` dependency in this repo, matching the established convention from `phase5`/`phase7` for content that can't be exercised without one): legal-page structure and required-content checks (correct Nghị định citation, 15-minute PENDING policy, all required sections present, no broken inline scripts), footer-link presence across all 5 passenger pages and both auth pages, `.sb-profile-menu`'s hardened CSS (`right:0`+`left:auto`, z-index, viewport-clamped max-width, mobile bottom-sheet), the new `.oauth-spinner` animation, the dead-`.btn-logout` cleanup (parameterized across all 18 pages), a regression guard for the exact `profile.html` init-timing bug found this sprint (asserts the head-level guard no longer calls `initProfileDropdown`, and that the call now happens after `<body>`/`#sbProfile` exist), and the OAuth role-based-redirect fix (parameterized across both Google and Facebook handlers in both `login.html` and `register.html`).

```
tests/phase9-layout-legal-harmony.test.js:  43 passed, 43 total
```

## Full regression suite

```
Test Suites: 34 passed, 34 total
Tests:       546 passed, 546 total
```

503 tests carried over from Sprints 1-8 (zero behavior regressions) + 43 new this sprint.

## Not claimed

- The mobile-viewport horizontal-overflow finding in Section 1 (admin/operator dashboards and the marketing homepage not respecting `width=device-width` at narrow widths) is reported honestly as a real, separate issue — it was investigated and root-caused (no hamburger/collapse nav pattern; decorative ticker/carousel widgets not designed for narrow screens) but **not fixed**, since a full mobile-responsive redesign of these pages is a substantially larger effort than this sprint's topbar/logout scope. The topbar dropdown component itself was confirmed unaffected by this issue in every test.
- Real end-to-end OAuth sign-in (actually completing a Google/Facebook consent flow through to redirect) was not driven through a live provider popup in this environment — same limitation already documented in Sprints 7 and 8. The redirect-branch fix was verified by confirming the storage side live (stubbed backend response) and by code identity with `login()`'s already-proven branching logic, not a full live OAuth round-trip.
- Screenshots were not captured for the same reason documented in Sprint 8's report — the automation browser's screenshot action does not render in this environment. All UI claims in this report are backed by `getBoundingClientRect()` measurements and DOM assertions instead.

## Files created

- `public/pages/legal/privacy-policy.html`
- `public/pages/legal/terms-of-service.html`
- `tests/phase9-layout-legal-harmony.test.js`

## Files modified

- `public/css/style.css` — `.sb-profile-menu` explicit `left:auto`; new `.oauth-spinner` + `@keyframes oauthSpin`.
- `public/pages/passenger/profile.html` — `initProfileDropdown` moved from the head-level auth guard into `DOMContentLoaded` (the real regression fix).
- 18 admin/operator/passenger pages — dead `.btn-logout{}`/`.btn-logout:hover{}` CSS rules removed.
- `public/pages/passenger/index.html` — footer "Chính sách" links wired to the real pages (were inert placeholder spans).
- `public/pages/passenger/nha-xe.html`, `hotro.html`, `booking.html` — new lightweight footer with legal links (previously had no footer at all).
- `public/pages/auth/login.html` — OAuth role-based redirect fix (both handlers), `.oauth-spinner` added to both loading states, new consent text with working legal links under the OAuth buttons.
- `public/pages/auth/register.html` — OAuth role-based redirect fix (both handlers), `.oauth-spinner` added, existing terms checkbox's dead `href="#"` links wired to the real pages.
- `tests/phase9-layout-legal-harmony.test.js` — new.
