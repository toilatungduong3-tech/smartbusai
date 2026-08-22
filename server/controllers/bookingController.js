const db = require("../config/db");
const { awardPoints } = require("../services/loyaltyService");
const { sendBookingConfirmation, sendBookingCancellation } = require("../services/emailService");
const { parsePagination, paginatedResponse } = require("../utils/pagination");
const logger = require('../utils/logger');

/* Phase 2I: shared ownership check for booking-scoped endpoints (pay, QR,
   status update, service-order). The route only guarantees a valid JWT
   (authenticate); this enforces that the caller is either the booking's
   own owner or an ADMIN/OPERATOR, mirroring the existing
   requireAdminOrOperator pattern used elsewhere (tripRoutes, routeStopRoutes). */
function canAccessBooking(req, bookingUserId) {
    if (!req.user) return false;
    if (req.user.role === 'ADMIN' || req.user.role === 'OPERATOR') return true;
    return bookingUserId != null && Number(bookingUserId) === Number(req.user.user_id);
}
const BOOKING_STATUS_VALUES = new Set(["PENDING", "PAID", "CANCELED"]);

/* =====================================================
   GET ALL BOOKINGS (Admin / Operator)
   Sprint 3 — MASTER_COMPLETION_MATRIX.md P0 blocker: this endpoint was
   fully unauthenticated and completely unscoped — any HTTP client could
   dump the entire platform's booking ledger, including every operator's
   revenue and every passenger's full_name/email. Now requires
   authenticate+requireAdminOrOperator+attachOperatorId (see
   bookingRoutes.js). An OPERATOR is always scoped to their own
   server-derived req.operatorId; ADMIN sees the full platform, matching
   the already-correct pattern used by adminController's own booking list.
   The public homepage ticker was split off into getBookingsTicker below —
   it never needed this PII-bearing query at all.
===================================================== */
exports.getAllBookings = async (req, res) => {
    try {
        let sql = `
            SELECT
                b.booking_id,
                b.user_id,
                /* Bug fix: booking supports guest checkout (createBooking
                   accepts an optional user_id — see its own header comment)
                   and stores the guest's real name/phone directly on the
                   booking row (b.guest_name/b.guest_phone) when there is no
                   linked user. This query previously selected only
                   u.full_name via a LEFT JOIN, which is NULL for every
                   guest booking — operator/bookings.html then rendered
                   those rows with a blank "—" customer name, which is what
                   was reported as "sai tên khách hàng". COALESCE falls back
                   to the guest fields so every booking shows its real
                   name/phone, registered or guest. */
                COALESCE(u.full_name, b.guest_name)  AS full_name,
                COALESCE(u.phone, b.guest_phone)     AS phone,
                COALESCE(u.email, b.guest_email)     AS email,
                (b.user_id IS NULL)                  AS is_guest,
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
            LEFT JOIN users u   ON b.user_id  = u.user_id
            JOIN trip t    ON b.trip_id  = t.trip_id
            JOIN route r   ON t.route_id = r.route_id
            JOIN bus       ON t.bus_id   = bus.bus_id
            LEFT JOIN payment p        ON p.booking_id  = b.booking_id
            LEFT JOIN booking_detail bd ON bd.booking_id = b.booking_id
            LEFT JOIN seat s           ON s.seat_id     = bd.seat_id
        `;
        const params = [];
        let whereClause = "";
        if (req.user.role === "OPERATOR") {
            if (req.operatorId == null) return res.json([]); // unlinked or suspended — owns nothing
            whereClause = " WHERE bus.operator_id = ?";
            params.push(req.operatorId);
        }
        sql += whereClause;
        sql += `
            GROUP BY
                b.booking_id, b.user_id, u.full_name, u.email, u.phone,
                b.guest_name, b.guest_phone, b.guest_email,
                b.trip_id, b.booking_time, b.total_amount, b.status,
                t.departure_time, r.origin, r.destination,
                bus.plate_number, bus.bus_type,
                p.method, p.status
            ORDER BY b.booking_id DESC
        `;

        /* Sprint 6 — opt-in pagination, see server/utils/pagination.js. */
        const paging = parsePagination(req.query);
        if (!paging) {
            const [result] = await db.query(sql, params);
            return res.json(result);
        }

        const [[{ total }]] = await db.query(
            `SELECT COUNT(*) AS total FROM booking b
             JOIN trip t ON b.trip_id = t.trip_id
             JOIN bus  ON t.bus_id = bus.bus_id
             ${whereClause}`,
            params
        );
        const [result] = await db.query(sql + " LIMIT ? OFFSET ?", [...params, paging.limit, paging.offset]);
        res.json(paginatedResponse(result, total, paging));
    } catch (err) {
        logger.error("GET ALL BOOKINGS ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

/* =====================================================
   GET BOOKINGS TICKER (public homepage widget)
   Sprint 3: deliberately separate from getAllBookings above — public, no
   auth, hard-capped at 20 rows, and selects only the columns the ticker
   actually renders. full_name is masked server-side (last word + first
   initial, e.g. "An N.") so the real name never leaves the server even
   via devtools/network inspection — the frontend previously received the
   full unmasked name and masked it only for display. No email, phone,
   payment method/status, plate number, user_id, or booking_id are
   selected at all — the ticker never used them.
===================================================== */
function _maskName(name) {
    if (!name) return "Khách hàng";
    const parts = String(name).trim().split(/\s+/);
    if (parts.length === 1) return parts[0][0] + "***";
    return parts[parts.length - 1] + " " + parts[0][0] + ".";
}

exports.getBookingsTicker = async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT
                u.full_name,
                b.booking_time,
                b.total_amount,
                b.status,
                r.origin,
                r.destination,
                bus.bus_type,
                GROUP_CONCAT(s.seat_number ORDER BY LENGTH(s.seat_number), s.seat_number SEPARATOR ', ')
                             AS seat_numbers
            FROM booking b
            LEFT JOIN users u   ON b.user_id  = u.user_id
            JOIN trip t    ON b.trip_id  = t.trip_id
            JOIN route r   ON t.route_id = r.route_id
            JOIN bus       ON t.bus_id   = bus.bus_id
            LEFT JOIN booking_detail bd ON bd.booking_id = b.booking_id
            LEFT JOIN seat s            ON s.seat_id     = bd.seat_id
            WHERE b.status != 'CANCELED'
            GROUP BY b.booking_id, u.full_name, b.booking_time, b.total_amount,
                     b.status, r.origin, r.destination, bus.bus_type
            ORDER BY b.booking_id DESC
            LIMIT 20
        `);
        const masked = rows.map(r => ({
            full_name: _maskName(r.full_name),
            booking_time: r.booking_time,
            total_amount: r.total_amount,
            status: r.status,
            origin: r.origin,
            destination: r.destination,
            bus_type: r.bus_type,
            seat_numbers: r.seat_numbers,
        }));
        res.json(masked);
    } catch (err) {
        logger.error("GET BOOKINGS TICKER ERROR:", err);
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
                o.name AS operator_name,
                GROUP_CONCAT(s.seat_number ORDER BY LENGTH(s.seat_number), s.seat_number SEPARATOR ', ')
                             AS seat_numbers
            FROM booking b
            JOIN trip t ON b.trip_id = t.trip_id
            JOIN route r ON t.route_id = r.route_id
            JOIN bus ON t.bus_id = bus.bus_id
            JOIN bus_operator o ON bus.operator_id = o.operator_id
            LEFT JOIN booking_detail bd ON bd.booking_id = b.booking_id
            LEFT JOIN seat s           ON s.seat_id     = bd.seat_id
            WHERE b.user_id = ?
            GROUP BY
                b.booking_id, b.total_amount, b.status, b.booking_time, b.extras,
                t.departure_time, t.arrival_time, r.origin, r.destination,
                bus.bus_type, bus.plate_number, o.name
            ORDER BY b.booking_id DESC
        `;
        const [result] = await db.query(sql, [userId]);
        res.json(result);
    } catch (err) {
        logger.error("GET BOOKINGS BY USER ERROR:", err);
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
   ONBOARD SERVICE PRICE TABLE (server-authoritative)
   Mirrors SVC_ITEMS in public/pages/passenger/profile.html —
   Phase 2I: addServiceOrder previously trusted body.items[].price
   directly, so a caller could submit any price for a real item id and
   have it recorded as a 'SUCCESS' payment for that amount.
===================================================== */
const SVC_ITEM_PRICES = {
    "nuoc-suoi":      4000,
    "nuoc-ngot":      8000,
    "ca-phe":        10000,
    "mi-ly":         12000,
    "hop-an":        20000,
    "thuoc-say":      5000,
    "khau-trang":     2000,
    "goi-co":        12000,
    "chan":          10000,
    "tai-nghe":       8000,
    "sac-du-phong":  15000,
    "khan-uot":       4000,
    "bo-danh-rang":   8000,
};

/* =====================================================
   CREATE BOOKING (Transaction)
===================================================== */
/* ── Tạo mã đặt vé ngẫu nhiên (8 ký tự in hoa + số) ── */
function generateBookingCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

exports.createBooking = async (req, res) => {
    const {
        user_id, trip_id, seats, status: reqStatus, payment_method, extras,
        guest_name, guest_phone, guest_email  // Guest booking fields
    } = req.body;
    const bookingStatus = (reqStatus === "PENDING") ? "PENDING" : "PAID";

    // user_id is optional (guest booking). trip_id + seats are required.
    if (!trip_id || !Array.isArray(seats) || seats.length === 0) {
        return res.status(400).json({ message: "Thiếu dữ liệu" });
    }
    // Guest must provide name + phone
    if (!user_id && (!guest_name || !guest_phone)) {
        return res.status(400).json({ message: "Khách vãng lai cần nhập họ tên và số điện thoại" });
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

        // Check ghế chưa được đặt cho chuyến này (bỏ điều kiện ngày đặt — sai logic)
        const [bookedSeats] = await conn.query(
            `SELECT bd.seat_id FROM booking_detail bd
             JOIN booking bk ON bd.booking_id = bk.booking_id
             WHERE bk.trip_id = ?
               AND bk.status IN ('CONFIRMED','PAID','PENDING')
               AND bd.seat_id IN (?)
             FOR UPDATE`,
            [trip_id, seatIds]
        );

        if (bookedSeats.length > 0) {
            await conn.rollback();
            return res.status(400).json({ message: "Một hoặc nhiều ghế đã bị đặt" });
        }

        /* Phase 1 hardening — DB-level seat-uniqueness backstop
           (MASTER_COMPLETION_MATRIX.md blocker #7). The FOR UPDATE checks
           above are sound application-level protection, but had zero
           database-level guarantee behind them — a live audit found 5
           seats already double-booked in this exact database. Claiming a
           hold row for every seat is deferred until just before the actual
           INSERT INTO booking_detail below (see the try/catch there): this
           SELECT...FOR UPDATE lock is still the primary, fast-path guard;
           the hold-table INSERT is the guarantee that holds even if some
           other, future code path ever bypasses this lock. */

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

        // Generate unique booking_code
        let bookingCode;
        for (let attempt = 0; attempt < 5; attempt++) {
            const candidate = generateBookingCode();
            const [[exists]] = await conn.query('SELECT booking_id FROM booking WHERE booking_code=?', [candidate]);
            if (!exists) { bookingCode = candidate; break; }
        }

        const [bookingResult] = await conn.query(
            `INSERT INTO booking (user_id, trip_id, booking_time, total_amount, status, extras,
                                  guest_name, guest_phone, guest_email, booking_code)
             VALUES (?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?)`,
            [user_id || null, trip_id, total, bookingStatus, extrasJson,
             guest_name || null, guest_phone || null, guest_email || null, bookingCode]
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

        /* DB-level seat-uniqueness backstop (see comment above). One row
           per (trip_id, seat_id) — PRIMARY KEY(trip_id, seat_id) in
           trip_seat_hold makes it physically impossible for two active
           bookings to hold the same seat, regardless of any application
           logic bug. A duplicate-key violation here means a concurrent
           transaction already claimed one of these seats between our
           FOR UPDATE check above and this INSERT — extremely unlikely
           given the row lock, but no longer just "unlikely": now provably
           impossible to smuggle past undetected. */
        try {
            const holdValues = seatIds.map(seatId => [trip_id, seatId, bookingId]);
            await conn.query(
                "INSERT INTO trip_seat_hold (trip_id, seat_id, booking_id) VALUES ?",
                [holdValues]
            );
        } catch (holdErr) {
            if (holdErr.code === 'ER_DUP_ENTRY' || holdErr.errno === 1062) {
                await conn.rollback();
                return res.status(409).json({ message: "Một hoặc nhiều ghế vừa được người khác đặt, vui lòng thử lại" });
            }
            throw holdErr;
        }

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
                let earned = 0;
                if (user_id) {
                    // Loyalty points only for registered users
                    earned = await awardPoints(db, user_id, bookingId, total);
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
                } else if (guest_email) {
                    // Send basic confirmation to guest email
                    const [bRows] = await db.query(
                        `SELECT r.origin, r.destination, t.departure_time, t.arrival_time,
                                bs.bus_type, bs.plate_number
                         FROM booking b
                         JOIN trip t ON b.trip_id = t.trip_id
                         JOIN route r ON t.route_id = r.route_id
                         JOIN bus bs ON t.bus_id = bs.bus_id
                         WHERE b.booking_id = ?`, [bookingId]
                    );
                    if (bRows.length) {
                        await sendBookingConfirmation(guest_email, {
                            ...bRows[0], full_name: guest_name,
                            booking_id: bookingId, total_amount: total, loyalty_earned: 0
                        });
                    }
                }
            } catch (postErr) {
                logger.warn('[CreateBooking] Post-commit error (non-critical):', postErr.message);
            }
        }

        res.status(201).json({
            message: "Đặt vé thành công",
            booking_id: bookingId,
            booking_code: bookingCode,
            total,
            is_guest: !user_id
        });

    } catch (err) {
        await conn.rollback();
        logger.error("CREATE BOOKING ERROR:", err);
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

        /* Phase 2I: previously accepted ANY string with zero validation and
           zero ownership check. Now: status must be a real enum value, and
           a non-admin/operator caller may only cancel their own booking —
           marking PAID must go through the dedicated pay/confirm endpoints. */
        if (!BOOKING_STATUS_VALUES.has(status)) {
            return res.status(422).json({ message: `status không hợp lệ: ${[...BOOKING_STATUS_VALUES].join(", ")}` });
        }
        const [[existing]] = await db.query("SELECT user_id FROM booking WHERE booking_id=?", [id]);
        if (!existing) return res.status(404).json({ message: "Booking không tồn tại" });
        if (!canAccessBooking(req, existing.user_id)) {
            return res.status(403).json({ message: "Không có quyền truy cập booking này" });
        }
        const isPrivileged = req.user && (req.user.role === 'ADMIN' || req.user.role === 'OPERATOR');
        if (!isPrivileged && status !== 'CANCELED') {
            return res.status(403).json({ message: "Chỉ có thể tự huỷ vé — xác nhận thanh toán phải qua cổng thanh toán" });
        }

        /* Cancelling a booking is one business operation with two parts —
           mark it CANCELED AND release any seat holds it owns — so both
           happen atomically (Phase 1 hardening, Section D: transaction
           boundary covers the complete operation, not a bare status flip
           that could leave a seat permanently un-releasable if the process
           died between the two statements). Non-CANCELED transitions
           (e.g. an admin reopening a PENDING booking) don't touch holds,
           so a plain query is enough there. */
        if (status === "CANCELED") {
            const conn = await db.getConnection();
            try {
                await conn.beginTransaction();
                await conn.query("UPDATE booking SET status=? WHERE booking_id=?", [status, id]);
                await conn.query("DELETE FROM trip_seat_hold WHERE booking_id=?", [id]);
                await conn.commit();
            } catch (err) {
                await conn.rollback();
                throw err;
            } finally {
                conn.release();
            }
        } else {
            await db.query("UPDATE booking SET status=? WHERE booking_id=?", [status, id]);
        }

        // Send cancellation email (non-critical)
        if (status === "CANCELED") {
            try {
                const [bRows] = await db.query(
                    `SELECT COALESCE(u.email, b.guest_email) AS email,
                            COALESCE(u.full_name, b.guest_name) AS full_name,
                            r.origin, r.destination, t.departure_time
                     FROM booking b
                     LEFT JOIN users u ON b.user_id = u.user_id
                     JOIN trip t ON b.trip_id = t.trip_id
                     JOIN route r ON t.route_id = r.route_id
                     WHERE b.booking_id = ?`, [id]
                );
                if (bRows.length && bRows[0].email) {
                    await sendBookingCancellation(bRows[0].email, {
                        full_name: bRows[0].full_name,
                        booking_id: id,
                        origin: bRows[0].origin,
                        destination: bRows[0].destination,
                        departure_time: bRows[0].departure_time
                    });
                }
            } catch (emailErr) {
                logger.warn('[UpdateStatus] Email send error (non-critical):', emailErr.message);
            }
        }

        res.json({ message: "Cập nhật thành công" });
    } catch (err) {
        logger.error("UPDATE BOOKING STATUS ERROR:", err);
        res.status(500).json({ message: "Update failed" });
    }
};

/* =====================================================
   PAY BOOKING (PENDING → PAID, ghi nhận thanh toán)

   Sprint 3 — thesis-compliance transparency note: method=CASH is a
   genuine real-world business action (operator physically receives cash
   at the counter and records it — there's no gateway to call for cash).
   method=MOMO/ZALOPAY/BANK submitted through THIS endpoint is different —
   it is a trust-based simulation, same as confirmVietQR below: the caller
   claims a payment happened and this endpoint records it with no actual
   gateway signature/callback verification. The real, gateway-verified
   paths for those three methods are the /momo/notify, /vnpay/return, and
   /vietqr/confirm handlers in paymentRoutes.js — not this one.
===================================================== */
exports.payBooking = async (req, res) => {
    try {
        const { id } = req.params;
        const { method } = req.body; // CASH | MOMO | ZALOPAY | BANK

        const [rows] = await db.query(
            "SELECT booking_id, total_amount, status, user_id FROM booking WHERE booking_id=?", [id]
        );
        if (!rows.length) return res.status(404).json({ message: "Booking không tồn tại" });
        /* Phase 2I: was reachable by anyone with zero ownership check — a
           second, separate bypass of the F-13/F-17 payment-integrity fix,
           found during this phase's audit. */
        if (!canAccessBooking(req, rows[0].user_id)) {
            return res.status(403).json({ message: "Không có quyền truy cập booking này" });
        }
        if (rows[0].status === "CANCELED") return res.status(400).json({ message: "Vé đã bị huỷ" });
        if (rows[0].status === "PAID") return res.status(400).json({ message: "Vé đã được thanh toán" });

        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            /* Phase 2I: previously updated to PAID unconditionally, with no
               status='PENDING' guard and no affectedRows check — a double
               click, or a race with a gateway callback confirming the same
               booking, could both pass the earlier not-CANCELED/not-PAID
               check and both insert a payment row. Now matches the same
               atomic guard confirmVietQR already uses. */
            const [updResult] = await conn.query(
                "UPDATE booking SET status='PAID' WHERE booking_id=? AND status='PENDING'", [id]
            );
            if (updResult.affectedRows !== 1) {
                await conn.rollback();
                return res.status(409).json({ message: "Trạng thái vé đã thay đổi, vui lòng tải lại" });
            }
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
                logger.warn('[PayBooking] Post-commit tasks error (non-critical):', postErr.message);
            }

            res.json({ message: "Thanh toán thành công" });
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }
    } catch (err) {
        logger.error("PAY BOOKING ERROR:", err);
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
             LEFT JOIN users u ON b.user_id = u.user_id
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
        /* Phase 2I: was an IDOR — any sequential booking_id leaked full
           name/email/QR image/checksum with zero auth. */
        if (!canAccessBooking(req, booking.user_id)) {
            return res.status(403).json({ message: 'Không có quyền truy cập booking này' });
        }
        const { generateQRImage, generateChecksum } = require('../services/qrService');
        const qrImage = await generateQRImage(booking);
        const checksum = generateChecksum(booking.booking_id, booking.user_id || 0, booking.total_amount);

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
        logger.error('QR ERROR:', err);
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
             LEFT JOIN users u ON b.user_id = u.user_id
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
        logger.error('VERIFY QR ERROR:', err);
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
            "SELECT booking_id, total_amount, extras, status, user_id FROM booking WHERE booking_id=?", [id]
        );
        if (!rows.length) return res.status(404).json({ message: "Booking không tồn tại" });
        /* Phase 2I: was unauthenticated, no ownership check — anyone could
           append paid "extras" to any booking and insert an unverified
           payment row for it. */
        if (!canAccessBooking(req, rows[0].user_id)) {
            return res.status(403).json({ message: "Không có quyền truy cập booking này" });
        }
        if (rows[0].status === "CANCELED") return res.status(400).json({ message: "Vé đã bị huỷ" });

        // Phase 2I: price now comes only from the server-authoritative
        // SVC_ITEM_PRICES catalog, never from the client — items with an
        // unknown id (or a client-supplied price that would previously
        // have been trusted) are dropped instead of priced at whatever the
        // caller sent.
        const validItems = items
            .filter(i => i.qty > 0 && SVC_ITEM_PRICES[i.id] != null)
            .map(i => ({ ...i, price: SVC_ITEM_PRICES[i.id] }));
        const svcTotal = validItems.reduce((s, i) => s + i.price * Number(i.qty), 0);

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
        logger.error("ADD SERVICE ORDER ERROR:", err);
        res.status(500).json({ message: "Lỗi server" });
    }
};

/* =====================================================
   GUEST LOOKUP — GET /api/bookings/lookup?code=X&phone=Y
   Tra cứu vé bằng mã đặt vé + số điện thoại (không cần đăng nhập)
===================================================== */
exports.lookupBooking = async (req, res) => {
    try {
        const { code, phone } = req.query;
        if (!code || !phone) {
            return res.status(400).json({ message: "Cần nhập mã đặt vé và số điện thoại" });
        }

        const [rows] = await db.query(
            `SELECT b.booking_id, b.booking_code, b.status, b.total_amount, b.booking_time,
                    b.guest_name, b.guest_phone, b.guest_email,
                    COALESCE(u.full_name, b.guest_name) AS full_name,
                    COALESCE(u.email, b.guest_email) AS email,
                    COALESCE(u.phone, b.guest_phone) AS phone,
                    r.origin, r.destination,
                    t.departure_time, t.arrival_time,
                    bs.bus_type, bs.plate_number,
                    o.name AS operator_name,
                    GROUP_CONCAT(s.seat_number ORDER BY s.seat_number SEPARATOR ', ') AS seat_numbers
             FROM booking b
             LEFT JOIN users u ON b.user_id = u.user_id
             JOIN trip t ON b.trip_id = t.trip_id
             JOIN route r ON t.route_id = r.route_id
             JOIN bus bs ON t.bus_id = bs.bus_id
             JOIN bus_operator o ON bs.operator_id = o.operator_id
             LEFT JOIN booking_detail bd ON bd.booking_id = b.booking_id
             LEFT JOIN seat s ON s.seat_id = bd.seat_id
             WHERE b.booking_code = ?
             GROUP BY b.booking_id`,
            [code.toUpperCase()]
        );

        if (!rows.length) {
            return res.status(404).json({ message: "Không tìm thấy vé với mã này" });
        }

        const booking = rows[0];
        // Verify phone matches (guest_phone or user phone_number)
        const storedPhone = (booking.phone || '').replace(/\s/g, '');
        const inputPhone  = phone.replace(/\s/g, '');
        if (storedPhone !== inputPhone) {
            return res.status(403).json({ message: "Số điện thoại không khớp với mã đặt vé" });
        }

        res.json({
            booking_id:     booking.booking_id,
            booking_code:   booking.booking_code,
            status:         booking.status,
            total_amount:   booking.total_amount,
            booking_time:   booking.booking_time,
            full_name:      booking.full_name,
            origin:         booking.origin,
            destination:    booking.destination,
            departure_time: booking.departure_time,
            arrival_time:   booking.arrival_time,
            bus_type:       booking.bus_type,
            plate_number:   booking.plate_number,
            operator_name:  booking.operator_name,
            seat_numbers:   booking.seat_numbers
        });
    } catch (err) {
        logger.error('LOOKUP BOOKING ERROR:', err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};
