const db = require("../config/db");

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
        console.error(err);
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
        console.error(err);
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
        console.error(err);
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
        console.error(err);
        res.status(500).json({ error: "Operation failed" });
    }
};

/* ============================================
   OPERATOR DASHBOARD STATS
   GET /api/operators/dashboard/stats
============================================ */
exports.getDashboardStats = async (req, res) => {
    try {
        const sql = `
            SELECT
                (SELECT COUNT(*) FROM trip)                                          AS totalTrips,
                (SELECT COUNT(*) FROM booking WHERE status='PAID')                  AS totalBookings,
                (SELECT IFNULL(SUM(total_amount),0) FROM booking WHERE status='PAID') AS totalRevenue,
                (SELECT IFNULL(AVG(rating),0) FROM review)                          AS avgRating
        `;
        const [result] = await db.query(sql);
        res.json(result[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ============================================
   REVENUE DATA
   GET /api/operators/dashboard/revenue
============================================ */
exports.getRevenue = async (req, res) => {
    try {
        const { from, to } = req.query;
        let sql = `
            SELECT DATE_FORMAT(booking_time,'%m/%Y') AS month, SUM(total_amount) AS revenue, COUNT(*) AS bookings
            FROM booking
            WHERE status='PAID'
        `;
        const params = [];
        if (from) { sql += " AND booking_time >= ?"; params.push(from); }
        if (to)   { sql += " AND booking_time <= ?"; params.push(to); }
        sql += " GROUP BY month ORDER BY booking_time";
        const [result] = await db.query(sql, params);
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ============================================
   TOP ROUTES
   GET /api/operators/dashboard/routes
============================================ */
exports.getTopRoutes = async (req, res) => {
    try {
        const sql = `
            SELECT
                CONCAT(r.origin,' → ',r.destination) AS route,
                COUNT(b.booking_id)                  AS count,
                SUM(b.total_amount)                  AS revenue
            FROM booking b
            JOIN trip t ON b.trip_id = t.trip_id
            JOIN route r ON t.route_id = r.route_id
            WHERE b.status='PAID'
            GROUP BY r.route_id
            ORDER BY count DESC
            LIMIT 5
        `;
        const [result] = await db.query(sql);
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ============================================
   BOOKING STATUS BREAKDOWN
   GET /api/operators/dashboard/booking-status
============================================ */
exports.getBookingStatus = async (req, res) => {
    try {
        const [rows] = await db.query(
            "SELECT status, COUNT(*) AS count FROM booking GROUP BY status"
        );
        const result = { paid: 0, pending: 0, canceled: 0 };
        rows.forEach(r => {
            if (r.status === "PAID")     result.paid     = r.count;
            if (r.status === "PENDING")  result.pending  = r.count;
            if (r.status === "CANCELED") result.canceled = r.count;
        });
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ============================================
   SEAT OCCUPANCY
   GET /api/operators/dashboard/seat-occupancy
============================================ */
exports.getSeatOccupancy = async (req, res) => {
    try {
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
            GROUP BY t.trip_id
            ORDER BY booked DESC
            LIMIT 6
        `;
        const [result] = await db.query(sql);
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ============================================
   RECENT TRIPS
   GET /api/operators/dashboard/recent-trips
============================================ */
exports.getRecentTrips = async (req, res) => {
    try {
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
            GROUP BY t.trip_id
            ORDER BY t.departure_time ASC
            LIMIT 7
        `;
        const [result] = await db.query(sql);
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ============================================
   FLEET (Buses)
   GET /api/operators/dashboard/buses
============================================ */
exports.getBuses = async (req, res) => {
    try {
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
            GROUP BY b.bus_id
            ORDER BY b.bus_id
        `;
        const [result] = await db.query(sql);
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ============================================
   REVIEWS FOR OPERATOR
   GET /api/operators/dashboard/reviews
============================================ */
exports.getReviews = async (req, res) => {
    try {
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
            ORDER BY rv.created_at DESC
            LIMIT 10
        `;
        const [result] = await db.query(sql);
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ============================================
   PAYMENTS / REVENUE DETAILS
   GET /api/operators/dashboard/payments
============================================ */
exports.getPayments = async (req, res) => {
    try {
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
            WHERE b.status='PAID'
        `;
        const params = [];
        if (from) { sql += " AND b.booking_time >= ?"; params.push(from); }
        if (to)   { sql += " AND b.booking_time <= ?"; params.push(to); }
        sql += " ORDER BY b.booking_time DESC LIMIT 100";
        const [result] = await db.query(sql, params);
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ============================================
   BOOKINGS FOR REVENUE PAGE
   GET /api/operators/dashboard/bookings
============================================ */
exports.getBookingsSummary = async (req, res) => {
    try {
        const { from, to } = req.query;
        let sql = `
            SELECT
                DATE(b.booking_time) AS date,
                COUNT(*)              AS count,
                SUM(b.total_amount)   AS revenue
            FROM booking b
            WHERE b.status='PAID'
        `;
        const params = [];
        if (from) { sql += " AND b.booking_time >= ?"; params.push(from); }
        if (to)   { sql += " AND b.booking_time <= ?"; params.push(to); }
        sql += " GROUP BY date ORDER BY date DESC";
        const [result] = await db.query(sql, params);
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "DB error" });
    }
};
