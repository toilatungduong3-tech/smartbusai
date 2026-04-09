const db = require("../config/db");

/* ===============================
   LẤY GHẾ THEO TRIP
=============================== */
exports.getSeatsByTrip = async (req, res) => {
    try {
        const tripId = req.params.tripId;
        const sql = `
            SELECT
                s.seat_id,
                s.seat_number,
                s.seat_type,
                CASE WHEN COUNT(bd.seat_id) > 0 THEN 1 ELSE 0 END AS isBooked
            FROM trip t
            JOIN bus b ON t.bus_id = b.bus_id
            JOIN seat s ON s.bus_id = b.bus_id
            LEFT JOIN booking bk ON bk.trip_id = t.trip_id
                                 AND bk.status IN ('CONFIRMED','PAID','PENDING')
                                 AND DATE(bk.booking_time) = DATE(t.departure_time)
            LEFT JOIN booking_detail bd ON bd.booking_id = bk.booking_id AND bd.seat_id = s.seat_id
            WHERE t.trip_id = ?
            GROUP BY s.seat_id, s.seat_number, s.seat_type
            ORDER BY LENGTH(s.seat_number), s.seat_number
        `;
        const [result] = await db.query(sql, [tripId]);
        res.json(result);
    } catch (err) {
        console.error("SEAT ERROR:", err);
        res.status(500).json({ message: "Seat error" });
    }
};

/* ===============================
   UPDATE SEAT (type, status)
=============================== */
exports.updateSeat = async (req, res) => {
    try {
        const { id } = req.params;
        const { seat_type } = req.body;
        await db.query("UPDATE seat SET seat_type=? WHERE seat_id=?", [seat_type, id]);
        res.json({ message: "Cập nhật ghế thành công" });
    } catch (err) {
        console.error("UPDATE SEAT ERROR:", err);
        res.status(500).json({ message: "Update seat failed" });
    }
};

/* ===============================
   LẤY GHẾ THEO BUS
=============================== */
exports.getSeatsByBus = async (req, res) => {
    try {
        const { busId } = req.params;
        const [result] = await db.query(
            `SELECT seat_id, bus_id, seat_number, seat_type
             FROM seat WHERE bus_id = ?
             ORDER BY LENGTH(seat_number), seat_number`,
            [busId]
        );
        res.json(result);
    } catch (err) {
        console.error("GET SEATS BY BUS ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ===============================
   TẠO GHẾ MỚI
=============================== */
exports.createSeat = async (req, res) => {
    try {
        const { bus_id, seat_number, seat_type } = req.body;
        if (!bus_id || !seat_number) return res.status(400).json({ message: "Thiếu bus_id hoặc seat_number" });
        const [[dup]] = await db.query("SELECT seat_id FROM seat WHERE bus_id=? AND seat_number=?", [bus_id, seat_number]);
        if (dup) return res.status(400).json({ message: `Ghế ${seat_number} đã tồn tại` });
        const [r] = await db.query(
            "INSERT INTO seat (bus_id, seat_number, seat_type) VALUES (?, ?, ?)",
            [bus_id, seat_number, seat_type || "NORMAL"]
        );
        res.json({ seat_id: r.insertId, bus_id, seat_number, seat_type: seat_type || "NORMAL" });
    } catch (err) {
        console.error("CREATE SEAT ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ===============================
   XÓA GHẾ
=============================== */
exports.deleteSeat = async (req, res) => {
    try {
        const { id } = req.params;
        const [[chk]] = await db.query("SELECT COUNT(*) AS cnt FROM booking_detail WHERE seat_id=?", [id]);
        if (chk.cnt > 0) return res.status(400).json({ message: "Ghế đang có booking, không thể xóa" });
        await db.query("DELETE FROM seat WHERE seat_id=?", [id]);
        res.json({ message: "Đã xóa ghế" });
    } catch (err) {
        console.error("DELETE SEAT ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ===============================
   MỞ RỘNG GHẾ THEO TOTAL_SEATS CỦA BUS
=============================== */
exports.expandSeats = async (req, res) => {
    try {
        const { busId } = req.params;
        const [[bus]] = await db.query("SELECT bus_id, total_seats FROM bus WHERE bus_id=?", [busId]);
        if (!bus) return res.status(404).json({ message: "Không tìm thấy xe" });

        const [existing] = await db.query(
            "SELECT seat_number FROM seat WHERE bus_id=? ORDER BY LENGTH(seat_number), seat_number",
            [busId]
        );
        const target = bus.total_seats;
        if (existing.length >= target) return res.json({ message: "Ghế đã đủ", added: 0 });

        const existingNums = new Set(existing.map(s => s.seat_number));
        const cols = ["A", "B", "C", "D"];
        const newSeats = [];
        let needed = target - existing.length;
        let row = 1;
        while (needed > 0 && row <= 100) {
            for (let c = 0; c < cols.length && needed > 0; c++) {
                const num = cols[c] + row;
                if (!existingNums.has(num)) {
                    newSeats.push([busId, num, row <= 2 ? "VIP" : "NORMAL"]);
                    existingNums.add(num);
                    needed--;
                }
            }
            row++;
        }
        if (newSeats.length > 0) {
            await db.query("INSERT INTO seat (bus_id, seat_number, seat_type) VALUES ?", [newSeats]);
        }
        res.json({ message: "Đã thêm ghế", added: newSeats.length });
    } catch (err) {
        console.error("EXPAND SEATS ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ===============================
   GENERATE GHẾ THEO TOTAL_SEATS
=============================== */
exports.generateSeats = async (req, res) => {
    try {
        const tripId = req.params.tripId;
        const [[busInfo]] = await db.query(
            "SELECT b.bus_id, b.total_seats FROM trip t JOIN bus b ON t.bus_id = b.bus_id WHERE t.trip_id = ?",
            [tripId]
        );
        if (!busInfo) return res.status(404).json({ message: "Không tìm thấy xe" });

        const { bus_id, total_seats } = busInfo;
        const [[check]] = await db.query("SELECT COUNT(*) AS count FROM seat WHERE bus_id=?", [bus_id]);
        if (check.count > 0) return res.json({ message: "Ghế đã tồn tại" });

        const cols = ["A", "B", "C", "D"];
        const rows = Math.ceil(total_seats / 4);
        const seats = [];
        let created = 0;

        for (let r = 1; r <= rows && created < total_seats; r++) {
            for (let c = 0; c < cols.length && created < total_seats; c++) {
                seats.push([bus_id, cols[c] + r, r <= 2 ? "VIP" : "NORMAL"]);
                created++;
            }
        }

        await db.query("INSERT INTO seat (bus_id, seat_number, seat_type) VALUES ?", [seats]);
        res.json({ message: "Tạo ghế thành công", total: seats.length });
    } catch (err) {
        console.error("GENERATE SEATS ERROR:", err);
        res.status(500).json({ message: "Lỗi tạo ghế" });
    }
};
