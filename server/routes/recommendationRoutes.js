'use strict';
const express = require('express');
const logger = require('../utils/logger');
const router  = express.Router();
const ctrl    = require('../controllers/passengerAIController');
const { authenticate } = require('../middleware/authMiddleware');
const cache   = require('../services/cacheManager');

const TRENDING_CACHE_KEY = 'trips:trending';
const TRENDING_TTL_MS = 30_000; // Sprint 12 — Cache-Aside; matches statsController's public-summary TTL rationale

// Phase 2I: previously trusted ?userId= from the query string with zero
// auth (any caller could read any user's recommendations + spending data).
// "me" now means exactly that — the controller derives the target user
// from req.user (the JWT), the query param is no longer read at all.
router.get('/me', authenticate, ctrl.getMyRecommendations);

// GET /api/recommendations/trending — top trips by booking count
router.get('/trending', async (req, res) => {
  try {
    const recommendations = await cache.getOrSet(TRENDING_CACHE_KEY, TRENDING_TTL_MS, computeTrending);
    res.json({ recommendations });
  } catch(e) {
    logger.error('trending reco error', e);
    res.json({ recommendations: [] });
  }
});

async function computeTrending() {
    const db = require('../config/db');
    const [rows] = await db.query(`
      SELECT
        t.trip_id     AS route_id,
        r.origin, r.destination,
        t.departure_time, t.arrival_time,
        t.base_price  AS current_price,
        b.bus_type,
        (b.total_seats - COUNT(DISTINCT bd.seat_id)) AS available_seats,
        COUNT(DISTINCT bk.booking_id) AS booking_count,
        AVG(rv.rating)               AS avg_rating,
        COUNT(DISTINCT bk.booking_id) AS trip_count
      FROM trip t
      JOIN route r   ON t.route_id  = r.route_id
      JOIN bus b     ON t.bus_id    = b.bus_id
      LEFT JOIN booking bk        ON bk.trip_id    = t.trip_id
                                 AND bk.status IN ('PAID','PENDING','CONFIRMED')
      LEFT JOIN booking_detail bd ON bd.booking_id = bk.booking_id
      LEFT JOIN review rv         ON rv.trip_id    = t.trip_id
      WHERE t.status = 'OPEN'
        AND t.departure_time > NOW()
      GROUP BY t.trip_id, r.origin, r.destination, t.departure_time,
               t.arrival_time, t.base_price, b.bus_type, b.total_seats
      ORDER BY booking_count DESC, avg_rating DESC
      LIMIT 4
    `);
    const recommendations = rows.map(r => ({
      route_id:      r.route_id,
      origin:        r.origin,
      destination:   r.destination,
      departure_time:r.departure_time,
      arrival_time:  r.arrival_time,
      current_price: Number(r.current_price),
      bus_type:      r.bus_type,
      available_seats: r.available_seats,
      score:         Math.min(95, 60 + (r.booking_count || 0) * 2),
      avg_rating:    r.avg_rating ? Number(r.avg_rating).toFixed(1) : null,
      trip_count:    r.trip_count || 0,
      algorithm:     'popularity_based',
      reasons: [
        { icon:'🔥', text:`${r.booking_count||0} lượt đặt vé`, key:'trending' },
        r.avg_rating ? { icon:'⭐', text:`Đánh giá ${Number(r.avg_rating).toFixed(1)}/5`, key:'rating' } : null,
        { icon:'💺', text:`Còn ${r.available_seats} ghế trống`, key:'seats' },
      ].filter(Boolean),
      breakdown: {
        popularity: { score: 80, basis: `Rank #1 · ${r.booking_count||0}` },
        price_attract: { score: 60, basis: '+0%' },
        booking_history: { score: 0, basis: '0 lần' },
        user_history:    { score: 0, basis: '0 lần' },
      }
    }));
    return recommendations;
}

module.exports = router;
