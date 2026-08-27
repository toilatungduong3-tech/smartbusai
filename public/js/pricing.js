'use strict';
/* ══════════════════════════════════════════════════════════════════
   SmartBusAI — shared client-side pricing helper.

   Mirrors server/services/loyaltyService.js's applyUserTierDiscount()
   EXACTLY (same tier table, same formula, same single rounding point) so
   a price rendered anywhere on the frontend (passenger/index.html's trip
   list, AI Reco cards, Golden Deal widget, passenger/booking.html) can
   never drift from what bookingController.createBooking actually charges
   for the same trip/tier/system-fee combination. The server is still the
   sole authority for the real charge (computed from the caller's verified
   JWT, never a client-supplied value) — this is purely for display,
   without a round trip per price shown.

     Giá hiển thị = Giá gốc * (1 - %Giảm Hạng) * (1 + %Phí hệ thống)

   Plain global-scope script (no bundler in this project) — include via
   <script src="/js/pricing.js"> and call window.applyUserTierDiscount(...).
═══════════════════════════════════════════════════════════════════ */

const TIER_DISCOUNT_PCT = { BRONZE: 0, SILVER: 5, GOLD: 10, DIAMOND: 15 };
const TIER_LABEL = { BRONZE: '🥉 Đồng', SILVER: '🥈 Bạc', GOLD: '🥇 Vàng', DIAMOND: '💎 Kim cương' };

/**
 * @param {number} basePrice
 * @param {string} userTier BRONZE|SILVER|GOLD|DIAMOND
 * @param {number} [systemFeePct=0]
 * @returns {{originalPrice:number, discountPct:number, feePct:number, finalPrice:number, tierLabel:string}}
 */
function applyUserTierDiscount(basePrice, userTier, systemFeePct) {
  const price = Number(basePrice) || 0;
  const discountPct = TIER_DISCOUNT_PCT[userTier] || 0;
  const feePct = Number(systemFeePct) || 0;
  const finalPrice = Math.round(price * (1 - discountPct / 100) * (1 + feePct / 100));
  return { originalPrice: price, discountPct, feePct, finalPrice, tierLabel: TIER_LABEL[userTier] || TIER_LABEL.BRONZE };
}
