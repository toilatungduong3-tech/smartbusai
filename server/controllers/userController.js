console.log("✅ userController loaded");

const db = require("../config/db");
const loyaltyService = require("../services/loyaltyService");

/* ================= GET ALL USERS ================= */
exports.getUsers = async (req, res) => {
    try {
        const sql = `
            SELECT user_id, username, full_name, email, phone, gender, birth_date,
                   province, district, address_detail, role, status, created_at
            FROM users
            ORDER BY user_id DESC
        `;
        const [result] = await db.query(sql);
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ================= GET USER BY ID ================= */
exports.getUserById = async (req, res) => {
    try {
        const [result] = await db.query(
            `SELECT user_id, username, full_name, email, phone, gender, birth_date,
                    province, district, address_detail, role, status, created_at
             FROM users WHERE user_id=?`,
            [req.params.id]
        );
        if (result.length === 0) return res.status(404).json({ message: "User not found" });
        res.json(result[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ================= CREATE USER ================= */
exports.createUser = async (req, res) => {
    try {
        const { username, full_name, email, phone, province, district, address_detail, role, status, password } = req.body;
        const sql = `
            INSERT INTO users
            (username, full_name, email, password_hash, phone, province, district, address_detail, role, status, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,NOW())
        `;
        const [result] = await db.query(sql, [
            username || full_name?.replace(/\s+/g, "").toLowerCase(),
            full_name, email,
            await require("bcryptjs").hash(password || "123456", 10),
            phone || null,
            province || null,
            district || null,
            address_detail || null,
            role || "PASSENGER",
            status || "ACTIVE"
        ]);
        res.json({ message: "User created", user_id: result.insertId });
    } catch (err) {
        console.error(err);
        if (err.code === "ER_DUP_ENTRY") return res.status(400).json({ message: "Email hoặc username đã tồn tại" });
        res.status(500).json({ message: "Insert failed" });
    }
};

/* ================= UPDATE USER ================= */
exports.updateUser = async (req, res) => {
    try {
        const userId = req.params.id;
        const { full_name, email, phone, gender, birth_date, province, district, address_detail, role, status, password } = req.body;

        let sql, params;
        if (password) {
            const hashed = await require("bcryptjs").hash(password, 10);
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
        res.json({ message: "Update success", affectedRows: result.affectedRows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Update failed" });
    }
};

/* ================= DELETE USER ================= */
exports.deleteUser = async (req, res) => {
    try {
        const [result] = await db.query("DELETE FROM users WHERE user_id=?", [req.params.id]);
        res.json({ message: "Deleted", affectedRows: result.affectedRows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Delete failed" });
    }
};

/* ================= GET USER LOYALTY ================= */
exports.getUserLoyalty = async (req, res) => {
    try {
        const data = await loyaltyService.getUserLoyalty(db, req.params.id);
        res.json(data);
    } catch (err) {
        console.error("GET LOYALTY ERROR:", err);
        res.status(500).json({ message: "Lỗi lấy dữ liệu loyalty" });
    }
};

/* ================= REDEEM LOYALTY POINTS ================= */
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

/* ================= USER STATS (dashboard) ================= */
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

/* ================= MONTHLY STATS (charts) ================= */
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

/* ================= TRAVEL PROFILE (hero stats) ================= */
exports.getTravelProfile = async (req, res) => {
    try {
        const uid = req.params.id;
        // Favorite route (origin → destination via trip → route)
        const [favRoutes] = await db.query(`
            SELECT CONCAT(r.origin,' → ',r.destination) AS route, COUNT(*) AS cnt
            FROM booking b
            JOIN trip t ON b.trip_id=t.trip_id
            JOIN route r ON t.route_id=r.route_id
            WHERE b.user_id=? AND b.status IN ('PAID','COMPLETED')
            GROUP BY route ORDER BY cnt DESC LIMIT 1
        `, [uid]);
        // Favorite operator (booking → trip → bus → bus_operator)
        const [favOps] = await db.query(`
            SELECT o.name AS company_name, COUNT(*) AS cnt
            FROM booking b
            JOIN trip t ON b.trip_id=t.trip_id
            JOIN bus bs ON t.bus_id=bs.bus_id
            JOIN bus_operator o ON bs.operator_id=o.operator_id
            WHERE b.user_id=? AND b.status IN ('PAID','COMPLETED')
            GROUP BY o.name ORDER BY cnt DESC LIMIT 1
        `, [uid]);
        // Total completed for km estimate
        const [[tc]] = await db.query(`
            SELECT COALESCE(SUM(r.distance_km),0) AS total_km
            FROM booking b
            JOIN trip t ON b.trip_id=t.trip_id
            JOIN route r ON t.route_id=r.route_id
            WHERE b.user_id=? AND b.status IN ('PAID','COMPLETED')
        `, [uid]);
        // Top departure cities
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

/* ================= NOTIFICATIONS ================= */
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
        const notifs = [
            ...upcoming.map(u => ({
                type: 'departure', dot: 'green',
                title: 'Chuyến sắp khởi hành',
                message: `${u.origin} → ${u.destination}`,
                time: u.departure_time,
                code: u.booking_code
            })),
            ...pending.map(p => ({
                type: 'payment', dot: 'warn',
                title: 'Vé chờ thanh toán',
                message: `${p.origin} → ${p.destination}`,
                time: p.departure_time,
                code: p.booking_code
            }))
        ];
        res.json(notifs);
    } catch (err) {
        console.error("GET NOTIFICATIONS ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};
