const db           = require("../config/db");
const bcrypt       = require("bcryptjs");
const crypto       = require("crypto");
const fs           = require("fs");
const path         = require("path");
const loyaltyService = require("../services/loyaltyService");
const { VALID_ROLES, VALID_STATUSES } = require("../middleware/authMiddleware");
const { sendError } = require("../utils/errors");
const { validatePasswordStrength } = require("../utils/passwordPolicy");
const logger = require('../utils/logger');

logger.info("✅ userController loaded");

const SAFE_SORT_COLS = new Set(["user_id", "full_name", "email", "role", "status", "created_at"]);

/* ═══════════════════════════════════════════
   GET ALL USERS — với pagination, search, filter
═══════════════════════════════════════════ */
exports.getUsers = async (req, res) => {
    try {
        const page   = Math.max(1, parseInt(req.query.page)  || 1);
        const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
        const offset = (page - 1) * limit;
        const search = req.query.search?.trim() || "";
        const role   = req.query.role   || "";
        const status = req.query.status || "";
        const sortBy = SAFE_SORT_COLS.has(req.query.sort) ? req.query.sort : "user_id";
        const order  = req.query.order === "asc" ? "ASC" : "DESC";

        const wheresPlain = []; // unqualified — for the COUNT query (no JOIN, no ambiguity)
        const wheresQualified = []; // u.-prefixed — for the SELECT query (JOINs bus_operator, which also has email/phone/status columns)
        const params = [];

        if (search) {
            wheresPlain.push("(full_name LIKE ? OR email LIKE ? OR phone LIKE ?)");
            wheresQualified.push("(u.full_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)");
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        if (role   && VALID_ROLES.has(role))     { wheresPlain.push("role=?");   wheresQualified.push("u.role=?");   params.push(role); }
        if (status && VALID_STATUSES.has(status)) { wheresPlain.push("status=?"); wheresQualified.push("u.status=?"); params.push(status); }

        const wherePlain = wheresPlain.length ? "WHERE " + wheresPlain.join(" AND ") : "";
        const whereQualified = wheresQualified.length ? "WHERE " + wheresQualified.join(" AND ") : "";

        const [[{ total }]] = await db.query(
            `SELECT COUNT(*) AS total FROM users ${wherePlain}`, params
        );

        const [rows] = await db.query(
            `SELECT u.user_id, u.username, u.full_name, u.email, u.phone, u.gender, u.birth_date,
                    u.province, u.district, u.address_detail, u.role, u.status, u.created_at,
                    u.operator_id, o.name AS operator_name
             FROM users u
             LEFT JOIN bus_operator o ON u.operator_id = o.operator_id
             ${whereQualified}
             ORDER BY u.${sortBy} ${order}
             LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        res.json({
            data: rows,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ═══════════════════════════════════════════
   GET USER BY ID
═══════════════════════════════════════════ */
exports.getUserById = async (req, res) => {
    try {
        const [result] = await db.query(
            `SELECT u.user_id, u.username, u.full_name, u.email, u.phone, u.gender, u.birth_date,
                    u.province, u.district, u.address_detail, u.role, u.status, u.created_at,
                    u.operator_id, o.name AS operator_name,
                    u.id_number, u.default_pickup, u.default_dropoff, u.avatar_url
             FROM users u
             LEFT JOIN bus_operator o ON u.operator_id = o.operator_id
             WHERE u.user_id=?`,
            [req.params.id]
        );
        if (!result.length) return res.status(404).json({ message: "User not found" });
        res.json(result[0]);
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ═══════════════════════════════════════════
   CREATE USER (Admin only)
═══════════════════════════════════════════ */
exports.createUser = async (req, res) => {
    try {
        const { username, full_name, email, phone, province, district, address_detail, role, status, password, operator_id } = req.body;

        if (!full_name || !email) {
            return res.status(400).json({ message: "full_name và email là bắt buộc" });
        }
        if (role && !VALID_ROLES.has(role)) {
            return res.status(422).json({ message: `role không hợp lệ. Phải là: ${[...VALID_ROLES].join(", ")}` });
        }
        if (status && !VALID_STATUSES.has(status)) {
            return res.status(422).json({ message: `status không hợp lệ. Phải là: ${[...VALID_STATUSES].join(", ")}` });
        }
        /* This route is already requireAdmin-gated (userRoutes.js); still
           validate operator_id against a real bus_operator row rather than
           trusting the client's value blindly. */
        let operatorIdValue = null;
        if (operator_id !== undefined && operator_id !== null && operator_id !== "") {
            const [[op]] = await db.query("SELECT operator_id FROM bus_operator WHERE operator_id=?", [operator_id]);
            if (!op) {
                return res.status(422).json({ message: "operator_id không hợp lệ — nhà xe không tồn tại" });
            }
            operatorIdValue = op.operator_id;
        }

        const hashed = await bcrypt.hash(password || "123456", 10);
        const [result] = await db.query(
            `INSERT INTO users (username, full_name, email, password_hash, phone,
              province, district, address_detail, role, status, operator_id, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW())`,
            [
                username || email.split("@")[0],
                full_name, email, hashed,
                phone || null, province || null, district || null, address_detail || null,
                role || "PASSENGER",
                status || "ACTIVE",
                operatorIdValue
            ]
        );
        res.status(201).json({ message: "User created", user_id: result.insertId });
    } catch (err) {
        logger.error(err);
        if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ message: "Email hoặc username đã tồn tại" });
        res.status(500).json({ message: "Insert failed" });
    }
};

/* ═══════════════════════════════════════════
   UPDATE USER
═══════════════════════════════════════════ */
exports.updateUser = async (req, res) => {
    try {
        const userId       = parseInt(req.params.id, 10);
        const requestorId  = req.user?.user_id;
        const requestorRole= req.user?.role;
        const { full_name, email, phone, gender, birth_date, province, district,
                address_detail, role, status, password,
                id_number, default_pickup, default_dropoff } = req.body;

        /* Role/status validation — chỉ ADMIN được đổi */
        if (role !== undefined) {
            if (requestorRole !== "ADMIN") {
                return res.status(403).json({ message: "Chỉ ADMIN mới được thay đổi role" });
            }
            if (!VALID_ROLES.has(role)) {
                return res.status(422).json({ message: `role không hợp lệ: ${[...VALID_ROLES].join(", ")}` });
            }
            /* Không tự hạ quyền admin nếu là admin cuối cùng */
            if (userId === requestorId && role !== "ADMIN") {
                const [[{ cnt }]] = await db.query(
                    "SELECT COUNT(*) AS cnt FROM users WHERE role='ADMIN' AND status='ACTIVE'"
                );
                if (cnt <= 1) {
                    return res.status(409).json({ message: "Không thể hạ quyền admin cuối cùng" });
                }
            }
        }
        if (status !== undefined) {
            if (requestorRole !== "ADMIN") {
                return res.status(403).json({ message: "Chỉ ADMIN mới được thay đổi status" });
            }
            if (!VALID_STATUSES.has(status)) {
                return res.status(422).json({ message: `status không hợp lệ: ${[...VALID_STATUSES].join(", ")}` });
            }
            /* Không tự khóa chính mình */
            if (userId === requestorId && status !== "ACTIVE") {
                return res.status(409).json({ message: "Admin không thể tự khóa tài khoản của mình" });
            }
        }

        /* operator_id — chỉ ADMIN được gán/hủy gán, và operator_id phải trỏ
           tới một bus_operator có thật. Ba trạng thái cần phân biệt: field
           vắng mặt (giữ nguyên), field=null/"" (hủy gán tường minh), field
           là số (gán tường minh) — do đó không dùng được mẫu IFNULL(?,col)
           như role/status ở trên (mẫu đó không biểu diễn được "đặt về NULL"). */
        let operatorIdClause = "";
        let operatorIdValue;
        const hasOperatorIdField = Object.prototype.hasOwnProperty.call(req.body, "operator_id");
        if (hasOperatorIdField) {
            if (requestorRole !== "ADMIN") {
                return res.status(403).json({ message: "Chỉ ADMIN mới được gán nhà xe" });
            }
            const raw = req.body.operator_id;
            if (raw === null || raw === "") {
                operatorIdValue = null;
            } else {
                const [[op]] = await db.query("SELECT operator_id FROM bus_operator WHERE operator_id=?", [raw]);
                if (!op) {
                    return res.status(422).json({ message: "operator_id không hợp lệ — nhà xe không tồn tại" });
                }
                operatorIdValue = op.operator_id;
            }
            operatorIdClause = ",operator_id=?";
        }

        /* Phase 2I Final pass (CRITICAL, found via live testing): every
           field below used to be written unconditionally with a `||null`
           fallback — a partial update that only intended to change one
           field (e.g. the admin "toggle status" quick action, which sends
           only {status}) silently wiped every other field to NULL,
           including email — permanently locking the user out, since
           login() looks the account up by exact email match. Switched to
           the same IFNULL(?, column) "omitted/null = keep existing"
           pattern already used for role/status in this same function. */
        let sql, params;
        if (password) {
            const hashed = await bcrypt.hash(password, 10);
            sql = `UPDATE users SET full_name=IFNULL(?,full_name),email=IFNULL(?,email),
                   phone=IFNULL(?,phone),gender=IFNULL(?,gender),birth_date=IFNULL(?,birth_date),
                   province=IFNULL(?,province),district=IFNULL(?,district),address_detail=IFNULL(?,address_detail),
                   role=IFNULL(?,role),
                   status=IFNULL(?,status),
                   id_number=IFNULL(?,id_number),default_pickup=IFNULL(?,default_pickup),default_dropoff=IFNULL(?,default_dropoff)
                   ${operatorIdClause}, password_hash=? WHERE user_id=?`;
            params = [full_name||null, email||null, phone||null, gender||null, birth_date||null,
                      province||null, district||null, address_detail||null,
                      role||null, status||null,
                      id_number||null, default_pickup||null, default_dropoff||null,
                      ...(hasOperatorIdField ? [operatorIdValue] : []),
                      hashed, userId];
        } else {
            sql = `UPDATE users SET full_name=IFNULL(?,full_name),email=IFNULL(?,email),
                   phone=IFNULL(?,phone),gender=IFNULL(?,gender),birth_date=IFNULL(?,birth_date),
                   province=IFNULL(?,province),district=IFNULL(?,district),address_detail=IFNULL(?,address_detail),
                   role=IFNULL(?,role),
                   status=IFNULL(?,status),
                   id_number=IFNULL(?,id_number),default_pickup=IFNULL(?,default_pickup),default_dropoff=IFNULL(?,default_dropoff)
                   ${operatorIdClause} WHERE user_id=?`;
            params = [full_name||null, email||null, phone||null, gender||null, birth_date||null,
                      province||null, district||null, address_detail||null,
                      role||null, status||null,
                      id_number||null, default_pickup||null, default_dropoff||null,
                      ...(hasOperatorIdField ? [operatorIdValue] : []),
                      userId];
        }

        const [result] = await db.query(sql, params);
        res.json({ message: "Cập nhật thành công", affectedRows: result.affectedRows });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: "Update failed" });
    }
};

/* ═══════════════════════════════════════════
   DELETE USER — soft delete via status=INACTIVE
   Hard delete chỉ nếu user chưa có booking
═══════════════════════════════════════════ */
exports.deleteUser = async (req, res) => {
    try {
        const userId = parseInt(req.params.id, 10);

        /* Không tự xóa chính mình */
        if (req.user?.user_id === userId) {
            return res.status(409).json({ message: "Admin không thể tự xóa tài khoản của mình" });
        }

        /* Kiểm tra admin cuối cùng */
        const [[u]] = await db.query("SELECT role FROM users WHERE user_id=?", [userId]);
        if (!u) return res.status(404).json({ message: "User không tồn tại" });

        if (u.role === "ADMIN") {
            const [[{ cnt }]] = await db.query(
                "SELECT COUNT(*) AS cnt FROM users WHERE role='ADMIN' AND status='ACTIVE'"
            );
            if (cnt <= 1) {
                return res.status(409).json({ message: "Không thể xóa admin cuối cùng" });
            }
        }

        /* Kiểm tra có booking không */
        const [[{ bookingCount }]] = await db.query(
            "SELECT COUNT(*) AS bookingCount FROM booking WHERE user_id=?", [userId]
        );

        if (bookingCount > 0) {
            /* Có lịch sử — soft delete */
            await db.query("UPDATE users SET status='INACTIVE' WHERE user_id=?", [userId]);
            return res.json({ message: "Tài khoản đã bị vô hiệu hóa (có lịch sử giao dịch)", soft: true });
        }

        /* Không có lịch sử — hard delete */
        await db.query("DELETE FROM users WHERE user_id=?", [userId]);
        res.json({ message: "Đã xóa user", soft: false });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: "Delete failed" });
    }
};

/* ═══════════════════════════════════════════
   USER LOYALTY
═══════════════════════════════════════════ */
exports.getUserLoyalty = async (req, res) => {
    try {
        const data = await loyaltyService.getUserLoyalty(db, req.params.id);
        res.json(data);
    } catch (err) {
        logger.error("GET LOYALTY ERROR:", err);
        res.status(500).json({ message: "Lỗi lấy dữ liệu loyalty" });
    }
};

/* ═══════════════════════════════════════════
   REDEEM POINTS
═══════════════════════════════════════════ */
exports.redeemPoints = async (req, res) => {
    try {
        const { points } = req.body;
        if (!points || points <= 0) return res.status(400).json({ message: "Số điểm không hợp lệ" });
        const result = await loyaltyService.redeemPoints(db, req.params.id, points);
        res.json({ message: "Đổi điểm thành công", ...result });
    } catch (err) {
        sendError(res, err, "REDEEM POINTS", 500, "Lỗi đổi điểm");
    }
};

/* ═══════════════════════════════════════════
   USER STATS
═══════════════════════════════════════════ */
exports.getUserStats = async (req, res) => {
    try {
        const uid = req.params.id;
        const [[stats]] = await db.query(`
            SELECT
              COUNT(*) AS total_trips,
              SUM(CASE WHEN status IN ('PAID','COMPLETED') THEN 1 ELSE 0 END) AS completed,
              SUM(CASE WHEN status = 'CANCELED' THEN 1 ELSE 0 END) AS canceled,
              SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pending,
              COALESCE(SUM(CASE WHEN status IN ('PAID','COMPLETED') THEN total_amount ELSE 0 END),0) AS total_spent,
              ROUND(
                SUM(CASE WHEN status IN ('PAID','COMPLETED') THEN 1 ELSE 0 END)*100.0
                / NULLIF(COUNT(*),0), 1
              ) AS success_rate,
              SUM(CASE WHEN YEAR(booking_time)=YEAR(NOW()) AND MONTH(booking_time)=MONTH(NOW()) THEN 1 ELSE 0 END) AS this_month,
              SUM(CASE WHEN YEAR(booking_time)=YEAR(NOW()) THEN 1 ELSE 0 END) AS this_year
            FROM booking WHERE user_id=?
        `, [uid]);
        const [[u]] = await db.query(`SELECT loyalty_points FROM users WHERE user_id=?`, [uid]);
        res.json({ ...stats, loyalty_points: u?.loyalty_points || 0 });
    } catch (err) {
        logger.error("GET STATS ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ═══════════════════════════════════════════
   MONTHLY STATS
═══════════════════════════════════════════ */
exports.getMonthlyStats = async (req, res) => {
    try {
        const uid = req.params.id;
        const [rows] = await db.query(`
            SELECT
              MONTH(booking_time) AS month,
              COUNT(*) AS trips,
              COALESCE(SUM(CASE WHEN status IN ('PAID','COMPLETED') THEN total_amount ELSE 0 END),0) AS spending,
              COALESCE(SUM(CASE WHEN status IN ('PAID','COMPLETED') THEN FLOOR(total_amount/100000) ELSE 0 END),0) AS points
            FROM booking
            WHERE user_id=? AND YEAR(booking_time)=YEAR(NOW())
            GROUP BY MONTH(booking_time)
            ORDER BY month
        `, [uid]);
        res.json(rows);
    } catch (err) {
        logger.error("GET MONTHLY STATS ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ═══════════════════════════════════════════
   TRAVEL PROFILE
═══════════════════════════════════════════ */
exports.getTravelProfile = async (req, res) => {
    try {
        const uid = req.params.id;
        const [favRoutes] = await db.query(`
            SELECT CONCAT(r.origin,' → ',r.destination) AS route, COUNT(*) AS cnt
            FROM booking b
            JOIN trip t ON b.trip_id=t.trip_id
            JOIN route r ON t.route_id=r.route_id
            WHERE b.user_id=? AND b.status IN ('PAID','COMPLETED')
            GROUP BY route ORDER BY cnt DESC LIMIT 1
        `, [uid]);
        const [favOps] = await db.query(`
            SELECT o.name AS company_name, COUNT(*) AS cnt
            FROM booking b
            JOIN trip t ON b.trip_id=t.trip_id
            JOIN bus bs ON t.bus_id=bs.bus_id
            JOIN bus_operator o ON bs.operator_id=o.operator_id
            WHERE b.user_id=? AND b.status IN ('PAID','COMPLETED')
            GROUP BY o.name ORDER BY cnt DESC LIMIT 1
        `, [uid]);
        const [[tc]] = await db.query(`
            SELECT COALESCE(SUM(r.distance_km),0) AS total_km
            FROM booking b
            JOIN trip t ON b.trip_id=t.trip_id
            JOIN route r ON t.route_id=r.route_id
            WHERE b.user_id=? AND b.status IN ('PAID','COMPLETED')
        `, [uid]);
        const [topDeps] = await db.query(`
            SELECT r.origin AS city, COUNT(*) AS cnt
            FROM booking b
            JOIN trip t ON b.trip_id=t.trip_id
            JOIN route r ON t.route_id=r.route_id
            WHERE b.user_id=? AND b.status IN ('PAID','COMPLETED')
            GROUP BY city ORDER BY cnt DESC LIMIT 3
        `, [uid]);
        res.json({
            km_traveled: Math.round(tc?.total_km || 0),
            favorite_route: favRoutes[0]?.route || null,
            favorite_operator: favOps[0]?.company_name || null,
            top_cities: topDeps.map(r => r.city)
        });
    } catch (err) {
        logger.error("GET TRAVEL PROFILE ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ═══════════════════════════════════════════
   CHANGE PASSWORD (Sprint 7)
   PUT /api/users/:id/password — { current_password, new_password }
   This endpoint did not exist at all before Sprint 7: profile.html's
   change-password modal (public/pages/passenger/profile.html) has been
   calling it since it was built, meaning every "change password" attempt
   from a passenger's own profile page has always 404'd.
═══════════════════════════════════════════ */
exports.changePassword = async (req, res) => {
    try {
        const userId = parseInt(req.params.id, 10);
        const { current_password, new_password } = req.body;
        if (!new_password) {
            return res.status(400).json({ message: "Thiếu mật khẩu mới" });
        }
        const strength = validatePasswordStrength(new_password);
        if (!strength.valid) {
            return res.status(422).json({ message: strength.message });
        }

        const [[user]] = await db.query("SELECT user_id, password_hash FROM users WHERE user_id=?", [userId]);
        if (!user) return res.status(404).json({ message: "User not found" });

        /* Self-service (the caller changing their own password) must prove
           they know the current one. An ADMIN acting on someone else's
           account (requireSelfOrAdmin already guarded this route) has no
           legitimate way to know the target's current password and isn't
           asked for it — same asymmetry as the rest of this controller's
           role/status fields, which are also ADMIN-only-no-proof-required. */
        const isSelf = req.user && req.user.user_id === userId;
        if (isSelf) {
            if (!current_password) {
                return res.status(400).json({ message: "Thiếu mật khẩu hiện tại" });
            }
            const matches = await bcrypt.compare(current_password, user.password_hash || "");
            if (!matches) {
                return res.status(401).json({ message: "Mật khẩu hiện tại không đúng" });
            }
        }

        const hashedPassword = await bcrypt.hash(new_password, 12);
        /* Same as resetPassword — invalidate every session logged in
           before this change, everywhere, not just the tab that changed it. */
        await db.query(
            "UPDATE users SET password_hash=?, token_version = token_version + 1 WHERE user_id=?",
            [hashedPassword, userId]
        );
        res.json({ message: "Đổi mật khẩu thành công" });
    } catch (err) {
        logger.error("CHANGE PASSWORD ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ═══════════════════════════════════════════
   STATS SUMMARY (Sprint 6 — Passenger Analytics)
   Composes the three EXISTING endpoints above (getUserStats,
   getTravelProfile, loyaltyService.getUserLoyalty) into the one
   consolidated response a profile page actually wants — total trips,
   total spent/loyalty points accumulated, most-traveled route, and
   membership tier — without duplicating any of their SQL. Each inner
   call is invoked with a throwaway `res` that captures the JSON instead
   of sending it, so this reuses the real, already-tested query logic
   verbatim rather than re-deriving it.
═══════════════════════════════════════════ */
function _capture() {
    const fake = { status(c) { fake._status = c; return fake; }, json(body) { fake._body = body; return fake; } };
    return fake;
}

exports.getStatsSummary = async (req, res) => {
    try {
        const uid = req.params.id;
        const statsRes = _capture();
        const profileRes = _capture();
        await exports.getUserStats({ params: { id: uid } }, statsRes);
        await exports.getTravelProfile({ params: { id: uid } }, profileRes);
        const loyalty = await loyaltyService.getUserLoyalty(db, uid);

        res.json({
            total_trips: statsRes._body?.completed || 0,
            total_spent: statsRes._body?.total_spent || 0,
            favorite_route: profileRes._body?.favorite_route || null,
            km_traveled: profileRes._body?.km_traveled || 0,
            loyalty_points: loyalty.points,
            membership_tier: loyalty.tier,
            membership_tier_label: loyalty.tierLabel,
            tier_discount_pct: loyalty.tierDiscount,
            next_tier: loyalty.nextTier,
            next_tier_at: loyalty.nextTierAt,
            tier_progress_pct: loyalty.progress,
        });
    } catch (err) {
        logger.error("GET STATS SUMMARY ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ═══════════════════════════════════════════
   SAVED PASSENGERS (Sprint 6 — companion list)
   requireSelfOrAdmin on every route (see userRoutes.js) already ensures
   :id is the caller's own user_id or an admin — no separate ownership
   check needed here beyond scoping every query to user_id=:id.
═══════════════════════════════════════════ */
exports.getSavedPassengers = async (req, res) => {
    try {
        const [rows] = await db.query(
            "SELECT saved_passenger_id, full_name, phone, email, id_number, relationship, created_at FROM saved_passenger WHERE user_id=? ORDER BY created_at DESC",
            [req.params.id]
        );
        res.json(rows);
    } catch (err) {
        logger.error("GET SAVED PASSENGERS ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

exports.addSavedPassenger = async (req, res) => {
    try {
        const { full_name, phone, email, id_number, relationship } = req.body;
        if (!full_name || !full_name.trim()) {
            return res.status(400).json({ message: "Thiếu họ tên" });
        }
        const [existing] = await db.query("SELECT COUNT(*) AS cnt FROM saved_passenger WHERE user_id=?", [req.params.id]);
        if (existing[0].cnt >= 20) {
            return res.status(422).json({ message: "Đã đạt giới hạn 20 hành khách đã lưu" });
        }
        const [result] = await db.query(
            "INSERT INTO saved_passenger (user_id, full_name, phone, email, id_number, relationship) VALUES (?,?,?,?,?,?)",
            [req.params.id, full_name.trim(), phone || null, email || null, id_number || null, relationship || null]
        );
        res.status(201).json({ message: "Đã lưu hành khách", saved_passenger_id: result.insertId });
    } catch (err) {
        logger.error("ADD SAVED PASSENGER ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

exports.deleteSavedPassenger = async (req, res) => {
    try {
        const [result] = await db.query(
            "DELETE FROM saved_passenger WHERE saved_passenger_id=? AND user_id=?",
            [req.params.passengerId, req.params.id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ message: "Không tìm thấy hành khách đã lưu" });
        res.json({ message: "Đã xóa hành khách" });
    } catch (err) {
        logger.error("DELETE SAVED PASSENGER ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ═══════════════════════════════════════════
   NOTIFICATIONS
═══════════════════════════════════════════ */
exports.getNotifications = async (req, res) => {
    try {
        const uid = req.params.id;
        const [upcoming] = await db.query(`
            SELECT b.booking_id, b.booking_code, r.origin, r.destination, t.departure_time
            FROM booking b
            JOIN trip t ON b.trip_id=t.trip_id
            JOIN route r ON t.route_id=r.route_id
            WHERE b.user_id=? AND b.status='PAID'
              AND t.departure_time > NOW()
              AND t.departure_time < DATE_ADD(NOW(), INTERVAL 48 HOUR)
            ORDER BY t.departure_time LIMIT 5
        `, [uid]);
        const [pending] = await db.query(`
            SELECT b.booking_id, b.booking_code, r.origin, r.destination, t.departure_time
            FROM booking b
            JOIN trip t ON b.trip_id=t.trip_id
            JOIN route r ON t.route_id=r.route_id
            WHERE b.user_id=? AND b.status='PENDING'
              AND t.departure_time > NOW()
            ORDER BY t.departure_time LIMIT 3
        `, [uid]);
        res.json([
            ...upcoming.map(u => ({
                type: "departure", dot: "green",
                title: "Chuyến sắp khởi hành",
                message: `${u.origin} → ${u.destination}`,
                time: u.departure_time, code: u.booking_code
            })),
            ...pending.map(p => ({
                type: "payment", dot: "warn",
                title: "Vé chờ thanh toán",
                message: `${p.origin} → ${p.destination}`,
                time: p.departure_time, code: p.booking_code
            }))
        ]);
    } catch (err) {
        logger.error("GET NOTIFICATIONS ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ═══════════════════════════════════════════
   AVATAR SYNC ENGINE (Sprint 8)
   POST /api/users/:id/avatar — two accepted shapes:
     { avatar_url: "https://..." }   — reuse an existing image (e.g. the
                                        Google/Facebook picture already on
                                        the account, or any public URL)
     { image_base64: "data:image/png;base64,...." } — a file the user picked
                                        locally, saved under
                                        /public/uploads/avatars/
   Only http(s) URLs are accepted for the direct-URL path — rejects
   data:/javascript:/other schemes being stuffed into a column that's
   rendered as an <img src>. File uploads are validated by their declared
   MIME type in the data-URI header (not by a client-supplied filename/
   extension, which would be trivially spoofable) and capped at 2MB.
═══════════════════════════════════════════ */
const AVATAR_DIR = path.join(__dirname, "../../public/uploads/avatars");
const AVATAR_MIME_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2MB

exports.uploadAvatar = async (req, res) => {
    try {
        const userId = parseInt(req.params.id, 10);
        const { avatar_url, image_base64 } = req.body;

        let finalUrl;

        if (image_base64) {
            const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(image_base64.trim());
            if (!match) {
                return res.status(422).json({ message: "Ảnh không hợp lệ — chỉ hỗ trợ PNG, JPEG, WEBP, GIF" });
            }
            const [, mime, b64] = match;
            const buffer = Buffer.from(b64, "base64");
            if (buffer.length > MAX_AVATAR_BYTES) {
                return res.status(413).json({ message: "Ảnh quá lớn — tối đa 2MB" });
            }
            const ext = AVATAR_MIME_EXT[mime];
            const filename = `${userId}_${crypto.randomBytes(8).toString("hex")}.${ext}`;
            fs.mkdirSync(AVATAR_DIR, { recursive: true });
            fs.writeFileSync(path.join(AVATAR_DIR, filename), buffer);
            finalUrl = `/uploads/avatars/${filename}`;
        } else if (avatar_url) {
            const trimmed = avatar_url.trim();
            if (!/^https?:\/\//i.test(trimmed) || trimmed.length > 500) {
                return res.status(422).json({ message: "avatar_url phải là đường dẫn http(s) hợp lệ, tối đa 500 ký tự" });
            }
            finalUrl = trimmed;
        } else {
            return res.status(400).json({ message: "Thiếu avatar_url hoặc image_base64" });
        }

        await db.query("UPDATE users SET avatar_url=? WHERE user_id=?", [finalUrl, userId]);
        res.json({ message: "Cập nhật ảnh đại diện thành công", avatar_url: finalUrl });
    } catch (err) {
        logger.error("UPLOAD AVATAR ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};
