const db = require("../config/db");
const cache = require("../services/cacheManager");
const logger = require('../utils/logger');

/* ===============================
   PUBLIC SUMMARY
   Real-time hero-stats for the login page. No auth required (same
   pattern as authRoutes.js's google-config/facebook-config), so this
   query must never expose anything beyond simple counts/averages.

   Sprint 12: Cache-Aside via cacheManager — a login-page load is exactly
   the "public read, same answer for every visitor, tolerates being a few
   seconds stale" case this cache exists for. 30s TTL: the numbers on the
   login page are hero copy, not a live dashboard — a 30s staleness
   window is invisible to a visitor but removes the query from the hot
   path for every other page load in that window.
=============================== */
const PUBLIC_SUMMARY_CACHE_KEY = "stats:public-summary";
const PUBLIC_SUMMARY_TTL_MS = 30_000;

async function computePublicSummary() {
    const sql = `
        SELECT
            (SELECT COUNT(*) FROM route WHERE status = 'ACTIVE')          AS totalRoutes,
            (SELECT COUNT(*) FROM users WHERE role = 'PASSENGER')         AS totalPassengers,
            (SELECT IFNULL(ROUND(AVG(rating), 1), 0) FROM review)         AS avgRating,
            (SELECT COUNT(*) FROM review)                                 AS reviewCount,
            (SELECT COUNT(*) FROM trip WHERE status = 'COMPLETED')        AS completedTrips,
            (SELECT COUNT(*) FROM trip WHERE status = 'CANCELED')         AS canceledTrips,
            (SELECT COUNT(*) FROM trip WHERE status = 'COMPLETED'
                AND YEAR(departure_time) = YEAR(NOW()) AND MONTH(departure_time) = MONTH(NOW())) AS completedTripsThisMonth
    `;
    const [[row]] = await db.query(sql);

    const finishedTrips = row.completedTrips + row.canceledTrips;
    const completionRate = finishedTrips > 0
        ? Math.round((row.completedTrips / finishedTrips) * 1000) / 10
        : null; // no finished trips yet — honest "no data" rather than a fake 0%/100%

    return {
        totalRoutes: row.totalRoutes,
        totalPassengers: row.totalPassengers,
        avgRating: row.avgRating,
        reviewCount: row.reviewCount,
        completionRate,
        completedTrips: row.completedTrips,
        completedTripsThisMonth: row.completedTripsThisMonth,
    };
}

exports.getPublicSummary = async (req, res) => {
    try {
        const summary = await cache.getOrSet(PUBLIC_SUMMARY_CACHE_KEY, PUBLIC_SUMMARY_TTL_MS, computePublicSummary);
        res.json(summary);
    } catch (err) {
        logger.error("GET PUBLIC SUMMARY ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

exports.__cacheKey = PUBLIC_SUMMARY_CACHE_KEY; // exposed for invalidation callers (see adminController.js resetDemoData)

/* ===============================
   FEATURED REVIEWS (homepage social proof)
   Real reviews only — never fabricated testimonials. Same no-auth,
   cached, counts-only-exposure philosophy as getPublicSummary above.
   full_name is masked the same way bookingController's public homepage
   ticker already does (_maskName) — a real reviewer's full name should
   not be broadcast to every anonymous visitor.
=============================== */
const FEATURED_REVIEWS_CACHE_KEY = "stats:featured-reviews";
const FEATURED_REVIEWS_TTL_MS = 60_000;

function _maskReviewerName(name) {
    if (!name) return "Khách hàng";
    const parts = String(name).trim().split(/\s+/);
    if (parts.length === 1) return parts[0][0] + "***";
    return parts[parts.length - 1] + " " + parts[0][0] + ".";
}

async function computeFeaturedReviews() {
    const [rows] = await db.query(`
        SELECT r.rating, r.comment, u.full_name, ro.origin, ro.destination
        FROM review r
        JOIN users u ON r.user_id = u.user_id
        JOIN trip t ON r.trip_id = t.trip_id
        JOIN route ro ON t.route_id = ro.route_id
        WHERE r.rating >= 4 AND r.comment IS NOT NULL AND TRIM(r.comment) != ''
        ORDER BY r.created_at DESC
        LIMIT 6
    `);
    return rows.map(r => ({
        rating: r.rating,
        comment: r.comment,
        reviewer: _maskReviewerName(r.full_name),
        origin: r.origin,
        destination: r.destination,
    }));
}

exports.getFeaturedReviews = async (req, res) => {
    try {
        const reviews = await cache.getOrSet(FEATURED_REVIEWS_CACHE_KEY, FEATURED_REVIEWS_TTL_MS, computeFeaturedReviews);
        res.json(reviews);
    } catch (err) {
        logger.error("GET FEATURED REVIEWS ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};
