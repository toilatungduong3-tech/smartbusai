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
            (SELECT COUNT(*) FROM trip WHERE status = 'COMPLETED')        AS completedTrips,
            (SELECT COUNT(*) FROM trip WHERE status = 'CANCELED')         AS canceledTrips
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
        completionRate,
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
