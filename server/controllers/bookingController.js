const db = require("../config/db");
const { awardPoints } = require("../services/loyaltyService");
const { sendBookingConfirmation, sendBookingCancellation } = require("../services/emailService");

/* =====================================================
   GET ALL BOOKINGS (Admin / Operator)
===================================================== */
exports.getAllBookings = async (req, res) => {
    try {
        const sql = `
            SELECT
                b.booking_id,
                b.user_id,
                u.full_name,
                u.email,
                b.trip_id,
                b.booking_time,
                b.total_amount,
                b.status,
                t.departure_time,
                r.origin,
                r.destination,
                bus.plate_number,
                bus.bus_type,
                p.method         AS payment_method,
                p.status         AS payment_status,
                GROUP_CONCAT(s.seat_number ORDER BY LENGTH(s.seat_number), s.seat_number SEPARATOR ', ')
                                 AS seat_numbers,
                GROUP_CONCAT(DISTINCT s.seat_type SEPARATOR '/')
                                 AS seat_types
            FROM booking b
            JOIN users u   ON b.user_id  = u.user_id
            JOIN trip t    ON b.trip_id  = t.trip_id
            JOIN route r   ON t.route_id = r.route_id
            JOIN bus       ON t.bus_id   = bus.bus_id
            LEFT JOIN payment p        ON p.booking_id  = b.booking_id
            LEFT JOIN booking_detail bd ON bd.booking_id = b.booking_id
            LEFT JOIN seat s           ON s.seat_id     = bd.seat_id
            GROUP BY
                b.booking_id, b.user_id, u.full_name, u.email,
                b.trip_id, b.booking_time, b.total_amount, b.status,
                t.departure_time, r.origin, r.destination,
                bus.plate_number, bus.bus_type,
                p.method, p.status
            ORDER BY b.booking_id DESC
        `;
        const [result] = await db.query(sql);
        res.json(result);
    } catch (err) {
        console.error("GET ALL BOOKINGS ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

/* =====================================================
   GET BOOKINGS BY USER
===================================================== */
exports.getBookingsByUser = async (req, res) => {
    try {
        const userId = req.params.id;
        const sql = `
            SELECT
                b.booking_id,
                b.total_amount,
                b.status,
                b.booking_time,
                b.extras,
                t.departure_time,
                t.arrival_time,
                r.origin,
                r.destination,
                bus.bus_type,
                bus.plate_number,
                o.name AS operator_name
            FROM booking b
            JOIN trip t ON b.trip_id = t.trip_id
            JOIN route r ON t.route_id = r.route_id
            JOIN bus ON t.bus_id = bus.bus_id
            JOIN bus_operator o ON bus.operator_id = o.operator_id
            WHERE b.user_id = ?
            ORDER BY b.booking_id DESC
        `;
        const [result] = await db.query(sql, [userId]);
        res.json(result);
    } catch (err) {
        console.error("GET BOOKINGS BY USER ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

/* =====================================================
   AMENITY PRICE TABLE (server-authoritative)
===================================================== */
const AMENITY_PRICES = {
    "thuoc-say-xe":  8000,
    "nuoc-uong":     6000,
    "do-an-nhe":    15000,
    "khau-trang":    3000,
    "chan-goi":      12000,
    "tai-nghe":     10000,
};

/* =====================================================
   CREATE BOOKING (Transaction)
===================================================== */
exports.createBooking = async (req, res) => {
    const { user_id, trip_id, seats, status: reqStatus, payment_method, extras } = req.body;
    const bookingStatus = (reqStatus === "PENDING") ? "PENDING" : "PAID";

    if (!user_id || !trip_id || !Array.isArray(seats) || seats.length === 0) {
        return res.status(400).json({ message: "Thiếu dữ liệu" });
    }

    const normalizedSeats = seats.map(s => {
        if (typeof s === "number") return { id: s, type: "NORMAL" };
        return { id: parseInt(s.id), type: s.type || "NORMAL" };
    });

    const seatIds = normalizedSeats.map(s => s.id);
    if (seatIds.some(id => !id || isNaN(id))) {
        return res.status(400).json({ message: "Seat không hợp lệ" });
    }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const [[trip]] = await conn.query(
            "SELECT base_price, bus_id FROM trip WHERE trip_id = ? FOR UPDATE",
            [trip_id]
        );
        if (!trip) {
            await conn.rollback();
            return res.status(404).json({ message: "Trip not found" });
        }

        const basePrice = trip.base_price;

        // Check ghế chưa được đặt trong ngày hiện tại của chuyến
        const [bookedSeats] = await conn.query(
            `SELECT bd.seat_id FROM booking_detail bd
             JOIN booking bk ON bd.booking_id = bk.booking_id
             WHERE bk.trip_id = ?
               AND bk.status IN ('CONFIRMED','PAID','PENDING')
               AND DATE(bk.booking_time) = DATE((SELECT departure_time FROM trip WHERE trip_id = ?))
               AND bd.seat_id IN (?)
             FOR UPDATE`,
            [trip_id, trip_id, seatIds]
        );

        if (bookedSeats.length > 0) {
            await conn.rollback();
            return res.status(400).json({ message: "Một hoặc nhiều ghế đã bị đặt" });
        }

        let total = 0;
        normalizedSeats.forEach(s => {
            total += s.type === "VIP" ? basePrice * 1.5 : basePrice;
        });

        // Compute amenities cost (server-authoritative prices)
        const extrasArr = Array.isArray(extras) ? extras.filter(e => e.qty > 0) : [];
        extrasArr.forEach(e => {
            total += (AMENITY_PRICES[e.id] || 0) * (parseInt(e.qty) || 0);
        });
        const extrasJson = extrasArr.length ? JSON.stringify(extrasArr) : null;

        const [bookingResult] = await conn.query(
            `INSERT INTO booking (user_id, trip_id, booking_time, total_amount, status, extras)
             VALUES (?, ?, NOW(), ?, ?, ?)`,
            [user_id, trip_id, total, bookingStatus, extrasJson]
        );
        const bookingId = bookingResult.insertId;

        const values = normalizedSeats.map(s => [
            bookingId,
            s.id,
            s.type === "VIP" ? basePrice * 1.5 : basePrice
        ]);
        await conn.query(
            "INSERT INTO booking_detail (booking_id, seat_id, price) VALUES ?",
            [values]
        );

        // Ghi payment record nếu PAID ngay
        if (bookingStatus === "PAID" && payment_method) {
            const pm = payment_method.toUpperCase();
            const mapped = ["MOMO","ZALOPAY","BANK"].includes(pm) ? pm : "BANK";
            await conn.query(
                `INSERT INTO payment (booking_id, method, amount, status, payment_time)
                 VALUES (?, ?, ?, 'SUCCESS', NOW())`,
                [bookingId, mapped, total]
            );
        }

        await conn.commit();

        // ── Post-commit for immediate PAID bookings ──
        if (bookingStatus === "PAID") {
            try {
                const earned = await awardPoints(db, user_id, bookingId, total);
                const [bRows] = await db.query(
                    `SELECT u.full_name, u.email, r.origin, r.destination,
                            t.departure_time, t.arrival_time, bs.bus_type, bs.plate_number
                     FROM booking b
                     JOIN users u ON b.user_id = u.user_id
                     JOIN trip t ON b.trip_id = t.trip_id
                     JOIN route r ON t.route_id = r.route_id
                     JOIN bus bs ON t.bus_id = bs.bus_id
                     WHERE b.booking_id = ?`, [bookingId]
                );
                if (bRows.length) {
                    await sendBookingConfirmation(bRows[0].email, {
                        ...bRows[0], booking_id: bookingId,
                        total_amount: total, loyalty_earned: earned
                    });
                }
            } catch (postErr) {
                console.warn('[CreateBooking] Post-commit error (non-critical):', postErr.message);
            }
        }

        res.status(201).json({ message: "Đặt vé thành công", booking_id: bookingId, total });

    } catch (err) {
        await conn.rollback();
        console.error("CREATE BOOKING ERROR:", err);
        res.status(500).json({ message: "Lỗi server" });
    } finally {
        conn.release();
    }
};

/* =====================================================
   UPDATE BOOKING STATUS (Huỷ vé / Xác nhận)
===================================================== */
exports.updateBookingStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        await db.query("UPDATE booking SET status=? WHERE booking_id=?", [status, id]);

        // Send cancellation email (non-critical)
        if (status === "CANCELED") {
            try {
                const [bRows] = await db.query(
                    `SELECT u.email, u.full_name, r.origin, r.destination, t.departure_time
                     FROM booking b
                     JOIN users u ON b.user_id = u.user_id
                     JOIN trip t ON b.trip_id = t.trip_id
                     JOIN route r ON t.route_id = r.route_id
                     WHERE b.booking_id = ?`, [id]
                );
                if (bRows.length) {
                    await sendBookingCancellation(bRows[0].email, {
                        full_name: bRows[0].full_name,
                        booking_id: id,
                        origin: bRows[0].origin,
                        destination: bRows[0].destination,
                        departure_time: bRows[0].departure_time
                    });
                }
            } catch (emailErr) {
                console.warn('[UpdateStatus] Email send error (non-critical):', emailErr.message);
            }
        }

        res.json({ message: "Cập nhật thành công" });
    } catch (err) {
        console.error("UPDATE BOOKING STATUS ERROR:", err);
        res.status(500).json({ message: "Update failed" });
    }
};

/* =====================================================
   PAY BOOKING (PENDING → PAID, ghi nhận thanh toán)
===================================================== */
exports.payBooking = async (req, res) => {
    try {
        const { id } = req.params;
        const { method } = req.body; // CASH | MOMO | ZALOPAY | BANK

        const [rows] = await db.query(
            "SELECT booking_id, total_amount, status FROM booking WHERE booking_id=?", [id]
        );
        if (!rows.length) return res.status(404).json({ message: "Booking không tồn tại" });
        if (rows[0].status === "CANCELED") return res.status(400).json({ message: "Vé đã bị huỷ" });
        if (rows[0].status === "PAID") return res.status(400).json({ message: "Vé đã được thanh toán" });

        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            await conn.query("UPDATE booking SET status='PAID' WHERE booking_id=?", [id]);
            // Ghi nhận vào bảng payment (map CASH→BANK nếu enum không có CASH)
            const payMethod = (method === "CASH") ? "BANK" : (method || "BANK");
            await conn.query(
                `INSERT INTO payment (booking_id, method, amount, status, payment_time)
                 VALUES (?, ?, ?, 'SUCCESS', NOW())`,
                [id, payMethod, rows[0].total_amount]
            );
            await conn.commit();

            // ── Post-commit: award loyalty points + send email (non-critical) ──
            try {
                const [bRows] = await db.query(
                    `SELECT b.user_id, b.total_amount, u.full_name, u.email,
                            r.origin, r.destination, t.departure_time, t.arrival_time,
                            bs.plate_number, bs.bus_type
                     FROM booking b
                     JOIN users u ON b.user_id = u.user_id
                     JOIN trip t ON b.trip_id = t.trip_id
                     JOIN route r ON t.route_id = r.route_id
                     JOIN bus bs ON t.bus_id = bs.bus_id
                     WHERE b.booking_id = ?`, [id]
                );
                if (bRows.length) {
                    const br = bRows[0];
                    // Award loyalty points
                    const earned = await awardPoints(db, br.user_id, Number(id), br.total_amount);
                    // Send confirmation email
                    await sendBookingConfirmation(br.email, {
                        full_name: br.full_name,
                        booking_id: id,
                        origin: br.origin,
                        destination: br.destination,
                        departure_time: br.departure_time,
                        arrival_time: br.arrival_time,
                        total_amount: br.total_amount,
                        bus_type: br.bus_type,
                        plate_number: br.plate_number,
                        loyalty_earned: earned
                    });
                }
            } catch (postErr) {
                console.warn('[PayBooking] Post-commit tasks error (non-critical):', postErr.message);
            }

            res.json({ message: "Thanh toán thành công" });
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }
    } catch (err) {
        console.error("PAY BOOKING ERROR:", err);
        res.status(500).json({ message: "Lỗi thanh toán" });
    }
};

/* =====================================================
   GET BOOKING QR TICKET
===================================================== */
exports.getBookingQR = async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await db.query(
            `SELECT b.booking_id, b.user_id, b.trip_id, b.total_amount, b.status,
                    b.booking_time,
                    u.full_name, u.email,
                    t.departure_time, t.arrival_time,
                    ro.origin, ro.destination,
                    bs.plate_number, bs.bus_type,
                    GROUP_CONCAT(s.seat_number ORDER BY s.seat_number SEPARATOR ', ') AS seat_numbers
             FROM booking b
             JOIN users u ON b.user_id = u.user_id
             JOIN trip t ON b.trip_id = t.trip_id
             JOIN route ro ON t.route_id = ro.route_id
             JOIN bus bs ON t.bus_id = bs.bus_id
             LEFT JOIN booking_detail bd ON bd.booking_id = b.booking_id
             LEFT JOIN seat s ON s.seat_id = bd.seat_id
             WHERE b.booking_id = ?
             GROUP BY b.booking_id`, [id]
        );
        if (!rows.length) return res.status(404).json({ message: 'Không tìm thấy vé' });

        const booking = rows[0];
        const { generateQRImage, generateChecksum } = require('../services/qrService');
        const qrImage = await generateQRImage(booking);
        const checksum = generateChecksum(booking.booking_id, booking.user_id, booking.total_amount);

        res.json({
            booking_id: booking.booking_id,
            status: booking.status,
            full_name: booking.full_name,
            email: booking.email,
            origin: booking.origin,
            destination: booking.destination,
            departure_time: booking.departure_time,
            arrival_time: booking.arrival_time,
            seat_numbers: booking.seat_numbers,
            total_amount: booking.total_amount,
            bus_type: booking.bus_type,
            plate_number: booking.plate_number,
            booking_time: booking.booking_time,
            qr_image: qrImage,
            checksum: checksum
        });
    } catch (err) {
        console.error('QR ERROR:', err);
        res.status(500).json({ message: 'Lỗi tạo QR' });
    }
};

/* =====================================================
   VERIFY BOOKING QR (Operator scanner)
===================================================== */
exports.verifyBookingQR = async (req, res) => {
    try {
        const { qr_data } = req.body;
        const { verifyQR } = require('../services/qrService');
        const result = verifyQR(qr_data);

        if (!result.valid) return res.status(400).json({ valid: false, message: 'QR không hợp lệ' });

        const [rows] = await db.query(
            `SELECT b.booking_id, b.status, b.total_amount,
                    u.full_name, u.email,
                    ro.origin, ro.destination,
                    t.departure_time,
                    GROUP_CONCAT(s.seat_number ORDER BY s.seat_number SEPARATOR ', ') AS seat_numbers
             FROM booking b
             JOIN users u ON b.user_id = u.user_id
             JOIN trip t ON b.trip_id = t.trip_id
             JOIN route ro ON t.route_id = ro.route_id
             LEFT JOIN booking_detail bd ON bd.booking_id = b.booking_id
             LEFT JOIN seat s ON s.seat_id = bd.seat_id
             WHERE b.booking_id = ?
             GROUP BY b.booking_id`, [result.bookingId]
        );

        if (!rows.length) return res.status(404).json({ valid: false, message: 'Vé không tồn tại' });

        const booking = rows[0];
        res.json({
            valid: true,
            booking_id: booking.booking_id,
            status: booking.status,
            full_name: booking.full_name,
            origin: booking.origin,
            destination: booking.destination,
            departure_time: booking.departure_time,
            seat_numbers: booking.seat_numbers,
            message: booking.status === 'PAID' ? '✅ Vé hợp lệ' : '⚠️ Trạng thái: ' + booking.status
        });
    } catch (err) {
        console.error('VERIFY QR ERROR:', err);
        res.status(500).json({ valid: false, message: 'Lỗi xác thực' });
    }
};

/* =====================================================
   ADD SERVICE ORDER (post-boarding, adds to existing booking)
===================================================== */
exports.addServiceOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const { items, payment_method, total: clientTotal } = req.body;
        // items: [{id, name, price, qty, unit}]

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ message: "Không có dịch vụ nào" });
        }

        // Get existing booking
        const [rows] = await db.query(
            "SELECT booking_id, total_amount, extras, status FROM booking WHERE booking_id=?", [id]
        );
        if (!rows.length) return res.status(404).json({ message: "Booking không tồn tại" });
        if (rows[0].status === "CANCELED") return res.status(400).json({ message: "Vé đã bị huỷ" });

        // Calculate service total (server-side)
        const validItems = items.filter(i => i.qty > 0 && i.price > 0);
        const svcTotal = validItems.reduce((s, i) => s + Number(i.price) * Number(i.qty), 0);

        // Merge with existing extras
        let existingExtras = [];
        try { existingExtras = rows[0].extras ? JSON.parse(rows[0].extras) : []; } catch {}
        const mergedExtras = [...existingExtras, ...validItems.map(i => ({
            id: i.id, name: i.name, icon: i.icon || "🛎️",
            price: i.price, qty: i.qty, unit: i.unit || "", source: "onboard"
        }))];

        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            // Update booking total and extras
            const newTotal = Number(rows[0].total_amount || 0) + svcTotal;
            await conn.query(
                "UPDATE booking SET total_amount=?, extras=? WHERE booking_id=?",
                [newTotal, JSON.stringify(mergedExtras), id]
            );

            // Record payment
            const pm = (payment_method || "BANK").toUpperCase();
            const mapped = ["MOMO","ZALOPAY","BANK"].includes(pm) ? pm : "BANK";
            await conn.query(
                `INSERT INTO payment (booking_id, method, amount, status, payment_time)
                 VALUES (?, ?, ?, 'SUCCESS', NOW())`,
                [id, mapped, svcTotal]
            );

            await conn.commit();
            res.json({ message: "Đặt dịch vụ thành công", added_total: svcTotal, new_total: newTotal });
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }
    } catch (err) {
        console.error("ADD SERVICE ORDER ERROR:", err);
        res.status(500).json({ message: "Lỗi server" });
    }
};
