/**
 * SmartBusAI Dynamic Pricing Engine
 * Adjusts ticket price based on: time to departure, seat availability, demand
 */

/**
 * Calculate dynamic price multiplier
 * @param {number} daysUntilDeparture
 * @param {number} occupancyRate  0.0 – 1.0
 * @returns {number} multiplier rounded to 2 decimals
 */
function getPriceMultiplier(daysUntilDeparture, occupancyRate) {
    let multiplier = 1.0;

    // Early bird discount / last-minute surcharge
    if (daysUntilDeparture > 14)      multiplier *= 0.85; // -15%
    else if (daysUntilDeparture > 7)  multiplier *= 0.92; // -8%
    else if (daysUntilDeparture > 3)  multiplier *= 1.00; // base
    else if (daysUntilDeparture > 1)  multiplier *= 1.10; // +10%
    else                               multiplier *= 1.18; // last day +18%

    // Seat scarcity surcharge / empty seat discount
    if      (occupancyRate > 0.9)  multiplier *= 1.20; // < 10% left  → +20%
    else if (occupancyRate > 0.75) multiplier *= 1.12; // < 25% left  → +12%
    else if (occupancyRate > 0.5)  multiplier *= 1.05; // < 50% left  → +5%
    else if (occupancyRate < 0.2)  multiplier *= 0.90; // > 80% empty → -10%

    return Math.round(multiplier * 100) / 100;
}

/**
 * Build a human-readable reason string for the price adjustment
 */
function _buildReason(daysUntilDeparture, occupancyRate) {
    const reasons = [];

    if (daysUntilDeparture > 14)      reasons.push('Đặt sớm giảm 15%');
    else if (daysUntilDeparture > 7)  reasons.push('Đặt sớm giảm 8%');
    else if (daysUntilDeparture > 3)  reasons.push('Giá cơ bản');
    else if (daysUntilDeparture > 1)  reasons.push('Sắp khởi hành +10%');
    else                               reasons.push('Ngày khởi hành +18%');

    if      (occupancyRate > 0.9)  reasons.push('Sắp hết ghế +20%');
    else if (occupancyRate > 0.75) reasons.push('Còn ít ghế +12%');
    else if (occupancyRate > 0.5)  reasons.push('Ghế đã qua nửa +5%');
    else if (occupancyRate < 0.2)  reasons.push('Còn nhiều ghế -10%');

    return reasons.join(' · ');
}

/**
 * Get dynamic price for a specific trip
 * @param {object} db  mysql2/promise pool
 * @param {number|string} tripId
 * @returns {object} price breakdown
 */
async function getDynamicPrice(db, tripId) {
    const sql = `
        SELECT
            t.base_price,
            t.departure_time,
            COUNT(bd.booking_detail_id) AS booked,
            b.total_seats
        FROM trip t
        JOIN bus b ON t.bus_id = b.bus_id
        LEFT JOIN booking bk ON bk.trip_id = t.trip_id
            AND bk.status = 'PAID'
        LEFT JOIN booking_detail bd ON bd.booking_id = bk.booking_id
        WHERE t.trip_id = ?
        GROUP BY t.trip_id, t.base_price, t.departure_time, b.total_seats
    `;

    const [rows] = await db.query(sql, [tripId]);
    if (!rows.length) {
        throw new Error('Trip not found');
    }

    const row = rows[0];
    const basePrice = Number(row.base_price) || 0;
    const totalSeats = Number(row.total_seats) || 1;
    const booked = Number(row.booked) || 0;

    const depTime = new Date(row.departure_time);
    const now = new Date();
    const daysUntilDeparture = (depTime.getTime() - now.getTime()) / 86400000;
    const occupancyRate = Math.min(1, booked / totalSeats);

    const multiplier = getPriceMultiplier(daysUntilDeparture, occupancyRate);
    const dynamicPrice = Math.round(basePrice * multiplier / 1000) * 1000; // round to nearest 1000 VND

    const discountPct = multiplier < 1 ? Math.round((1 - multiplier) * 100) : 0;
    const surchargePct = multiplier > 1 ? Math.round((multiplier - 1) * 100) : 0;

    return {
        trip_id: Number(tripId),
        basePrice,
        dynamicPrice,
        multiplier,
        reason: _buildReason(daysUntilDeparture, occupancyRate),
        discount_pct: discountPct,
        surcharge_pct: surchargePct,
        daysUntilDeparture: Math.max(0, Math.round(daysUntilDeparture * 10) / 10),
        occupancyRate: Math.round(occupancyRate * 100),
        booked,
        totalSeats
    };
}

/**
 * Batch get dynamic prices for multiple trips
 * @param {object} db  mysql2/promise pool
 * @param {number[]} tripIds
 * @returns {object}  map of trip_id → price breakdown
 */
async function getBatchDynamicPrices(db, tripIds) {
    if (!tripIds || tripIds.length === 0) return {};

    const results = {};
    // Run in parallel for speed
    await Promise.all(tripIds.map(async (id) => {
        try {
            results[id] = await getDynamicPrice(db, id);
        } catch (e) {
            results[id] = { error: e.message };
        }
    }));
    return results;
}

module.exports = { getPriceMultiplier, getDynamicPrice, getBatchDynamicPrices };
