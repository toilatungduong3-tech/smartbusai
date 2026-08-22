/**
 * SmartBusAI — Shared API Utility
 * JWT auth + GET cache + request deduplication
 */

const API_BASE = "/api";

/* ── User cache (avoid repeated JSON.parse) ── */
let _userCache = null;
let _userCacheKey = null;
function getUser() {
    try {
        const raw = localStorage.getItem("user");
        if (!raw) { _userCache = null; return null; }
        if (raw === _userCacheKey && _userCache) return _userCache;
        _userCacheKey = raw;
        _userCache = JSON.parse(raw);
        return _userCache;
    } catch { return null; }
}

function getUserId() {
    return localStorage.getItem("user_id") || getUser()?.user_id || null;
}

function getRole() {
    return getUser()?.role || null;
}

/* ── JWT tokens ── */
function getAccessToken()  { return localStorage.getItem("accessToken")  || null; }
function getRefreshToken() { return localStorage.getItem("refreshToken") || null; }

/* ── Auth guards ── */
function requireLogin(redirectTo = "/pages/auth/login.html") {
    if (!getUser()) { window.location.href = redirectTo; return false; }
    return true;
}
function requireRole(role, redirectTo = "/pages/auth/login.html") {
    const user = getUser();
    if (!user || user.role !== role) { window.location.href = redirectTo; return false; }
    return true;
}

/* ── Logout ──
   Sprint 7: POST /api/auth/logout now requires the Bearer token (it
   revokes server-side by user_id, decoded from the token) — captured
   into a variable BEFORE clearing localStorage, since the fetch below is
   dispatched after the clears below it in source order but this value is
   read synchronously up front either way. Sent best-effort: local
   storage is always cleared and the redirect always happens even if the
   revocation call fails (network down, token already expired, etc.) —
   the tokens still naturally expire within 15m/7d regardless. */
function logout() {
    const tokenAtLogout = getAccessToken();
    _userCache = null; _userCacheKey = null;
    localStorage.removeItem("user");
    localStorage.removeItem("user_id");
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    if (tokenAtLogout) {
        fetch(API_BASE + "/auth/logout", {
            method: "POST",
            headers: { "Authorization": `Bearer ${tokenAtLogout}` },
        }).catch(() => {});
    }
    window.location.href = "/pages/auth/login.html";
}

/* ── Shared Topbar Profile Dropdown (Sprint 8) ──
   Fixes a real, measured overflow bug: the old always-expanded
   "avatar + name" chip + separate logout button together needed ~250px
   of topbar width with no responsive collapse — on a real 1280px
   viewport the logout button's right edge landed 159px past the visible
   viewport edge (measured via getBoundingClientRect() against the real
   running admin.html before this fix; see SPRINT8_FINAL_REPORT.md).
   One shared implementation, called from every admin/operator/passenger
   topbar, instead of duplicating bespoke chip markup per page — CSS is
   in /css/style.css (.sb-profile*).

   Usage: <div class="sb-profile" id="sbProfile"></div> in the topbar,
   then initProfileDropdown('sbProfile') after the page's own header
   markup is in the DOM. */
function _sbAvatarHtml(sizeClass, avatarUrl, initial) {
    if (avatarUrl) {
        return `<div class="${sizeClass}" style="background-image:url('${avatarUrl.replace(/'/g, "%27")}')"></div>`;
    }
    return `<div class="${sizeClass}">${initial}</div>`;
}

function _sbRoleLabel(role) {
    return { ADMIN: 'Quản trị viên', OPERATOR: 'Nhà xe', PASSENGER: 'Hành khách' }[role] || role || '';
}

/* Role-aware "personal page" link — omitted entirely for a role with no
   real equivalent (operators have no dedicated profile/settings page
   today) rather than link somewhere that doesn't serve this purpose. */
function _sbPersonalPageUrl(role) {
    if (role === 'ADMIN') return '/pages/admin/settings.html';
    if (role === 'PASSENGER') return '/pages/passenger/profile.html';
    return null;
}

let _sbDropdownCloseHandler = null;

function initProfileDropdown(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const user = getUser();
    if (!user) {
        // Guest — no session to show a profile chip for. Previously this
        // returned here and left the container permanently empty, which
        // removed the only way to reach the login page from the topbar on
        // every page that uses this component (a real regression, not the
        // intended "acceptable gap" — a guest still needs a way in).
        container.classList.add('sb-profile');
        container.innerHTML = `<a href="/pages/auth/login.html" class="sb-profile-trigger" style="text-decoration:none;padding:6px 16px;">
            <span style="font-size:12.5px;font-weight:700;color:#fff;">Đăng nhập</span>
        </a>`;
        return;
    }

    const initial = (user.full_name || user.email || '?').trim().charAt(0).toUpperCase();
    const displayName = user.full_name || user.email || 'Người dùng';
    const personalUrl = _sbPersonalPageUrl(user.role);

    container.classList.add('sb-profile');
    container.innerHTML = `
      <button type="button" class="sb-profile-trigger" id="${containerId}Trigger" aria-haspopup="true" aria-expanded="false">
        ${_sbAvatarHtml('sb-profile-avatar', user.avatar_url, initial)}
        <span class="sb-profile-chevron">▾</span>
      </button>
      <div class="sb-profile-menu" id="${containerId}Menu" role="menu">
        <div class="sb-profile-menu-header">
          ${_sbAvatarHtml('sb-profile-menu-avatar', user.avatar_url, initial)}
          <div class="sb-profile-menu-info">
            <div class="sb-profile-menu-name">${displayName}</div>
            <div class="sb-profile-menu-email">${user.email || ''}</div>
            <span class="sb-profile-menu-role">${_sbRoleLabel(user.role)}</span>
          </div>
        </div>
        ${personalUrl ? `<a class="sb-profile-menu-item" href="${personalUrl}">👤 Trang cá nhân / Cài đặt</a>` : ''}
        <div class="sb-profile-menu-sep"></div>
        <button type="button" class="sb-profile-menu-item sb-danger" id="${containerId}LogoutBtn">🚪 Đăng xuất</button>
      </div>
    `;

    const trigger = document.getElementById(`${containerId}Trigger`);
    const menu = document.getElementById(`${containerId}Menu`);
    const logoutBtn = document.getElementById(`${containerId}LogoutBtn`);

    function closeMenu() {
        menu.classList.remove('open');
        trigger.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
    }
    function toggleMenu(e) {
        e.stopPropagation();
        const willOpen = !menu.classList.contains('open');
        menu.classList.toggle('open', willOpen);
        trigger.classList.toggle('open', willOpen);
        trigger.setAttribute('aria-expanded', String(willOpen));
    }

    trigger.addEventListener('click', toggleMenu);
    logoutBtn.addEventListener('click', () => { if (typeof logout === 'function') logout(); });

    // Close on outside click / Escape — one shared document-level listener,
    // replaced (not stacked) if initProfileDropdown() is ever called again.
    if (_sbDropdownCloseHandler) document.removeEventListener('click', _sbDropdownCloseHandler);
    _sbDropdownCloseHandler = (e) => { if (!container.contains(e.target)) closeMenu(); };
    document.addEventListener('click', _sbDropdownCloseHandler);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
}

/* Sprint 8 — Avatar Sync Engine: re-renders every .sb-profile on the
   CURRENT page immediately after a profile avatar change, without a full
   reload. Cross-tab/cross-page sync (other already-open tabs) happens
   via the native `storage` event, wired below — localStorage writes only
   fire `storage` in OTHER tabs, never the tab that wrote it, which is
   exactly why this function exists to handle the local case explicitly. */
function refreshProfileDropdowns() {
    document.querySelectorAll('.sb-profile[id]').forEach(el => initProfileDropdown(el.id));
}
window.addEventListener('storage', (e) => {
    if (e.key === 'user') refreshProfileDropdowns();
});

/* ── Token refresh ── */
async function _doTokenRefresh() {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return null;
    try {
        const res = await fetch(API_BASE + "/auth/refresh", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refreshToken })
        });
        if (!res.ok) { logout(); return null; }
        const data = await res.json();
        if (data.accessToken) {
            localStorage.setItem("accessToken", data.accessToken);
            return data.accessToken;
        }
        return null;
    } catch (err) {
        console.error("[api.js] Token refresh error:", err);
        return null;
    }
}

/* ══════════════════════════════════════════
   GET CACHE — TTL 45s, max 80 entries
   In-flight deduplication (same URL called
   simultaneously → single network request)
══════════════════════════════════════════ */
const _cache    = new Map(); // key → { data, expiresAt }
const _inflight = new Map(); // key → Promise
const CACHE_TTL = 45_000;    // 45 seconds
const CACHE_MAX = 80;

/* Endpoints that should NEVER be cached (writes / user-specific volatile) */
const _noCache = new Set([
    "/bookings",         // live ticker
    "/seats/locks/",     // realtime seat locks
    "/auth/",
]);

function _isCacheable(endpoint) {
    return !_noCache.has(endpoint) &&
           !Array.from(_noCache).some(p => endpoint.startsWith(p));
}

function _cacheGet(key) {
    const entry = _cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) { _cache.delete(key); return null; }
    return entry.data;
}

function _cacheSet(key, data) {
    if (_cache.size >= CACHE_MAX) {
        // evict oldest
        const firstKey = _cache.keys().next().value;
        _cache.delete(firstKey);
    }
    _cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL });
}

/* Invalidate cache entries matching a prefix (call after POST/PUT/DELETE) */
function _invalidateCache(prefix) {
    for (const key of _cache.keys()) {
        if (key.startsWith(prefix)) _cache.delete(key);
    }
}

/* ── Generic fetch wrapper ── */
async function apiFetch(endpoint, options = {}, _isRetry = false) {
    const isGET   = !options.method || options.method === "GET";
    const cacheKey = endpoint;

    /* Serve from cache for GET requests */
    if (isGET && _isCacheable(endpoint)) {
        const cached = _cacheGet(cacheKey);
        if (cached) return cached;

        /* Deduplication: if same GET is in-flight, await that promise */
        if (_inflight.has(cacheKey)) return _inflight.get(cacheKey);
    }

    const accessToken = getAccessToken();
    const headers = { "Content-Type": "application/json", ...options.headers };
    if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

    const fetchPromise = (async () => {
        try {
            const res = await fetch(API_BASE + endpoint, { ...options, headers });

            if (res.status === 401 && !_isRetry) {
                const newToken = await _doTokenRefresh();
                if (newToken) return apiFetch(endpoint, options, true);
                const d = await res.json().catch(() => ({}));
                throw { status: 401, message: d.message || "Phiên đăng nhập hết hạn" };
            }

            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw { status: res.status, message: data.message || "Lỗi server" };

            /* Cache successful GET responses */
            if (isGET && _isCacheable(endpoint)) _cacheSet(cacheKey, data);

            return data;
        } catch (err) {
            if (err.status) throw err;
            throw { status: 0, message: "Không kết nối được server" };
        } finally {
            _inflight.delete(cacheKey);
        }
    })();

    /* Register in-flight for deduplication */
    if (isGET && _isCacheable(endpoint)) _inflight.set(cacheKey, fetchPromise);

    return fetchPromise;
}

const api = {
    get:    (ep)       => apiFetch(ep),
    post:   (ep, body) => {
        _invalidateCache(ep.replace(/\/[^/]+$/, "")); // invalidate parent collection
        return apiFetch(ep, { method: "POST", body: JSON.stringify(body) });
    },
    put:    (ep, body) => {
        _invalidateCache(ep.replace(/\/[^/]+$/, ""));
        return apiFetch(ep, { method: "PUT",  body: JSON.stringify(body) });
    },
    delete: (ep)       => {
        _invalidateCache(ep.replace(/\/[^/]+$/, ""));
        return apiFetch(ep, { method: "DELETE" });
    },
    /* Manually clear cache (e.g. after booking paid) */
    clearCache: (prefix = "") => {
        if (!prefix) { _cache.clear(); return; }
        _invalidateCache(prefix);
    },
};

/* ── Format tiền VNĐ (reuse formatter instance) ── */
const _vndFmt = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" });
function formatMoney(n) {
    if (!n && n !== 0) return "—";
    return _vndFmt.format(n);
}

/* ── Format ngày giờ (reuse formatter instance) ── */
const _dateFmt = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" });
function formatDate(d) {
    if (!d) return "—";
    const dt = d instanceof Date ? d : new Date(d);
    return isNaN(dt) ? "—" : _dateFmt.format(dt);
}

/* ── Toast notification ── */
let _toastStyleInjected = false;
function showToast(message, type = "success") {
    const existing = document.getElementById("_toast");
    if (existing) existing.remove();

    if (!_toastStyleInjected) {
        const s = document.createElement("style");
        s.textContent = `@keyframes _toastIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes _toastOut{to{opacity:0;transform:translateY(8px)}}`;
        document.head.appendChild(s);
        _toastStyleInjected = true;
    }

    const colors = { success:"#2ecc71", error:"#e74c3c", warning:"#f39c12", info:"#00a8ff" };
    const toast = document.createElement("div");
    toast.id = "_toast";
    toast.style.cssText = `position:fixed;bottom:28px;right:28px;z-index:99999;
background:${colors[type]||colors.success};color:#fff;padding:13px 22px;border-radius:12px;
font-size:14px;font-weight:600;box-shadow:0 4px 24px rgba(0,0,0,.35);
animation:_toastIn .2s cubic-bezier(.34,1.56,.64,1);
max-width:340px;word-break:break-word;will-change:transform,opacity;`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = "_toastOut .2s ease forwards";
        setTimeout(() => toast.remove(), 200);
    }, 2800);
}
