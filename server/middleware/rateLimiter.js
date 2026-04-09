/**
 * SmartBusAI — Rate Limiting Middleware
 * Giới hạn số lượng request để chống brute-force và DDoS
 */

const rateLimit = require("express-rate-limit");

// =================================
// LOGIN LIMITER
// Giới hạn 10 lần đăng nhập sai trong 15 phút mỗi IP
// Áp dụng cho: POST /api/auth/login
// =================================
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 phút
    max: 10,                   // Tối đa 10 lần thử mỗi IP
    standardHeaders: true,     // Trả về header RateLimit-* theo RFC 6585
    legacyHeaders: false,      // Tắt header X-RateLimit-* cũ
    message: {
        message: "Bạn đã thử đăng nhập quá nhiều lần. Vui lòng thử lại sau 15 phút."
    },
    skipSuccessfulRequests: true // Không đếm các request thành công
});

// =================================
// API LIMITER
// Giới hạn 200 request mỗi phút mỗi IP
// Áp dụng cho: tất cả /api/ endpoints
// =================================
const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 phút
    max: 200,            // Tối đa 200 request mỗi IP
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        message: "Quá nhiều yêu cầu từ IP này. Vui lòng thử lại sau."
    }
});

// =================================
// STRICT LIMITER
// Giới hạn 50 request mỗi phút mỗi IP
// Áp dụng cho: các endpoint nhạy cảm (reset password, v.v.)
// =================================
const strictLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 phút
    max: 50,             // Tối đa 50 request mỗi IP
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        message: "Quá nhiều yêu cầu. Vui lòng chờ một chút trước khi thử lại."
    }
});

module.exports = { loginLimiter, apiLimiter, strictLimiter };
