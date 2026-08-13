const db = require("../config/db");

/* ===============================
   BASE SELECT (ĐẾM GHẾ CHUẨN)
=============================== */
const baseSelect = `
    SELECT
        t.trip_id,
        r.route_id,
        r.origin,
        r.destination,
        r.distance_km,
        r.origin_lat,
        r.origin_lng,
        r.dest_lat,
        r.dest_lng,
        t.departure_time,
        t.arrival_time,
        t.base_price,
        t.status,
        b.bus_id,
        b.plate_number,
        b.bus_type,
        b.total_seats,
        o.operator_id,
        o.name AS operator_name,
        COUNT(DISTINCT bd.seat_id) AS booked_seats,
        (b.total_seats - COUNT(DISTINCT bd.seat_id)) AS available_seats,
        IFNULL(AVG(rv.rating), 0) AS avg_rating,
        COUNT(DISTINCT rv.review_id) AS review_count
    FROM trip t
    JOIN route r ON t.route_id = r.route_id
    JOIN bus b ON t.bus_id = b.bus_id
    JOIN bus_operator o ON b.operator_id = o.operator_id
    LEFT JOIN booking bk ON bk.trip_id = t.trip_id
                         AND bk.status IN ('PAID','PENDING','CONFIRMED')
    LEFT JOIN booking_detail bd ON bd.booking_id = bk.booking_id
    LEFT JOIN review rv ON rv.trip_id = t.trip_id
`;

/* ===============================
   LẤY TẤT CẢ CHUYẾN XE
=============================== */
exports.getTrips = async (req, res) => {
    try {
        const { bus_id, operator_id } = req.query;
        let sql = baseSelect;
        const params = [];
        /* Chuyến chưa khởi hành — dành cho hành khách đặt vé & danh sách operator */
        const wheres = ["t.departure_time > NOW()"];
        if (bus_id)      { wheres.push("t.bus_id = ?");      params.push(bus_id); }
        if (operator_id) { wheres.push("o.operator_id = ?"); params.push(operator_id); }
        sql += " WHERE " + wheres.join(" AND ");
        sql += " GROUP BY t.trip_id ORDER BY t.departure_time ASC";
        const [result] = await db.query(sql, params);
        res.json(result);
    } catch (err) {
        console.error("GET TRIPS ERROR:", err);
        res.status(500).json({ message: "Database error" });
    }
};

/* ===============================
   GET RUNNING TRIPS  — /api/trips/running
   Trả về TẤT CẢ chuyến đang diễn ra theo thời gian thực:
     departure_time <= NOW()  AND  arrival_time > NOW()
   Không lọc theo ngày. Hoạt động qua nửa đêm, qua ngày.
=============================== */
exports.getRunningTrips = async (req, res) => {
    try {
        const { operator_id } = req.query;
        let sql = baseSelect + `
            WHERE t.departure_time <= NOW()
              AND t.arrival_time   >  NOW()
              AND t.status        != 'CANCELED'`;
        const params = [];
        if (operator_id) {
            sql += " AND o.operator_id = ?";
            params.push(operator_id);
        }
        sql += " GROUP BY t.trip_id ORDER BY t.departure_time ASC";
        const [result] = await db.query(sql, params);
        res.json(result);
    } catch (err) {
        console.error("GET RUNNING TRIPS ERROR:", err);
        res.status(500).json({ message: "Database error" });
    }
};

/* ===============================
   SEARCH TRIP
=============================== */
exports.searchTrips = async (req, res) => {
    try {
        const { origin, destination, date, busType, sort } = req.query;
        let sql = baseSelect + " WHERE t.departure_time > NOW()";
        const params = [];

        if (origin)      { sql += " AND r.origin LIKE ?";           params.push(`%${origin}%`); }
        if (destination) { sql += " AND r.destination LIKE ?";       params.push(`%${destination}%`); }
        if (date)        { sql += " AND DATE(t.departure_time) = ?"; params.push(date); }
        if (busType)     { sql += " AND b.bus_type = ?";             params.push(busType); }

        sql += " GROUP BY t.trip_id";
        if (sort === "asc")       sql += " ORDER BY t.base_price ASC";
        else if (sort === "desc") sql += " ORDER BY t.base_price DESC";
        else                      sql += " ORDER BY t.departure_time ASC";

        const [result] = await db.query(sql, params);
        res.json(result);
    } catch (err) {
        console.error("SEARCH ERROR:", err);
        res.status(500).json({ message: "Database error" });
    }
};

/* ===============================
   GET TRIP BY ID
=============================== */
exports.getTripById = async (req, res) => {
    try {
        const { id } = req.params;
        const sql = baseSelect + " WHERE t.trip_id = ? GROUP BY t.trip_id";
        const [result] = await db.query(sql, [id]);
        if (result.length === 0) return res.status(404).json({ message: "Trip not found" });
        res.json(result[0]);
    } catch (err) {
        console.error("GET TRIP BY ID ERROR:", err);
        res.status(500).json({ message: "Database error" });
    }
};

/* ===============================
   CREATE TRIP (Operator)
=============================== */
exports.createTrip = async (req, res) => {
    try {
        const { route_id, bus_id, departure_time, arrival_time, base_price } = req.body;
        if (!route_id || !bus_id || !departure_time || !arrival_time || !base_price) {
            return res.status(400).json({ message: "Thiếu dữ liệu bắt buộc" });
        }
        const dep = new Date(departure_time);
        const arr = new Date(arrival_time);
        if (isNaN(dep) || isNaN(arr)) {
            return res.status(422).json({ message: "departure_time hoặc arrival_time không hợp lệ" });
        }
        if (arr <= dep) {
            return res.status(422).json({ message: "arrival_time phải sau departure_time" });
        }
        const price = Number(base_price);
        if (isNaN(price) || price < 0) {
            return res.status(422).json({ message: "base_price phải là số không âm" });
        }

        /* Operator chỉ được dùng xe của mình */
        if (req.user && req.user.role === 'OPERATOR') {
            const [[ownedBus]] = await db.query(
                `SELECT b.bus_id FROM bus b
                 JOIN bus_operator op ON b.operator_id = op.operator_id
                 WHERE b.bus_id=? AND op.email=?`,
                [bus_id, req.user.email]
            );
            if (!ownedBus) {
                return res.status(403).json({ message: "Xe này không thuộc quyền quản lý của bạn" });
            }
        }

        /* Kiểm tra xe không có chuyến trùng giờ */
        const [[conflict]] = await db.query(
            `SELECT trip_id FROM trip
             WHERE bus_id=? AND status != 'CANCELED'
               AND departure_time < ? AND arrival_time > ?`,
            [bus_id, arrival_time, departure_time]
        );
        if (conflict) {
            return res.status(409).json({ message: "Xe này đã có chuyến trong khung giờ đó", conflict_trip_id: conflict.trip_id });
        }

        const [result] = await db.query(
            `INSERT INTO trip (route_id, bus_id, departure_time, arrival_time, base_price, status)
             VALUES (?, ?, ?, ?, ?, 'OPEN')`,
            [route_id, bus_id, departure_time, arrival_time, price]
        );
        res.status(201).json({ message: "Tạo chuyến xe thành công", trip_id: result.insertId });
    } catch (err) {
        console.error("CREATE TRIP ERROR:", err);
        res.status(500).json({ message: "Database error" });
    }
};

/* ===============================
   UPDATE TRIP
=============================== */
exports.updateTrip = async (req, res) => {
    try {
        const { id } = req.params;
        const { route_id, bus_id, departure_time, arrival_time, base_price, status } = req.body;

        if (departure_time && arrival_time) {
            const dep = new Date(departure_time);
            const arr = new Date(arrival_time);
            if (isNaN(dep) || isNaN(arr)) {
                return res.status(422).json({ message: "Thời gian không hợp lệ" });
            }
            if (arr <= dep) {
                return res.status(422).json({ message: "arrival_time phải sau departure_time" });
            }
        }
        if (base_price !== undefined) {
            const price = Number(base_price);
            if (isNaN(price) || price < 0) {
                return res.status(422).json({ message: "base_price phải là số không âm" });
            }
        }
        const VALID_STATUS = new Set(["OPEN","FULL","RUNNING","COMPLETED","CANCELED"]);
        if (status && !VALID_STATUS.has(status)) {
            return res.status(422).json({ message: `status không hợp lệ: ${[...VALID_STATUS].join(", ")}` });
        }

        /* Operator chỉ được sửa chuyến xe của mình */
        if (req.user && req.user.role === 'OPERATOR') {
            const [[ownedTrip]] = await db.query(
                `SELECT t.trip_id FROM trip t
                 JOIN bus b ON t.bus_id = b.bus_id
                 JOIN bus_operator op ON b.operator_id = op.operator_id
                 WHERE t.trip_id=? AND op.email=?`,
                [id, req.user.email]
            );
            if (!ownedTrip) {
                return res.status(403).json({ message: "Chuyến này không thuộc quyền quản lý của bạn" });
            }
        }

        await db.query(
            `UPDATE trip SET route_id=?, bus_id=?, departure_time=?, arrival_time=?, base_price=?, status=?
             WHERE trip_id=?`,
            [route_id, bus_id, departure_time, arrival_time, base_price, status, id]
        );
        res.json({ message: "Cập nhật chuyến xe thành công" });
    } catch (err) {
        console.error("UPDATE TRIP ERROR:", err);
        res.status(500).json({ message: "Database error" });
    }
};

/* ===============================
   UPDATE TRIP STATUS
=============================== */
exports.updateTripStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const VALID = new Set(["OPEN","FULL","RUNNING","COMPLETED","CANCELED"]);
        if (!status || !VALID.has(status)) {
            return res.status(422).json({ message: `status không hợp lệ: ${[...VALID].join(", ")}` });
        }
        await db.query("UPDATE trip SET status=? WHERE trip_id=?", [status, id]);
        res.json({ message: "Cập nhật trạng thái thành công" });
    } catch (err) {
        console.error("UPDATE TRIP STATUS ERROR:", err);
        res.status(500).json({ message: "Database error" });
    }
};

/* ===============================
   UPDATE TRIP PRICE
=============================== */
exports.updateTripPrice = async (req, res) => {
    try {
        const { id } = req.params;
        const { price } = req.body;
        const p = Number(price);
        if (isNaN(p) || p < 0) {
            return res.status(422).json({ message: "price phải là số không âm" });
        }
        await db.query("UPDATE trip SET base_price=? WHERE trip_id=?", [p, id]);
        res.json({ message: "Cập nhật giá thành công" });
    } catch (err) {
        console.error("UPDATE TRIP PRICE ERROR:", err);
        res.status(500).json({ message: "Database error" });
    }
};

/* ===============================
   AUTO-ADVANCE COMPLETED TRIPS
   Chỉ advance chuyến đã KẾT THÚC (arrival_time < NOW).
   Chuyến đang chạy KHÔNG bị đụng — /api/trips/running tự query trực tiếp.
=============================== */
exports.autoGenerateRecurringTrips = async () => {
    try {
        /* Chỉ advance các chuyến đã HOÀN THÀNH (arrival_time đã qua).
           Chuyến đang chạy (dep <= NOW < arr) → GIỮ NGUYÊN.
           Dùng MySQL làm chuẩn thời gian để tránh timezone JS vs DB. */
        const [completed] = await db.query(
            `SELECT trip_id, route_id, bus_id, departure_time, arrival_time, base_price
             FROM trip
             WHERE status != 'CANCELED'
               AND arrival_time <= NOW()`
        );
        if (!completed.length) {
            console.log(`ℹ️ [AutoTrip] No completed trips to advance`);
            return;
        }

        const pad = n => String(n).padStart(2, "0");
        const fmtUTC = d =>
            `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ` +
            `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

        const [[{ nowMs }]] = await db.query(`SELECT UNIX_TIMESTAMP(NOW()) * 1000 AS nowMs`);
        const now = Number(nowMs);

        let cloned = 0, inplace = 0;
        for (const t of completed) {
            const dep = t.departure_time instanceof Date
                ? t.departure_time.getTime()
                : new Date(String(t.departure_time).replace(' ','T')+'Z').getTime();
            const arr = t.arrival_time instanceof Date
                ? t.arrival_time.getTime()
                : new Date(String(t.arrival_time).replace(' ','T')+'Z').getTime();
            const dur = arr - dep;

            let nextDep = new Date(dep);
            nextDep.setUTCDate(nextDep.getUTCDate() + 1);
            while (nextDep.getTime() <= now) {
                nextDep.setUTCDate(nextDep.getUTCDate() + 1);
            }
            const nextArr = new Date(nextDep.getTime() + dur);

            /* Kiểm tra trip có booking lịch sử không */
            const [[{ cnt }]] = await db.query(
                `SELECT COUNT(*) AS cnt FROM booking WHERE trip_id=?`, [t.trip_id]
            );

            if (Number(cnt) > 0) {
                /* Có booking → KHÔNG sửa departure_time cũ (bảo toàn lịch sử).
                   Chỉ INSERT trip mới nếu chưa có chuyến tương lai cho bus/route này. */
                const [[existing]] = await db.query(
                    `SELECT trip_id FROM trip
                     WHERE bus_id=? AND route_id=? AND status != 'CANCELED'
                       AND departure_time > NOW() LIMIT 1`,
                    [t.bus_id, t.route_id]
                );
                if (!existing) {
                    await db.query(
                        `INSERT INTO trip (route_id, bus_id, departure_time, arrival_time, base_price, status)
                         VALUES (?, ?, ?, ?, ?, 'OPEN')`,
                        [t.route_id, t.bus_id, fmtUTC(nextDep), fmtUTC(nextArr), t.base_price]
                    );
                    cloned++;
                }
                /* Đánh dấu chuyến cũ là COMPLETED (giữ nguyên departure_time) */
                await db.query(`UPDATE trip SET status='COMPLETED' WHERE trip_id=?`, [t.trip_id]);
            } else {
                /* Không có booking → cập nhật in-place (chuyến template chưa được đặt) */
                await db.query(
                    `UPDATE trip SET departure_time=?, arrival_time=?, status='OPEN' WHERE trip_id=?`,
                    [fmtUTC(nextDep), fmtUTC(nextArr), t.trip_id]
                );
                inplace++;
            }
        }
        if (cloned + inplace > 0)
            console.log(`✅ [AutoTrip] Advanced: ${inplace} in-place, ${cloned} cloned (with bookings)`);
    } catch (err) {
        console.error("❌ [AutoTrip] Error:", err);
    }
};

/* ===============================
   PERIODIC CHECK (mỗi 2 phút)
   Trigger advance ngay khi hết chuyến OPEN có thể đặt vé.
   Chuyến đang chạy (RUNNING) vẫn giữ nguyên, chỉ advance các chuyến đã xong.
=============================== */
exports.checkAndAdvanceIfNeeded = async () => {
    try {
        // Advance tất cả chuyến đã hoàn thành (arrival_time đã qua)
        const [[{ doneCnt }]] = await db.query(
            `SELECT COUNT(*) AS doneCnt FROM trip
             WHERE status != 'CANCELED' AND arrival_time <= NOW()`
        );
        if (Number(doneCnt) > 0) {
            console.log(`🔄 [AutoTrip] Có ${doneCnt} chuyến đã đến nơi → advance sang ngày mai...`);
            await exports.autoGenerateRecurringTrips();
        }
    } catch (err) {
        console.error("❌ [AutoTrip] checkAndAdvance error:", err);
    }
};

/* ===============================
   DYNAMIC PRICING
=============================== */
exports.getDynamicPriceForTrip = async (req, res) => {
    try {
        const { getDynamicPrice } = require('../services/pricingEngine');
        const result = await getDynamicPrice(db, req.params.id);
        res.json(result);
    } catch (err) {
        console.error("DYNAMIC PRICE ERROR:", err);
        if (err.message === 'Trip not found') return res.status(404).json({ message: 'Trip not found' });
        res.status(500).json({ message: 'Database error' });
    }
};

/* ===============================
   DELETE TRIP
=============================== */
exports.deleteTrip = async (req, res) => {
    try {
        const { id } = req.params;
        const [[{ bookingCount }]] = await db.query(
            "SELECT COUNT(*) AS bookingCount FROM booking WHERE trip_id=?", [id]
        );
        if (bookingCount > 0) {
            /* Soft delete — không xóa chuyến có booking lịch sử */
            await db.query("UPDATE trip SET status='CANCELED' WHERE trip_id=?", [id]);
            return res.json({ message: "Chuyến đã có booking — đã hủy thay vì xóa", soft: true });
        }
        await db.query("DELETE FROM trip WHERE trip_id=?", [id]);
        res.json({ message: "Đã xóa chuyến xe", soft: false });
    } catch (err) {
        console.error("DELETE TRIP ERROR:", err);
        res.status(500).json({ message: "Database error" });
    }
};
