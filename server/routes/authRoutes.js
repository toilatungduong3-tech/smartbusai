const express = require("express");
const router = express.Router();

const authController = require("../controllers/authController");
const { strictLimiter } = require("../middleware/rateLimiter");
const { authenticate } = require("../middleware/authMiddleware");

// =============================
// ĐĂNG KÝ
// POST /api/auth/register
// =============================
router.post("/register", authController.register);

// =============================
// ĐĂNG NHẬP
// POST /api/auth/login
// =============================
router.post("/login", authController.login);

// =============================
// ĐẶT LẠI MẬT KHẨU
// POST /api/auth/reset-password
// =============================
// =============================
// KIỂM TRA EMAIL TỒN TẠI
// POST /api/auth/check-email
// =============================
router.post("/check-email", strictLimiter, authController.checkEmail);

// =============================
// ĐẶT LẠI MẬT KHẨU
// POST /api/auth/reset-password
// =============================
router.post("/reset-password", strictLimiter, authController.resetPassword);

// =============================
// REFRESH TOKEN
// POST /api/auth/refresh
// =============================
router.post("/refresh", authController.refreshToken);

// =============================
// ĐĂNG XUẤT
// POST /api/auth/logout
// Sprint 7 — requires a valid Bearer token (to know whose token_version
// to increment); the old no-op version needed no auth at all.
// =============================
router.post("/logout", authenticate, authController.logout);

// =============================
// ĐĂNG NHẬP / ĐĂNG KÝ VỚI GOOGLE
// POST /api/auth/google
// =============================
router.post("/google", authController.googleAuth);

// Trả về Google Client ID cho frontend (không cần auth)
router.get("/google-config", (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const configured = clientId && clientId !== "YOUR_GOOGLE_CLIENT_ID_HERE";
    res.json({ clientId: configured ? clientId : null, configured });
});

// =============================
// ĐĂNG NHẬP / ĐĂNG KÝ VỚI FACEBOOK
// POST /api/auth/facebook
// =============================
router.post("/facebook", authController.facebookAuth);

// Trả về Facebook App ID cho frontend (không cần auth) — chỉ App ID, không
// bao giờ là App Secret, giống hệt nguyên tắc của google-config ở trên.
router.get("/facebook-config", (req, res) => {
    const appId = process.env.FACEBOOK_APP_ID;
    const configured = appId && appId !== "YOUR_FACEBOOK_APP_ID_HERE";
    res.json({ appId: configured ? appId : null, configured });
});

// =============================
// TEST ROUTE
// GET /api/auth/test
// =============================
router.get("/test", (req, res) => {

    res.json({
        message: "Auth route working"
    });

});

module.exports = router;