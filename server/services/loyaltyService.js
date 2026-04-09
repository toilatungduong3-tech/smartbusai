'use strict';

/* ═══════════════════════════════════════════════════════════
   SmartBusAI — Loyalty Points Service
   1,000 VND spent = 1 point
   Tiers: Bronze/Silver/Gold/Diamond
═══════════════════════════════════════════════════════════ */

const TIER_THRESHOLDS = { BRONZE: 0, SILVER: 500, GOLD: 2000, DIAMOND: 5000 };
const EARN_RATE   = 1;   // 1 pt per 1,000 VND
const REDEEM_RATE = 100; // 100 pts = 10,000 VND discount

const TIER_META = {
    BRONZE:  { label: '🥉 Đồng',       color: '#cd7f32', discount: 0,  next: 'SILVER',  nextAt: 500  },
    SILVER:  { label: '🥈 Bạc',         color: '#c0c0c0', discount: 5,  next: 'GOLD',    nextAt: 2000 },
    GOLD:    { label: '🥇 Vàng',        color: '#ffd700', discount: 10, next: 'DIAMOND', nextAt: 5000 },
    DIAMOND: { label: '💎 Kim cương',   color: '#b9f2ff', discount: 15, next: null,       nextAt: null }
};

/* ── Utilities ── */
function calculateEarnedPoints(amount) {
    return Math.floor(Number(amount) / 1000) * EARN_RATE;
}

function calculateTier(totalPoints) {
    const p = Number(totalPoints) || 0;
    if (p >= 5000) return 'DIAMOND';
    if (p >= 2000) return 'GOLD';
    if (p >= 500)  return 'SILVER';
    return 'BRONZE';
}

/* ── Ensure loyalty columns exist (soft migration) ── */
async function ensureColumns(db) {
    try {
        await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS loyalty_points INT DEFAULT 0`);
        await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS loyalty_tier ENUM('BRONZE','SILVER','GOLD','DIAMOND') DEFAULT 'BRONZE'`);
    } catch (e) { /* MySQL 5.x doesn't support IF NOT EXISTS - silently ignore */ }

    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS loyalty_transactions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                booking_id INT,
                type ENUM('EARN','REDEEM','BONUS','EXPIRE') NOT NULL,
                points INT NOT NULL,
                balance_after INT NOT NULL,
                description VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
    } catch (e) { /* table may already exist */ }
}

/* ── Award points after successful payment ── */
async function awardPoints(db, userId, bookingId, amount) {
    try {
        await ensureColumns(db);
        const earned = calculateEarnedPoints(amount);
        if (earned <= 0) return 0;

        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            // Get current points (handle missing column gracefully)
            let currentPts = 0;
            try {
                const [[u]] = await conn.query('SELECT loyalty_points FROM users WHERE user_id=?', [userId]);
                currentPts = Number(u?.loyalty_points) || 0;
            } catch (e) { currentPts = 0; }

            const newPts  = currentPts + earned;
            const newTier = calculateTier(newPts);

            await conn.query(
                'UPDATE users SET loyalty_points=?, loyalty_tier=? WHERE user_id=?',
                [newPts, newTier, userId]
            );

            try {
                await conn.query(
                    `INSERT INTO loyalty_transactions (user_id, booking_id, type, points, balance_after, description)
                     VALUES (?, ?, 'EARN', ?, ?, ?)`,
                    [userId, bookingId || null, earned, newPts, `Đặt vé #${bookingId} — +${earned} điểm`]
                );
            } catch (e) { /* transaction table may not exist yet */ }

            await conn.commit();
            return earned;
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }
    } catch (e) {
        console.error('[LoyaltyService] awardPoints error (non-critical):', e.message);
        return 0;
    }
}

/* ── Redeem points for discount ── */
async function redeemPoints(db, userId, pointsToRedeem) {
    await ensureColumns(db);
    const pts = Math.floor(Number(pointsToRedeem));
    if (pts <= 0) throw new Error('Số điểm không hợp lệ');

    const [[u]] = await db.query(
        'SELECT loyalty_points, loyalty_tier FROM users WHERE user_id=?', [userId]
    );
    if (!u) throw new Error('Không tìm thấy user');

    const current = Number(u.loyalty_points) || 0;
    if (current < pts) throw new Error(`Không đủ điểm (có ${current}, cần ${pts})`);

    const discountAmount = Math.floor(pts / REDEEM_RATE) * 10000;
    const newPts  = current - pts;
    const newTier = calculateTier(newPts);

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        await conn.query(
            'UPDATE users SET loyalty_points=?, loyalty_tier=? WHERE user_id=?',
            [newPts, newTier, userId]
        );
        try {
            await conn.query(
                `INSERT INTO loyalty_transactions (user_id, type, points, balance_after, description)
                 VALUES (?, 'REDEEM', ?, ?, ?)`,
                [userId, -pts, newPts, `Đổi ${pts} điểm → giảm ${discountAmount.toLocaleString('vi-VN')} VNĐ`]
            );
        } catch (e) { /* non-critical */ }
        await conn.commit();
        return { discountAmount, newPoints: newPts, newTier };
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

/* ── Get user loyalty info ── */
async function getUserLoyalty(db, userId) {
    await ensureColumns(db);

    let points = 0, tier = 'BRONZE';
    try {
        const [[u]] = await db.query(
            'SELECT loyalty_points, loyalty_tier FROM users WHERE user_id=?', [userId]
        );
        points = Number(u?.loyalty_points) || 0;
        tier   = u?.loyalty_tier || calculateTier(points);
    } catch (e) { /* column may not exist yet */ }

    const meta    = TIER_META[tier] || TIER_META.BRONZE;
    const nextAt  = meta.nextAt;
    const progress = nextAt ? Math.min(100, Math.round((points / nextAt) * 100)) : 100;

    let transactions = [];
    try {
        const [tx] = await db.query(
            `SELECT type, points, balance_after, description, created_at
             FROM loyalty_transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 10`,
            [userId]
        );
        transactions = tx;
    } catch (e) { /* table may not exist */ }

    return {
        points,
        tier,
        tierLabel:      meta.label,
        tierColor:      meta.color,
        tierDiscount:   meta.discount,
        nextTier:       meta.next,
        nextTierAt:     nextAt,
        progress,
        redeemRate:     REDEEM_RATE,
        earnRate:       EARN_RATE,
        transactions
    };
}

module.exports = { calculateEarnedPoints, calculateTier, TIER_META, awardPoints, redeemPoints, getUserLoyalty };
