/**
 * reviewRepository.js — Data Access Layer (Enterprise Hardening Pass, Pillar 2).
 * Same rationale as busRepository.js: encapsulates every raw SQL statement
 * touching the `review` and `operator_review` tables behind named,
 * parameterized functions, so reviewController.js contains zero SQL.
 */
const db = require("../config/db");

async function findByOperator(operatorId) {
    const [rows] = await db.query(
        `SELECT r.review_id, r.rating, r.comment, r.created_at,
                COALESCE(u.full_name, u.username, 'Ẩn danh') AS full_name
         FROM operator_review r
         LEFT JOIN users u ON u.user_id = r.user_id
         WHERE r.operator_id = ?
         ORDER BY r.created_at DESC`,
        [operatorId]
    );
    return rows;
}

async function operatorReviewExists(userId, operatorId) {
    const [rows] = await db.query(
        "SELECT review_id FROM operator_review WHERE user_id=? AND operator_id=?",
        [userId, operatorId]
    );
    return rows.length > 0;
}

async function createOperatorReview({ user_id, operator_id, rating, comment }) {
    await db.query(
        "INSERT INTO operator_review (user_id, operator_id, rating, comment) VALUES (?,?,?,?)",
        [user_id, operator_id, rating, comment]
    );
}

async function findByTrip(tripId) {
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
    return rows;
}

async function tripReviewExists(userId, tripId) {
    const [rows] = await db.query(
        "SELECT review_id FROM review WHERE user_id=? AND trip_id=?",
        [userId, tripId]
    );
    return rows.length > 0;
}

async function createTripReview({ user_id, trip_id, rating, comment, rating_time, rating_clean, rating_service, rating_comfort, tags }) {
    await db.query(
        `INSERT INTO review (user_id, trip_id, rating, comment, rating_time, rating_clean, rating_service, rating_comfort, tags)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [user_id, trip_id, rating, comment || null,
         rating_time || null, rating_clean || null, rating_service || null, rating_comfort || null, tags || null]
    );
}

function summarize(rows) {
    const avg = rows.length
        ? (rows.reduce((s, r) => s + (r.rating || 0), 0) / rows.length).toFixed(1)
        : null;
    const dist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    rows.forEach(r => { const s = Math.round(r.rating); if (dist[s] !== undefined) dist[s]++; });
    return { avg_rating: avg ? parseFloat(avg) : null, total: rows.length, distribution: dist, reviews: rows };
}

module.exports = {
    findByOperator,
    operatorReviewExists,
    createOperatorReview,
    findByTrip,
    tripReviewExists,
    createTripReview,
    summarize,
};
