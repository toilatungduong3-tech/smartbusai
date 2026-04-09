/**
 * SmartBusAI — Auth Controller
 * Xử lý đăng ký, đăng nhập, refresh token, đăng xuất
 */

const db      = require("../config/db");
const bcrypt  = require("bcryptjs");
const jwt     = require("jsonwebtoken");

// Khóa bí mật JWT — nên đặt trong biến môi trường .env
const JWT_SECRET = process.env.JWT_SECRET || "smartbusai_jwt_secret_key_2024_international";

// Thời gian hết hạn token
const ACCESS_TOKEN_EXPIRES  = "15m"; // Access token: 15 phút
const REFRESH_TOKEN_EXPIRES = "7d";  // Refresh token: 7 ngày

// =================================
// HELPER: Tạo cặp access + refresh token
// =================================
function generateTokens(user) {
    const payload = {
        user_id: user.user_id,
        role:    user.role,
        email:   user.email
    };

    const accessToken  = jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRES });
    const refreshToken = jwt.sign(payload, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRES });

    return { accessToken, refreshToken };
}

// =================================
// CHECK EMAIL EXISTS (for forgot-password step 1)
// =================================
exports.checkEmail = async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Thiếu email" });
    try {
        const [rows] = await db.query("SELECT user_id FROM users WHERE email = ?", [email]);
        if (rows.length === 0) {
            return res.status(404).json({ message: "Email không tồn tại trong hệ thống" });
        }
        return res.json({ message: "Email hợp lệ" });
    } catch (err) {
        console.error("Check email error:", err);
        return res.status(500).json({ message: "Database error" });
    }
};

// =================================
// RESET PASSWORD
// Lưu mật khẩu mới dưới dạng bcrypt hash
// =================================
exports.resetPassword = async (req, res) => {
    const { email, new_password } = req.body;
    if (!email || !new_password) {
        return res.status(400).json({ message: "Thiếu thông tin bắt buộc" });
    }
    if (new_password.length < 6) {
        return res.status(400).json({ message: "Mật khẩu tối thiểu 6 ký tự" });
    }
    try {
        const [rows] = await db.query("SELECT user_id FROM users WHERE email = ?", [email]);
        if (rows.length === 0) {
            return res.status(404).json({ message: "Email không tồn tại trong hệ thống" });
        }

        // Hash mật khẩu mới trước khi lưu
        const hashedPassword = await bcrypt.hash(new_password, 12);
        await db.query("UPDATE users SET password_hash = ? WHERE email = ?", [hashedPassword, email]);

        return res.json({ message: "Đặt lại mật khẩu thành công" });
    } catch (err) {
        console.error("Reset password error:", err);
        return res.status(500).json({ message: "Database error" });
    }
};

// =================================
// REGISTER USER
// Hash mật khẩu với bcrypt trước khi lưu DB
// =================================
exports.register = async (req, res) => {
    const {
        username, full_name, email, password,
        phone, gender, birth_date,
        province, district, address_detail
    } = req.body;

    console.log(req.body);

    if (!username || !full_name || !email || !password) {
        return res.status(400).json({ message: "Missing required fields" });
    }

    // CHECK AGE >= 15
    if (birth_date) {
        const today = new Date();
        const birth = new Date(birth_date);
        let age = today.getFullYear() - birth.getFullYear();
        const monthDiff = today.getMonth() - birth.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--;
        if (age < 15) {
            return res.status(400).json({ message: "User must be at least 15 years old" });
        }
    }

    try {
        // CHECK USERNAME EXISTS
        const [existUser] = await db.query(
            "SELECT user_id FROM users WHERE username = ?", [username]
        );
        if (existUser.length > 0) {
            return res.status(400).json({ message: "Username already exists" });
        }

        // HASH MẬT KHẨU với bcrypt (cost factor 12)
        const hashedPassword = await bcrypt.hash(password, 12);

        // INSERT USER với mật khẩu đã được hash
        const [result] = await db.query(
            `INSERT INTO users
             (username, full_name, email, password_hash, phone, gender, birth_date, province, district, address_detail)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                username, full_name, email, hashedPassword,
                phone || null, gender || null, birth_date || null,
                province || null, district || null, address_detail || null
            ]
        );

        return res.status(201).json({
            message: "Register successful",
            user_id: result.insertId
        });

    } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            return res.status(400).json({ message: "Email already exists" });
        }
        console.error("Register error:", err);
        return res.status(500).json({ message: "Database error" });
    }
};


// =================================
// LOGIN USER
// So sánh mật khẩu với bcrypt, tự động migration plain text → bcrypt
// Trả về JWT access token + refresh token
// =================================
exports.login = async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: "Missing email or password" });
    }

    try {
        const [rows] = await db.query(
            "SELECT * FROM users WHERE email = ?", [email]
        );

        if (rows.length === 0) {
            return res.status(401).json({ message: "Email or password incorrect" });
        }

        const user = rows[0];

        // ── Kiểm tra mật khẩu với backward compatibility ──
        let passwordValid = false;

        // Thử bcrypt.compare trước
        try {
            passwordValid = await bcrypt.compare(password, user.password_hash);
        } catch (bcryptErr) {
            // bcrypt.compare ném lỗi nếu hash không đúng định dạng — bỏ qua
            passwordValid = false;
        }

        // Nếu bcrypt thất bại VÀ mật khẩu lưu không phải bcrypt hash (plain text migration)
        if (!passwordValid && !user.password_hash.startsWith("$2")) {
            // So sánh plain text
            if (user.password_hash === password) {
                passwordValid = true;

                // Tự động migrate: cập nhật lên bcrypt hash trong DB
                try {
                    const newHash = await bcrypt.hash(password, 12);
                    await db.query(
                        "UPDATE users SET password_hash = ? WHERE user_id = ?",
                        [newHash, user.user_id]
                    );
                    console.log(`[Auth] Migrated plain text password to bcrypt for user_id=${user.user_id}`);
                } catch (migrateErr) {
                    // Không dừng đăng nhập nếu migration thất bại
                    console.error("[Auth] Password migration error:", migrateErr);
                }
            }
        }

        if (!passwordValid) {
            return res.status(401).json({ message: "Email or password incorrect" });
        }

        /* ── Maintenance mode: block PASSENGER + OPERATOR ── */
        if (user.role !== "ADMIN") {
            try {
                const fs   = require("fs");
                const path = require("path");
                const sf   = path.join(__dirname, "../config/settings.json");
                const cfg  = JSON.parse(fs.readFileSync(sf, "utf8"));
                if (cfg.maintenanceMode) {
                    return res.status(503).json({ message: "maintenance" });
                }
            } catch (_) { /* settings file missing — allow login */ }
        }

        // ── Tạo JWT tokens ──
        const { accessToken, refreshToken } = generateTokens(user);

        // ── Lấy operator_id nếu là OPERATOR (match theo email) ──
        let operator_id = null;
        let operator_name = null;
        if (user.role === 'OPERATOR') {
            try {
                const [[op]] = await db.query(
                    'SELECT operator_id, name FROM bus_operator WHERE email = ? LIMIT 1',
                    [user.email]
                );
                if (op) { operator_id = op.operator_id; operator_name = op.name; }
            } catch (_) { /* non-critical */ }
        }

        return res.json({
            message: "Login successful",
            user: {
                user_id:       user.user_id,
                username:      user.username,
                full_name:     user.full_name,
                email:         user.email,
                role:          user.role,
                operator_id:   operator_id,
                operator_name: operator_name
            },
            accessToken,
            refreshToken
        });

    } catch (err) {
        console.error("Login error:", err);
        return res.status(500).json({ message: "Database error" });
    }
};

// =================================
// REFRESH TOKEN
// POST /api/auth/refresh
// Nhận { refreshToken }, trả về accessToken mới
// =================================
exports.refreshToken = async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
        return res.status(400).json({ message: "Thiếu refresh token" });
    }

    try {
        // Xác minh refresh token
        const decoded = jwt.verify(refreshToken, JWT_SECRET);

        // Tạo access token mới từ payload cũ
        const payload = {
            user_id: decoded.user_id,
            role:    decoded.role,
            email:   decoded.email
        };

        const newAccessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRES });

        return res.json({
            message: "Token refreshed",
            accessToken: newAccessToken
        });

    } catch (err) {
        if (err.name === "TokenExpiredError") {
            return res.status(401).json({ message: "Refresh token đã hết hạn, vui lòng đăng nhập lại", expired: true });
        }
        return res.status(401).json({ message: "Refresh token không hợp lệ" });
    }
};

// =================================
// LOGOUT
// POST /api/auth/logout
// Token-based auth là stateless — logout xử lý ở client
// Server chỉ trả về success, client tự xóa token
// =================================
exports.logout = (req, res) => {
    // Với JWT stateless, logout chỉ cần client xóa token
    // Server không cần làm gì thêm (trừ khi dùng token blacklist)
    return res.json({ message: "Đăng xuất thành công" });
};
