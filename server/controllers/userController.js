console.log("✅ userController loaded");

const db           = require("../config/db");
const bcrypt       = require("bcryptjs");
const loyaltyService = require("../services/loyaltyService");
const { VALID_ROLES, VALID_STATUSES } = require("../middleware/authMiddleware");

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

        const wheres = [];
        const params = [];

        if (search) {
            wheres.push("(full_name LIKE ? OR email LIKE ? OR phone LIKE ?)");
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        if (role   && VALID_ROLES.has(role))     { wheres.push("role=?");   params.push(role); }
        if (status && VALID_STATUSES.has(status)) { wheres.push("status=?"); params.push(status); }

        const where = wheres.length ? "WHERE " + wheres.join(" AND ") : "";

        const [[{ total }]] = await db.query(
            `SELECT COUNT(*) AS total FROM users ${where}`, params
        );

        const [rows] = await db.query(
            `SELECT user_id, username, full_name, email, phone, gender, birth_date,
                    province, district, address_detail, role, status, created_at
             FROM users ${where}
             ORDER BY ${sortBy} ${order}
             LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        res.json({
            data: rows,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ═══════════════════════════════════════════
   GET USER BY ID
═══════════════════════════════════════════ */
exports.getUserById = async (req, res) => {
    try {
        const [result] = await db.query(
            `SELECT user_id, username, full_name, email, phone, gender, birth_date,
                    province, district, address_detail, role, status, created_at
             FROM users WHERE user_id=?`,
            [req.params.id]
        );
        if (!result.length) return res.status(404).json({ message: "User not found" });
        res.json(result[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ═══════════════════════════════════════════
   CREATE USER (Admin only)
═══════════════════════════════════════════ */
exports.createUser = async (req, res) => {
    try {
        const { username, full_name, email, phone, province, district, address_detail, role, status, password } = req.body;

        if (!full_name || !email) {
            return res.status(400).json({ message: "full_name và email là bắt buộc" });
        }
        if (role && !VALID_ROLES.has(role)) {
            return res.status(422).json({ message: `role không hợp lệ. Phải là: ${[...VALID_ROLES].join(", ")}` });
        }
        if (status && !VALID_STATUSES.has(status)) {
            return res.status(422).json({ message: `status không hợp lệ. Phải là: ${[...VALID_STATUSES].join(", ")}` });
        }

        const hashed = await bcrypt.hash(password || "123456", 10);
        const [result] = await db.query(
            `INSERT INTO users (username, full_name, email, password_hash, phone,
              province, district, address_detail, role, status, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,NOW())`,
            [
                username || email.split("@")[0],
                full_name, email, hashed,
                phone || null, province || null, district || null, address_detail || null,
                role || "PASSENGER",
                status || "ACTIVE"
            ]
        );
        res.status(201).json({ message: "User created", user_id: result.insertId });
    } catch (err) {
        console.error(err);
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
                address_detail, role, status, password } = req.body;

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

        let sql, params;
        if (password) {
            const hashed = await bcrypt.hash(password, 10);
            sql = `UPDATE users SET full_name=?,email=?,phone=?,gender=?,birth_date=?,
                   province=?,district=?,address_detail=?,role=IFNULL(?,role),
                   status=IFNULL(?,status), password_hash=? WHERE user_id=?`;
            params = [full_name||null, email||null, phone||null, gender||null, birth_date||null,
                      province||null, district||null, address_detail||null,
                      role||null, status||null, hashed, userId];
        } else {
            sql = `UPDATE users SET full_name=?,email=?,phone=?,gender=?,birth_date=?,
                   province=?,district=?,address_detail=?,role=IFNULL(?,role),
                   status=IFNULL(?,status) WHERE user_id=?`;
            params = [full_name||null, email||null, phone||null, gender||null, birth_date||null,
                      province||null, district||null, address_detail||null,
                      role||null, status||null, userId];
        }

        const [result] = await db.query(sql, params);
        res.json({ message: "Cập nhật thành công", affectedRows: result.affectedRows });
    } catch (err) {
        console.error(err);
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
        console.error(err);
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
        console.error("GET LOYALTY ERROR:", err);
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
        console.error("REDEEM POINTS ERROR:", err);
        res.status(400).json({ message: err.message || "Lỗi đổi điểm" });
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
        console.error("GET STATS ERROR:", err);
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
        console.error("GET MONTHLY STATS ERROR:", err);
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
        console.error("GET TRAVEL PROFILE ERROR:", err);
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
        console.error("GET NOTIFICATIONS ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};
