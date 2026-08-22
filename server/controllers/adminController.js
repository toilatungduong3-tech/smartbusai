const db = require("../config/db");
const cache = require("../services/cacheManager");
const logger = require('../utils/logger');

/* ===============================
   THỐNG KÊ TỔNG QUAN
=============================== */
exports.getStats = async (req, res) => {
    try {
        const sql = `
            SELECT
                (SELECT IFNULL(SUM(total_amount),0) FROM booking WHERE status='PAID')                                                                AS totalRevenue,
                (SELECT COUNT(*) FROM booking)                                                                                                        AS totalBookings,
                (SELECT COUNT(*) FROM users)                                                                                                          AS totalUsers,
                (SELECT COUNT(*) FROM bus_operator WHERE status='ACTIVE')                                                                             AS totalOperators,
                (SELECT COUNT(*) FROM trip WHERE status IN ('OPEN','FULL'))                                                                           AS tripsOpen,
                (SELECT COUNT(*) FROM booking WHERE status='CANCELED')                                                                               AS canceledBookings,
                (SELECT IFNULL(ROUND(AVG(rating),1),0) FROM review)                                                                                  AS avgRating,
                (SELECT COUNT(*) FROM booking WHERE status='PAID')                                                                                   AS paySuccess,
                (SELECT COUNT(*) FROM booking WHERE status='PENDING')                                                                                AS pendingBookings,
                (SELECT IFNULL(SUM(total_amount),0) FROM booking WHERE status='PAID')                                                                AS revenuePaid,
                (SELECT IFNULL(SUM(total_amount),0) FROM booking WHERE status='PAID' AND YEAR(booking_time)=YEAR(NOW()) AND MONTH(booking_time)=MONTH(NOW())) AS revenueThisMonth,
                (SELECT IFNULL(SUM(total_amount),0) FROM booking WHERE status='CANCELED')                                                            AS revenueCanceled,
                (SELECT COUNT(*) FROM booking WHERE status IN ('PAID','PENDING'))                                                                     AS totalPayments
        `;
        const [result] = await db.query(sql);
        res.json(result[0]);
    } catch (err) {
        logger.error("GET STATS ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ===============================
   DOANH THU 6 THÁNG
=============================== */
exports.getRevenue6Months = async (req, res) => {
    try {
        const sql = `
            SELECT
                DATE_FORMAT(booking_time,'%m/%Y') AS month,
                SUM(total_amount)                  AS revenue
            FROM booking
            WHERE status='PAID'
              AND booking_time >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
            GROUP BY month
            ORDER BY booking_time
        `;
        const [result] = await db.query(sql);
        res.json(result);
    } catch (err) {
        logger.error("GET REVENUE ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ===============================
   ĐẶT VÉ THEO NGÀY
=============================== */
exports.getBookingsPerDay = async (req, res) => {
    try {
        const sql = `
            SELECT DATE(booking_time) AS date, COUNT(*) AS count
            FROM booking
            GROUP BY date
            ORDER BY date DESC
            LIMIT 10
        `;
        const [result] = await db.query(sql);
        res.json(result);
    } catch (err) {
        logger.error("GET BOOKINGS PER DAY ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ===============================
   TUYẾN PHỔ BIẾN
=============================== */
exports.getTopRoutes = async (req, res) => {
    try {
        const sql = `
            SELECT
                CONCAT(r.origin,' - ',r.destination) AS route,
                COUNT(b.booking_id)                  AS count
            FROM booking b
            JOIN trip t ON b.trip_id = t.trip_id
            JOIN route r ON t.route_id = r.route_id
            GROUP BY r.route_id
            ORDER BY count DESC
            LIMIT 5
        `;
        const [result] = await db.query(sql);
        res.json(result);
    } catch (err) {
        logger.error("GET TOP ROUTES ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ===============================
   REVIEW GẦN ĐÂY
=============================== */
exports.getReviews = async (req, res) => {
    try {
        const sql = `
            SELECT u.full_name AS user, rv.rating, rv.comment, rv.created_at,
                   r.origin, r.destination
            FROM review rv
            JOIN users u ON rv.user_id = u.user_id
            LEFT JOIN trip t ON rv.trip_id = t.trip_id
            LEFT JOIN route r ON t.route_id = r.route_id
            ORDER BY rv.created_at DESC
            LIMIT 10
        `;
        const [result] = await db.query(sql);
        res.json(result);
    } catch (err) {
        logger.error("GET REVIEWS ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

exports.getTopAIRecommendations = async (req, res) => {
    try {
        const sql = `
            SELECT
                CONCAT(r.origin,' - ',r.destination) AS route,
                COUNT(ar.recommend_id)               AS count
            FROM ai_recommendation ar
            JOIN trip t ON ar.trip_id = t.trip_id
            JOIN route r ON t.route_id = r.route_id
            GROUP BY r.route_id
            ORDER BY count DESC
            LIMIT 5
        `;
        const [result] = await db.query(sql);
        res.json(result);
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

exports.getTopActiveUsers = async (req, res) => {
    try {
        const sql = `
            SELECT u.full_name, COUNT(ub.behavior_id) AS actions
            FROM user_behavior ub
            JOIN users u ON ub.user_id = u.user_id
            GROUP BY ub.user_id
            ORDER BY actions DESC
            LIMIT 5
        `;
        const [result] = await db.query(sql);
        res.json(result);
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

exports.getPeakBookingHour = async (req, res) => {
    try {
        const sql = `
            SELECT HOUR(booking_time) AS hour, COUNT(*) AS count
            FROM booking
            GROUP BY hour
            ORDER BY hour
        `;
        const [result] = await db.query(sql);
        res.json(result);
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

exports.getBusOccupancy = async (req, res) => {
    try {
        const sql = `
            SELECT
                b.bus_id,
                b.total_seats,
                COUNT(bd.booking_detail_id) AS booked
            FROM bus b
            LEFT JOIN trip t ON b.bus_id = t.bus_id
            LEFT JOIN booking bk ON bk.trip_id = t.trip_id
            LEFT JOIN booking_detail bd ON bd.booking_id = bk.booking_id
            GROUP BY b.bus_id
        `;
        const [result] = await db.query(sql);
        const data = result.map(r => ({
            bus: r.bus_id,
            rate: ((r.booked || 0) / r.total_seats * 100).toFixed(1)
        }));
        res.json(data);
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

exports.getTripStatus = async (req, res) => {
    try {
        const sql = "SELECT status, COUNT(*) AS count FROM trip GROUP BY status";
        const [result] = await db.query(sql);
        res.json(result);
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

exports.getGrowthRate = async (req, res) => {
    try {
        const sql = `
            SELECT DATE_FORMAT(created_at,'%Y-%m') AS month, COUNT(*) AS users
            FROM users
            GROUP BY month
            ORDER BY month
        `;
        const [result] = await db.query(sql);
        res.json(result);
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ===============================
   BOOKING STATUS BREAKDOWN
=============================== */
exports.getBookingStatus = async (req, res) => {
    try {
        const [rows] = await db.query("SELECT status, COUNT(*) AS count FROM booking GROUP BY status");
        const result = {};
        rows.forEach(r => { result[r.status.toLowerCase()] = r.count; });
        res.json(result);
    } catch (err) { res.status(500).json({ message: "DB error" }); }
};

/* ===============================
   PAYMENT METHODS
=============================== */
exports.getPaymentMethods = async (req, res) => {
    try {
        const [rows] = await db.query("SELECT method, COUNT(*) AS count FROM payment GROUP BY method ORDER BY count DESC");
        res.json(rows);
    } catch (err) { res.status(500).json({ message: "DB error" }); }
};

/* ===============================
   REVENUE 12 MONTHS
=============================== */
exports.getRevenue12Months = async (req, res) => {
    try {
        const sql = `
            SELECT DATE_FORMAT(booking_time,'%m/%Y') AS month, SUM(total_amount) AS revenue
            FROM booking
            WHERE status='PAID' AND booking_time >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
            GROUP BY month ORDER BY booking_time
        `;
        const [result] = await db.query(sql);
        res.json(result);
    } catch (err) { res.status(500).json({ message: "DB error" }); }
};

/* ===============================
   REVENUE BY OPERATOR
=============================== */
exports.getRevenueByOperator = async (req, res) => {
    try {
        const sql = `
            SELECT o.name AS name, SUM(b.total_amount) AS revenue
            FROM booking b
            JOIN trip t ON b.trip_id = t.trip_id
            JOIN bus bs ON t.bus_id = bs.bus_id
            JOIN bus_operator o ON bs.operator_id = o.operator_id
            WHERE b.status='PAID'
            GROUP BY o.operator_id ORDER BY revenue DESC LIMIT 8
        `;
        const [result] = await db.query(sql);
        res.json(result);
    } catch (err) { res.status(500).json({ message: "DB error" }); }
};

/* ===============================
   REVENUE BY BUS TYPE
=============================== */
exports.getRevenueByBusType = async (req, res) => {
    try {
        const sql = `
            SELECT bs.bus_type AS bus_type, SUM(b.total_amount) AS revenue, COUNT(b.booking_id) AS bookings
            FROM booking b
            JOIN trip t ON b.trip_id = t.trip_id
            JOIN bus bs ON t.bus_id = bs.bus_id
            WHERE b.status='PAID'
            GROUP BY bs.bus_type ORDER BY revenue DESC
        `;
        const [result] = await db.query(sql);
        res.json(result);
    } catch (err) { res.status(500).json({ message: "DB error" }); }
};

/* ===============================
   RECENT TRIPS
=============================== */
exports.getRecentTrips = async (req, res) => {
    try {
        const sql = `
            SELECT t.trip_id, r.origin, r.destination, t.departure_time, t.status,
                   o.name AS operator_name, b.total_seats, t.base_price, b.plate_number,
                   ROUND(COUNT(DISTINCT bd.seat_id) / b.total_seats * 100, 1) AS occupancy_rate,
                   (b.total_seats - COUNT(DISTINCT bd.seat_id)) AS available_seats
            FROM trip t
            JOIN route r ON t.route_id = r.route_id
            JOIN bus b ON t.bus_id = b.bus_id
            JOIN bus_operator o ON b.operator_id = o.operator_id
            LEFT JOIN booking bk ON bk.trip_id = t.trip_id AND bk.status='PAID'
            LEFT JOIN booking_detail bd ON bd.booking_id = bk.booking_id
            GROUP BY t.trip_id ORDER BY t.departure_time DESC LIMIT 10
        `;
        const [result] = await db.query(sql);
        res.json(result);
    } catch (err) { res.status(500).json({ message: "DB error" }); }
};

/* ===============================
   RECENT USERS
=============================== */
exports.getRecentUsers = async (req, res) => {
    try {
        const [result] = await db.query(
            "SELECT user_id, full_name, email, phone, role, status, created_at FROM users ORDER BY created_at DESC LIMIT 10"
        );
        res.json(result);
    } catch (err) { res.status(500).json({ message: "DB error" }); }
};

/* ===============================
   USER STATS
=============================== */
exports.getUserStats = async (req, res) => {
    try {
        const sql = `
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN role='PASSENGER' THEN 1 ELSE 0 END) AS passengers,
                SUM(CASE WHEN role='OPERATOR' THEN 1 ELSE 0 END)  AS operators,
                SUM(CASE WHEN role='ADMIN' THEN 1 ELSE 0 END)     AS admins,
                SUM(CASE WHEN status='ACTIVE' THEN 1 ELSE 0 END)  AS active,
                SUM(CASE WHEN status!='ACTIVE' THEN 1 ELSE 0 END) AS blocked
            FROM users
        `;
        const [[result]] = await db.query(sql);
        res.json(result);
    } catch (err) { res.status(500).json({ message: "DB error" }); }
};

/* ===============================
   USER BEHAVIOR
=============================== */
exports.getUserBehavior = async (req, res) => {
    try {
        const sql = `
            SELECT action, COUNT(*) AS count
            FROM user_behavior
            GROUP BY action ORDER BY count DESC LIMIT 8
        `;
        const [result] = await db.query(sql);
        res.json(result);
    } catch (err) {
        // table may not exist yet
        res.json([]);
    }
};

/* ===============================
   USER BEHAVIOR BY HOUR
=============================== */
exports.getUserBehaviorHours = async (req, res) => {
    try {
        const sql = `
            SELECT HOUR(action_time) AS hour, COUNT(*) AS count
            FROM user_behavior
            GROUP BY hour ORDER BY hour
        `;
        const [result] = await db.query(sql);
        res.json(result);
    } catch (err) {
        res.json([]);
    }
};

/* ===============================
   AI STATS
=============================== */
exports.getAIStats = async (req, res) => {
    try {
        const sql = `
            SELECT
                COUNT(*)                                                                        AS totalRecommendations,
                ROUND(AVG(score), 2)                                                            AS avgScore,
                (SELECT COUNT(*) FROM user_behavior)                                            AS totalBehaviors,
                ROUND(
                    (SELECT COUNT(DISTINCT ar2.recommend_id)
                     FROM ai_recommendation ar2
                     JOIN booking bk ON bk.trip_id = ar2.trip_id AND bk.user_id = ar2.user_id AND bk.status='PAID')
                    / NULLIF(COUNT(*), 0) * 100, 1)                                             AS conversionRate
            FROM ai_recommendation
        `;
        const [[result]] = await db.query(sql);
        res.json(result);
    } catch (err) {
        res.json({ totalRecommendations: 0, avgScore: 0, totalBehaviors: 0, conversionRate: 0 });
    }
};

/* ===============================
   THÔNG BÁO ADMIN
=============================== */
exports.getNotifications = async (req, res) => {
    try {
        const notifs = [];

        /* ── 1. Người dùng mới đăng ký (7 ngày) ── */
        const [newUsers] = await db.query(`
            SELECT user_id, full_name, email, created_at
            FROM users
            WHERE role = 'PASSENGER' AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            ORDER BY created_at DESC LIMIT 15
        `);
        newUsers.forEach(u => notifs.push({
            id:      'usr_' + u.user_id,
            type:    'new_user',
            icon:    '👤',
            title:   'Hành khách mới đăng ký',
            message: u.full_name + ' — ' + u.email,
            time:    u.created_at,
            link:    'users.html'
        }));

        /* ── 2. Nhà xe mới đăng ký (10 gần nhất) ── */
        const [newOps] = await db.query(`
            SELECT operator_id, name, email, status
            FROM bus_operator
            ORDER BY operator_id DESC LIMIT 10
        `);
        newOps.forEach(o => notifs.push({
            id:      'op_' + o.operator_id,
            type:    'new_operator',
            icon:    '🚌',
            title:   'Nhà xe đăng ký',
            message: o.name + ' — ' + (o.status === 'ACTIVE' ? 'Đang hoạt động' : 'Tạm dừng'),
            time:    null,
            link:    'operators.html'
        }));

        /* ── 3. Đặt vé mới thành công (2 ngày) ── */
        const [newBk] = await db.query(`
            SELECT b.booking_id, b.booking_time, b.total_amount,
                   u.full_name, ro.origin, ro.destination
            FROM booking b
            JOIN users u  ON b.user_id  = u.user_id
            JOIN trip  t  ON b.trip_id  = t.trip_id
            JOIN route ro ON t.route_id = ro.route_id
            WHERE b.status = 'PAID'
              AND b.booking_time >= DATE_SUB(NOW(), INTERVAL 2 DAY)
            ORDER BY b.booking_time DESC LIMIT 15
        `);
        newBk.forEach(b => notifs.push({
            id:      'bk_' + b.booking_id,
            type:    'new_booking',
            icon:    '🎫',
            title:   'Vé mới được đặt',
            message: b.full_name + ': ' + b.origin + ' → ' + b.destination,
            time:    b.booking_time,
            link:    'admin.html'
        }));

        /* ── 4. Vé bị huỷ (3 ngày) ── */
        const [cancelBk] = await db.query(`
            SELECT b.booking_id, b.booking_time,
                   u.full_name, ro.origin, ro.destination
            FROM booking b
            JOIN users u  ON b.user_id  = u.user_id
            JOIN trip  t  ON b.trip_id  = t.trip_id
            JOIN route ro ON t.route_id = ro.route_id
            WHERE b.status = 'CANCELED'
              AND b.booking_time >= DATE_SUB(NOW(), INTERVAL 3 DAY)
            ORDER BY b.booking_time DESC LIMIT 10
        `);
        cancelBk.forEach(b => notifs.push({
            id:      'cancel_' + b.booking_id,
            type:    'cancel_booking',
            icon:    '❌',
            title:   'Vé bị huỷ',
            message: b.full_name + ': ' + b.origin + ' → ' + b.destination,
            time:    b.booking_time,
            link:    'admin.html'
        }));

        /* ── 5. Yêu cầu hỗ trợ chưa xử lý ── */
        const TYPE_LABEL = { GENERAL:'Chung', BOOKING:'Vé xe', PAYMENT:'Thanh toán', REFUND:'Hoàn tiền', TECHNICAL:'Kỹ thuật', COMPLAINT:'Khiếu nại', OTHER:'Khác' };
        const [supports] = await db.query(`
            SELECT r.request_id, r.type, r.title AS req_title, r.status, r.created_at,
                   u.full_name
            FROM support_request r
            JOIN users u ON r.user_id = u.user_id
            WHERE r.status IN ('PENDING', 'PROCESSING')
            ORDER BY r.created_at DESC LIMIT 10
        `);
        supports.forEach(s => notifs.push({
            id:      'sup_' + s.request_id,
            type:    'support',
            icon:    '🆘',
            title:   'Yêu cầu hỗ trợ mới',
            message: s.full_name + ' — ' + (TYPE_LABEL[s.type] || s.type) + ': ' + s.req_title,
            time:    s.created_at,
            link:    'support.html'
        }));

        /* ── 6. Đánh giá mới (3 ngày) ── */
        try {
            const [newReviews] = await db.query(`
                SELECT rv.review_id, rv.rating, rv.comment, rv.created_at,
                       u.full_name,
                       ro.origin, ro.destination
                FROM review rv
                JOIN users u ON rv.user_id = u.user_id
                LEFT JOIN trip t ON rv.trip_id = t.trip_id
                LEFT JOIN route ro ON t.route_id = ro.route_id
                WHERE rv.created_at >= DATE_SUB(NOW(), INTERVAL 3 DAY)
                ORDER BY rv.created_at DESC LIMIT 10
            `);
            const stars = r => '⭐'.repeat(Math.min(5, Math.max(1, Math.round(r))));
            newReviews.forEach(r => notifs.push({
                id:      'rev_' + r.review_id,
                type:    'new_review',
                icon:    r.rating >= 4 ? '⭐' : r.rating >= 3 ? '🌟' : '😞',
                title:   'Đánh giá mới ' + stars(r.rating),
                message: r.full_name + (r.origin ? ' · ' + r.origin + ' → ' + r.destination : '') + (r.comment ? ' — "' + r.comment.slice(0,40) + (r.comment.length>40?'…':'') + '"' : ''),
                time:    r.created_at,
                link:    'admin.html'
            }));
        } catch(e) { /* review table may not exist */ }

        /* ── 7. Vé đặt dịch vụ trên xe (extras) trong 1 ngày ── */
        try {
            const [svcOrders] = await db.query(`
                SELECT b.booking_id, b.booking_time, b.extras,
                       u.full_name, ro.origin, ro.destination
                FROM booking b
                JOIN users u ON b.user_id = u.user_id
                JOIN trip t ON b.trip_id = t.trip_id
                JOIN route ro ON t.route_id = ro.route_id
                WHERE b.extras IS NOT NULL
                  AND b.extras != '[]'
                  AND b.extras != 'null'
                  AND b.booking_time >= DATE_SUB(NOW(), INTERVAL 1 DAY)
                ORDER BY b.booking_time DESC LIMIT 8
            `);
            svcOrders.forEach(s => {
                let svcNames = '';
                try {
                    const items = JSON.parse(s.extras || '[]');
                    const onboard = items.filter(i => i.source === 'onboard');
                    if (!onboard.length) return;
                    svcNames = onboard.map(i => i.name).join(', ');
                } catch { return; }
                notifs.push({
                    id:      'svc_' + s.booking_id,
                    type:    'service_order',
                    icon:    '🛎️',
                    title:   'Dịch vụ trên xe được đặt',
                    message: s.full_name + ' — ' + (s.origin||'') + ' → ' + (s.destination||'') + ': ' + svcNames,
                    time:    s.booking_time,
                    link:    'admin.html'
                });
            });
        } catch(e) { /* silent */ }

        /* ── Sort by time desc, max 60 ── */
        notifs.sort((a, b) => new Date(b.time) - new Date(a.time));
        res.json(notifs.slice(0, 60));

    } catch (err) {
        logger.error('GET NOTIFICATIONS ERROR:', err);
        res.status(500).json({ message: 'DB error' });
    }
};

/* ===============================
   ALL BOOKINGS (admin - paginated + search + filter)
=============================== */
exports.getAllBookings = async (req, res) => {
    try {
        const { status, search, page = 1, limit = 20 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const wheres = [];
        const params = [];

        if (status) { wheres.push("b.status = ?"); params.push(status); }
        if (search) {
            wheres.push("(u.full_name LIKE ? OR u.email LIKE ? OR ro.origin LIKE ? OR ro.destination LIKE ?)");
            const s = `%${search}%`; params.push(s, s, s, s);
        }
        const wc = wheres.length ? "WHERE " + wheres.join(" AND ") : "";

        const [[{ total }]] = await db.query(
            `SELECT COUNT(*) AS total
             FROM booking b
             JOIN users u  ON b.user_id  = u.user_id
             JOIN trip  t  ON b.trip_id  = t.trip_id
             JOIN route ro ON t.route_id = ro.route_id ${wc}`, params
        );

        const [rows] = await db.query(
            `SELECT b.booking_id, b.booking_time, b.status, b.total_amount,
                    u.user_id, u.full_name, u.email,
                    ro.origin, ro.destination, t.departure_time, t.trip_id
             FROM booking b
             JOIN users u  ON b.user_id  = u.user_id
             JOIN trip  t  ON b.trip_id  = t.trip_id
             JOIN route ro ON t.route_id = ro.route_id
             ${wc}
             ORDER BY b.booking_time DESC
             LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), offset]
        );

        res.json({ total, page: parseInt(page), limit: parseInt(limit), data: rows });
    } catch (err) {
        logger.error("GET ALL BOOKINGS ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ===============================
   UPDATE BOOKING STATUS (admin)
=============================== */
exports.updateBookingStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        if (!["PAID","PENDING","CANCELED"].includes(status))
            return res.status(400).json({ message: "status không hợp lệ" });

        /* Phase 1 hardening — same rule as bookingController.updateBookingStatus:
           cancelling must atomically release any trip_seat_hold rows the
           booking owns, or the seat is stuck un-bookable forever (the hold
           table has no other cleanup path). */
        if (status === "CANCELED") {
            const conn = await db.getConnection();
            try {
                await conn.beginTransaction();
                await conn.query("UPDATE booking SET status = ? WHERE booking_id = ?", [status, id]);
                await conn.query("DELETE FROM trip_seat_hold WHERE booking_id=?", [id]);
                await conn.commit();
            } catch (err) {
                await conn.rollback();
                throw err;
            } finally {
                conn.release();
            }
        } else {
            await db.query("UPDATE booking SET status = ? WHERE booking_id = ?", [status, id]);
        }
        await Promise.all([
            cache.invalidate("trips:trending"),       // booking_count feeds the trending sort
            cache.invalidate("stats:public-summary"), // totalPassengers/completionRate can shift
        ]);
        res.json({ success: true, message: "Đã cập nhật trạng thái booking" });
    } catch (err) {
        logger.error("UPDATE BOOKING STATUS ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ═══════════════════════════════════════════════════════════
   AI ENGINE ENDPOINTS
   Delegates to recommendation.js algorithms
═══════════════════════════════════════════════════════════ */
const ai = require('../ai/recommendation');

/* AI — Top recommended routes (admin overview) */
exports.getAIRecommendations = async (req, res) => {
    try {
        const data = await ai.getTopRecommendedRoutes(10);
        res.json(data);
    } catch (err) {
        logger.error('GET AI RECOMMENDATIONS ERROR:', err);
        res.json([]);
    }
};

/* AI — Revenue forecast 30 days */
exports.getRevenueForecast = async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const data = await ai.forecastRevenue(days);
        res.json(data);
    } catch (err) {
        logger.error('GET REVENUE FORECAST ERROR:', err);
        res.json([]);
    }
};

/* AI — Anomaly detection */
exports.getAnomalyDetection = async (req, res) => {
    try {
        const data = await ai.detectAnomalies();
        res.json(data);
    } catch (err) {
        logger.error('GET ANOMALY DETECTION ERROR:', err);
        res.json([]);
    }
};

/* AI — Booking heatmap 7×24 */
exports.getBookingHeatmap = async (req, res) => {
    try {
        const data = await ai.getBookingHeatmap();
        res.json(data);
    } catch (err) {
        logger.error('GET BOOKING HEATMAP ERROR:', err);
        res.json({ matrix: [], raw: [], days: [], hours: [] });
    }
};

/* AI — Price prediction for a route + date */
exports.getPricePrediction = async (req, res) => {
    try {
        const { routeId, date } = req.query;
        if (!routeId) return res.status(400).json({ message: 'routeId required' });
        const data = await ai.predictOptimalPrice(routeId, date || null);
        res.json(data);
    } catch (err) {
        logger.error('GET PRICE PREDICTION ERROR:', err);
        res.status(500).json({ message: 'DB error' });
    }
};

/* AI — Demand forecast for a trip */
exports.getTripDemandForecast = async (req, res) => {
    try {
        const { tripId } = req.query;
        if (!tripId) return res.status(400).json({ message: 'tripId required' });
        const data = await ai.forecastDemand(tripId);
        res.json(data);
    } catch (err) {
        logger.error('GET TRIP DEMAND FORECAST ERROR:', err);
        res.status(500).json({ message: 'DB error' });
    }
};

/* AI — Classify support ticket */
exports.classifySupportTicket = async (req, res) => {
    try {
        const { title, content } = req.body;
        if (!title && !content) return res.status(400).json({ message: 'title or content required' });
        const data = ai.classifySupportTicket(title || '', content || '');
        res.json(data);
    } catch (err) {
        logger.error('CLASSIFY SUPPORT TICKET ERROR:', err);
        res.status(500).json({ message: 'Error' });
    }
};

/* ===============================
   ALL ROUTES with stats
=============================== */
exports.getAllRoutes = async (req, res) => {
    try {
        const page   = Math.max(1, parseInt(req.query.page)  || 1);
        const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
        const offset = (page - 1) * limit;
        const search = req.query.search?.trim() || "";
        const status = req.query.status || "";

        const wheres = [];
        const params = [];
        if (search) {
            wheres.push("(r.origin LIKE ? OR r.destination LIKE ?)");
            params.push(`%${search}%`, `%${search}%`);
        }
        if (status) { wheres.push("r.status=?"); params.push(status); }
        const where = wheres.length ? "WHERE " + wheres.join(" AND ") : "";

        const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM route r ${where}`, params);

        const [rows] = await db.query(`
            SELECT
                r.route_id, r.origin, r.destination,
                IFNULL(r.distance_km, 0)                                           AS distance_km,
                IFNULL(r.status, 'ACTIVE')                                         AS status,
                r.origin_lat, r.origin_lng, r.dest_lat, r.dest_lng,
                COUNT(DISTINCT t.trip_id)                                           AS total_trips,
                COUNT(DISTINCT b.booking_id)                                        AS total_bookings,
                IFNULL(SUM(CASE WHEN b.status='PAID' THEN b.total_amount END), 0)  AS total_revenue,
                COUNT(DISTINCT bo.operator_id)                                      AS operator_count
            FROM route r
            LEFT JOIN trip  t  ON r.route_id = t.route_id
            LEFT JOIN booking b ON t.trip_id = b.trip_id
            LEFT JOIN bus   bu ON t.bus_id = bu.bus_id
            LEFT JOIN bus_operator bo ON bu.operator_id = bo.operator_id
            ${where}
            GROUP BY r.route_id
            ORDER BY total_bookings DESC
            LIMIT ? OFFSET ?
        `, [...params, limit, offset]);

        res.json({ data: rows, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    } catch (err) {
        logger.error("GET ALL ROUTES ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ═══════════════════════════════════════════
   ROUTE BY ID
═══════════════════════════════════════════ */
exports.getRouteById = async (req, res) => {
    try {
        const [[row]] = await db.query(`
            SELECT r.*, COUNT(DISTINCT rs.stop_id) AS stop_count
            FROM route r
            LEFT JOIN route_stop rs ON rs.route_id = r.route_id AND rs.is_active = 1
            WHERE r.route_id = ?
            GROUP BY r.route_id
        `, [req.params.id]);
        if (!row) return res.status(404).json({ message: "Tuyến không tồn tại" });
        res.json(row);
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ═══════════════════════════════════════════
   CREATE ROUTE
═══════════════════════════════════════════ */
exports.createRoute = async (req, res) => {
    try {
        const { origin, destination, distance_km, origin_lat, origin_lng, dest_lat, dest_lng } = req.body;

        if (!origin?.trim() || !destination?.trim()) {
            return res.status(400).json({ message: "origin và destination là bắt buộc" });
        }
        const o = origin.trim(), d = destination.trim();
        if (o.toLowerCase() === d.toLowerCase()) {
            return res.status(422).json({ message: "Điểm đi và điểm đến không được trùng nhau" });
        }
        if (distance_km !== undefined && (isNaN(distance_km) || Number(distance_km) <= 0)) {
            return res.status(422).json({ message: "distance_km phải là số dương" });
        }

        /* Kiểm tra tuyến trùng (so sánh lowercase) */
        const [[dup]] = await db.query(
            "SELECT route_id FROM route WHERE LOWER(origin)=LOWER(?) AND LOWER(destination)=LOWER(?)",
            [o, d]
        );
        if (dup) return res.status(409).json({ message: "Tuyến này đã tồn tại", route_id: dup.route_id });

        const [result] = await db.query(
            `INSERT INTO route (origin, destination, distance_km, origin_lat, origin_lng, dest_lat, dest_lng, status)
             VALUES (?,?,?,?,?,?,?,'ACTIVE')`,
            [o, d, distance_km || null, origin_lat || null, origin_lng || null, dest_lat || null, dest_lng || null]
        );
        res.status(201).json({ message: "Tạo tuyến thành công", route_id: result.insertId });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ═══════════════════════════════════════════
   UPDATE ROUTE
═══════════════════════════════════════════ */
exports.updateRoute = async (req, res) => {
    try {
        const { id } = req.params;
        const { origin, destination, distance_km, origin_lat, origin_lng, dest_lat, dest_lng } = req.body;

        if (origin && destination && origin.trim().toLowerCase() === destination.trim().toLowerCase()) {
            return res.status(422).json({ message: "Điểm đi và điểm đến không được trùng nhau" });
        }
        if (distance_km !== undefined && (isNaN(distance_km) || Number(distance_km) <= 0)) {
            return res.status(422).json({ message: "distance_km phải là số dương" });
        }

        const [[existing]] = await db.query("SELECT route_id FROM route WHERE route_id=?", [id]);
        if (!existing) return res.status(404).json({ message: "Tuyến không tồn tại" });

        await db.query(
            `UPDATE route SET
                origin=COALESCE(?,origin),
                destination=COALESCE(?,destination),
                distance_km=COALESCE(?,distance_km),
                origin_lat=COALESCE(?,origin_lat),
                origin_lng=COALESCE(?,origin_lng),
                dest_lat=COALESCE(?,dest_lat),
                dest_lng=COALESCE(?,dest_lng)
             WHERE route_id=?`,
            [origin||null, destination||null, distance_km||null,
             origin_lat||null, origin_lng||null, dest_lat||null, dest_lng||null, id]
        );
        res.json({ message: "Cập nhật tuyến thành công" });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ═══════════════════════════════════════════
   UPDATE ROUTE STATUS
═══════════════════════════════════════════ */
exports.updateRouteStatus = async (req, res) => {
    try {
        const { status } = req.body;
        if (!["ACTIVE", "INACTIVE"].includes(status)) {
            return res.status(422).json({ message: "status phải là ACTIVE hoặc INACTIVE" });
        }
        const [[existing]] = await db.query("SELECT route_id FROM route WHERE route_id=?", [req.params.id]);
        if (!existing) return res.status(404).json({ message: "Tuyến không tồn tại" });

        await db.query("UPDATE route SET status=? WHERE route_id=?", [status, req.params.id]);
        res.json({ message: "Cập nhật trạng thái thành công" });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ═══════════════════════════════════════════
   DELETE ROUTE — soft delete nếu có trip/booking
═══════════════════════════════════════════ */
exports.deleteRoute = async (req, res) => {
    try {
        const { id } = req.params;
        const [[{ tripCount }]] = await db.query(
            "SELECT COUNT(*) AS tripCount FROM trip WHERE route_id=?", [id]
        );
        if (tripCount > 0) {
            await db.query("UPDATE route SET status='INACTIVE' WHERE route_id=?", [id]);
            return res.json({ message: "Tuyến đã có chuyến xe — đã vô hiệu hóa thay vì xóa", soft: true });
        }
        await db.query("DELETE FROM route WHERE route_id=?", [id]);
        res.json({ message: "Đã xóa tuyến", soft: false });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ═══════════════════════════════════════════
   US-102: IMPORT ROUTES — PREVIEW (không ghi DB)
═══════════════════════════════════════════ */
exports.importRoutesPreview = async (req, res) => {
    try {
        const rows = req.body.rows; // [{ origin, destination, distance_km, ... }]
        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ message: "Không có dữ liệu để preview" });
        }
        if (rows.length > 500) {
            return res.status(400).json({ message: "Tối đa 500 dòng mỗi lần import" });
        }

        /* Load existing routes để check duplicate */
        const [existingRoutes] = await db.query(
            "SELECT LOWER(origin) AS o, LOWER(destination) AS d FROM route"
        );
        const existingSet = new Set(existingRoutes.map(r => `${r.o}|${r.d}`));

        const inFileSet = new Set();
        const results = rows.map((row, idx) => {
            const rowNum = idx + 1;
            const errors = [];
            const origin = String(row.origin || "").trim();
            const destination = String(row.destination || "").trim();
            const distance_km = row.distance_km !== undefined ? Number(row.distance_km) : null;

            if (!origin) errors.push({ field: "origin", message: "Bắt buộc" });
            if (!destination) errors.push({ field: "destination", message: "Bắt buộc" });
            if (origin && destination && origin.toLowerCase() === destination.toLowerCase()) {
                errors.push({ field: "destination", message: "Điểm đi và đến không được trùng" });
            }
            if (row.distance_km !== undefined && row.distance_km !== "" && (isNaN(distance_km) || distance_km <= 0)) {
                errors.push({ field: "distance_km", message: "Phải là số dương" });
            }

            const key = `${origin.toLowerCase()}|${destination.toLowerCase()}`;
            let status = "VALID";
            if (errors.length > 0) {
                status = "INVALID";
            } else if (existingSet.has(key)) {
                status = "DUPLICATE_DB";
                errors.push({ field: "route", message: "Tuyến đã tồn tại trong database" });
            } else if (inFileSet.has(key)) {
                status = "DUPLICATE_FILE";
                errors.push({ field: "route", message: "Tuyến bị trùng trong file" });
            } else {
                inFileSet.add(key);
            }

            return {
                rowNumber: rowNum,
                origin, destination,
                distance_km: isNaN(distance_km) ? null : distance_km,
                origin_lat: row.origin_lat || null,
                origin_lng: row.origin_lng || null,
                dest_lat: row.dest_lat || null,
                dest_lng: row.dest_lng || null,
                status,
                errors
            };
        });

        const valid    = results.filter(r => r.status === "VALID").length;
        const invalid  = results.filter(r => r.status === "INVALID").length;
        const dupDb    = results.filter(r => r.status === "DUPLICATE_DB").length;
        const dupFile  = results.filter(r => r.status === "DUPLICATE_FILE").length;

        res.json({
            summary: { total: rows.length, valid, invalid, duplicate_db: dupDb, duplicate_file: dupFile },
            rows: results
        });
    } catch (err) {
        logger.error("IMPORT PREVIEW ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ═══════════════════════════════════════════
   US-102: IMPORT ROUTES — CONFIRM (ghi DB)
═══════════════════════════════════════════ */
exports.importRoutesConfirm = async (req, res) => {
    try {
        const rows = req.body.rows;
        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ message: "Không có dữ liệu để import" });
        }

        /* Chỉ import những dòng VALID */
        const validRows = rows.filter(r => r.status === "VALID");
        if (validRows.length === 0) {
            return res.status(400).json({ message: "Không có dòng hợp lệ để import" });
        }

        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            let inserted = 0;
            const skipped = [];

            for (const row of validRows) {
                const o = String(row.origin || "").trim();
                const d = String(row.destination || "").trim();
                /* Re-check duplicate tại thời điểm import để tránh race condition */
                const [[dup]] = await conn.query(
                    "SELECT route_id FROM route WHERE LOWER(origin)=LOWER(?) AND LOWER(destination)=LOWER(?)", [o, d]
                );
                if (dup) {
                    skipped.push({ origin: o, destination: d, reason: "Đã tồn tại" });
                    continue;
                }
                await conn.query(
                    `INSERT INTO route (origin, destination, distance_km, origin_lat, origin_lng, dest_lat, dest_lng, status)
                     VALUES (?,?,?,?,?,?,?,'ACTIVE')`,
                    [o, d, row.distance_km || null, row.origin_lat || null, row.origin_lng || null,
                     row.dest_lat || null, row.dest_lng || null]
                );
                inserted++;
            }

            await conn.commit();
            res.json({ message: "Import thành công", inserted, skipped: skipped.length, skipped_detail: skipped });
        } catch (e) {
            await conn.rollback();
            throw e;
        } finally {
            conn.release();
        }
    } catch (err) {
        logger.error("IMPORT CONFIRM ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ═══════════════════════════════════════════
   US-201: LOCATION CRUD
═══════════════════════════════════════════ */
const LAT_RE  = /^-?([0-8]?\d(\.\d+)?|90(\.0+)?)$/;
const LNG_RE  = /^-?((1[0-7]\d|\d{1,2})(\.\d+)?|180(\.0+)?)$/;

function validateLatLng(lat, lng) {
    const errors = [];
    if (lat !== null && lat !== undefined && lat !== "") {
        const v = Number(lat);
        if (isNaN(v) || !isFinite(v) || v < -90 || v > 90) {
            errors.push({ field: "latitude", message: "latitude phải trong [-90, 90]" });
        }
    }
    if (lng !== null && lng !== undefined && lng !== "") {
        const v = Number(lng);
        if (isNaN(v) || !isFinite(v) || v < -180 || v > 180) {
            errors.push({ field: "longitude", message: "longitude phải trong [-180, 180]" });
        }
    }
    return errors;
}

exports.getLocations = async (req, res) => {
    try {
        const page   = Math.max(1, parseInt(req.query.page)  || 1);
        const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
        const offset = (page - 1) * limit;
        const search = req.query.search?.trim() || "";
        const type   = req.query.type   || "";
        const status = req.query.status || "";

        const wheres = [], params = [];
        if (search) { wheres.push("(l.name LIKE ? OR l.address LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }
        if (type)   { wheres.push("l.type=?");   params.push(type); }
        if (status) { wheres.push("l.status=?"); params.push(status); }
        const where = wheres.length ? "WHERE " + wheres.join(" AND ") : "";

        const [[{ total }]] = await db.query(
            `SELECT COUNT(*) AS total FROM location l ${where}`, params
        );
        const [rows] = await db.query(
            `SELECT * FROM location l ${where} ORDER BY l.name ASC LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );
        res.json({ data: rows, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

exports.createLocation = async (req, res) => {
    try {
        const { name, type, province, address, latitude, longitude } = req.body;
        if (!name?.trim()) return res.status(400).json({ message: "name là bắt buộc" });

        const gpsErrors = validateLatLng(latitude, longitude);
        if (gpsErrors.length) return res.status(422).json({ message: gpsErrors[0].message, errors: gpsErrors });

        const lat = (latitude !== null && latitude !== undefined && latitude !== "") ? Number(latitude) : null;
        const lng = (longitude !== null && longitude !== undefined && longitude !== "") ? Number(longitude) : null;

        const [[dup]] = await db.query(
            "SELECT location_id FROM location WHERE LOWER(name)=LOWER(?) AND LOWER(IFNULL(type,''))=LOWER(IFNULL(?,''))",
            [name.trim(), type || ""]
        );
        if (dup) return res.status(409).json({ message: "Địa điểm này đã tồn tại" });

        const [result] = await db.query(
            `INSERT INTO location (name, type, province, address, latitude, longitude, status)
             VALUES (?,?,?,?,?,?,'ACTIVE')`,
            [name.trim(), type || null, province || null, address || null, lat, lng]
        );
        res.status(201).json({ message: "Tạo địa điểm thành công", location_id: result.insertId });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

exports.updateLocation = async (req, res) => {
    try {
        const { name, type, province, address, latitude, longitude } = req.body;
        const gpsErrors = validateLatLng(latitude, longitude);
        if (gpsErrors.length) return res.status(422).json({ message: gpsErrors[0].message, errors: gpsErrors });

        const [[existing]] = await db.query("SELECT location_id FROM location WHERE location_id=?", [req.params.id]);
        if (!existing) return res.status(404).json({ message: "Địa điểm không tồn tại" });

        const lat = (latitude !== null && latitude !== undefined && latitude !== "") ? Number(latitude) : null;
        const lng = (longitude !== null && longitude !== undefined && longitude !== "") ? Number(longitude) : null;

        await db.query(
            `UPDATE location SET
                name=COALESCE(?,name), type=COALESCE(?,type), province=COALESCE(?,province),
                address=COALESCE(?,address),
                latitude=?, longitude=?,
                updated_at=NOW()
             WHERE location_id=?`,
            [name||null, type||null, province||null, address||null, lat, lng, req.params.id]
        );
        res.json({ message: "Cập nhật địa điểm thành công" });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

exports.updateLocationStatus = async (req, res) => {
    try {
        const { status } = req.body;
        if (!["ACTIVE", "INACTIVE"].includes(status)) {
            return res.status(422).json({ message: "status phải là ACTIVE hoặc INACTIVE" });
        }
        const [[existing]] = await db.query("SELECT location_id FROM location WHERE location_id=?", [req.params.id]);
        if (!existing) return res.status(404).json({ message: "Địa điểm không tồn tại" });
        await db.query("UPDATE location SET status=? WHERE location_id=?", [status, req.params.id]);
        res.json({ message: "Cập nhật trạng thái thành công" });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

exports.deleteLocation = async (req, res) => {
    try {
        await db.query("UPDATE location SET status='INACTIVE' WHERE location_id=?", [req.params.id]);
        res.json({ message: "Đã vô hiệu hóa địa điểm" });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ═══════════════════════════════════════════════════════════
   Sprint 12 — Quick Demo Mode: 1-click "reset demo session" for the
   thesis defense. Deliberately conservative — this does NOT wipe and
   re-seed the whole database (routes/trips/users took a real seed run
   to build and a full reseed is slow and risky to gate behind one
   click). It only clears the kind of session noise that would look bad
   live in front of a committee:
     - stuck PENDING bookings (any age, not just the 15-min-old ones the
       background cleanup job already catches) — releases their seat
       holds via the same atomic pattern updateBookingStatus uses.
     - the AI intent-predictor log (ai_intent_log) — a demo run's own
       test clicks shouldn't show up as "real" traffic in the next demo.
   PAID bookings, users, routes, trips, and reviews are never touched.
═══════════════════════════════════════════════════════════ */
exports.resetDemoData = async (req, res) => {
    try {
        const [pending] = await db.query("SELECT booking_id FROM booking WHERE status='PENDING'");
        let canceled = 0;
        for (const { booking_id } of pending) {
            const conn = await db.getConnection();
            try {
                await conn.beginTransaction();
                const [upd] = await conn.query(
                    "UPDATE booking SET status='CANCELED' WHERE booking_id=? AND status='PENDING'",
                    [booking_id]
                );
                if (upd.affectedRows === 1) {
                    await conn.query("DELETE FROM trip_seat_hold WHERE booking_id=?", [booking_id]);
                    await conn.commit();
                    canceled++;
                } else {
                    await conn.rollback();
                }
            } catch (err) {
                await conn.rollback();
                logger.error(`[resetDemoData] Failed to cancel booking_id=${booking_id}:`, err.message);
            } finally {
                conn.release();
            }
        }

        const [intentLogResult] = await db.query("DELETE FROM ai_intent_log").catch(() => [{ affectedRows: 0 }]);

        await cache.clear(); // every cached read (trending, public stats) must reflect the reset state immediately

        res.json({
            message: "Đã khôi phục dữ liệu demo",
            canceled_pending_bookings: canceled,
            cleared_intent_logs: intentLogResult.affectedRows || 0,
        });
    } catch (err) {
        logger.error("RESET DEMO DATA ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};
