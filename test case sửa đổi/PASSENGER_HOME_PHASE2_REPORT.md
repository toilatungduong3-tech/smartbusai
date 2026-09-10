# Passenger Home — Phase 2 UI Restructure Report

**Date:** 2026-07-24  
**Branch:** main  
**File changed:** `public/pages/passenger/index.html`

---

## 1. Objective

Restructure the passenger home page so that at 1366×768 the primary CTA (search form) is immediately visible above the fold, benefit cards are compacted into a strip, and the DOM order matches the user's 17-point specification.

---

## 2. Changes Made

### 2.1 DOM Order (before → after)

| Before | After |
|--------|-------|
| Header | Header |
| `<section class="about">` (3 large cards) | Hero Compact (`<section class="hero-section">`) |
| Search form | Search form ← **moved up** |
| Popular routes | Popular routes |
| Sort/filter bar | Benefit Strip (3 compact items) ← **new** |
| | Sort/filter bar |

### 2.2 Hero Compact

Added `<section class="hero-section">` with:
- `<h1 class="hero-title">` — "Tìm chuyến xe phù hợp chỉ trong vài giây"
- `<p class="hero-desc">` — 1-line supporting description
- No background image, no full-screen height — purely typographic

### 2.3 Search Form — moved above benefit cards

The entire `<div class="search-box">` block with all original IDs preserved was kept intact and placed directly after the hero section. All IDs retained:

`#originWrap` `#originTrigger` `#originSearch` `#originList` `#origin` `#destWrap` `#destTrigger` `#destSearch` `#destList` `#destination` `#date` `#busType` `#sortPrice` `#searchBtn` `#geoBtn` `#searchInlineAI` `#sbAISpinner` `#sbAIItems`

### 2.4 Benefit Strip — 3 compact items replacing large cards

Replaced `<section class="about">` large cards with `<section class="benefit-strip">`.  
Each item uses class `about-card benefit-item` (preserving `querySelectorAll('.about-card')` selector used by `toggleAbout()`).

Structure per item:
```html
<div class="about-card benefit-item" onclick="toggleAbout(this, N)">
  <div class="bi-main-row">
    <span class="bi-icon">…</span>
    <div class="bi-body">
      <div class="bi-title">…</div>
      <div class="bi-desc">…</div>
    </div>
    <span class="bi-expand">▼</span>
  </div>
  <div class="about-detail"><div class="about-detail-inner">…</div></div>
</div>
```

Height per item: ~89px strip total (3 items in CSS grid).

### 2.5 CSS Added

```css
/* Hero */
.hero-section { width: min(1100px, 94vw); margin: 28px auto 0; text-align: center; }
.hero-title { font-size: 32px; font-weight: 800; ... cyan gradient text }
.hero-desc { font-size: 15px; color: rgba(184,198,217,.82); ... }

/* Benefit strip */
.benefit-strip { display: grid; grid-template-columns: repeat(3,1fr); gap: 12px; }
.benefit-item { height ~89px total; no glow; no float animation; no transform on hover }

/* Button overrides */
#searchBtn { cyan fill, font-weight 800 }
#geoBtn { transparent bg, outlined, !important to beat inline styles }
.swap-btn { subtle, no glow }
.pop-route-chip / .sf-chip { reduced glow, clear active state }

/* Reduced-motion */
@media (prefers-reduced-motion: reduce) { key animations disabled }
```

### 2.6 Planet size reduced

`.planet1` reduced from `~260px` to `130px` with proportionally reduced box-shadow.

---

## 3. Layout Verification (getBoundingClientRect measurements)

### 3.1 — 1366×768 (primary target)

| Element | top | bottom | height |
|---------|-----|--------|--------|
| `header` | 0 | 64 | 64 |
| `.hero-section` | 92 | 164 | 72 |
| `.search-box` | 178 | 260 | 82 |
| `#searchBtn` | 196 | 242 | 47 |
| `.popular-routes-bar` | 274 | 304 | 30 |
| `.benefit-strip` | 326 | 415 | 89 |
| `.sort-filter-bar` | 429 | 504 | 75 |

✅ All primary sections visible above 504px — well within 768px viewport.  
✅ Search button at y=196–242 — immediately visible, no scroll needed.

### 3.2 — 1440×900

| Element | top | bottom | height |
|---------|-----|--------|--------|
| `header` | 0 | 64 | 64 |
| `.hero-section` | 92 | 164 | 72 |
| `.search-box` | 178 | 260 | 82 |
| `#searchBtn` | 196 | 242 | 47 |
| `.popular-routes-bar` | 274 | 304 | 30 |
| `.benefit-strip` | 326 | 415 | 89 |
| `.sort-filter-bar` | 429 | 504 | 75 |

✅ All above fold (900px).

### 3.3 — 1024×768

| Element | top | bottom | height |
|---------|-----|--------|--------|
| `header` | 0 | 64 | 64 |
| `.hero-section` | 92 | 164 | 72 |
| `.search-box` | 178 | 313 | 136 |
| `.benefit-strip` | 417 | 525 | 107 |
| `.sort-filter-bar` | 539 | 614 | 75 |

✅ Search box wraps slightly wider but bottom at 313px — still above fold.  
✅ Benefit strip bottom at 525px — within 768px.

### 3.4 — 390×844 (mobile, measured at browser internal 712×1542 equivalent)

| Element | top | bottom | height |
|---------|-----|--------|--------|
| `header` | 0 | 64 | 64 |
| `.hero-section` | 92 | 198 | 106 |
| `.search-box` | 212 | 518 | 306 |
| `.benefit-strip` | 698 | 980 | 282 |
| `.sort-filter-bar` | 994 | 1034 | 40 |

✅ Benefit strip uses `grid-template-columns: 1fr` (single column) per mobile media query.  
⚠️ Search box taller on mobile (stacks vertically) — expected behavior for narrow viewport.

---

## 4. JS Function Preservation Audit

All functions verified present after restructure:

| Function | Status |
|----------|--------|
| `toggleAbout()` | ✅ present, `.about-card` class on all 3 benefit items |
| `searchTrips()` | ✅ present |
| `fillSearch()` | ✅ present |
| `swapOriginDest()` | ✅ present |
| All search form IDs | ✅ all 18 IDs verified via `getElementById` |

---

## 5. Server Syntax Check

```
node --check server/server.js → OK (no output = pass)
```

---

## 6. Console Errors

Zero console errors observed via `read_console_messages` after DOM restructure.

---

## 7. Constraints Respected

- ✅ No git reset, no git rollback, no git checkout
- ✅ No backend API changes
- ✅ No push to remote
- ✅ No DROP/TRUNCATE database commands
- ✅ All API endpoints, HTTP methods, request/response contracts preserved
- ✅ All IDs, name attributes, data-* attributes preserved
- ✅ No framework added, no large UI library, no mock data
- ✅ No functionality removed
