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
        const [result] = await db.query("SELECT * FROM users WHERE user_id=?", [req.params.id]);
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
            password || "123456",
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
            sql = `UPDATE users SET full_name=?,email=?,phone=?,gender=?,birth_date=?,
                   province=?,district=?,address_detail=?,role=IFNULL(?,role),
                   status=IFNULL(?,status), password_hash=? WHERE user_id=?`;
            params = [full_name||null, email||null, phone||null, gender||null, birth_date||null,
                      province||null, district||null, address_detail||null,
                      role||null, status||null, password, userId];
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
