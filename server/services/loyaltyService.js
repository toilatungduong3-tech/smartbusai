'use strict';
const logger = require('../utils/logger');

/* ═══════════════════════════════════════════════════════════
   SmartBusAI — Loyalty Points Service
   1,000 VND spent = 1 point
   Tiers: Bronze/Silver/Gold/Diamond
═══════════════════════════════════════════════════════════ */

const { AppError } = require('../utils/errors');
const crypto = require('crypto');

/* Sprint 24 — the reward catalog previously lived only in profile.html's
   REWARDS array; a voucher was a JSON blob generated and verified entirely
   client-side (localStorage['smartbus_vouchers']), redeemable on one
   browser only. free_seats:0 for VIPUP matches its pre-existing behavior —
   booking.html's own _getVoucherFreeCount() never matched "VIPUP" against
   its /FREE(\d+)/ regex either, so this doesn't change what that reward
   actually did, only where its state now lives. */
const REWARD_CATALOG = {
    FREE1: { pts: 50,  name: '1 vé miễn phí', free_seats: 1 },
    FREE2: { pts: 95,  name: '2 vé miễn phí', free_seats: 2 },
    FREE3: { pts: 150, name: '3 vé miễn phí', free_seats: 3 },
    VIPUP: { pts: 200, name: 'Vé hạng VIP',   free_seats: 0 },
};

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

/* ── Tier discount pricing (real, applied both for display and at
   booking-creation time — see bookingController.createBooking, which
   calls this with the AUTHENTICATED caller's own verified tier, never a
   client-supplied one) ── */
function calculateDiscountedPrice(originalPrice, userTier) {
    const price = Number(originalPrice) || 0;
    const meta = TIER_META[userTier] || TIER_META.BRONZE;
    const discountPct = meta.discount || 0;
    const discounted = Math.round(price * (1 - discountPct / 100));
    return { originalPrice: price, discountPct, discountedPrice: discounted, tierLabel: meta.label };
}

/* Canonical price-display/charge formula, used identically by
   bookingController (the real charge) and mirrored in
   /public/js/pricing.js (frontend display on the trip list, AI Reco,
   Golden Deal, and booking.html) — a price shown anywhere in the app can
   never drift from what actually gets charged for the same
   trip/tier/system-fee combination, because both sides run this exact
   one-line formula instead of each independently composing fee+discount
   in their own order with their own intermediate rounding.
     Giá hiển thị = Giá gốc * (1 - %Giảm Hạng) * (1 + %Phí hệ thống) */
function applyUserTierDiscount(basePrice, userTier, systemFeePct) {
    const price = Number(basePrice) || 0;
    const meta = TIER_META[userTier] || TIER_META.BRONZE;
    const discountPct = meta.discount || 0;
    const feePct = Number(systemFeePct) || 0;
    const finalPrice = Math.round(price * (1 - discountPct / 100) * (1 + feePct / 100));
    return { originalPrice: price, discountPct, feePct, finalPrice, tierLabel: meta.label };
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

            // Get current points (handle missing column gracefully).
            // Phase 2I: FOR UPDATE locks the row for the duration of this
            // transaction — without it, two awardPoints calls for the same
            // user racing concurrently (e.g. two bookings paid at once)
            // could both read the same stale balance and the second UPDATE
            // would silently overwrite the first instead of adding to it.
            let currentPts = 0;
            try {
                const [[u]] = await conn.query('SELECT loyalty_points FROM users WHERE user_id=? FOR UPDATE', [userId]);
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
        logger.error('[LoyaltyService] awardPoints error (non-critical):', e.message);
        return 0;
    }
}

/* ── Redeem points for discount ── */
async function redeemPoints(db, userId, pointsToRedeem) {
    await ensureColumns(db);
    const pts = Math.floor(Number(pointsToRedeem));
    /* Phase 2I Step 3: `pts <= 0` alone does not catch NaN (all comparisons
       against NaN are false in JS) — a non-numeric points value slipped
       through to the query, which then leaked a raw MySQL error message
       ("Unknown column 'NaN' in 'field list'") straight to the API client. */
    if (!Number.isFinite(pts) || pts <= 0) throw new AppError(422, 'Số điểm không hợp lệ');

    const discountAmount = Math.floor(pts / REDEEM_RATE) * 10000;

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        /* Phase 2I: balance was previously read outside the transaction
           with no row lock, then trusted for the UPDATE — two concurrent
           redeem requests (double-click) could both read the same balance,
           both pass the "enough points" check, and both deduct, letting a
           user redeem the same points twice / go negative. SELECT ... FOR
           UPDATE serializes concurrent redemptions for the same user. */
        const [[u]] = await conn.query(
            'SELECT loyalty_points FROM users WHERE user_id=? FOR UPDATE', [userId]
        );
        if (!u) throw new AppError(404, 'Không tìm thấy user');
        const current = Number(u.loyalty_points) || 0;
        if (current < pts) throw new AppError(409, `Không đủ điểm (có ${current}, cần ${pts})`);
        const newPts  = current - pts;
        const newTier = calculateTier(newPts);

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

/* ── Redeem points for a real, persisted voucher (Sprint 24) ──
   Same FOR UPDATE locking discipline as redeemPoints() above — a user
   already holding one unused voucher is blocked from redeeming another
   (mirrors the "one active voucher at a time" rule profile.html enforced
   client-side, now enforced server-side too so it can't be bypassed by
   clearing localStorage). */
async function redeemForVoucher(db, userId, rewardCode) {
    await ensureColumns(db);
    const reward = REWARD_CATALOG[rewardCode];
    if (!reward) throw new AppError(422, 'Phần thưởng không hợp lệ');

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const [[u]] = await conn.query(
            'SELECT loyalty_points FROM users WHERE user_id=? FOR UPDATE', [userId]
        );
        if (!u) throw new AppError(404, 'Không tìm thấy user');

        const [[active]] = await conn.query(
            'SELECT voucher_id FROM voucher WHERE user_id=? AND is_used=0 LIMIT 1 FOR UPDATE', [userId]
        );
        if (active) throw new AppError(409, 'Bạn đang có voucher chưa sử dụng — hãy dùng voucher hiện tại trước khi đổi mới');

        const current = Number(u.loyalty_points) || 0;
        if (current < reward.pts) throw new AppError(409, `Không đủ điểm (có ${current}, cần ${reward.pts})`);
        const newPts  = current - reward.pts;
        const newTier = calculateTier(newPts);

        await conn.query(
            'UPDATE users SET loyalty_points=?, loyalty_tier=? WHERE user_id=?',
            [newPts, newTier, userId]
        );

        const code = `SMART-${rewardCode}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const [ins] = await conn.query(
            `INSERT INTO voucher (user_id, code, reward_code, reward_name, free_seats, points_spent)
             VALUES (?,?,?,?,?,?)`,
            [userId, code, rewardCode, reward.name, reward.free_seats, reward.pts]
        );

        try {
            await conn.query(
                `INSERT INTO loyalty_transactions (user_id, type, points, balance_after, description)
                 VALUES (?, 'REDEEM', ?, ?, ?)`,
                [userId, -reward.pts, newPts, `Đổi ${reward.pts} điểm → ${reward.name} (${code})`]
            );
        } catch (e) { /* non-critical */ }

        await conn.commit();
        return {
            voucher_id: ins.insertId, code, reward_name: reward.name,
            free_seats: reward.free_seats, points_spent: reward.pts,
            newPoints: newPts, newTier,
        };
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

/* ── List a user's vouchers (Sprint 24) — replaces reading localStorage['smartbus_vouchers'] ── */
async function getVouchers(db, userId) {
    const [rows] = await db.query(
        `SELECT voucher_id, code, reward_code, reward_name, free_seats, points_spent,
                is_used, booking_id, created_at, used_at
         FROM voucher WHERE user_id=? ORDER BY created_at DESC`,
        [userId]
    );
    return rows;
}

/* ── Mark a voucher used (Sprint 24) — called after a booking that applied
   it succeeds. Deliberately does NOT touch booking pricing/creation logic
   itself (bookingController.createBooking is untouched) — the frontend
   still computes the seat-price discount client-side exactly as before,
   this only persists that the voucher was consumed so it can't be reused
   from another device/session. Ownership-scoped: the WHERE clause only
   matches a row that belongs to userId, so this can never mark someone
   else's voucher used even if a client sent the wrong id. */
async function useVoucher(db, userId, code, bookingId) {
    const [result] = await db.query(
        `UPDATE voucher SET is_used=1, used_at=NOW(), booking_id=?
         WHERE user_id=? AND code=? AND is_used=0`,
        [bookingId || null, userId, code]
    );
    if (result.affectedRows === 0) throw new AppError(404, 'Voucher không tồn tại hoặc đã được sử dụng');
    return { message: 'Đã dùng voucher' };
}

module.exports = { calculateEarnedPoints, calculateTier, calculateDiscountedPrice, applyUserTierDiscount, TIER_META, awardPoints, redeemPoints, redeemForVoucher, getUserLoyalty, getVouchers, useVoucher, REWARD_CATALOG };
