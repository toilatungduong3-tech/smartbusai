/**
 * SmartBusAI — JWT Authentication Middleware
 * Xác thực JWT từ header Authorization: Bearer <token>
 */

const jwt = require("jsonwebtoken");

// Sử dụng biến môi trường hoặc fallback về secret mặc định
const JWT_SECRET = process.env.JWT_SECRET || "smartbusai_jwt_secret_key_2024_international";

// =================================
// AUTHENTICATE (bắt buộc có token)
// Gắn req.user = { user_id, role, email } nếu token hợp lệ
// =================================
const authenticate = (req, res, next) => {
    const authHeader = req.headers["authorization"];

    // Kiểm tra header có tồn tại và đúng định dạng Bearer
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Không có token xác thực" });
    }

    const token = authHeader.split(" ")[1];

    try {
        // Xác minh token và giải mã payload
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = {
            user_id: decoded.user_id,
            role:    decoded.role,
            email:   decoded.email
        };
        next();
    } catch (err) {
        if (err.name === "TokenExpiredError") {
            return res.status(401).json({ message: "Token đã hết hạn", expired: true });
        }
        return res.status(401).json({ message: "Token không hợp lệ" });
    }
};

// =================================
// OPTIONAL AUTH (không bắt buộc có token)
// Nếu có token hợp lệ thì gắn req.user, không có thì bỏ qua
// =================================
const optionalAuth = (req, res, next) => {
    const authHeader = req.headers["authorization"];

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        // Không có token — cho phép tiếp tục mà không gắn req.user
        return next();
    }

    const token = authHeader.split(" ")[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = {
            user_id: decoded.user_id,
            role:    decoded.role,
            email:   decoded.email
        };
    } catch (err) {
        // Token không hợp lệ hoặc hết hạn — bỏ qua, không báo lỗi
        req.user = null;
    }

    next();
};

module.exports = { authenticate, optionalAuth };
