'use strict';
const db = require('../config/db');
const ai = require('../ai/recommendation');

/* ═══════════════════════════════════════════════════════════
   SmartBusAI — Passenger-facing AI endpoints
   Explainable AI: score = 40% history + 25% booking + 20% popularity + 15% price
═══════════════════════════════════════════════════════════ */

function _dowLabel(dow) {
    return ['Chủ nhật','Thứ 2','Thứ 3','Thứ 4','Thứ 5','Thứ 6','Thứ 7'][dow % 7] || '';
}
function _hourLabel(h) {
    if (h >= 5  && h < 12) return 'buổi sáng (5–12h)';
    if (h >= 12 && h < 18) return 'buổi chiều (12–18h)';
    if (h >= 18 && h < 22) return 'buổi tối (18–22h)';
    return 'đêm khuya';
}

/* ── Compute 4-component explainable score ──────────────────
   Returns score 0-100 + breakdown + reasons[]
   Formula: 40% userHistory + 25% bookingHistory + 20% popularity + 15% price
──────────────────────────────────────────────────────────── */
function _computeScore({ searchCount, bookingCount, popularityPct, priceDiffPct, avgRating }) {
    // 1. User History Score (40%): search frequency this route in 30 days
    //    0 searches=0, 2=25, 4=50, 6=75, 8+=100
    const userHistoryScore = Math.min(100, Math.round(searchCount * 12.5));

    // 2. Booking History Score (25%): times user actually booked this route
    //    0=0, 1=25, 2=50, 3=75, 4+=100
    const bookingHistScore = Math.min(100, Math.round(bookingCount * 25));

    // 3. Popularity Score (20%): normalized against most popular route this week
    const popularityScore  = Math.round(Math.min(100, popularityPct));

    // 4. Price Attractiveness Score (15%): current vs historical average
    //    -15%+ below avg=100, -5 to -15=75, ±5=50, above avg=20
    let priceScore = 50;
    if (priceDiffPct <= -15) priceScore = 100;
    else if (priceDiffPct <= -5) priceScore = 75;
    else if (priceDiffPct <= 5)  priceScore = 50;
    else                          priceScore = 20;

    // Rating bonus: 0-5 extra points if avg_rating >= 4.0
    const ratingBonus = avgRating >= 4.5 ? 5 : avgRating >= 4.0 ? 3 : 0;

    const finalScore = Math.min(99, Math.round(
        0.40 * userHistoryScore +
        0.25 * bookingHistScore +
        0.20 * popularityScore  +
        0.15 * priceScore       +
        ratingBonus
    ));

    return { finalScore, userHistoryScore, bookingHistScore, popularityScore, priceScore, ratingBonus };
}

/* ── Build reasons[] from score breakdown ─────────────────── */
function _buildReasons({ searchCount, bookingCount, popularityRank, priceDiffPct,
                          currentPrice, avgPrice, avgRating, weekendTrips, tripCount,
                          scores, cfReason }) {
    const reasons = [];

    // User history reason
    if (searchCount >= 2) {
        reasons.push({ key: 'search_history', icon: '🔍',
            text: `Bạn đã tìm tuyến này ${searchCount} lần trong 30 ngày`,
            score_contribution: `+${Math.round(scores.userHistoryScore * 0.40)} điểm (lịch sử tìm kiếm 40%)` });
    } else if (searchCount === 1) {
        reasons.push({ key: 'search_history', icon: '🔍',
            text: 'Bạn đã từng tìm kiếm tuyến này',
            score_contribution: `+${Math.round(scores.userHistoryScore * 0.40)} điểm` });
    }

    // Booking history reason
    if (bookingCount >= 3) {
        reasons.push({ key: 'booking_history', icon: '🎫',
            text: `Bạn đã đặt tuyến này ${bookingCount} lần — tuyến thường xuyên của bạn`,
            score_contribution: `+${Math.round(scores.bookingHistScore * 0.25)} điểm (lịch sử đặt vé 25%)` });
    } else if (bookingCount >= 1) {
        reasons.push({ key: 'booking_history', icon: '🎫',
            text: `Bạn đã đặt vé tuyến này ${bookingCount} lần trước đây`,
            score_contribution: `+${Math.round(scores.bookingHistScore * 0.25)} điểm` });
    }

    // Popularity reason
    if (popularityRank <= 3 && popularityRank > 0) {
        reasons.push({ key: 'trending', icon: '🔥',
            text: `Đang là tuyến phổ biến thứ #${popularityRank} tuần này`,
            score_contribution: `+${Math.round(scores.popularityScore * 0.20)} điểm (độ phổ biến 20%)` });
    } else if (scores.popularityScore >= 50) {
        reasons.push({ key: 'popular', icon: '📈',
            text: 'Tuyến được nhiều hành khách lựa chọn tuần này',
            score_contribution: `+${Math.round(scores.popularityScore * 0.20)} điểm` });
    }

    // Price reason
    if (priceDiffPct <= -15) {
        reasons.push({ key: 'great_price', icon: '💰',
            text: `Giá hiện thấp hơn trung bình ${Math.abs(Math.round(priceDiffPct))}% — đang có ưu đãi tốt`,
            score_contribution: `+${Math.round(scores.priceScore * 0.15)} điểm (giá hấp dẫn 15%)` });
    } else if (priceDiffPct <= -5) {
        reasons.push({ key: 'good_price', icon: '💲',
            text: `Giá thấp hơn trung bình ${Math.abs(Math.round(priceDiffPct))}%`,
            score_contribution: `+${Math.round(scores.priceScore * 0.15)} điểm` });
    } else if (priceDiffPct > 5) {
        reasons.push({ key: 'avg_price', icon: '💲',
            text: 'Giá bình thường so với lịch sử tuyến này' });
    }

    // Rating bonus
    if (scores.ratingBonus >= 3) {
        reasons.push({ key: 'high_rating', icon: '⭐',
            text: `Đánh giá cao ${Number(avgRating).toFixed(1)}/5 từ hành khách` });
    }

    // Availability
    if (tripCount > 0) {
        reasons.push({ key: 'available', icon: '✅',
            text: `${tripCount} chuyến sắp tới còn chỗ${weekendTrips > 0 ? ` (${weekendTrips} chuyến cuối tuần)` : ''}` });
    }

    // CF fallback if no personal data
    if (reasons.filter(r => ['search_history','booking_history'].includes(r.key)).length === 0) {
        if (cfReason) {
            reasons.push({ key: 'similar_users', icon: '👥',
                text: 'Hành khách có hành vi tương tự bạn thường chọn tuyến này' });
        }
    }

    return reasons.slice(0, 5);
}

/* ═══════════════════════════════════════════════════════════
   GET /api/ai/recommend/:userId  AND  GET /api/recommendations/me
   Personalized recommendations — fully explainable score.
═══════════════════════════════════════════════════════════ */
async function _buildRecommendations(userId) {
    // ── 1. Load user's booking + search history to resolve route_ids ──
    const [
        [userBookedRoutes],
        [searchResolved],
        [cfRoutes],
        [popularityRanking],
        [priceHistMap],
        [availMap],
        [ratingMap]
    ] = await Promise.all([

        // Routes user actually booked (with count)
        db.query(`
            SELECT r.route_id,
                   CONCAT(r.origin,' → ',r.destination) AS route,
                   r.origin, r.destination,
                   COUNT(b.booking_id) AS booking_count
            FROM booking b
            JOIN trip t ON b.trip_id = t.trip_id
            JOIN route r ON t.route_id = r.route_id
            WHERE b.user_id = ? AND b.status = 'PAID'
            GROUP BY r.route_id
            ORDER BY booking_count DESC
        `, [userId]),

        // Resolve search_log text → actual route_ids
        // COLLATE utf8mb4_general_ci on both sides avoids collation mismatch
        db.query(`
            SELECT r.route_id,
                   CONCAT(r.origin,' → ',r.destination) AS route,
                   r.origin, r.destination,
                   COUNT(*) AS cnt
            FROM search_log sl
            JOIN route r ON (
                r.origin     COLLATE utf8mb4_general_ci LIKE CONCAT('%', sl.origin COLLATE utf8mb4_general_ci, '%')
                OR sl.origin COLLATE utf8mb4_general_ci LIKE CONCAT('%', r.origin COLLATE utf8mb4_general_ci, '%')
            ) AND (
                r.destination     COLLATE utf8mb4_general_ci LIKE CONCAT('%', sl.destination COLLATE utf8mb4_general_ci, '%')
                OR sl.destination COLLATE utf8mb4_general_ci LIKE CONCAT('%', r.destination COLLATE utf8mb4_general_ci, '%')
            )
            WHERE sl.user_id = ?
              AND sl.search_time >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            GROUP BY r.route_id
            ORDER BY cnt DESC
            LIMIT 20
        `, [userId]),

        // CF: routes booked by similar users (not yet booked by this user)
        db.query(`
            SELECT r.route_id,
                   CONCAT(r.origin,' → ',r.destination) AS route,
                   r.origin, r.destination,
                   COUNT(DISTINCT b2.user_id) AS similar_user_count
            FROM booking b1
            JOIN booking b2 ON b2.user_id != b1.user_id
                AND b2.trip_id IN (
                    SELECT trip_id FROM booking WHERE user_id = ? AND status = 'PAID'
                )
            JOIN trip t ON t.trip_id = b1.trip_id
            JOIN route r ON r.route_id = t.route_id
            WHERE b1.user_id != ?
              AND b1.status = 'PAID'
              AND r.route_id NOT IN (
                  SELECT DISTINCT t2.route_id FROM booking bx
                  JOIN trip t2 ON bx.trip_id = t2.trip_id
                  WHERE bx.user_id = ? AND bx.status = 'PAID'
              )
            GROUP BY r.route_id
            ORDER BY similar_user_count DESC
            LIMIT 10
        `, [userId, userId, userId]),

        // System-wide popularity this week (for ranking + score)
        db.query(`
            SELECT r.route_id,
                   COUNT(b.booking_id) AS weekly_bookings,
                   RANK() OVER (ORDER BY COUNT(b.booking_id) DESC) AS pop_rank
            FROM booking b
            JOIN trip t ON b.trip_id = t.trip_id
            JOIN route r ON t.route_id = r.route_id
            WHERE b.status = 'PAID'
              AND b.booking_time >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            GROUP BY r.route_id
        `),

        // Historical average price per route
        db.query(`
            SELECT t.route_id, AVG(t.base_price) AS avg_price
            FROM trip t
            JOIN booking b ON b.trip_id = t.trip_id
            WHERE b.status = 'PAID'
            GROUP BY t.route_id
        `),

        // Current available trips next 14 days
        db.query(`
            SELECT r.route_id,
                   MIN(t.base_price) AS current_price,
                   COUNT(DISTINCT t.trip_id) AS trip_count,
                   SUM(CASE WHEN DAYOFWEEK(t.departure_time) IN (1,7) THEN 1 ELSE 0 END) AS weekend_trips
            FROM trip t
            JOIN route r ON t.route_id = r.route_id
            WHERE t.status = 'OPEN'
              AND t.departure_time > NOW()
              AND t.departure_time < DATE_ADD(NOW(), INTERVAL 14 DAY)
            GROUP BY r.route_id
        `),

        // Average ratings per route
        db.query(`
            SELECT t.route_id, AVG(rv.rating) AS avg_rating, COUNT(rv.review_id) AS review_count
            FROM review rv
            JOIN trip t ON rv.trip_id = t.trip_id
            GROUP BY t.route_id
        `)
    ]);

    // ── Build lookup maps ──
    const popMap   = {};
    const maxWeekly = Math.max(1, ...popularityRanking.map(p => Number(p.weekly_bookings)));
    popularityRanking.forEach(p => {
        popMap[p.route_id] = {
            rank:            Number(p.pop_rank),
            weekly_bookings: Number(p.weekly_bookings),
            popularity_pct:  Math.round(Number(p.weekly_bookings) / maxWeekly * 100)
        };
    });

    const priceMap = {};
    priceHistMap.forEach(p => { priceMap[p.route_id] = Number(p.avg_price); });

    const availMapById = {};
    availMap.forEach(a => { availMapById[a.route_id] = a; });

    const ratingMapById = {};
    ratingMap.forEach(r => { ratingMapById[r.route_id] = r; });

    const bookingCountById = {};
    userBookedRoutes.forEach(r => { bookingCountById[r.route_id] = Number(r.booking_count); });

    const searchCountById = {};
    searchResolved.forEach(r => { searchCountById[r.route_id] = Number(r.cnt || 0); });

    // ── Collect all candidate routes (deduplicated) ──
    const seen = new Set();
    const candidates = [];

    const addCandidate = (row, source) => {
        if (seen.has(row.route_id)) return;
        seen.add(row.route_id);
        candidates.push({ ...row, _source: source });
    };

    // Priority: user's own booked routes first (they know these)
    userBookedRoutes.forEach(r => addCandidate(r, 'booking'));
    // Then user's search history
    searchResolved.forEach(r => addCandidate(r, 'search'));
    // Then CF suggestions
    cfRoutes.forEach(r => addCandidate(r, 'cf'));
    // Then trending (fill if not enough candidates)
    if (candidates.length < 6) {
        popularityRanking
            .sort((a, b) => Number(a.pop_rank) - Number(b.pop_rank))
            .slice(0, 6)
            .forEach(p => {
                // Need route name — fetch from availMapById which has route_id
                // We'll handle this below
            });
    }

    // ── Score each candidate ──
    const scored = candidates
        .filter(c => availMapById[c.route_id])  // only routes with available trips
        .map(c => {
            const avail       = availMapById[c.route_id] || {};
            const avgPrice    = priceMap[c.route_id] || 0;
            const currentPrice = Number(avail.current_price || 0);
            const priceDiffPct = avgPrice > 0
                ? Math.round((currentPrice - avgPrice) / avgPrice * 100)
                : 0;
            const popInfo  = popMap[c.route_id] || { rank: 999, popularity_pct: 0, weekly_bookings: 0 };
            const rating   = ratingMapById[c.route_id];
            const avgRating = rating ? Number(rating.avg_rating) : 0;

            const searchCount  = searchCountById[c.route_id] || 0;
            const bookingCount = bookingCountById[c.route_id] || 0;

            const scores = _computeScore({
                searchCount,
                bookingCount,
                popularityPct: popInfo.popularity_pct,
                priceDiffPct,
                avgRating
            });

            const reasons = _buildReasons({
                searchCount,
                bookingCount,
                popularityRank:  popInfo.rank,
                priceDiffPct,
                currentPrice,
                avgPrice,
                avgRating,
                weekendTrips: Number(avail.weekend_trips || 0),
                tripCount:    Number(avail.trip_count || 0),
                scores,
                cfReason: c._source === 'cf'
            });

            // Score breakdown for transparency (shown in API response)
            const breakdown = {
                user_history:    { weight: '40%', score: scores.userHistoryScore, basis: `${searchCount} lần tìm kiếm / 30 ngày` },
                booking_history: { weight: '25%', score: scores.bookingHistScore, basis: `${bookingCount} lần đặt vé` },
                popularity:      { weight: '20%', score: scores.popularityScore,  basis: `Rank #${popInfo.rank} · ${popInfo.weekly_bookings} lượt đặt/tuần` },
                price_attract:   { weight: '15%', score: scores.priceScore,       basis: priceDiffPct !== 0 ? `${priceDiffPct > 0 ? '+' : ''}${priceDiffPct}% so với TB` : 'Chưa có lịch sử giá' },
                rating_bonus:    { weight: 'bonus', score: scores.ratingBonus,    basis: avgRating > 0 ? `Đánh giá ${Number(avgRating).toFixed(1)}/5` : 'Chưa có đánh giá' }
            };

            return {
                route_id:      c.route_id,
                route:         c.route || `${c.origin} → ${c.destination}`,
                origin:        c.origin,
                destination:   c.destination,
                score:         scores.finalScore,
                current_price: currentPrice,
                avg_price:     Math.round(avgPrice),
                trip_count:    Number(avail.trip_count || 0),
                avg_rating:    avgRating > 0 ? Math.round(avgRating * 10) / 10 : null,
                reasons,
                breakdown,
                algorithm:     bookingCount > 0 ? 'collaborative_filtering'
                             : searchCount  > 0 ? 'search_based'
                             : c._source === 'cf' ? 'collaborative_filtering'
                             : 'popularity_based'
            };
        });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // ── Cold start: pad with trending routes if fewer than 3 results ──
    if (scored.length < 3) {
        const [trending] = await db.query(`
            SELECT r.route_id,
                   CONCAT(r.origin,' → ',r.destination) AS route,
                   r.origin, r.destination,
                   COUNT(b.booking_id) AS bk_count,
                   MIN(t.base_price) AS current_price,
                   COUNT(DISTINCT t.trip_id) AS trip_count,
                   RANK() OVER (ORDER BY COUNT(b.booking_id) DESC) AS pop_rank
            FROM booking b
            JOIN trip t ON b.trip_id = t.trip_id
            JOIN route r ON t.route_id = r.route_id
            WHERE b.status = 'PAID'
              AND t.status = 'OPEN'
              AND t.departure_time > NOW()
              AND b.booking_time >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            GROUP BY r.route_id
            ORDER BY bk_count DESC
            LIMIT 8
        `);

        const trendingMax = Math.max(1, ...trending.map(t => Number(t.bk_count)));

        trending.forEach(t => {
            if (seen.has(t.route_id)) return;
            seen.add(t.route_id);
            const popPct = Math.round(Number(t.bk_count) / trendingMax * 100);
            const scores = _computeScore({
                searchCount: 0, bookingCount: 0,
                popularityPct: popPct, priceDiffPct: 0, avgRating: 0
            });
            scored.push({
                route_id:      t.route_id,
                route:         t.route,
                origin:        t.origin,
                destination:   t.destination,
                score:         scores.finalScore,
                current_price: Number(t.current_price),
                avg_price:     null,
                trip_count:    Number(t.trip_count),
                avg_rating:    null,
                reasons: [
                    { key: 'trending', icon: '🔥',
                      text: `Tuyến phổ biến thứ #${t.pop_rank} — ${t.bk_count} lượt đặt tuần này`,
                      score_contribution: `+${Math.round(scores.popularityScore * 0.20)} điểm` },
                    { key: 'available', icon: '✅',
                      text: `${t.trip_count} chuyến còn vé trong 14 ngày tới` }
                ],
                breakdown: {
                    user_history:    { weight: '40%', score: 0,                   basis: 'Chưa có dữ liệu (người dùng mới)' },
                    booking_history: { weight: '25%', score: 0,                   basis: 'Chưa đặt vé' },
                    popularity:      { weight: '20%', score: scores.popularityScore, basis: `Rank #${t.pop_rank} · ${t.bk_count} lượt/tuần` },
                    price_attract:   { weight: '15%', score: 50,                  basis: 'Giá mặc định' },
                    rating_bonus:    { weight: 'bonus', score: 0,                 basis: 'Chưa có đánh giá' }
                },
                algorithm: 'popularity_based'
            });
        });

        scored.sort((a, b) => b.score - a.score);
    }

    return scored.slice(0, 8);
}

exports.getRecommendations = async (req, res) => {
    const userId = parseInt(req.params.userId);
    if (!userId) return res.status(400).json({ message: 'Invalid userId' });

    try {
        const recommendations = await _buildRecommendations(userId);

        const [savingsData] = await db.query(`
            SELECT COALESCE(SUM(GREATEST(0, avg_r.avg_price - b.total_amount / bd_cnt.cnt)), 0) AS total_saved
            FROM booking b
            JOIN trip t ON b.trip_id = t.trip_id
            JOIN (SELECT route_id, AVG(base_price) AS avg_price FROM trip GROUP BY route_id) avg_r
                ON avg_r.route_id = t.route_id
            JOIN (SELECT booking_id, COUNT(*) AS cnt FROM booking_detail GROUP BY booking_id) bd_cnt
                ON bd_cnt.booking_id = b.booking_id
            WHERE b.user_id = ? AND b.status = 'PAID'
            LIMIT 1
        `, [userId]);

        res.json({
            userId,
            recommendations,
            meta: {
                algorithm:   'SmartBusAI v3 · Explainable AI (40% history + 25% booking + 20% popularity + 15% price)',
                formula:     'score = 0.40×userHistory + 0.25×bookingHistory + 0.20×popularity + 0.15×price',
                total_saved: Math.round(Number(savingsData[0]?.total_saved) || 0),
                data_points: recommendations.reduce((s, r) => {
                    const b = r.breakdown;
                    return s + (b.user_history.score > 0 ? 1 : 0) + (b.booking_history.score > 0 ? 1 : 0);
                }, 0),
                generated_at: new Date()
            }
        });
    } catch (err) {
        console.error('[AI] getRecommendations error:', err.message);
        res.status(500).json({ message: 'AI error', recommendations: [] });
    }
};

/* ═══════════════════════════════════════════════════════════
   GET /api/recommendations/me?userId=X
   Same engine, mounted at the new path for cleaner API design
═══════════════════════════════════════════════════════════ */
exports.getMyRecommendations = async (req, res) => {
    const userId = parseInt(req.query.userId || req.query.user_id);
    if (!userId) return res.status(400).json({ message: 'userId query param required' });

    try {
        const recommendations = await _buildRecommendations(userId);
        res.json({
            userId,
            recommendations,
            meta: {
                algorithm:   'SmartBusAI v3 · Explainable AI',
                formula:     'score = 0.40×userHistory + 0.25×bookingHistory + 0.20×popularity + 0.15×price',
                generated_at: new Date()
            }
        });
    } catch (err) {
        console.error('[AI] getMyRecommendations error:', err.message);
        res.status(500).json({ message: 'AI error', recommendations: [] });
    }
};

/* ═══════════════════════════════════════════════════════════
   GET /api/ai/trending  — Global trending (cold start / anonymous)
═══════════════════════════════════════════════════════════ */
exports.getTrending = async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT r.route_id,
                   CONCAT(r.origin,' → ',r.destination) AS route,
                   r.origin, r.destination, r.distance_km,
                   COUNT(DISTINCT b.booking_id) AS total_bookings,
                   COUNT(DISTINCT CASE WHEN b.booking_time >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                                       THEN b.booking_id END) AS recent_bookings,
                   MIN(t.base_price) AS min_price,
                   AVG(t.base_price) AS avg_price,
                   COUNT(DISTINCT t.trip_id) AS trip_count,
                   IFNULL(AVG(rv.rating),0) AS avg_rating
            FROM route r
            JOIN trip t ON t.route_id = r.route_id
            LEFT JOIN booking b ON b.trip_id = t.trip_id AND b.status = 'PAID'
            LEFT JOIN review rv ON rv.trip_id = t.trip_id
            WHERE t.status = 'OPEN' AND t.departure_time > NOW()
            GROUP BY r.route_id
            ORDER BY recent_bookings DESC, total_bookings DESC
            LIMIT 8
        `);

        const maxRecent = Math.max(1, ...rows.map(r => Number(r.recent_bookings)));

        const result = rows.map((r, idx) => {
            const popularityPct = Math.round(Number(r.recent_bookings) / maxRecent * 100);
            const minP = Number(r.min_price), avgP = Number(r.avg_price);
            const priceDiff = avgP > 0 ? Math.round((minP - avgP) / avgP * 100) : 0;
            const avgRating = Number(r.avg_rating);

            const scores = _computeScore({
                searchCount: 0, bookingCount: 0,
                popularityPct, priceDiffPct: priceDiff, avgRating
            });

            const reasons = [];
            const recent = Number(r.recent_bookings);
            if (recent > 0) {
                reasons.push({ key: 'trending', icon: '🔥',
                    text: `${recent} lượt đặt tuần này — phổ biến thứ #${idx + 1}`,
                    score_contribution: `+${Math.round(scores.popularityScore * 0.20)} điểm` });
            }
            if (r.trip_count > 0) {
                reasons.push({ key: 'available', icon: '✅',
                    text: `${r.trip_count} chuyến còn chỗ trong 14 ngày tới` });
            }
            if (priceDiff <= -5) {
                reasons.push({ key: 'good_price', icon: '💰',
                    text: `Giá thấp hơn trung bình ${Math.abs(priceDiff)}%` });
            }
            if (avgRating >= 4.0) {
                reasons.push({ key: 'high_rating', icon: '⭐',
                    text: `Đánh giá ${avgRating.toFixed(1)}/5` });
            }

            return {
                route_id:      r.route_id,
                route:         r.route,
                origin:        r.origin,
                destination:   r.destination,
                score:         scores.finalScore,
                current_price: minP,
                trip_count:    Number(r.trip_count),
                avg_rating:    avgRating >= 1 ? Math.round(avgRating * 10) / 10 : null,
                reasons,
                algorithm:     'popularity_based'
            };
        });

        res.json({ recommendations: result, type: 'trending', generated_at: new Date() });
    } catch (err) {
        console.error('[AI] getTrending error:', err.message);
        res.json({ recommendations: [] });
    }
};

/* ═══════════════════════════════════════════════════════════
   GET /api/ai/behavior/:userId  — Behavioral profile
═══════════════════════════════════════════════════════════ */
exports.getBehaviorProfile = async (req, res) => {
    const userId = parseInt(req.params.userId);
    if (!userId) return res.status(400).json({ message: 'Invalid userId' });
    try {
        const [
            [topRoutes], [hourDist], [dowDist], [busTypeDist], [searchDist], [recentSearches]
        ] = await Promise.all([
            db.query(`
                SELECT r.origin, r.destination, COUNT(*) AS cnt, SUM(b.total_amount) AS total_spent
                FROM booking b JOIN trip t ON b.trip_id=t.trip_id JOIN route r ON t.route_id=r.route_id
                WHERE b.user_id=? AND b.status='PAID' GROUP BY r.route_id ORDER BY cnt DESC LIMIT 5
            `, [userId]),
            db.query(`
                SELECT HOUR(booking_time) AS hour, COUNT(*) AS cnt
                FROM booking WHERE user_id=? AND status='PAID' GROUP BY hour ORDER BY cnt DESC LIMIT 3
            `, [userId]),
            db.query(`
                SELECT DAYOFWEEK(booking_time) AS dow, COUNT(*) AS cnt
                FROM booking WHERE user_id=? AND status='PAID' GROUP BY dow ORDER BY cnt DESC
            `, [userId]),
            db.query(`
                SELECT bs.bus_type, COUNT(*) AS cnt
                FROM booking b JOIN trip t ON b.trip_id=t.trip_id JOIN bus bs ON t.bus_id=bs.bus_id
                WHERE b.user_id=? AND b.status='PAID' GROUP BY bs.bus_type ORDER BY cnt DESC LIMIT 3
            `, [userId]),
            db.query(`
                SELECT origin, destination, COUNT(*) AS cnt
                FROM search_log WHERE user_id=? GROUP BY origin,destination ORDER BY cnt DESC LIMIT 5
            `, [userId]),
            db.query(`
                SELECT origin, destination, search_time FROM search_log
                WHERE user_id=? ORDER BY search_time DESC LIMIT 5
            `, [userId])
        ]);

        const totalBk = dowDist.reduce((s,d)=>s+d.cnt,0);
        const wkBk    = dowDist.filter(d=>d.dow===1||d.dow===7).reduce((s,d)=>s+d.cnt,0);
        const wkRatio = totalBk > 0 ? Math.round(wkBk/totalBk*100) : 0;
        const prefHour = hourDist[0]?.hour;
        const prefBusType = busTypeDist[0]?.bus_type;
        const busTypeLabel = prefBusType?.includes('VIP') ? 'xe VIP'
            : prefBusType?.includes('LIM') ? 'Limousine' : 'xe thường';

        const insights = [];
        if (wkRatio >= 40) insights.push({ key: 'weekend_habit', icon: '📅',
            text: `Bạn có xu hướng đặt vé cuối tuần nhiều hơn (${wkRatio}% tổng chuyến)` });
        if (prefHour !== undefined) insights.push({ key: 'peak_hour', icon: '⏰',
            text: `Giờ đặt vé phổ biến nhất của bạn là ${_hourLabel(prefHour)}` });
        if (prefBusType) insights.push({ key: 'bus_preference', icon: '🚌',
            text: `Bạn thường chọn ${busTypeLabel} (${busTypeDist[0].cnt} lần)` });
        if (topRoutes.length > 0) insights.push({ key: 'fav_route', icon: '🗺️',
            text: `Tuyến yêu thích: ${topRoutes[0].origin} → ${topRoutes[0].destination}` });
        if (topRoutes.length > 0) {
            const cities = [...new Set(topRoutes.flatMap(r=>[r.origin,r.destination]))];
            insights.push({ key: 'top_cities', icon: '🏙️',
                text: `Thành phố thường đi nhất: ${cities.slice(0,3).join(', ')}` });
        }

        res.json({ userId, top_routes: topRoutes, preferred_hour: prefHour,
            preferred_dow: dowDist[0] ? _dowLabel(dowDist[0].dow-1) : null,
            weekend_ratio: wkRatio, preferred_bus: prefBusType,
            search_patterns: searchDist, recent_searches: recentSearches,
            insights, generated_at: new Date() });
    } catch (err) {
        console.error('[AI] getBehaviorProfile error:', err.message);
        res.status(500).json({ message: 'AI error' });
    }
};

/* ═══════════════════════════════════════════════════════════
   GET /api/ai/search-insight?origin=X&destination=Y&userId=Z
═══════════════════════════════════════════════════════════ */
exports.getSearchInsight = async (req, res) => {
    const { origin, destination, userId } = req.query;
    if (!origin || !destination) return res.json({ insights: [] });
    try {
        const insights = [];
        const uid = parseInt(userId) || null;

        const [priceRows] = await db.query(`
            SELECT AVG(t.base_price) AS avg_price, MIN(t.base_price) AS min_price,
                   COUNT(DISTINCT t.trip_id) AS trip_count
            FROM trip t JOIN route r ON t.route_id=r.route_id
            WHERE (r.origin LIKE ? OR r.origin LIKE ?)
              AND (r.destination LIKE ? OR r.destination LIKE ?)
              AND t.status='OPEN' AND t.departure_time > NOW()
        `, [`%${origin}%`, `${origin}%`, `%${destination}%`, `${destination}%`]);

        const priceRow = priceRows[0];
        if (priceRow?.avg_price) {
            const diff = Math.round((priceRow.min_price - priceRow.avg_price) / priceRow.avg_price * 100);
            if (diff < -5) insights.push({ type: 'price_drop', icon: '💰',
                text: `Giá hôm nay thấp hơn trung bình ${Math.abs(diff)}%`,
                detail: `Từ ${Number(priceRow.min_price).toLocaleString('vi-VN')}đ` });
            if (priceRow.trip_count > 0) insights.push({ type: 'availability', icon: '✅',
                text: `Còn ${priceRow.trip_count} chuyến sắp tới` });
        }

        if (uid) {
            const [userHistory] = await db.query(`
                SELECT COUNT(*) AS cnt, MAX(search_time) AS last_search
                FROM search_log WHERE user_id=? AND origin LIKE ? AND destination LIKE ?
            `, [uid, `%${origin}%`, `%${destination}%`]);
            if (userHistory[0]?.cnt > 0) {
                insights.push({ type: 'user_history', icon: '🔄',
                    text: `Bạn đã tìm tuyến này ${userHistory[0].cnt} lần`,
                    detail: 'Đặt ngay để không bỏ lỡ chuyến tốt' });
            }

            const [lastBook] = await db.query(`
                SELECT b.booking_time, DAYOFWEEK(b.booking_time) AS dow
                FROM booking b JOIN trip t ON b.trip_id=t.trip_id JOIN route r ON t.route_id=r.route_id
                WHERE b.user_id=? AND b.status='PAID'
                  AND (r.origin LIKE ? OR r.origin LIKE ?)
                  AND (r.destination LIKE ? OR r.destination LIKE ?)
                ORDER BY b.booking_time DESC LIMIT 1
            `, [uid, `%${origin}%`, `${origin}%`, `%${destination}%`, `${destination}%`]);
            if (lastBook[0]) {
                const dow = lastBook[0].dow;
                insights.push({ type: 'booking_pattern', icon: '📅',
                    text: `Bạn thường đặt tuyến này vào ${(dow===1||dow===7)?'cuối tuần':_dowLabel(dow-1)}`,
                    detail: 'Đặt trước để có giá tốt hơn' });
            }
        }

        const [demandRow] = await db.query(`
            SELECT COUNT(b.booking_id) AS recent_bookings
            FROM booking b JOIN trip t ON b.trip_id=t.trip_id JOIN route r ON t.route_id=r.route_id
            WHERE (r.origin LIKE ? OR r.origin LIKE ?)
              AND (r.destination LIKE ? OR r.destination LIKE ?)
              AND b.booking_time >= DATE_SUB(NOW(), INTERVAL 7 DAY)
              AND b.status='PAID'
        `, [`%${origin}%`, `${origin}%`, `%${destination}%`, `${destination}%`]);
        if ((demandRow[0]?.recent_bookings || 0) >= 5) {
            insights.push({ type: 'demand', icon: '🔥',
                text: `${demandRow[0].recent_bookings} người đã đặt tuyến này tuần này`,
                detail: 'Tuyến đang có nhu cầu cao' });
        }

        res.json({ origin, destination, insights, generated_at: new Date() });
    } catch (err) {
        console.error('[AI] getSearchInsight error:', err.message);
        res.json({ insights: [] });
    }
};
