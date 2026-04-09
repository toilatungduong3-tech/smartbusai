const express = require("express");
const router = express.Router();

const authController = require("../controllers/authController");

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
router.post("/check-email", authController.checkEmail);

// =============================
// ĐẶT LẠI MẬT KHẨU
// POST /api/auth/reset-password
// =============================
router.post("/reset-password", authController.resetPassword);

// =============================
// REFRESH TOKEN
// POST /api/auth/refresh
// =============================
router.post("/refresh", authController.refreshToken);

// =============================
// ĐĂNG XUẤT
// POST /api/auth/logout
// =============================
router.post("/logout", authController.logout);

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