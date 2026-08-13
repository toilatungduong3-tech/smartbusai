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

/* ── Logout ── */
function logout() {
    _userCache = null; _userCacheKey = null;
    localStorage.removeItem("user");
    localStorage.removeItem("user_id");
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    fetch(API_BASE + "/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/pages/auth/login.html";
}

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
