/**
 * SmartBusAI — JWT Authentication & RBAC Middleware
 */

const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "smartbusai_jwt_secret_key_2024_international";

const VALID_ROLES   = new Set(["ADMIN", "OPERATOR", "PASSENGER"]);
const VALID_STATUSES = new Set(["ACTIVE", "INACTIVE", "BANNED"]);

/* ── authenticate: bắt buộc có token hợp lệ ── */
const authenticate = (req, res, next) => {
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Không có token xác thực" });
    }
    const token = authHeader.split(" ")[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = { user_id: decoded.user_id, role: decoded.role, email: decoded.email };
        next();
    } catch (err) {
        if (err.name === "TokenExpiredError") {
            return res.status(401).json({ message: "Token đã hết hạn", expired: true });
        }
        return res.status(401).json({ message: "Token không hợp lệ" });
    }
};

/* ── optionalAuth: không bắt buộc có token ── */
const optionalAuth = (req, res, next) => {
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) return next();
    const token = authHeader.split(" ")[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = { user_id: decoded.user_id, role: decoded.role, email: decoded.email };
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
