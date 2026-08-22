'use strict';
const db = require('../config/db');

/* ═══════════════════════════════════════════════════════════
   aiDemandForecaster.js — Sprint 11: system-wide demand forecast.

   Honest framing (matching login.html's own existing "Rule-based AI ·
   Real-time" badge for the recommendation engine): this is a real
   statistical heuristic over real booking/search history, NOT a trained
   ML model — there's no labeled training set to train one on. It reports
   an actual week-over-baseline booking trend and an actual current
   seat-fill level, not a random or hardcoded number.

   Per route (scoped to routes with at least one upcoming trip in the
   next FORECAST_WINDOW_DAYS — a dormant route has nothing to forecast):
     demand_change_pct = (last 7 days' paid bookings − prior 4-week
                           weekly average) / prior weekly average × 100
       — null when there's no prior-week baseline to compare against
         (reported as "insufficient data", never a fabricated number).
     sellout_risk_pct  = 0.7 × current average seat-fill % of upcoming
                          trips on the route + 0.3 × max(0, demand_change_pct)
       — a route already 90% full is high-risk regardless of trend; a
         route trending up further raises the risk on top of that.
═══════════════════════════════════════════════════════════ */

const FORECAST_WINDOW_DAYS = 7;
const TREND_LOOKBACK_DAYS = 35; // 5 weeks: last 7 days + prior 4 weeks

async function computeDemandForecast() {
    const [upcomingTrips] = await db.query(
        `SELECT t.trip_id, t.route_id, r.origin, r.destination, t.departure_time,
                bs.total_seats,
                (bs.total_seats - COUNT(DISTINCT bd.seat_id)) AS available_seats
         FROM trip t
         JOIN route r ON t.route_id = r.route_id
         JOIN bus bs  ON t.bus_id = bs.bus_id
         LEFT JOIN booking bk ON bk.trip_id = t.trip_id AND bk.status IN ('PAID','PENDING')
         LEFT JOIN booking_detail bd ON bd.booking_id = bk.booking_id
         WHERE t.departure_time BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL ? DAY)
           AND t.status IN ('OPEN','FULL')
           AND r.status = 'ACTIVE'
         GROUP BY t.trip_id`,
        [FORECAST_WINDOW_DAYS]
    );

    if (upcomingTrips.length === 0) return [];

    const byRoute = new Map();
    for (const row of upcomingTrips) {
        if (!byRoute.has(row.route_id)) {
            byRoute.set(row.route_id, {
                route_id: row.route_id, origin: row.origin, destination: row.destination,
                nearestDeparture: row.departure_time, fillSamples: [],
            });
        }
        const entry = byRoute.get(row.route_id);
        if (new Date(row.departure_time) < new Date(entry.nearestDeparture)) entry.nearestDeparture = row.departure_time;
        const total = Number(row.total_seats) || 0;
        const available = Math.max(0, Number(row.available_seats) || 0);
        if (total > 0) entry.fillSamples.push(1 - available / total);
    }

    const routeIds = [...byRoute.keys()];
    const [trendRows] = await db.query(
        `SELECT t.route_id,
                SUM(CASE WHEN bk.booking_time >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS lastWeekBookings,
                SUM(CASE WHEN bk.booking_time >= DATE_SUB(NOW(), INTERVAL ? DAY) AND bk.booking_time < DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS priorBookings
         FROM booking bk
         JOIN trip t ON bk.trip_id = t.trip_id
         WHERE bk.status = 'PAID' AND t.route_id IN (?) AND bk.booking_time >= DATE_SUB(NOW(), INTERVAL ? DAY)
         GROUP BY t.route_id`,
        [TREND_LOOKBACK_DAYS, routeIds, TREND_LOOKBACK_DAYS]
    );
    const trendByRoute = new Map(trendRows.map(r => [r.route_id, r]));

    const results = [];
    for (const [routeId, entry] of byRoute) {
        const trend = trendByRoute.get(routeId);
        const lastWeek = trend ? Number(trend.lastWeekBookings) : 0;
        const priorWeeklyAvg = trend ? Number(trend.priorBookings) / 4 : 0;

        const demand_change_pct = priorWeeklyAvg > 0
            ? Math.round(((lastWeek - priorWeeklyAvg) / priorWeeklyAvg) * 1000) / 10
            : null; // no prior baseline — don't fabricate a trend

        const avgFillPct = entry.fillSamples.length > 0
            ? entry.fillSamples.reduce((s, v) => s + v, 0) / entry.fillSamples.length
            : 0;

        const trendComponent = demand_change_pct != null ? Math.max(0, demand_change_pct) : 0;
        const sellout_risk_pct = Math.max(0, Math.min(100,
            Math.round((avgFillPct * 100 * 0.7 + trendComponent * 0.3) * 10) / 10
        ));

        const dateLabel = new Date(entry.nearestDeparture).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
        const message = demand_change_pct != null
            ? `Tuyến ${entry.origin} - ${entry.destination} ngày ${dateLabel} dự báo ${demand_change_pct >= 0 ? 'tăng' : 'giảm'} ${Math.abs(demand_change_pct)}% nhu cầu, nguy cơ cháy vé ${sellout_risk_pct}%`
            : `Tuyến ${entry.origin} - ${entry.destination} ngày ${dateLabel} — chưa đủ dữ liệu 5 tuần để so sánh xu hướng, mức lấp đầy hiện tại ${Math.round(avgFillPct * 100)}%`;

        results.push({
            route_id: routeId, origin: entry.origin, destination: entry.destination,
            forecast_date: entry.nearestDeparture,
            demand_change_pct, sellout_risk_pct, message,
        });
    }

    results.sort((a, b) => b.sellout_risk_pct - a.sellout_risk_pct);
    return results;
}

/** Best-effort persistence into the ai_demand_forecast cache/heatmap table. */
async function persistForecast(results) {
    for (const r of results) {
        try {
            const dateOnly = new Date(r.forecast_date).toISOString().slice(0, 10);
            await db.query(
                `INSERT INTO ai_demand_forecast (route_id, forecast_date, demand_change_pct, sellout_risk_pct, message)
                 VALUES (?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE demand_change_pct=VALUES(demand_change_pct), sellout_risk_pct=VALUES(sellout_risk_pct), message=VALUES(message), computed_at=NOW()`,
                [r.route_id, dateOnly, r.demand_change_pct, r.sellout_risk_pct, r.message]
            );
        } catch (e) { /* heatmap cache write is best-effort */ }
    }
}

async function getDemandForecast({ limit = 20, persist = true } = {}) {
    const results = await computeDemandForecast();
    if (persist && results.length > 0) await persistForecast(results);
    return results.slice(0, limit);
}

module.exports = { getDemandForecast, computeDemandForecast, FORECAST_WINDOW_DAYS };
