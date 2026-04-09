/**
 * SmartBusAI — Shared API Utility
 * Dùng chung cho tất cả các trang frontend
 *
 * Cập nhật: Hỗ trợ JWT authentication
 * - Tự động gắn Authorization: Bearer <accessToken> vào mọi request
 * - Tự động refresh token nếu nhận được 401 (token hết hạn)
 */

const API_BASE = "/api";

/* ── Lấy user từ localStorage ── */
function getUser() {
    try { return JSON.parse(localStorage.getItem("user")) || null; }
    catch { return null; }
}

function getUserId() {
    return localStorage.getItem("user_id") || getUser()?.user_id || null;
}

function getRole() {
    return getUser()?.role || null;
}

/* ── Lấy JWT tokens từ localStorage ── */
function getAccessToken() {
    return localStorage.getItem("accessToken") || null;
}

function getRefreshToken() {
    return localStorage.getItem("refreshToken") || null;
}

/* ── Kiểm tra đăng nhập, redirect nếu chưa login ── */
function requireLogin(redirectTo = "/pages/auth/login.html") {
    if (!getUser()) {
        window.location.href = redirectTo;
        return false;
    }
    return true;
}

/* ── Kiểm tra role ── */
function requireRole(role, redirectTo = "/pages/auth/login.html") {
    const user = getUser();
    if (!user || user.role !== role) {
        window.location.href = redirectTo;
        return false;
    }
    return true;
}

/* ── Đăng xuất: xóa cả user object lẫn tokens ── */
function logout() {
    localStorage.removeItem("user");
    localStorage.removeItem("user_id");
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    // Gọi API logout (không cần chờ response)
    fetch(API_BASE + "/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/pages/auth/login.html";
}

/* ── Thực hiện token refresh: lấy accessToken mới dùng refreshToken ── */
async function _doTokenRefresh() {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return null;

    try {
        const res = await fetch(API_BASE + "/auth/refresh", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refreshToken })
        });

        if (!res.ok) {
            // Refresh token hết hạn hoặc không hợp lệ — đăng xuất
            logout();
            return null;
        }

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

/* ── Generic fetch wrapper với JWT auto-inject và auto-refresh ── */
async function apiFetch(endpoint, options = {}, _isRetry = false) {
    // Lấy access token hiện tại (nếu có)
    const accessToken = getAccessToken();

    // Xây dựng headers — gắn Bearer token nếu có
    const headers = {
        "Content-Type": "application/json",
        ...options.headers
    };

    if (accessToken) {
        headers["Authorization"] = `Bearer ${accessToken}`;
    }

    try {
        const res = await fetch(API_BASE + endpoint, {
            ...options,
            headers
        });

        // Nếu nhận 401 và chưa retry — thử refresh token một lần
        if (res.status === 401 && !_isRetry) {
            const newToken = await _doTokenRefresh();
            if (newToken) {
                // Retry request với token mới
                return apiFetch(endpoint, options, true);
            }
            // Không refresh được — throw lỗi 401
            const data = await res.json().catch(() => ({}));
            throw { status: 401, message: data.message || "Phiên đăng nhập hết hạn" };
        }

        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw { status: res.status, message: data.message || "Lỗi server" };
        return data;
    } catch (err) {
        if (err.status) throw err;
        throw { status: 0, message: "Không kết nối được server" };
    }
}

const api = {
    get:    (ep) => apiFetch(ep),
    post:   (ep, body) => apiFetch(ep, { method: "POST", body: JSON.stringify(body) }),
    put:    (ep, body) => apiFetch(ep, { method: "PUT",  body: JSON.stringify(body) }),
    delete: (ep)       => apiFetch(ep, { method: "DELETE" }),
};

/* ── Format tiền VNĐ ── */
function formatMoney(n) {
    if (!n && n !== 0) return "—";
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(n);
}

/* ── Format ngày giờ ── */
function formatDate(d) {
    if (!d) return "—";
    return new Date(d).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}

/* ── Toast notification ── */
function showToast(message, type = "success") {
    const existing = document.getElementById("_toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "_toast";
    const colors = { success: "#2ecc71", error: "#e74c3c", warning: "#f39c12", info: "#00a8ff" };
    toast.style.cssText = `
        position:fixed; bottom:28px; right:28px; z-index:99999;
        background:${colors[type] || colors.success};
        color:#fff; padding:13px 22px; border-radius:12px;
        font-size:14px; font-weight:600;
        box-shadow:0 4px 24px rgba(0,0,0,.35);
        animation:_toastIn .25s ease;
        max-width:340px; word-break:break-word;
    `;
    const style = document.createElement("style");
    style.textContent = `@keyframes _toastIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}`;
    document.head.appendChild(style);
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}
