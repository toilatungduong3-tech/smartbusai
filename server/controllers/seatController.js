const db = require("../config/db");
const { ownsOperator } = require("../middleware/operatorScope");
const { buildSeatLayout, flattenLayoutToSeats } = require("../services/seatLayoutService");
const logger = require('../utils/logger');

/* Sprint 6 — shared by generateSeats/expandSeats: builds the flat seat
   list to insert, driven by bus.seat_layout_config when present (parsing
   it fresh from bus_type/total_seats if the stored config is missing or
   corrupt, rather than failing seat creation outright), falling back to
   the pre-Sprint-6 flat 4-column algorithm otherwise. */
function seatsFromLayout(bus) {
    let layout = null;
    if (bus.seat_layout_config) {
        try { layout = typeof bus.seat_layout_config === 'string' ? JSON.parse(bus.seat_layout_config) : bus.seat_layout_config; }
        catch (e) { layout = null; }
    }
    if (!layout) {
        try { layout = buildSeatLayout(bus.bus_type, bus.total_seats); }
        catch (e) { return null; } // caller falls back to the legacy algorithm
    }
    return flattenLayoutToSeats(layout);
}

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
        logger.error("SEAT ERROR:", err);
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
        const [[seat]] = await db.query(
            "SELECT b.operator_id FROM seat s JOIN bus b ON s.bus_id=b.bus_id WHERE s.seat_id=?", [id]
        );
        if (!seat) return res.status(404).json({ message: "Không tìm thấy ghế" });
        if (!ownsOperator(req, seat.operator_id)) {
            return res.status(403).json({ message: "Không có quyền sửa ghế của nhà xe khác" });
        }
        await db.query("UPDATE seat SET seat_type=? WHERE seat_id=?", [seat_type, id]);
        res.json({ message: "Cập nhật ghế thành công" });
    } catch (err) {
        logger.error("UPDATE SEAT ERROR:", err);
        res.status(500).json({ message: "Update seat failed" });
    }
};

/* ===============================
   LẤY GHẾ THEO BUS
   Sprint 3 — MASTER_COMPLETION_MATRIX.md blocker: previously public, no
   ownership check — any caller could read any bus's seat layout by
   guessing/enumerating bus_id. Same ownership pattern already used by
   updateSeat/deleteSeat/expandSeats on this exact resource.
=============================== */
exports.getSeatsByBus = async (req, res) => {
    try {
        const { busId } = req.params;
        const [[bus]] = await db.query("SELECT operator_id FROM bus WHERE bus_id=?", [busId]);
        if (!bus) return res.status(404).json({ message: "Không tìm thấy xe" });
        if (!ownsOperator(req, bus.operator_id)) {
            return res.status(403).json({ message: "Không có quyền xem ghế của xe thuộc nhà xe khác" });
        }
        const [result] = await db.query(
            `SELECT seat_id, bus_id, seat_number, seat_type
             FROM seat WHERE bus_id = ?
             ORDER BY LENGTH(seat_number), seat_number`,
            [busId]
        );
        res.json(result);
    } catch (err) {
        logger.error("GET SEATS BY BUS ERROR:", err);
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
        const [[bus]] = await db.query("SELECT operator_id FROM bus WHERE bus_id=?", [bus_id]);
        if (!bus) return res.status(404).json({ message: "Không tìm thấy xe" });
        if (!ownsOperator(req, bus.operator_id)) {
            return res.status(403).json({ message: "Không có quyền thêm ghế cho xe của nhà xe khác" });
        }
        const [[dup]] = await db.query("SELECT seat_id FROM seat WHERE bus_id=? AND seat_number=?", [bus_id, seat_number]);
        if (dup) return res.status(400).json({ message: `Ghế ${seat_number} đã tồn tại` });
        const [r] = await db.query(
            "INSERT INTO seat (bus_id, seat_number, seat_type) VALUES (?, ?, ?)",
            [bus_id, seat_number, seat_type || "NORMAL"]
        );
        res.json({ seat_id: r.insertId, bus_id, seat_number, seat_type: seat_type || "NORMAL" });
    } catch (err) {
        logger.error("CREATE SEAT ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ===============================
   XÓA GHẾ
=============================== */
exports.deleteSeat = async (req, res) => {
    try {
        const { id } = req.params;
        const [[seat]] = await db.query(
            "SELECT b.operator_id FROM seat s JOIN bus b ON s.bus_id=b.bus_id WHERE s.seat_id=?", [id]
        );
        if (!seat) return res.status(404).json({ message: "Không tìm thấy ghế" });
        if (!ownsOperator(req, seat.operator_id)) {
            return res.status(403).json({ message: "Không có quyền xóa ghế của nhà xe khác" });
        }
        const [[chk]] = await db.query("SELECT COUNT(*) AS cnt FROM booking_detail WHERE seat_id=?", [id]);
        if (chk.cnt > 0) return res.status(400).json({ message: "Ghế đang có booking, không thể xóa" });
        await db.query("DELETE FROM seat WHERE seat_id=?", [id]);
        res.json({ message: "Đã xóa ghế" });
    } catch (err) {
        logger.error("DELETE SEAT ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ===============================
   MỞ RỘNG GHẾ THEO TOTAL_SEATS CỦA BUS
=============================== */
exports.expandSeats = async (req, res) => {
    try {
        const { busId } = req.params;
        const [[bus]] = await db.query("SELECT bus_id, total_seats, operator_id FROM bus WHERE bus_id=?", [busId]);
        if (!bus) return res.status(404).json({ message: "Không tìm thấy xe" });
        if (!ownsOperator(req, bus.operator_id)) {
            return res.status(403).json({ message: "Không có quyền sửa ghế của nhà xe khác" });
        }

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
        logger.error("EXPAND SEATS ERROR:", err);
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
            "SELECT b.bus_id, b.bus_type, b.total_seats, b.operator_id, b.seat_layout_config FROM trip t JOIN bus b ON t.bus_id = b.bus_id WHERE t.trip_id = ?",
            [tripId]
        );
        if (!busInfo) return res.status(404).json({ message: "Không tìm thấy xe" });
        if (!ownsOperator(req, busInfo.operator_id)) {
            return res.status(403).json({ message: "Không có quyền tạo ghế cho xe của nhà xe khác" });
        }

        const { bus_id, total_seats } = busInfo;
        const [[check]] = await db.query("SELECT COUNT(*) AS count FROM seat WHERE bus_id=?", [bus_id]);
        if (check.count > 0) return res.json({ message: "Ghế đã tồn tại" });

        /* Sprint 6 — driven by the bus's seat_layout_config (floor/row/
           column/aisle blueprint) when available; falls back to the
           original flat 4-column algorithm for any bus without one
           (pre-Sprint-6 buses, or if layout generation failed). */
        let seatPairs = seatsFromLayout(busInfo);
        if (!seatPairs) {
            const cols = ["A", "B", "C", "D"];
            const rows = Math.ceil(total_seats / 4);
            seatPairs = [];
            let created = 0;
            for (let r = 1; r <= rows && created < total_seats; r++) {
                for (let c = 0; c < cols.length && created < total_seats; c++) {
                    seatPairs.push({ seat_number: cols[c] + r, seat_type: r <= 2 ? "VIP" : "NORMAL" });
                    created++;
                }
            }
        }
        const seats = seatPairs.map(s => [bus_id, s.seat_number, s.seat_type]);

        await db.query("INSERT INTO seat (bus_id, seat_number, seat_type) VALUES ?", [seats]);
        res.json({ message: "Tạo ghế thành công", total: seats.length });
    } catch (err) {
        logger.error("GENERATE SEATS ERROR:", err);
        res.status(500).json({ message: "Lỗi tạo ghế" });
    }
};
