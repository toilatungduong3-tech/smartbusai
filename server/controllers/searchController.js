'use strict';

const db = require('../config/db');
const { searchWithTransit, getPopularTransferPoints } = require('../ai/transitRouter');

/* ═══════════════════════════════════════════════════
   POST /api/search/transit
   Body: { origin, destination, date, mode }
   mode: 'time' | 'cost' | 'hops'
═══════════════════════════════════════════════════ */
exports.transitSearch = async (req, res) => {
    const { origin, destination, date, mode = 'time' } = req.body;

    if (!origin || !destination) {
        return res.status(400).json({ message: 'Thiếu điểm đi hoặc điểm đến' });
    }

    try {
        const result = await searchWithTransit(db, { origin, destination, date, mode });

        const is_success = (result.direct.length + result.transit.length) > 0;

        // Log tìm kiếm (non-blocking)
        logSearch(req, {
            origin, destination, date,
            result_count:  result.direct.length,
            transit_count: result.transit.length,
            is_success
        }).catch(() => {});

        return res.json({
            origin,
            destination,
            date: date || null,
            mode,
            direct_count:  result.direct.length,
            transit_count: result.transit.length,
            direct:        result.direct,
            transit:       result.transit
        });
    } catch (err) {
        console.error('[searchController] transitSearch error:', err);
        return res.status(500).json({ message: 'Search error' });
    }
};

/* ═══════════════════════════════════════════════════
   GET /api/search/log-search  (ghi log từ GET search)
   Được gọi từ frontend khi dùng /api/trips/search
═══════════════════════════════════════════════════ */
exports.logSearchGet = async (req, res) => {
    const { origin, destination, date, result_count, transit_count, is_success } = req.query;
    await logSearch(req, {
        origin, destination, date,
        result_count:  Number(result_count)  || 0,
        transit_count: Number(transit_count) || 0,
        is_success:    is_success === 'true' || is_success === '1'
    }).catch(() => {});
    res.json({ ok: true });
};

/* ═══════════════════════════════════════════════════
   GET /api/search/analytics
   Trả về thống kê tìm kiếm cho admin dashboard
═══════════════════════════════════════════════════ */
exports.getSearchAnalytics = async (req, res) => {
    try {
        const [[totals]] = await db.query(`
            SELECT
                COUNT(*)                                                          AS total_searches,
                SUM(is_success)                                                   AS success_count,
                SUM(result_count = 0 AND transit_count = 0)                       AS no_result_count,
                ROUND(AVG(result_count), 1)                                       AS avg_direct_results,
                COUNT(DISTINCT DATE(search_time))                                 AS active_days,
                SUM(CASE WHEN DATE(search_time) = CURDATE() THEN 1 ELSE 0 END)   AS today_searches
            FROM search_log
        `);

        // Tuyến được tìm nhiều nhất
        const [topRoutes] = await db.query(`
            SELECT origin, destination,
                   COUNT(*) AS search_count,
                   SUM(is_success) AS success_count
            FROM search_log
            WHERE origin IS NOT NULL AND destination IS NOT NULL
            GROUP BY origin, destination
            ORDER BY search_count DESC
            LIMIT 10
        `);

        // Lượt tìm kiếm 7 ngày gần nhất
        const [daily] = await db.query(`
            SELECT DATE(search_time) AS date, COUNT(*) AS count
            FROM search_log
            WHERE search_time >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            GROUP BY DATE(search_time)
            ORDER BY date ASC
        `);

        // Điểm trung chuyển phổ biến
        const [transitPoints] = await db.query(`
            SELECT sl.origin AS from_city, sl.destination AS to_city,
                   COUNT(*) AS frequency
            FROM search_log sl
            WHERE sl.transit_count > 0
            GROUP BY sl.origin, sl.destination
            ORDER BY frequency DESC
            LIMIT 10
        `).catch(() => [[]]);

        const successRate = totals.total_searches > 0
            ? Math.round((totals.success_count / totals.total_searches) * 100)
            : 0;

        return res.json({
            summary: {
                ...totals,
                success_rate: successRate + '%'
            },
            top_routes:      topRoutes,
            daily_searches:  daily,
            transit_popular: transitPoints
        });
    } catch (err) {
        console.error('[searchController] getSearchAnalytics error:', err);
        return res.status(500).json({ message: 'Analytics error' });
    }
};

/* ═══════════════════════════════════════════════════
   GET /api/search/popular-transfers
   Trả về điểm trung chuyển phổ biến
═══════════════════════════════════════════════════ */
exports.getPopularTransfers = async (req, res) => {
    try {
        const points = await getPopularTransferPoints(db, 10);
        return res.json(points);
    } catch (err) {
        return res.status(500).json({ message: 'DB error' });
    }
};

/* ═══════════════════════════════════════════════════
   GET /api/search/suggestions?q=...
   Gợi ý tên thành phố/tỉnh dựa trên từ khóa
═══════════════════════════════════════════════════ */
exports.getSuggestions = async (req, res) => {
    const q = (req.query.q || '').trim();
    if (q.length < 1) return res.json([]);
    try {
        const [rows] = await db.query(`
            SELECT city FROM (
                SELECT DISTINCT origin AS city FROM route WHERE origin LIKE ?
                UNION
                SELECT DISTINCT destination AS city FROM route WHERE destination LIKE ?
            ) t
            ORDER BY city
            LIMIT 10
        `, [`%${q}%`, `%${q}%`]);
        return res.json(rows.map(r => r.city));
    } catch (err) {
        return res.status(500).json([]);
    }
};

/* ── Internal: ghi log search vào DB ── */
async function logSearch(req, { origin, destination, date, result_count, transit_count, is_success }) {
    const user_id = req.user?.user_id || null;
    try {
        await db.query(`
            INSERT INTO search_log (user_id, origin, destination, travel_date, result_count, transit_count, is_success)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [user_id, origin || null, destination || null, date || null,
            result_count || 0, transit_count || 0, is_success ? 1 : 0]);
    } catch (e) {
        // search_log table may not exist yet — silently skip
    }
}
