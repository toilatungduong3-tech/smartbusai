/**
 * SmartBusAI — Auth Controller
 * Xử lý đăng ký, đăng nhập, refresh token, đăng xuất
 */

const db      = require("../config/db");
const bcrypt  = require("bcryptjs");
const jwt     = require("jsonwebtoken");
const crypto  = require("crypto");
const emailService = require("../services/emailService");
const { validatePasswordStrength } = require("../utils/passwordPolicy");
const logger = require('../utils/logger');

// Khóa bí mật JWT — nguồn duy nhất, xem server/config/jwtSecret.js
const JWT_SECRET = require("../config/jwtSecret");

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
        email:   user.email,
        // Sprint 7 — real server-side logout: embedded so authenticate()/
        // refreshToken() can reject any token minted before the user's
        // most recent logout. Defaults to 0 for callers that don't have
        // it on hand (matches the column's DEFAULT 0).
        token_version: user.token_version || 0,
    };

    const accessToken  = jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRES });
    const refreshToken = jwt.sign(payload, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRES });

    return { accessToken, refreshToken };
}

// =================================
// F-16: CHECK EMAIL — nay đồng thời sinh & gửi mã đặt lại mật khẩu
// (giữ nguyên tên route/endpoint để không phá frontend hiện có,
//  nhưng hành vi đổi từ "chỉ kiểm tra tồn tại" sang "phát hành token").
// Luôn trả về cùng một thông báo bất kể tài khoản có tồn tại hay không,
// để không lộ thông tin tài khoản (loại bỏ user-enumeration oracle).
//
// Sprint 10: nhận `account_identifier` — có thể là email, username, hoặc
// số điện thoại — thay vì chỉ email (vẫn nhận `email` cho tương thích
// ngược). Tra cứu WHERE email=? OR username=? OR phone=?.
//
// Bảo mật (chủ động không làm theo đúng nghĩa đen yêu cầu "sinh Reset
// Token cấp tốc trả về cho phiên làm việc" khi tra bằng username/SĐT):
// hệ thống này không có xác thực SMS OTP hay câu hỏi bảo mật thật — nếu
// trả token đặt lại mật khẩu trực tiếp về response chỉ vì ai đó biết
// username hoặc SĐT (cả hai đều là thông tin công khai/dễ đoán hơn
// email), bất kỳ ai cũng chiếm được tài khoản người khác mà không cần
// chứng minh sở hữu gì cả. Vì mọi tài khoản trong hệ thống này đều bắt
// buộc có email (register()/OAuth luôn yêu cầu), token đặt lại LUÔN được
// gửi qua email đã lưu của tài khoản — dù người dùng tra bằng username
// hay SĐT — giữ nguyên cơ chế "chỉ người sở hữu hộp thư mới đặt lại
// được mật khẩu" đã có từ Sprint 7.
// =================================
const RESET_TOKEN_TTL_MIN = 15;
const GENERIC_RESET_MESSAGE = "Nếu tài khoản tồn tại trong hệ thống, mã xác nhận đặt lại mật khẩu đã được gửi tới email đã đăng ký (có hiệu lực 15 phút).";

exports.checkEmail = async (req, res) => {
    const identifier = (req.body.account_identifier ?? req.body.email ?? "").trim();
    if (!identifier) return res.status(400).json({ message: "Thiếu email, tên đăng nhập hoặc số điện thoại" });
    try {
        const [rows] = await db.query(
            "SELECT user_id, full_name, email FROM users WHERE email = ? OR username = ? OR phone = ? LIMIT 1",
            [identifier, identifier, identifier]
        );
        if (rows.length > 0 && rows[0].email) {
            const user = rows[0];
            const rawToken  = crypto.randomBytes(32).toString("hex");
            const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
            const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MIN * 60 * 1000);

            // Vô hiệu hóa mọi token cũ chưa dùng của user này trước khi phát hành token mới.
            await db.query(
                "UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL",
                [user.user_id]
            );
            await db.query(
                "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
                [user.user_id, tokenHash, expiresAt]
            );

            // Demo/dev: in token ra console vì SMTP thật chưa được cấu hình
            // (transporter dùng Ethereal — hộp thư giả nhưng có thật, xem log
            // để lấy link xem trước). KHÔNG giả vờ đã gửi email thật.
            // Phase 2I Step 3: guarded so a production deploy (NODE_ENV=production)
            // never writes the raw token to logs.
            if (process.env.NODE_ENV !== 'production') {
                logger.info(`🔑 [PasswordReset] Token cho ${user.email}: ${rawToken} (hết hạn sau ${RESET_TOKEN_TTL_MIN} phút)`);
            }
            try {
                await emailService.sendPasswordReset(user, rawToken);
            } catch (mailErr) {
                logger.error("[checkEmail] gửi email thất bại (không ảnh hưởng phản hồi):", mailErr.message);
            }
        }
        return res.json({ message: GENERIC_RESET_MESSAGE });
    } catch (err) {
        logger.error("Check email error:", err);
        return res.status(500).json({ message: "Database error" });
    }
};

// =================================
// F-16: RESET PASSWORD — yêu cầu token hợp lệ, chưa dùng, chưa hết hạn.
// Lưu mật khẩu mới dưới dạng bcrypt hash.
// =================================
exports.resetPassword = async (req, res) => {
    const { token, new_password } = req.body;
    if (!token || !new_password) {
        return res.status(400).json({ message: "Thiếu thông tin bắt buộc" });
    }
    const strength = validatePasswordStrength(new_password);
    if (!strength.valid) {
        return res.status(422).json({ message: strength.message });
    }
    try {
        const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
        const [[record]] = await db.query(
            "SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ?",
            [tokenHash]
        );
        if (!record) return res.status(400).json({ message: "Mã xác nhận không hợp lệ" });
        if (record.used_at) return res.status(400).json({ message: "Mã xác nhận đã được sử dụng" });
        if (new Date(record.expires_at) < new Date()) {
            return res.status(400).json({ message: "Mã xác nhận đã hết hạn" });
        }

        // Đánh dấu đã dùng NGAY, có điều kiện used_at IS NULL để chống dùng lại
        // đồng thời (race condition) — chỉ tiếp tục nếu chính request này "thắng".
        const [updResult] = await db.query(
            "UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ? AND used_at IS NULL",
            [record.id]
        );
        if (updResult.affectedRows !== 1) {
            return res.status(400).json({ message: "Mã xác nhận đã được sử dụng" });
        }

        const hashedPassword = await bcrypt.hash(new_password, 12);
        /* Sprint 7: also bump token_version — a password reset most often
           means the old password (and anything logged in with it) is no
           longer trusted; every session logged in before this reset is
           invalidated the same way logout() does it. */
        await db.query(
            "UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE user_id = ?",
            [hashedPassword, record.user_id]
        );

        return res.json({ message: "Đặt lại mật khẩu thành công" });
    } catch (err) {
        logger.error("Reset password error:", err);
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

    if (!username || !full_name || !email || !password) {
        return res.status(400).json({ message: "Missing required fields" });
    }

    /* Sprint 7: register.html's client-side submit guard only checks
       password.length>=8 — it never re-checks the other 3 criteria its
       own strength meter displays (uppercase/digit/symbol) before
       submitting, and there was no server-side enforcement at all, so a
       weak password like "aaaaaaaa" was previously accepted outright. */
    const strength = validatePasswordStrength(password);
    if (!strength.valid) {
        return res.status(422).json({ message: strength.message });
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
        logger.error("Register error:", err);
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
                    logger.info(`[Auth] Migrated plain text password to bcrypt for user_id=${user.user_id}`);
                } catch (migrateErr) {
                    // Không dừng đăng nhập nếu migration thất bại
                    logger.error("[Auth] Password migration error:", migrateErr);
                }
            }
        }

        if (!passwordValid) {
            return res.status(401).json({ message: "Email or password incorrect" });
        }

        /* Sprint 3 — MASTER_COMPLETION_MATRIX.md blocker: admin's "block
           user" toggle (users.status='BLOCKED') previously had zero effect
           at login — this was the only place account status could have
           been checked and never was. A blocked user could log in fresh at
           any time after being blocked. */
        if (user.status !== "ACTIVE") {
            return res.status(403).json({ message: "Tài khoản đã bị khóa. Vui lòng liên hệ hỗ trợ." });
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

        /* Phase 2I: operator identity now comes from the explicit
           users.operator_id -> bus_operator.operator_id FK (migrate_v8.sql),
           not from matching users.email against bus_operator.email — that
           scheme silently failed whenever the two addresses legitimately
           differed (e.g. a staff email vs. the company's contact email)
           and had no database-level integrity guarantee. operator_id/
           operator_name here are for DISPLAY ONLY (shown in the frontend
           header); the authoritative authorization lookup happens
           per-request in operatorScope.js, from the same FK. */
        let operator_id = null;
        let operator_name = null;
        if (user.role === 'OPERATOR' && user.operator_id != null) {
            try {
                const [[op]] = await db.query(
                    'SELECT operator_id, name FROM bus_operator WHERE operator_id = ? LIMIT 1',
                    [user.operator_id]
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
                avatar_url:    user.avatar_url || null,
                operator_id:   operator_id,
                operator_name: operator_name
            },
            accessToken,
            refreshToken
        });

    } catch (err) {
        logger.error("Login error:", err);
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

        /* Sprint 3 — a refresh token issued before a user was blocked
           remains valid (by JWT design) for up to 7 days; without this
           check, a blocked user could keep minting fresh 15-minute access
           tokens for the full refresh-token lifetime, making the block
           toggle meaningless for up to a week. Re-verified against the DB
           on every refresh — not trusted from the token payload, since the
           whole point is to catch a status change that happened *after*
           the token was issued. */
        const [[user]] = await db.query("SELECT status, token_version FROM users WHERE user_id = ?", [decoded.user_id]);
        if (!user || user.status !== "ACTIVE") {
            return res.status(403).json({ message: "Tài khoản đã bị khóa. Vui lòng liên hệ hỗ trợ." });
        }
        /* Sprint 7 — real server-side logout: a refresh token minted before
           the user's most recent logout carries a stale token_version and
           is rejected here, even though its signature/expiry are still
           valid. (decoded.token_version||0) treats a pre-Sprint-7 token
           (minted before this field existed) as version 0, matching the
           column's own DEFAULT 0 — so already-logged-in sessions at
           deploy time aren't retroactively logged out. */
        if ((decoded.token_version || 0) !== (user.token_version || 0)) {
            return res.status(401).json({ message: "Phiên đăng nhập đã bị vô hiệu hóa, vui lòng đăng nhập lại", expired: true });
        }

        // Tạo access token mới từ payload cũ
        const payload = {
            user_id: decoded.user_id,
            role:    decoded.role,
            email:   decoded.email,
            token_version: user.token_version || 0,
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
// POST /api/auth/logout  (requires authenticate — see authRoutes.js)
//
// Sprint 7 — was a pure no-op ("Server chỉ trả về success, client tự xóa
// token"): a stolen access token stayed valid for its remaining 15-minute
// lifetime and a stolen refresh token for the full 7 days, regardless of
// the legitimate user logging out. Now increments users.token_version,
// which authenticate()/refreshToken() compare against the token's own
// embedded value on every request — instantly invalidates every
// previously-issued access AND refresh token for this user, everywhere
// (no per-device session tracking exists in this stateless-JWT design, so
// this is "log out everywhere", the same semantic as changing a password).
// =================================
exports.logout = async (req, res) => {
    try {
        await db.query("UPDATE users SET token_version = token_version + 1 WHERE user_id = ?", [req.user.user_id]);
        return res.json({ message: "Đăng xuất thành công" });
    } catch (err) {
        logger.error("Logout error:", err.message);
        // Never block the client from clearing its own local tokens just
        // because the revocation write failed — fail open on the response,
        // the tokens still naturally expire within 15m/7d regardless.
        return res.json({ message: "Đăng xuất thành công" });
    }
};

// =================================
// GOOGLE OAUTH
// POST /api/auth/google
// Nhận { credential } từ Google Identity Services
// Tạo/tìm tài khoản, trả về JWT của hệ thống
// =================================
exports.googleAuth = async (req, res) => {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ message: "Thiếu Google credential" });

    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID === "YOUR_GOOGLE_CLIENT_ID_HERE") {
        return res.status(503).json({ message: "Google OAuth chưa được cấu hình trên server" });
    }

    try {
        const { OAuth2Client } = require("google-auth-library");
        const client = new OAuth2Client(GOOGLE_CLIENT_ID);
        const ticket = await client.verifyIdToken({
            idToken: credential,
            audience: GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const { email, name, picture, sub: googleId } = payload;

        // Tìm user theo email
        const [rows] = await db.query(
            "SELECT user_id, full_name, email, role, status, operator_id, token_version, avatar_url FROM users WHERE email = ?",
            [email]
        );

        let user;
        if (rows.length > 0) {
            user = rows[0];
            /* Sprint 7 fix: was checking status === "BANNED", a value that
               has never existed in this schema (users.status is
               enum('ACTIVE','BLOCKED','INACTIVE') — migrate_v11.sql) — so
               this check could never fire, and a BLOCKED user could log
               back in via Google, completely bypassing the same
               account-block enforcement login()/authenticate()/
               refreshToken() all correctly apply. Matches login()'s check
               exactly now. */
            if (user.status !== "ACTIVE") {
                return res.status(403).json({ message: "Tài khoản đã bị khóa. Vui lòng liên hệ hỗ trợ." });
            }
        } else {
            // Tạo tài khoản mới với role PASSENGER, status ACTIVE (default),
            // mật khẩu ngẫu nhiên an toàn (không phải placeholder đoán được)
            // — tài khoản này chỉ có thể đăng nhập qua Google, không qua
            // form mật khẩu thường, nhưng một giá trị ngẫu nhiên thật vẫn
            // an toàn hơn một chuỗi cố định nếu logic đăng nhập từng thay đổi.
            // avatar_url: Google's own ID-token payload already carries a
            // profile picture URL — captured once at signup, same as
            // full_name; a later manual upload (POST /api/users/:id/avatar)
            // simply overwrites this column, no special-casing needed.
            const username = email.split("@")[0].replace(/[^a-z0-9]/gi, "") + "_gg";
            const randomPassword = crypto.randomBytes(32).toString("hex");
            const passwordHash = await bcrypt.hash(randomPassword, 12);
            const [result] = await db.query(
                `INSERT INTO users (username, full_name, email, password_hash, role, status, avatar_url)
                 VALUES (?, ?, ?, ?, 'PASSENGER', 'ACTIVE', ?)`,
                [username, name || email, email, passwordHash, picture || null]
            );
            user = { user_id: result.insertId, full_name: name, email, role: "PASSENGER", operator_id: null, token_version: 0, avatar_url: picture || null };
        }

        const { accessToken, refreshToken } = generateTokens(user);

        // Same DISPLAY-ONLY operator lookup as login() — authoritative
        // authorization still comes from operatorScope.js on every request.
        let operator_id = null, operator_name = null;
        if (user.role === 'OPERATOR' && user.operator_id != null) {
            try {
                const [[op]] = await db.query('SELECT operator_id, name FROM bus_operator WHERE operator_id = ? LIMIT 1', [user.operator_id]);
                if (op) { operator_id = op.operator_id; operator_name = op.name; }
            } catch (_) { /* non-critical */ }
        }

        return res.json({
            message: "Đăng nhập Google thành công",
            user: {
                user_id:  user.user_id,
                full_name: user.full_name,
                email:    user.email,
                role:     user.role,
                avatar_url: user.avatar_url || null,
                operator_id,
                operator_name,
            },
            accessToken,
            refreshToken,
        });
    } catch (err) {
        logger.error("Google auth error:", err.message);
        return res.status(401).json({ message: "Google token không hợp lệ hoặc đã hết hạn" });
    }
};

// =================================
// FACEBOOK LOGIN
// POST /api/auth/facebook
// Nhận { accessToken } từ Facebook JS SDK (FB.login()), xác thực trực
// tiếp qua Facebook Graph API — cùng cách tiếp cận "xác thực thủ công,
// không cần framework nặng" như googleAuth() ở trên (dùng
// google-auth-library trực tiếp thay vì Passport.js); Facebook có REST
// API tương đương nên không cần thêm passport-facebook làm dependency mới.
// Tạo/tìm tài khoản, trả về JWT của hệ thống — cùng luồng find-or-create
// như Google (role PASSENGER, status ACTIVE, mật khẩu ngẫu nhiên an toàn).
// =================================
exports.facebookAuth = async (req, res) => {
    const { accessToken: fbAccessToken } = req.body;
    if (!fbAccessToken) return res.status(400).json({ message: "Thiếu Facebook access token" });

    const FACEBOOK_APP_ID     = process.env.FACEBOOK_APP_ID;
    const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
    if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET
        || FACEBOOK_APP_ID === "YOUR_FACEBOOK_APP_ID_HERE") {
        return res.status(503).json({ message: "Facebook Login chưa được cấu hình trên server" });
    }

    try {
        /* Bước 1 — xác thực token thuộc đúng app này (không phải token bị
           đánh cắp/replay từ một Facebook App khác), qua debug_token với
           app access token (app_id|app_secret) — cùng nguyên tắc như
           Google's `audience: GOOGLE_CLIENT_ID` check. */
        const appToken = `${FACEBOOK_APP_ID}|${FACEBOOK_APP_SECRET}`;
        const debugUrl = `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(fbAccessToken)}&access_token=${encodeURIComponent(appToken)}`;
        const debugRes = await fetch(debugUrl);
        const debugJson = await debugRes.json();
        const tokenData = debugJson && debugJson.data;
        if (!tokenData || !tokenData.is_valid || String(tokenData.app_id) !== String(FACEBOOK_APP_ID)) {
            return res.status(401).json({ message: "Facebook token không hợp lệ hoặc đã hết hạn" });
        }

        /* Bước 2 — lấy hồ sơ thật (id/tên/email/ảnh đại diện) bằng chính
           token của user. picture.data.url is Graph API's documented shape
           for the ?fields=picture expansion (not a flat field). */
        const profileUrl = `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${encodeURIComponent(fbAccessToken)}`;
        const profileRes = await fetch(profileUrl);
        const profile = await profileRes.json();
        if (!profile || profile.error) {
            return res.status(401).json({ message: "Không lấy được hồ sơ Facebook" });
        }
        const { id: facebookId, name, email } = profile;
        const picture = profile.picture && profile.picture.data && profile.picture.data.url || null;
        /* Một số tài khoản Facebook không cấp quyền email (hoặc không có
           email xác thực) — toàn bộ hệ thống này định danh tài khoản qua
           email (users.email UNIQUE), nên không thể tạo/tìm tài khoản nếu
           thiếu. Từ chối rõ ràng thay vì tạo một tài khoản không có email. */
        if (!email) {
            return res.status(422).json({ message: "Tài khoản Facebook này chưa cấp quyền chia sẻ email — vui lòng dùng email/mật khẩu hoặc Google" });
        }

        const [rows] = await db.query(
            "SELECT user_id, full_name, email, role, status, operator_id, token_version, avatar_url FROM users WHERE email = ?",
            [email]
        );

        let user;
        if (rows.length > 0) {
            user = rows[0];
            if (user.status !== "ACTIVE") {
                return res.status(403).json({ message: "Tài khoản đã bị khóa. Vui lòng liên hệ hỗ trợ." });
            }
        } else {
            const username = email.split("@")[0].replace(/[^a-z0-9]/gi, "") + "_fb";
            const randomPassword = crypto.randomBytes(32).toString("hex");
            const passwordHash = await bcrypt.hash(randomPassword, 12);
            const [result] = await db.query(
                `INSERT INTO users (username, full_name, email, password_hash, role, status, avatar_url)
                 VALUES (?, ?, ?, ?, 'PASSENGER', 'ACTIVE', ?)`,
                [username, name || email, email, passwordHash, picture]
            );
            user = { user_id: result.insertId, full_name: name, email, role: "PASSENGER", operator_id: null, token_version: 0, avatar_url: picture };
        }

        const { accessToken, refreshToken } = generateTokens(user);

        let operator_id = null, operator_name = null;
        if (user.role === 'OPERATOR' && user.operator_id != null) {
            try {
                const [[op]] = await db.query('SELECT operator_id, name FROM bus_operator WHERE operator_id = ? LIMIT 1', [user.operator_id]);
                if (op) { operator_id = op.operator_id; operator_name = op.name; }
            } catch (_) { /* non-critical */ }
        }

        return res.json({
            message: "Đăng nhập Facebook thành công",
            user: {
                user_id:  user.user_id,
                full_name: user.full_name,
                email:    user.email,
                role:     user.role,
                avatar_url: user.avatar_url || null,
                operator_id,
                operator_name,
            },
            accessToken,
            refreshToken,
        });
    } catch (err) {
        logger.error("Facebook auth error:", err.message);
        return res.status(401).json({ message: "Facebook token không hợp lệ hoặc đã hết hạn" });
    }
};
