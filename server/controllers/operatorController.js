const db = require("../config/db");
const logger = require('../utils/logger');

/* Phase 2I Step 4: every dashboard function below is scoped to the
   authenticated operator's own operator_id (req.operatorId, resolved by
   operatorScope.js) when the caller is OPERATOR, and left platform-wide
   for ADMIN (req.operatorId === null). An OPERATOR account with no
   resolved operator_id (req.operatorId === undefined — not linked to any
   bus_operator row) owns nothing; isUnlinkedOperator() detects this so
   each handler can short-circuit to an empty result instead of silently
   falling through to global data. */
function isUnlinkedOperator(req) {
    return req.user.role === "OPERATOR" && req.operatorId == null;
}

/* ============================================
   GET ALL OPERATORS (Admin)
============================================ */
exports.getOperators = async (req, res) => {
    try {
        const sql = `
            SELECT
                o.*,
                COUNT(DISTINCT b.bus_id)      AS bus_count,
                COUNT(DISTINCT t.trip_id)     AS trip_count,
                IFNULL(AVG(rv.rating), 0)     AS avg_rating,
                COUNT(DISTINCT rv.review_id)  AS review_count,
                COUNT(DISTINCT orv.review_id) AS op_review_count
            FROM bus_operator o
            LEFT JOIN bus b    ON b.operator_id = o.operator_id
            LEFT JOIN trip t   ON t.bus_id = b.bus_id
            LEFT JOIN review rv  ON rv.trip_id = t.trip_id
            LEFT JOIN operator_review orv ON orv.operator_id = o.operator_id
            GROUP BY o.operator_id
            ORDER BY o.name ASC
        `;
        const [result] = await db.query(sql);
        res.json(result);
    } catch (err) {
        logger.error(err);
        res.status(500).json({ error: "Database error" });
    }
};

/* ============================================
   CREATE OPERATOR
============================================ */
exports.createOperator = async (req, res) => {
    try {
        const { name, address, phone, email } = req.body;
        const [result] = await db.query(
            "INSERT INTO bus_operator(name,address,phone,email,status) VALUES(?,?,?,?,'ACTIVE')",
            [name, address, phone, email]
        );
        res.json({ message: "Operator created", operator_id: result.insertId });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ error: "Insert failed" });
    }
};

/* ============================================
   UPDATE OPERATOR
============================================ */
exports.updateOperator = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, address, phone, email, status, license_number, established_year } = req.body;
        await db.query(
            `UPDATE bus_operator SET
                name=?, address=?, phone=?, email=?,
                status=IFNULL(?,status),
                license_number=IFNULL(?,license_number),
                established_year=IFNULL(?,established_year)
             WHERE operator_id=?`,
            [name, address, phone, email, status||null, license_number||null, established_year||null, id]
        );
        res.json({ message: "Operator updated" });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ error: "Update failed" });
    }
};

/* ============================================
   DISABLE OPERATOR (soft delete)
============================================ */
exports.deleteOperator = async (req, res) => {
    try {
        const { id } = req.params;
        await db.query("UPDATE bus_operator SET status='SUSPENDED' WHERE operator_id=?", [id]);
        res.json({ message: "Operator disabled" });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ error: "Operation failed" });
    }
};

/* ============================================
   OPERATOR DASHBOARD STATS
   GET /api/operators/dashboard/stats

   Enterprise Hardening follow-up: operator.html's loadStats() reads a much
   richer KPI shape (todayRevenue, todayBookings, activeTrips, activeBus,
   totalSeats, bookingRate, avgTicket, totalBus, totalRoutes, monthRevenue,
   monthBookings, fullTrips, canceledTrips, maintenanceBus, revGrowth,
   bkGrowth) than this endpoint used to return (totalTrips, totalBookings,
   totalRevenue, avgRating only) — every one of those extra fields was
   `undefined` on the frontend, silently rendering as "0"/"0 đ" once the
   separate opName ReferenceError in operator.html was fixed. The 4
   original fields are kept as-is: operator/revenue.html's updateKPI()
   reads statsData.totalRevenue/totalBookings/totalTrips directly and must
   not break.
============================================ */
exports.getDashboardStats = async (req, res) => {
    const emptyStats = {
        totalTrips: 0, totalBookings: 0, totalRevenue: 0, avgRating: 0,
        todayRevenue: 0, todayBookings: 0, activeTrips: 0, activeBus: 0,
        totalSeats: 0, bookingRate: 0, avgTicket: 0, totalBus: 0, totalRoutes: 0,
        monthRevenue: 0, monthBookings: 0, fullTrips: 0, canceledTrips: 0,
        maintenanceBus: 0, revGrowth: 0, bkGrowth: 0,
    };
    try {
        if (isUnlinkedOperator(req)) return res.json(emptyStats);
        const opId = req.operatorId;

        const tripScope   = opId == null ? "trip t"    : "trip t JOIN bus b ON t.bus_id=b.bus_id";
        const bookingScope = opId == null ? "booking bk JOIN trip t ON bk.trip_id=t.trip_id" : "booking bk JOIN trip t ON bk.trip_id=t.trip_id JOIN bus b ON t.bus_id=b.bus_id";
        const busWhere     = opId == null ? "" : "WHERE operator_id=?";
        const tripWhere    = (extra) => opId == null ? (extra ? `WHERE ${extra}` : "") : `WHERE b.operator_id=?${extra ? ` AND ${extra}` : ""}`;
        const bookingWhere = (extra) => opId == null ? `WHERE bk.status='PAID'${extra ? ` AND ${extra}` : ""}` : `WHERE b.operator_id=? AND bk.status='PAID'${extra ? ` AND ${extra}` : ""}`;

        const sql = `
            SELECT
                (SELECT COUNT(*) FROM ${tripScope} ${tripWhere("")})                                              AS totalTrips,
                (SELECT COUNT(*) FROM ${bookingScope} ${bookingWhere("")})                                          AS totalBookings,
                (SELECT IFNULL(SUM(bk.total_amount),0) FROM ${bookingScope} ${bookingWhere("")})                    AS totalRevenue,
                (SELECT IFNULL(AVG(rv.rating),0) FROM review rv JOIN trip t ON rv.trip_id=t.trip_id ${opId == null ? "" : "JOIN bus b ON t.bus_id=b.bus_id"} ${tripWhere("")}) AS avgRating,

                (SELECT IFNULL(SUM(bk.total_amount),0) FROM ${bookingScope} ${bookingWhere("DATE(bk.booking_time)=CURDATE()")}) AS todayRevenue,
                (SELECT COUNT(*) FROM ${bookingScope} ${bookingWhere("DATE(bk.booking_time)=CURDATE()")})                       AS todayBookings,
                (SELECT IFNULL(SUM(bk.total_amount),0) FROM ${bookingScope} ${bookingWhere("DATE(bk.booking_time)=CURDATE() - INTERVAL 1 DAY")}) AS yesterdayRevenue,
                (SELECT COUNT(*) FROM ${bookingScope} ${bookingWhere("DATE(bk.booking_time)=CURDATE() - INTERVAL 1 DAY")})                        AS yesterdayBookings,

                (SELECT COUNT(*) FROM ${tripScope} ${tripWhere("t.status='OPEN'")})     AS activeTrips,
                (SELECT COUNT(*) FROM ${tripScope} ${tripWhere("t.status='FULL'")})     AS fullTrips,
                (SELECT COUNT(*) FROM ${tripScope} ${tripWhere("t.status='CANCELED'")}) AS canceledTrips,

                (SELECT COUNT(*) FROM bus ${busWhere}${opId == null ? "WHERE" : " AND"} status='AVAILABLE')   AS activeBus,
                (SELECT COUNT(*) FROM bus ${busWhere}${opId == null ? "WHERE" : " AND"} status='MAINTENANCE') AS maintenanceBus,
                (SELECT COUNT(*) FROM bus ${busWhere})                                                        AS totalBus,
                (SELECT IFNULL(SUM(total_seats),0) FROM bus ${busWhere})                                      AS totalSeats,

                (SELECT COUNT(DISTINCT t.route_id) FROM ${tripScope} ${tripWhere("")}) AS totalRoutes,

                (SELECT IFNULL(SUM(bk.total_amount),0) FROM ${bookingScope} ${bookingWhere("YEAR(bk.booking_time)=YEAR(NOW()) AND MONTH(bk.booking_time)=MONTH(NOW())")}) AS monthRevenue,
                (SELECT COUNT(*) FROM ${bookingScope} ${bookingWhere("YEAR(bk.booking_time)=YEAR(NOW()) AND MONTH(bk.booking_time)=MONTH(NOW())")})                       AS monthBookings,

                (SELECT COUNT(*) FROM ${opId == null ? "booking bk JOIN trip t ON bk.trip_id=t.trip_id" : "booking bk JOIN trip t ON bk.trip_id=t.trip_id JOIN bus b ON t.bus_id=b.bus_id"} ${opId == null ? "" : "WHERE b.operator_id=?"}) AS allBookingsAttempted
        `;
        /* busWhere's "AVAILABLE"/"MAINTENANCE" branches add operator_id
           twice each (once via busWhere, once implicitly reused) only when
           opId is set — count the real `?` occurrences below instead of
           trying to reason about the template string. */
        const placeholderCount = (sql.match(/\?/g) || []).length;
        const params = opId == null ? [] : new Array(placeholderCount).fill(opId);

        const [result] = await db.query(sql, params);
        const r = result[0];

        const totalBookings = Number(r.totalBookings || 0);
        const totalRevenue = Number(r.totalRevenue || 0);
        const allAttempted = Number(r.allBookingsAttempted || 0);
        const todayRevenue = Number(r.todayRevenue || 0);
        const yesterdayRevenue = Number(r.yesterdayRevenue || 0);
        const todayBookings = Number(r.todayBookings || 0);
        const yesterdayBookings = Number(r.yesterdayBookings || 0);

        const pctGrowth = (today, yesterday) => {
            if (yesterday > 0) return Math.round(((today - yesterday) / yesterday) * 1000) / 10;
            return today > 0 ? 100 : 0;
        };

        res.json({
            totalTrips: Number(r.totalTrips || 0),
            totalBookings,
            totalRevenue,
            avgRating: Number(r.avgRating || 0),

            todayRevenue,
            todayBookings,
            activeTrips: Number(r.activeTrips || 0),
            activeBus: Number(r.activeBus || 0),
            totalSeats: Number(r.totalSeats || 0),
            bookingRate: allAttempted > 0 ? Math.round((totalBookings / allAttempted) * 1000) / 10 : 0,
            avgTicket: totalBookings > 0 ? Math.round(totalRevenue / totalBookings) : 0,
            totalBus: Number(r.totalBus || 0),
            totalRoutes: Number(r.totalRoutes || 0),
            monthRevenue: Number(r.monthRevenue || 0),
            monthBookings: Number(r.monthBookings || 0),
            fullTrips: Number(r.fullTrips || 0),
            canceledTrips: Number(r.canceledTrips || 0),
            maintenanceBus: Number(r.maintenanceBus || 0),
            revGrowth: pctGrowth(todayRevenue, yesterdayRevenue),
            bkGrowth: pctGrowth(todayBookings, yesterdayBookings),
        });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ============================================
   REVENUE DATA
   GET /api/operators/dashboard/revenue
============================================ */
exports.getRevenue = async (req, res) => {
    try {
        if (isUnlinkedOperator(req)) return res.json([]);
        const { from, to } = req.query;
        const opId = req.operatorId;
        let sql = opId == null
            ? `SELECT DATE_FORMAT(booking_time,'%m/%Y') AS month, SUM(total_amount) AS revenue, COUNT(*) AS bookings
               FROM booking WHERE status='PAID'`
            : `SELECT DATE_FORMAT(b.booking_time,'%m/%Y') AS month, SUM(b.total_amount) AS revenue, COUNT(*) AS bookings
               FROM booking b JOIN trip t ON b.trip_id=t.trip_id JOIN bus bs ON t.bus_id=bs.bus_id
               WHERE b.status='PAID' AND bs.operator_id=?`;
        const params = opId == null ? [] : [opId];
        if (from) { sql += (opId == null ? " AND booking_time >= ?" : " AND b.booking_time >= ?"); params.push(from); }
        if (to)   { sql += (opId == null ? " AND booking_time <= ?" : " AND b.booking_time <= ?"); params.push(to); }
        sql += opId == null ? " GROUP BY month ORDER BY booking_time" : " GROUP BY month ORDER BY b.booking_time";
        const [result] = await db.query(sql, params);
        res.json(result);
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ============================================
   TOP ROUTES
   GET /api/operators/dashboard/routes
============================================ */
exports.getTopRoutes = async (req, res) => {
    try {
        if (isUnlinkedOperator(req)) return res.json([]);
        const opId = req.operatorId;
        const sql = `
            SELECT
                CONCAT(r.origin,' → ',r.destination) AS route,
                COUNT(b.booking_id)                  AS count,
                SUM(b.total_amount)                  AS revenue
            FROM booking b
            JOIN trip t ON b.trip_id = t.trip_id
            JOIN route r ON t.route_id = r.route_id
            JOIN bus bs ON t.bus_id = bs.bus_id
            WHERE b.status='PAID' ${opId == null ? "" : "AND bs.operator_id=?"}
            GROUP BY r.route_id
            ORDER BY count DESC
            LIMIT 5
        `;
        const [result] = await db.query(sql, opId == null ? [] : [opId]);
        res.json(result);
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ============================================
   BOOKING STATUS BREAKDOWN
   GET /api/operators/dashboard/booking-status
============================================ */
exports.getBookingStatus = async (req, res) => {
    try {
        if (isUnlinkedOperator(req)) return res.json({ paid: 0, pending: 0, canceled: 0 });
        const opId = req.operatorId;
        const [rows] = opId == null
            ? await db.query("SELECT status, COUNT(*) AS count FROM booking GROUP BY status")
            : await db.query(
                `SELECT b.status, COUNT(*) AS count FROM booking b
                 JOIN trip t ON b.trip_id=t.trip_id JOIN bus bs ON t.bus_id=bs.bus_id
                 WHERE bs.operator_id=? GROUP BY b.status`, [opId]
              );
        const result = { paid: 0, pending: 0, canceled: 0 };
        rows.forEach(r => {
            if (r.status === "PAID")     result.paid     = r.count;
            if (r.status === "PENDING")  result.pending  = r.count;
            if (r.status === "CANCELED") result.canceled = r.count;
        });
        res.json(result);
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ============================================
   SEAT OCCUPANCY
   GET /api/operators/dashboard/seat-occupancy
============================================ */
exports.getSeatOccupancy = async (req, res) => {
    try {
        if (isUnlinkedOperator(req)) return res.json([]);
        const opId = req.operatorId;
        const sql = `
            SELECT
                CONCAT(r.origin,' → ',r.destination) AS route,
                b.total_seats                         AS total,
                COUNT(DISTINCT bd.seat_id)            AS booked
            FROM trip t
            JOIN bus b ON t.bus_id = b.bus_id
            JOIN route r ON t.route_id = r.route_id
            LEFT JOIN booking bk ON bk.trip_id = t.trip_id AND bk.status='PAID'
            LEFT JOIN booking_detail bd ON bd.booking_id = bk.booking_id
            ${opId == null ? "" : "WHERE b.operator_id=?"}
            GROUP BY t.trip_id
            ORDER BY booked DESC
            LIMIT 6
        `;
        const [result] = await db.query(sql, opId == null ? [] : [opId]);
        res.json(result);
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ============================================
   RECENT TRIPS
   GET /api/operators/dashboard/recent-trips
============================================ */
exports.getRecentTrips = async (req, res) => {
    try {
        if (isUnlinkedOperator(req)) return res.json([]);
        const opId = req.operatorId;
        const sql = `
            SELECT
                r.origin, r.destination,
                t.departure_time, t.base_price, t.status,
                b.total_seats,
                (b.total_seats - COUNT(DISTINCT bd.seat_id)) AS available_seats
            FROM trip t
            JOIN route r ON t.route_id = r.route_id
            JOIN bus b ON t.bus_id = b.bus_id
            LEFT JOIN booking bk ON bk.trip_id = t.trip_id AND bk.status='PAID'
            LEFT JOIN booking_detail bd ON bd.booking_id = bk.booking_id
            ${opId == null ? "" : "WHERE b.operator_id=?"}
            GROUP BY t.trip_id
            ORDER BY t.departure_time ASC
            LIMIT 7
        `;
        const [result] = await db.query(sql, opId == null ? [] : [opId]);
        res.json(result);
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ============================================
   FLEET (Buses)
   GET /api/operators/dashboard/buses
============================================ */
exports.getBuses = async (req, res) => {
    try {
        if (isUnlinkedOperator(req)) return res.json([]);
        const opId = req.operatorId;
        const sql = `
            SELECT
                b.bus_id, b.plate_number, b.bus_type, b.total_seats, b.status,
                CASE WHEN t.trip_id IS NOT NULL
                     THEN CONCAT(r.origin,' → ',r.destination)
                     ELSE NULL END AS active_trip
            FROM bus b
            LEFT JOIN trip t ON t.bus_id = b.bus_id
                AND t.status IN ('OPEN','FULL')
                AND t.departure_time >= NOW()
            LEFT JOIN route r ON t.route_id = r.route_id
            ${opId == null ? "" : "WHERE b.operator_id=?"}
            GROUP BY b.bus_id
            ORDER BY b.bus_id
        `;
        const [result] = await db.query(sql, opId == null ? [] : [opId]);
        res.json(result);
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ============================================
   REVIEWS FOR OPERATOR
   GET /api/operators/dashboard/reviews
============================================ */
exports.getReviews = async (req, res) => {
    try {
        if (isUnlinkedOperator(req)) return res.json([]);
        const opId = req.operatorId;
        const sql = `
            SELECT
                u.full_name,
                rv.rating,
                rv.comment,
                CONCAT(r.origin,' → ',r.destination) AS route
            FROM review rv
            JOIN users u ON rv.user_id = u.user_id
            JOIN trip t ON rv.trip_id = t.trip_id
            JOIN route r ON t.route_id = r.route_id
            JOIN bus bs ON t.bus_id = bs.bus_id
            ${opId == null ? "" : "WHERE bs.operator_id=?"}
            ORDER BY rv.created_at DESC
            LIMIT 10
        `;
        const [result] = await db.query(sql, opId == null ? [] : [opId]);
        res.json(result);
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ============================================
   PAYMENTS / REVENUE DETAILS
   GET /api/operators/dashboard/payments
============================================ */
exports.getPayments = async (req, res) => {
    try {
        if (isUnlinkedOperator(req)) return res.json([]);
        const opId = req.operatorId;
        const { from, to } = req.query;
        let sql = `
            SELECT
                b.booking_id,
                u.full_name,
                b.total_amount,
                b.status,
                b.booking_time,
                r.origin, r.destination
            FROM booking b
            JOIN users u ON b.user_id = u.user_id
            JOIN trip t ON b.trip_id = t.trip_id
            JOIN route r ON t.route_id = r.route_id
            JOIN bus bs ON t.bus_id = bs.bus_id
            WHERE b.status='PAID'
        `;
        const params = [];
        if (opId != null) { sql += " AND bs.operator_id=?"; params.push(opId); }
        if (from) { sql += " AND b.booking_time >= ?"; params.push(from); }
        if (to)   { sql += " AND b.booking_time <= ?"; params.push(to); }
        sql += " ORDER BY b.booking_time DESC LIMIT 100";
        const [result] = await db.query(sql, params);
        res.json(result);
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ============================================
   BOOKINGS FOR REVENUE PAGE
   GET /api/operators/dashboard/bookings
============================================ */
exports.getBookingsSummary = async (req, res) => {
    try {
        if (isUnlinkedOperator(req)) return res.json([]);
        const opId = req.operatorId;
        const { from, to } = req.query;
        let sql = opId == null ? `
            SELECT
                DATE(b.booking_time) AS date,
                COUNT(*)              AS count,
                SUM(b.total_amount)   AS revenue
            FROM booking b
            WHERE b.status='PAID'
        ` : `
            SELECT
                DATE(b.booking_time) AS date,
                COUNT(*)              AS count,
                SUM(b.total_amount)   AS revenue
            FROM booking b
            JOIN trip t ON b.trip_id=t.trip_id JOIN bus bs ON t.bus_id=bs.bus_id
            WHERE b.status='PAID' AND bs.operator_id=?
        `;
        const params = opId == null ? [] : [opId];
        if (from) { sql += " AND b.booking_time >= ?"; params.push(from); }
        if (to)   { sql += " AND b.booking_time <= ?"; params.push(to); }
        sql += " GROUP BY date ORDER BY date DESC";
        const [result] = await db.query(sql, params);
        res.json(result);
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: "DB error" });
    }
};
