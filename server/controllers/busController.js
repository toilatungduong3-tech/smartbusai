const db = require("../config/db");

/* ============================================
   GET ALL BUSES
============================================ */
exports.getBuses = async (req, res) => {
    try {
        const { operator_id } = req.query;
        let sql = `
            SELECT b.*,
                   o.name AS operator_name,
                   COUNT(DISTINCT t.trip_id) AS trip_count,
                   SUM(CASE WHEN t.departure_time > NOW() AND t.status='OPEN' THEN 1 ELSE 0 END) AS upcoming_trips,
                   SUM(CASE WHEN t.departure_time < NOW() THEN 1 ELSE 0 END) AS completed_trips
            FROM bus b
            LEFT JOIN bus_operator o ON b.operator_id = o.operator_id
            LEFT JOIN trip t ON t.bus_id = b.bus_id
        `;
        const params = [];
        if (operator_id) { sql += " WHERE b.operator_id=?"; params.push(operator_id); }
        sql += " GROUP BY b.bus_id ORDER BY b.bus_id DESC";
        const [result] = await db.query(sql, params);
        res.json(result);
    } catch (err) {
        console.error("GET BUSES ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ============================================
   GET BUS BY ID
============================================ */
exports.getBusById = async (req, res) => {
    try {
        const [result] = await db.query(
            "SELECT b.*, o.name AS operator_name FROM bus b LEFT JOIN bus_operator o ON b.operator_id=o.operator_id WHERE b.bus_id=?",
            [req.params.id]
        );
        if (result.length === 0) return res.status(404).json({ message: "Bus not found" });
        res.json(result[0]);
    } catch (err) {
        console.error("GET BUS BY ID ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ============================================
   CREATE BUS
============================================ */
exports.createBus = async (req, res) => {
    try {
        const { operator_id, plate_number, bus_type, total_seats, status, manufacturer, manufacture_year, color, mileage, description } = req.body;
        if (!operator_id || !plate_number || !bus_type || !total_seats) {
            return res.status(400).json({ message: "Thiếu dữ liệu bắt buộc" });
        }
        const [result] = await db.query(
            "INSERT INTO bus (operator_id, plate_number, bus_type, total_seats, status, manufacturer, manufacture_year, color, mileage, description) VALUES (?,?,?,?,?,?,?,?,?,?)",
            [operator_id, plate_number, bus_type, total_seats, status||"AVAILABLE", manufacturer||null, manufacture_year||null, color||null, mileage||null, description||null]
        );
        res.status(201).json({ message: "Tạo xe thành công", bus_id: result.insertId });
    } catch (err) {
        console.error("CREATE BUS ERROR:", err);
        if (err.code === "ER_DUP_ENTRY") return res.status(400).json({ message: "Biển số xe đã tồn tại" });
        res.status(500).json({ message: "DB error" });
    }
};

/* ============================================
   UPDATE BUS
============================================ */
exports.updateBus = async (req, res) => {
    try {
        const { id } = req.params;
        const { operator_id, plate_number, bus_type, total_seats, status, manufacturer, manufacture_year, color, mileage, description } = req.body;
        await db.query(
            "UPDATE bus SET operator_id=?,plate_number=?,bus_type=?,total_seats=?,status=?,manufacturer=?,manufacture_year=?,color=?,mileage=?,description=? WHERE bus_id=?",
            [operator_id, plate_number, bus_type, total_seats, status, manufacturer||null, manufacture_year||null, color||null, mileage||null, description||null, id]
        );
        res.json({ message: "Cập nhật xe thành công" });
    } catch (err) {
        console.error("UPDATE BUS ERROR:", err);
        res.status(500).json({ message: "Update failed" });
    }
};

/* ============================================
   UPDATE BUS STATUS
============================================ */
exports.updateBusStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        await db.query("UPDATE bus SET status=? WHERE bus_id=?", [status, id]);
        res.json({ message: "Cập nhật trạng thái thành công" });
    } catch (err) {
        console.error("UPDATE BUS STATUS ERROR:", err);
        res.status(500).json({ message: "Update failed" });
    }
};

/* ============================================
   DELETE BUS
============================================ */
exports.deleteBus = async (req, res) => {
    try {
        const { id } = req.params;
        await db.query("DELETE FROM bus WHERE bus_id=?", [id]);
        res.json({ message: "Xóa xe thành công" });
    } catch (err) {
        console.error("DELETE BUS ERROR:", err);
        res.status(500).json({ message: "Delete failed" });
    }
};
