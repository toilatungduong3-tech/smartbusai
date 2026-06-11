const db = require("../config/db");

/* GET reviews by operator */
exports.getReviewsByOperator = async (req, res) => {
    try {
        const opId = req.params.operatorId;
        const [rows] = await db.query(
            `SELECT r.review_id, r.rating, r.comment, r.created_at,
                    COALESCE(u.full_name, u.username, 'Ẩn danh') AS full_name
             FROM operator_review r
             LEFT JOIN users u ON u.user_id = r.user_id
             WHERE r.operator_id = ?
             ORDER BY r.created_at DESC`,
            [opId]
        );
        const avg = rows.length
            ? (rows.reduce((s, r) => s + (r.rating || 0), 0) / rows.length).toFixed(1)
            : null;
        const dist = { 5:0, 4:0, 3:0, 2:0, 1:0 };
        rows.forEach(r => { const s = Math.round(r.rating); if (dist[s] !== undefined) dist[s]++; });
        res.json({ avg_rating: avg ? parseFloat(avg) : null, total: rows.length, distribution: dist, reviews: rows });
    } catch (err) {
        console.error("getReviewsByOperator error:", err);
        res.status(500).json({ error: "DB error" });
    }
};

/* POST review for operator */
exports.createOperatorReview = async (req, res) => {
    const { user_id, operator_id, rating, comment } = req.body;
    if (!user_id || !operator_id || !rating)
        return res.status(400).json({ message: "Thiếu dữ liệu" });
    try {
        const [exist] = await db.query(
            "SELECT review_id FROM operator_review WHERE user_id=? AND operator_id=?",
            [user_id, operator_id]
        );
        if (exist.length > 0)
            return res.status(400).json({ message: "Bạn đã đánh giá nhà xe này rồi" });
        await db.query(
            "INSERT INTO operator_review (user_id, operator_id, rating, comment) VALUES (?,?,?,?)",
            [user_id, operator_id, rating, comment]
        );
        res.json({ message: "Review created" });
    } catch (err) {
        console.error("createOperatorReview error:", err);
        res.status(500).json({ error: "DB error" });
    }
};

/* GET reviews by trip */
exports.getReviewsByTrip = async (req, res) => {
    try {
        const tripId = req.params.tripId;
        const [rows] = await db.query(
            `SELECT r.review_id, r.rating, r.comment, r.created_at,
                    r.rating_time, r.rating_clean, r.rating_service, r.rating_comfort, r.tags,
                    COALESCE(u.full_name, u.username, 'Ẩn danh') AS full_name
             FROM review r
             LEFT JOIN users u ON u.user_id = r.user_id
             WHERE r.trip_id = ?
             ORDER BY r.created_at DESC`,
            [tripId]
        );
        const avg = rows.length
            ? (rows.reduce((s, r) => s + (r.rating || 0), 0) / rows.length).toFixed(1)
            : null;
        const dist = { 5:0, 4:0, 3:0, 2:0, 1:0 };
        rows.forEach(r => { const s = Math.round(r.rating); if (dist[s] !== undefined) dist[s]++; });
        res.json({ avg_rating: avg ? parseFloat(avg) : null, total: rows.length, distribution: dist, reviews: rows });
    } catch (err) {
        console.error("getReviewsByTrip error:", err);
        res.status(500).json({ error: "DB error" });
    }
};

exports.createReview = async (req, res) => {
    const { user_id, trip_id, rating, comment, rating_time, rating_clean, rating_service, rating_comfort, tags } = req.body;

    if (!user_id || !trip_id || !rating) {
        return res.status(400).json({ message: "Thiếu dữ liệu" });
    }

    try {
        const [exist] = await db.query(
            "SELECT review_id FROM review WHERE user_id=? AND trip_id=?",
            [user_id, trip_id]
        );
        if (exist.length > 0) {
            return res.status(400).json({ message: "Bạn đã đánh giá chuyến này rồi" });
        }

        await db.query(
            `INSERT INTO review (user_id, trip_id, rating, comment, rating_time, rating_clean, rating_service, rating_comfort, tags)
             VALUES (?,?,?,?,?,?,?,?,?)`,
            [user_id, trip_id, rating, comment||null,
             rating_time||null, rating_clean||null, rating_service||null, rating_comfort||null, tags||null]
        );

        res.json({ message: "Review created" });

    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "DB error" });
    }

};