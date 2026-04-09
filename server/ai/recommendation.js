'use strict';
const db = require('../config/db');

/* ═══════════════════════════════════════════════════════════
   SmartBusAI — AI Recommendation & Analytics Engine
   Algorithms: Collaborative Filtering, Linear Regression,
   Demand Forecasting, NLP Classification
═══════════════════════════════════════════════════════════ */

/* ── Utility: simple linear regression ─────────────────── */
function linearRegression(xs, ys) {
    const n = xs.length;
    if (n < 2) return { a: ys[0] || 0, b: 0 };
    const sumX  = xs.reduce((s, x) => s + x, 0);
    const sumY  = ys.reduce((s, y) => s + y, 0);
    const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
    const sumX2 = xs.reduce((s, x) => s + x * x, 0);
    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return { a: sumY / n, b: 0 };
    const b = (n * sumXY - sumX * sumY) / denom;
    const a = (sumY - b * sumX) / n;
    return { a, b };
}

/* ── 1. COLLABORATIVE FILTERING ──────────────────────────
   User-based route recommendations                        */
async function getPersonalizedRoutes(userId, limit = 5) {
    try {
        // Step 1: routes this user has already booked
        const [myRoutes] = await db.query(`
            SELECT DISTINCT t.route_id
            FROM booking b
            JOIN trip t ON b.trip_id = t.trip_id
            WHERE b.user_id = ? AND b.status = 'PAID'
        `, [userId]);

        const myRouteIds = myRoutes.map(r => r.route_id);

        if (myRouteIds.length === 0) {
            // Cold start: return globally popular routes
            const [popular] = await db.query(`
                SELECT r.route_id,
                       CONCAT(r.origin,' → ',r.destination) AS route,
                       COUNT(b.booking_id) AS score,
                       IFNULL(AVG(rv.rating), 3.5) AS avg_rating
                FROM booking b
                JOIN trip t ON b.trip_id = t.trip_id
                JOIN route r ON t.route_id = r.route_id
                LEFT JOIN review rv ON rv.trip_id = t.trip_id
                WHERE b.status = 'PAID'
                GROUP BY r.route_id
                ORDER BY score DESC
                LIMIT ?
            `, [limit]);
            return popular.map(r => ({
                route_id: r.route_id,
                route: r.route,
                score: Math.round(r.score * (r.avg_rating / 5) * 10) / 10,
                reason: 'Popular route'
            }));
        }

        // Step 2: find similar users (who also booked our routes)
        const placeholders = myRouteIds.map(() => '?').join(',');
        const [similarUsers] = await db.query(`
            SELECT DISTINCT b.user_id, COUNT(*) AS shared_routes
            FROM booking b
            JOIN trip t ON b.trip_id = t.trip_id
            WHERE t.route_id IN (${placeholders})
              AND b.user_id != ?
              AND b.status = 'PAID'
            GROUP BY b.user_id
            ORDER BY shared_routes DESC
            LIMIT 50
        `, [...myRouteIds, userId]);

        if (similarUsers.length === 0) {
            return [];
        }

        const similarUserIds = similarUsers.map(u => u.user_id);
        const userPlaceholders = similarUserIds.map(() => '?').join(',');
        const excludePlaceholders = myRouteIds.length > 0
            ? 'AND t.route_id NOT IN (' + myRouteIds.map(() => '?').join(',') + ')'
            : '';

        // Step 3: routes those similar users booked (that we haven't)
        const [recommended] = await db.query(`
            SELECT r.route_id,
                   CONCAT(r.origin,' → ',r.destination) AS route,
                   COUNT(b.booking_id) AS freq,
                   IFNULL(AVG(rv.rating), 3.5) AS avg_rating
            FROM booking b
            JOIN trip t ON b.trip_id = t.trip_id
            JOIN route r ON t.route_id = r.route_id
            LEFT JOIN review rv ON rv.trip_id = t.trip_id
            WHERE b.user_id IN (${userPlaceholders})
              AND b.status = 'PAID'
              ${excludePlaceholders}
            GROUP BY r.route_id
            ORDER BY (COUNT(b.booking_id) * IFNULL(AVG(rv.rating), 3.5)) DESC
            LIMIT ?
        `, [...similarUserIds, ...myRouteIds, limit]);

        return recommended.map(r => ({
            route_id: r.route_id,
            route: r.route,
            score: Math.round(r.freq * (r.avg_rating / 5) * 10) / 10,
            reason: `Booked by ${Math.min(similarUsers.length, 10)}+ similar users`
        }));
    } catch (err) {
        console.error('[AI] getPersonalizedRoutes error:', err.message);
        return [];
    }
}

/* ── 2. PRICE PREDICTION ─────────────────────────────────
   Linear regression on historical booking data            */
async function predictOptimalPrice(routeId, departureDate) {
    try {
        // Get historical bookings for this route in last 60 days
        const [history] = await db.query(`
            SELECT
                t.base_price,
                t.departure_time,
                DAYOFWEEK(t.departure_time) AS dow,
                DATEDIFF(t.departure_time, b.booking_time) AS days_ahead,
                COUNT(bd.booking_detail_id) AS booked_seats,
                bs.total_seats
            FROM booking b
            JOIN trip t ON b.trip_id = t.trip_id
            JOIN bus bs ON t.bus_id = bs.bus_id
            LEFT JOIN booking_detail bd ON bd.booking_id = b.booking_id
            WHERE t.route_id = ?
              AND b.status = 'PAID'
              AND b.booking_time >= DATE_SUB(NOW(), INTERVAL 60 DAY)
            GROUP BY t.trip_id, b.booking_id
            LIMIT 200
        `, [routeId]);

        if (history.length === 0) {
            return { basePrice: null, suggestedMin: null, suggestedMax: null,
                     demandFactor: 1.0, reasoning: 'Insufficient data for prediction' };
        }

        // Average price & occupancy
        const prices = history.map(h => h.base_price);
        const basePrice = prices.reduce((s, p) => s + p, 0) / prices.length;

        // Occupancy rate by day of week
        const dowOcc = {};
        history.forEach(h => {
            if (!dowOcc[h.dow]) dowOcc[h.dow] = { seats: 0, total: 0, count: 0 };
            dowOcc[h.dow].seats += Number(h.booked_seats) || 0;
            dowOcc[h.dow].total += Number(h.total_seats) || 40;
            dowOcc[h.dow].count++;
        });

        const targetDate = departureDate ? new Date(departureDate) : new Date();
        const targetDow = targetDate.getDay() + 1; // MySQL DAYOFWEEK: 1=Sun

        const occData = dowOcc[targetDow];
        const avgOccRate = occData && occData.total > 0
            ? occData.seats / occData.total
            : 0.55;

        // Days ahead trend via linear regression
        const validHistory = history.filter(h => h.days_ahead >= 0 && h.days_ahead <= 60);
        let demandFactor = 1.0;

        if (validHistory.length >= 5) {
            const xs = validHistory.map(h => h.days_ahead);
            const ys = validHistory.map(h => h.booked_seats / Math.max(h.total_seats, 1));
            const { a, b } = linearRegression(xs, ys);
            const daysAhead = Math.max(0, Math.ceil((targetDate - new Date()) / 86400000));
            const predictedOcc = Math.min(1, Math.max(0, a + b * daysAhead));
            demandFactor = 0.8 + predictedOcc * 0.6; // 0.8x to 1.4x
        } else {
            // Fallback: use DOW occupancy
            demandFactor = 0.8 + avgOccRate * 0.6;
        }

        // Weekend surcharge
        const isWeekend = targetDow === 1 || targetDow === 7; // Sun or Sat
        if (isWeekend) demandFactor *= 1.15;

        const suggestedPrice = basePrice * demandFactor;
        const suggestedMin = Math.round(suggestedPrice * 0.90 / 1000) * 1000;
        const suggestedMax = Math.round(suggestedPrice * 1.15 / 1000) * 1000;

        const level = demandFactor > 1.2 ? 'HIGH' : demandFactor > 1.0 ? 'MEDIUM' : 'LOW';
        const reasoning = `Based on ${history.length} historical bookings. ` +
            `Avg occupancy ${Math.round(avgOccRate * 100)}% on this day-of-week. ` +
            `Demand level: ${level}. ${isWeekend ? 'Weekend surcharge applied.' : ''}`;

        return {
            basePrice: Math.round(basePrice),
            suggestedMin,
            suggestedMax,
            demandFactor: Math.round(demandFactor * 100) / 100,
            demandLevel: level,
            avgOccupancyRate: Math.round(avgOccRate * 100),
            reasoning
        };
    } catch (err) {
        console.error('[AI] predictOptimalPrice error:', err.message);
        return { basePrice: null, suggestedMin: null, suggestedMax: null,
                 demandFactor: 1.0, reasoning: 'Error during prediction' };
    }
}

/* ── 3. DEMAND FORECASTING ───────────────────────────────
   Time-decay weighted occupancy forecast                  */
async function forecastDemand(tripId) {
    try {
        // Get the trip's route, departure DOW, hour
        const [[trip]] = await db.query(`
            SELECT t.trip_id, t.route_id, t.departure_time,
                   DAYOFWEEK(t.departure_time) AS dow,
                   HOUR(t.departure_time) AS hour,
                   bs.total_seats
            FROM trip t
            JOIN bus bs ON t.bus_id = bs.bus_id
            WHERE t.trip_id = ?
        `, [tripId]);

        if (!trip) {
            return { score: 0, level: 'LOW', estimated_occupancy: '0%', message: 'Trip not found' };
        }

        // Historical occupancy for same route, same DOW + hour, last 4 weeks
        const [historical] = await db.query(`
            SELECT
                t2.trip_id,
                t2.departure_time,
                bs2.total_seats,
                COUNT(DISTINCT bd.seat_id) AS booked_seats,
                DATEDIFF(NOW(), t2.departure_time) AS days_ago
            FROM trip t2
            JOIN bus bs2 ON t2.bus_id = bs2.bus_id
            LEFT JOIN booking bk ON bk.trip_id = t2.trip_id AND bk.status = 'PAID'
            LEFT JOIN booking_detail bd ON bd.booking_id = bk.booking_id
            WHERE t2.route_id = ?
              AND DAYOFWEEK(t2.departure_time) = ?
              AND ABS(HOUR(t2.departure_time) - ?) <= 2
              AND t2.departure_time < NOW()
              AND t2.departure_time >= DATE_SUB(NOW(), INTERVAL 28 DAY)
              AND t2.trip_id != ?
            GROUP BY t2.trip_id
            LIMIT 20
        `, [trip.route_id, trip.dow, trip.hour, tripId]);

        if (historical.length === 0) {
            // Fallback: route-level popularity
            const [[routeStats]] = await db.query(`
                SELECT COUNT(b.booking_id) AS total_bookings,
                       AVG(bs.total_seats) AS avg_seats
                FROM booking b
                JOIN trip t ON b.trip_id = t.trip_id
                JOIN bus bs ON t.bus_id = bs.bus_id
                WHERE t.route_id = ? AND b.status = 'PAID'
                  AND b.booking_time >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            `, [trip.route_id]);
            const estimatedOcc = Math.min(100, Math.round(
                ((routeStats.total_bookings || 0) /
                 Math.max(routeStats.avg_seats || 40, 1)) * 100
            ));
            const level = estimatedOcc > 70 ? 'HIGH' : estimatedOcc > 40 ? 'MEDIUM' : 'LOW';
            return { score: estimatedOcc, level, estimated_occupancy: estimatedOcc + '%' };
        }

        // Time-decay weighted average: weight = 1 / (1 + days_ago * 0.1)
        let weightedSum = 0, totalWeight = 0;
        historical.forEach(h => {
            const occ = Number(h.booked_seats) / Math.max(Number(h.total_seats), 1);
            const weight = 1 / (1 + Number(h.days_ago) * 0.1);
            weightedSum += occ * weight;
            totalWeight += weight;
        });

        const avgOcc = totalWeight > 0 ? weightedSum / totalWeight : 0;
        const score = Math.min(100, Math.round(avgOcc * 100));
        const level = score > 70 ? 'HIGH' : score > 40 ? 'MEDIUM' : 'LOW';

        return {
            score,
            level,
            estimated_occupancy: score + '%',
            data_points: historical.length
        };
    } catch (err) {
        console.error('[AI] forecastDemand error:', err.message);
        return { score: 0, level: 'LOW', estimated_occupancy: '0%' };
    }
}

/* ── 4. NLP SUPPORT CLASSIFICATION ──────────────────────
   Vietnamese keyword-based ticket classifier              */
function classifySupportTicket(title, content) {
    const keywords = {
        PAYMENT: {
            words: ['thanh toán', 'tiền', 'hoàn tiền', 'refund', 'payment', 'momo', 'zalopay',
                    'zalo pay', 'ngân hàng', 'bank', 'chuyển khoản', 'thẻ', 'visa', 'mastercard',
                    'nạp tiền', 'trừ tiền', 'không nhận', 'chưa nhận'],
            response: 'Xin chào! Chúng tôi đã nhận được yêu cầu hỗ trợ về thanh toán của bạn. ' +
                'Vui lòng cung cấp mã giao dịch và ảnh chụp màn hình để chúng tôi xử lý nhanh nhất. ' +
                'Thời gian giải quyết: 1-3 ngày làm việc.'
        },
        REFUND: {
            words: ['hoàn tiền', 'refund', 'trả tiền', 'hủy vé', 'hoàn vé', 'đòi tiền',
                    'bồi hoàn', 'hủy chuyến', 'hủy booking'],
            response: 'Cảm ơn bạn đã liên hệ! Yêu cầu hoàn tiền của bạn đã được tiếp nhận. ' +
                'Chúng tôi sẽ xem xét trong vòng 24 giờ và hoàn tiền trong 3-5 ngày làm việc.'
        },
        BOOKING: {
            words: ['đặt vé', 'vé', 'booking', 'ghế', 'seat', 'chỗ', 'đặt chỗ', 'chuyến',
                    'trip', 'lịch trình', 'giờ khởi hành', 'bến xe', 'tuyến'],
            response: 'Chào bạn! Chúng tôi đã nhận yêu cầu liên quan đến đặt vé. ' +
                'Vui lòng cung cấp mã booking để chúng tôi kiểm tra và hỗ trợ bạn.'
        },
        TECHNICAL: {
            words: ['lỗi', 'bug', 'không load', 'không hoạt động', 'error', 'crash', 'màn hình',
                    'app', 'tải', 'chậm', 'không vào được', 'không đăng nhập', 'quên mật khẩu',
                    'không nhận được', 'otp', 'sms'],
            response: 'Xin lỗi vì sự bất tiện! Đội kỹ thuật của chúng tôi đã được thông báo. ' +
                'Vui lòng thử xóa cache trình duyệt và thử lại. Nếu vẫn lỗi, chúng tôi sẽ khắc phục trong 24 giờ.'
        },
        COMPLAINT: {
            words: ['khiếu nại', 'tệ', 'kém', 'thất vọng', 'chậm trễ', 'trễ', 'muộn', 'thái độ',
                    'thô lỗ', 'không hài lòng', 'tức', 'phàn nàn', 'bức xúc', 'chất lượng', 'dịch vụ'],
            response: 'Chúng tôi thành thật xin lỗi vì trải nghiệm chưa tốt của bạn. ' +
                'Phản hồi của bạn rất quan trọng để chúng tôi cải thiện dịch vụ. ' +
                'Ban quản lý sẽ xem xét và phản hồi trong vòng 24 giờ.'
        },
        GENERAL: {
            words: ['hỏi', 'thắc mắc', 'tư vấn', 'giúp', 'hướng dẫn', 'thông tin',
                    'giá vé', 'lịch chạy', 'bao lâu'],
            response: 'Cảm ơn bạn đã liên hệ SmartBusAI! Chúng tôi sẽ phản hồi trong vòng 2-4 giờ. ' +
                'Bạn cũng có thể tham khảo mục FAQ trên website.'
        }
    };

    const titleLower = (title || '').toLowerCase();
    const contentLower = (content || '').toLowerCase();
    const combined = titleLower + ' ' + contentLower;

    const scores = {};
    for (const [cat, cfg] of Object.entries(keywords)) {
        let score = 0;
        cfg.words.forEach(kw => {
            if (titleLower.includes(kw)) score += 2;   // title match = 2x weight
            if (contentLower.includes(kw)) score += 1;
        });
        scores[cat] = score;
    }

    // Pick top category
    let topCat = 'GENERAL';
    let topScore = 0;
    for (const [cat, score] of Object.entries(scores)) {
        if (score > topScore) { topScore = score; topCat = cat; }
    }

    const totalScore = Object.values(scores).reduce((s, v) => s + v, 0);
    const confidence = totalScore > 0 ? Math.round((topScore / totalScore) * 100) : 50;

    return {
        category: topCat,
        confidence,
        scores,
        suggestedResponse: keywords[topCat].response
    };
}

/* ── 5. REVENUE FORECAST ─────────────────────────────────
   Linear regression + seasonality for 30-day projection  */
async function forecastRevenue(days = 30) {
    try {
        const [history] = await db.query(`
            SELECT DATE(booking_time) AS date,
                   SUM(total_amount) AS revenue
            FROM booking
            WHERE status = 'PAID'
              AND booking_time >= DATE_SUB(NOW(), INTERVAL 90 DAY)
            GROUP BY DATE(booking_time)
            ORDER BY date ASC
        `);

        if (history.length < 7) {
            // Not enough data — return zero-filled forecast
            const result = [];
            const today = new Date();
            for (let i = 1; i <= days; i++) {
                const d = new Date(today);
                d.setDate(today.getDate() + i);
                result.push({
                    date: d.toISOString().slice(0, 10),
                    predicted: 0,
                    lower_bound: 0,
                    upper_bound: 0,
                    confidence: 'low'
                });
            }
            return result;
        }

        // Build indexed series
        const xs = history.map((_, i) => i);
        const ys = history.map(h => Number(h.revenue) || 0);
        const { a, b } = linearRegression(xs, ys);

        // Residuals for confidence interval
        const residuals = ys.map((y, i) => y - (a + b * xs[i]));
        const stdDev = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / residuals.length);

        // Weekend seasonality factors per DOW (0=Sun … 6=Sat)
        const dowFactors = [1.20, 0.90, 0.92, 0.95, 0.98, 1.10, 1.30];

        const result = [];
        const today = new Date();
        const baseIndex = history.length;

        for (let i = 1; i <= days; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() + i);
            const dow = d.getDay();
            const x = baseIndex + i;
            const rawPred = a + b * x;
            const predicted = Math.max(0, Math.round(rawPred * dowFactors[dow]));
            const margin = Math.round(stdDev * 1.645); // 90% CI

            result.push({
                date: d.toISOString().slice(0, 10),
                predicted,
                lower_bound: Math.max(0, predicted - margin),
                upper_bound: predicted + margin,
                confidence: history.length >= 30 ? 'high' : history.length >= 14 ? 'medium' : 'low'
            });
        }
        return result;
    } catch (err) {
        console.error('[AI] forecastRevenue error:', err.message);
        return [];
    }
}

/* ── 6. ANOMALY DETECTION ────────────────────────────────
   Statistical deviation from 7-day rolling average       */
async function detectAnomalies() {
    try {
        const anomalies = [];

        // ── Cancellation rate ──
        const [[cancelData]] = await db.query(`
            SELECT
                SUM(CASE WHEN DATE(booking_time) = CURDATE() AND status='CANCELED' THEN 1 ELSE 0 END)  AS today_canceled,
                SUM(CASE WHEN DATE(booking_time) = CURDATE() THEN 1 ELSE 0 END)                         AS today_total,
                SUM(CASE WHEN booking_time >= DATE_SUB(NOW(), INTERVAL 8 DAY)
                          AND booking_time < DATE_SUB(NOW(), INTERVAL 1 DAY)
                          AND status='CANCELED' THEN 1 ELSE 0 END)                                       AS week_canceled,
                SUM(CASE WHEN booking_time >= DATE_SUB(NOW(), INTERVAL 8 DAY)
                          AND booking_time < DATE_SUB(NOW(), INTERVAL 1 DAY) THEN 1 ELSE 0 END)          AS week_total
            FROM booking
        `);

        const todayCancelRate = cancelData.today_total > 0
            ? cancelData.today_canceled / cancelData.today_total : 0;
        const weekCancelRate  = cancelData.week_total > 0
            ? cancelData.week_canceled / cancelData.week_total : 0;

        if (todayCancelRate > 0 && weekCancelRate > 0 && todayCancelRate > weekCancelRate * 2) {
            anomalies.push({
                type: 'HIGH_CANCELLATION',
                severity: todayCancelRate > weekCancelRate * 3 ? 'HIGH' : 'MEDIUM',
                description: 'Tỷ lệ huỷ vé hôm nay cao bất thường',
                metric_today: (todayCancelRate * 100).toFixed(1) + '%',
                metric_avg: (weekCancelRate * 100).toFixed(1) + '%',
                recommendation: 'Kiểm tra các vấn đề hệ thống hoặc chuyến xe bị huỷ'
            });
        }

        // ── Booking drop-off ──
        const [[bookingData]] = await db.query(`
            SELECT
                SUM(CASE WHEN DATE(booking_time) = CURDATE() THEN 1 ELSE 0 END) AS today_bookings,
                ROUND(SUM(CASE WHEN booking_time >= DATE_SUB(NOW(), INTERVAL 8 DAY)
                               AND booking_time < DATE_SUB(NOW(), INTERVAL 1 DAY) THEN 1 ELSE 0 END) / 7.0, 1)
                    AS avg_daily_bookings
            FROM booking WHERE status IN ('PAID','PENDING')
        `);

        const todayBk  = Number(bookingData.today_bookings) || 0;
        const avgDayBk = Number(bookingData.avg_daily_bookings) || 0;

        if (avgDayBk > 5 && todayBk < avgDayBk * 0.5) {
            anomalies.push({
                type: 'BOOKING_DROP',
                severity: todayBk < avgDayBk * 0.25 ? 'HIGH' : 'MEDIUM',
                description: 'Lượng đặt vé hôm nay thấp hơn bình thường đáng kể',
                metric_today: todayBk + ' vé',
                metric_avg: avgDayBk.toFixed(1) + ' vé/ngày',
                recommendation: 'Kiểm tra trạng thái website và các chuyến xe đang mở'
            });
        }

        // ── Revenue anomaly ──
        const [[revenueData]] = await db.query(`
            SELECT
                IFNULL(SUM(CASE WHEN DATE(booking_time) = CURDATE() AND status='PAID' THEN total_amount ELSE 0 END), 0) AS today_rev,
                IFNULL(ROUND(SUM(CASE WHEN booking_time >= DATE_SUB(NOW(), INTERVAL 8 DAY)
                               AND booking_time < DATE_SUB(NOW(), INTERVAL 1 DAY)
                               AND status='PAID' THEN total_amount ELSE 0 END) / 7.0, 0), 0) AS avg_daily_rev
            FROM booking
        `);

        const todayRev = Number(revenueData.today_rev) || 0;
        const avgRev   = Number(revenueData.avg_daily_rev) || 0;

        if (avgRev > 100000 && todayRev > avgRev * 2.5) {
            anomalies.push({
                type: 'REVENUE_SPIKE',
                severity: 'MEDIUM',
                description: 'Doanh thu hôm nay tăng đột biến',
                metric_today: todayRev.toLocaleString('vi-VN') + 'đ',
                metric_avg: avgRev.toLocaleString('vi-VN') + 'đ/ngày',
                recommendation: 'Có thể do sự kiện lớn hoặc khuyến mãi — theo dõi thêm'
            });
        }

        // ── No open trips ──
        const [[openTrips]] = await db.query(`
            SELECT COUNT(*) AS cnt FROM trip
            WHERE status = 'OPEN' AND departure_time > NOW()
        `);

        if (Number(openTrips.cnt) === 0) {
            anomalies.push({
                type: 'NO_OPEN_TRIPS',
                severity: 'HIGH',
                description: 'Không có chuyến xe nào đang mở',
                metric_today: '0 chuyến',
                metric_avg: 'Cần > 0',
                recommendation: 'Liên hệ nhà xe để mở thêm chuyến mới'
            });
        }

        return anomalies;
    } catch (err) {
        console.error('[AI] detectAnomalies error:', err.message);
        return [];
    }
}

/* ── 7. BOOKING HEATMAP ──────────────────────────────────
   7×24 matrix of booking frequency                       */
async function getBookingHeatmap() {
    try {
        const [rows] = await db.query(`
            SELECT DAYOFWEEK(booking_time) - 1 AS dow,
                   HOUR(booking_time)          AS hour,
                   COUNT(*)                    AS cnt
            FROM booking
            WHERE booking_time >= DATE_SUB(NOW(), INTERVAL 90 DAY)
            GROUP BY dow, hour
        `);

        // Build 7×24 matrix
        const matrix = Array.from({ length: 7 }, () => Array(24).fill(0));
        rows.forEach(r => {
            const d = Number(r.dow);
            const h = Number(r.hour);
            if (d >= 0 && d < 7 && h >= 0 && h < 24) {
                matrix[d][h] = Number(r.cnt);
            }
        });

        // Normalize 0 → 1
        const maxVal = Math.max(...matrix.flat(), 1);
        const normalized = matrix.map(row => row.map(v => Math.round((v / maxVal) * 100) / 100));

        return {
            matrix: normalized,
            raw: matrix,
            days: ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'],
            hours: Array.from({ length: 24 }, (_, i) => i)
        };
    } catch (err) {
        console.error('[AI] getBookingHeatmap error:', err.message);
        return { matrix: Array.from({ length: 7 }, () => Array(24).fill(0)), raw: [], days: [], hours: [] };
    }
}

/* ── 8. TOP RECOMMENDED ROUTES OVERVIEW ─────────────────
   For admin: aggregate personalised recommendations      */
async function getTopRecommendedRoutes(limit = 10) {
    try {
        // Get all users who have bookings
        const [users] = await db.query(`
            SELECT DISTINCT user_id FROM booking
            WHERE status = 'PAID'
            ORDER BY RAND()
            LIMIT 30
        `);

        const routeFreq = {};
        const routeNames = {};

        for (const u of users.slice(0, 20)) {
            const recs = await getPersonalizedRoutes(u.user_id, 5);
            recs.forEach(r => {
                routeFreq[r.route_id] = (routeFreq[r.route_id] || 0) + r.score;
                routeNames[r.route_id] = r.route;
            });
        }

        const sorted = Object.entries(routeFreq)
            .map(([id, score]) => ({ route_id: id, route: routeNames[id], score: Math.round(score * 10) / 10 }))
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

        return sorted;
    } catch (err) {
        console.error('[AI] getTopRecommendedRoutes error:', err.message);
        return [];
    }
}

module.exports = {
    getPersonalizedRoutes,
    predictOptimalPrice,
    forecastDemand,
    classifySupportTicket,
    forecastRevenue,
    detectAnomalies,
    getBookingHeatmap,
    getTopRecommendedRoutes
};
