/**
 * SmartBusAI — JWT Authentication & RBAC Middleware
 */

const jwt = require("jsonwebtoken");
const db  = require("../config/db");
const { setContext } = require("../utils/requestContext");
const logger = require('../utils/logger');

// Khóa bí mật JWT — nguồn duy nhất, xem server/config/jwtSecret.js
const JWT_SECRET = require("../config/jwtSecret");

const VALID_ROLES   = new Set(["ADMIN", "OPERATOR", "PASSENGER"]);
/* Phase 2I Final pass: was {"ACTIVE","INACTIVE","BANNED"} — doesn't match
   the actual schema (`users.status enum('ACTIVE','BLOCKED')`) or the only
   values the frontend ever sends ("ACTIVE"/"BLOCKED", e.g.
   admin/users.html's block/unblock toggle). That mismatch meant the
   validation in userController.updateUser rejected every real
   block/unblock attempt with 422, and the same set silently broke the
   admin user-list status filter (?status=BLOCKED never matched). Found via
   live testing while verifying an unrelated fix.
   Sprint 3: 'INACTIVE' added back — this time matching the schema, which
   migrate_v11.sql widens to enum('ACTIVE','BLOCKED','INACTIVE') to fix a
   separate bug (userController.deleteUser's soft-delete path wrote
   'INACTIVE' against a schema that didn't have it, silently truncating to
   ''). Recognizing it here makes the admin user-list filter and the manual
   status-update validation both work correctly for that state too. */
const VALID_STATUSES = new Set(["ACTIVE", "BLOCKED", "INACTIVE"]);

/* ── authenticate: bắt buộc có token hợp lệ ──
   Sprint 3 — MASTER_COMPLETION_MATRIX.md blocker: previously only verified
   the JWT signature/expiry and trusted the token payload entirely — a
   user blocked by an admin *after* their token was issued stayed fully
   authenticated for the token's remaining lifetime (up to 15 minutes per
   access token, effectively longer via refreshToken chaining before that
   was separately fixed). Status is now re-checked against the DB on every
   authenticated request — a single indexed PK lookup (users.user_id),
   not trusted from the token claims, since the whole point is to catch a
   status change that happened after the token was minted. */
const authenticate = async (req, res, next) => {
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Không có token xác thực" });
    }
    const token = authHeader.split(" ")[1];
    let decoded;
    try {
        decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
        if (err.name === "TokenExpiredError") {
            return res.status(401).json({ message: "Token đã hết hạn", expired: true });
        }
        return res.status(401).json({ message: "Token không hợp lệ" });
    }
    try {
        const [[user]] = await db.query("SELECT status, token_version FROM users WHERE user_id = ?", [decoded.user_id]);
        if (!user || user.status !== "ACTIVE") {
            return res.status(403).json({ message: "Tài khoản đã bị khóa. Vui lòng liên hệ hỗ trợ." });
        }
        /* Sprint 7 — real server-side logout: same query, one extra
           column. A token minted before the user's most recent logout
           carries a stale token_version and is rejected here, even though
           its signature/expiry are still valid — this is what makes
           logout() instant rather than "wait up to 15 minutes". Missing
           decoded.token_version (a pre-Sprint-7 token) is treated as 0,
           matching the column's own DEFAULT 0. */
        if ((decoded.token_version || 0) !== (user.token_version || 0)) {
            return res.status(401).json({ message: "Phiên đăng nhập đã bị vô hiệu hóa, vui lòng đăng nhập lại", expired: true });
        }
    } catch (err) {
        logger.error("[authenticate] status lookup error:", err.message);
        return res.status(500).json({ message: "Lỗi xác thực" });
    }
    req.user = { user_id: decoded.user_id, role: decoded.role, email: decoded.email };
    setContext({ user_id: decoded.user_id }); // Enterprise Hardening Pass — every logger.* call in this request now carries the real user_id
    next();
};

/* ── optionalAuth: không bắt buộc có token ── */
const optionalAuth = (req, res, next) => {
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) return next();
    const token = authHeader.split(" ")[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = { user_id: decoded.user_id, role: decoded.role, email: decoded.email };
        setContext({ user_id: decoded.user_id });
    } catch { req.user = null; }
    next();
};

/* ── requireRole(...roles): user phải có 1 trong các role liệt kê ── */
const requireRole = (...roles) => (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: "Chưa xác thực" });
    if (!roles.includes(req.user.role)) {
        return res.status(403).json({ message: "Không có quyền truy cập" });
    }
    next();
};

const requireAdmin            = requireRole("ADMIN");
const requireAdminOrOperator  = requireRole("ADMIN", "OPERATOR");

/* ── requireSelfOrAdmin: user chỉ truy cập dữ liệu của chính mình, trừ ADMIN ── */
const requireSelfOrAdmin = (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: "Chưa xác thực" });
    const targetId = parseInt(req.params.id, 10);
    if (req.user.role === "ADMIN" || req.user.user_id === targetId) return next();
    return res.status(403).json({ message: "Không có quyền truy cập dữ liệu này" });
};

module.exports = {
    authenticate,
    optionalAuth,
    requireRole,
    requireAdmin,
    requireAdminOrOperator,
    requireSelfOrAdmin,
    VALID_ROLES,
    VALID_STATUSES,
};
