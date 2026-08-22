'use strict';
const db = require('../config/db');

/* ═══════════════════════════════════════════════════════════
   aiIntentPredictor.js — Sprint 11: Booking Intent Score.

   Real formula, not a black box:
     S_raw = w1·min(searchCount,4) + w2·min(tripViewCount,5)
           + w3·(seatSelected?1:0) + w4·(checkoutReached?1:0)
           - w5·min(idleMinutes,15)
     S_intent = clamp(S_raw, 0, 100)

   Weights (documented so the "why" is inspectable, not tuned to hit a
   demo number): w1=5, w2=6, w3=25, w4=35, w5=2. Saturating each count
   term at a cap keeps one runaway signal (e.g. 40 rapid searches) from
   dominating the score — matches how a human would read "a few extra
   searches" vs. "browsing forever" as different signals, not linear
   ones.

   intent_level: HIGH >= 70, MEDIUM 40-69, LOW < 40.
   dropoff_risk: derived from idle time relative to how far the session
   got — someone idle at checkout is a much stronger abandonment signal
   than someone idle after one search.
═══════════════════════════════════════════════════════════ */

const WEIGHTS = { search: 5, view: 6, seat: 25, checkout: 35, idlePenalty: 2 };
const CAPS = { search: 4, view: 5, idleMinutes: 15 };

const EVENT_TYPES = new Set(['SEARCH', 'VIEW_TRIP', 'SELECT_SEAT', 'START_PAYMENT', 'COMPLETE_BOOKING', 'CANCEL']);

function summarizeEvents(sessionEvents) {
    const events = Array.isArray(sessionEvents) ? sessionEvents : [];
    let searchCount = 0, tripViewCount = 0, seatSelected = false, checkoutReached = false;
    let lastTimestamp = null;

    for (const ev of events) {
        if (!ev || typeof ev !== 'object') continue;
        const type = String(ev.type || '').toUpperCase();
        if (type === 'SEARCH') searchCount++;
        else if (type === 'VIEW_TRIP') tripViewCount++;
        else if (type === 'SELECT_SEAT') seatSelected = true;
        else if (type === 'START_PAYMENT') checkoutReached = true;

        const ts = ev.timestamp ? new Date(ev.timestamp).getTime() : NaN;
        if (Number.isFinite(ts) && (lastTimestamp === null || ts > lastTimestamp)) lastTimestamp = ts;
    }

    const idleMinutes = lastTimestamp !== null
        ? Math.max(0, (Date.now() - lastTimestamp) / 60000)
        : 0;

    return { searchCount, tripViewCount, seatSelected, checkoutReached, idleMinutes, eventCount: events.length };
}

function scoreFromSummary({ searchCount, tripViewCount, seatSelected, checkoutReached, idleMinutes }) {
    const raw =
        WEIGHTS.search * Math.min(searchCount, CAPS.search) +
        WEIGHTS.view * Math.min(tripViewCount, CAPS.view) +
        WEIGHTS.seat * (seatSelected ? 1 : 0) +
        WEIGHTS.checkout * (checkoutReached ? 1 : 0) -
        WEIGHTS.idlePenalty * Math.min(idleMinutes, CAPS.idleMinutes);

    return Math.max(0, Math.min(100, Math.round(raw * 10) / 10));
}

function levelFromScore(score) {
    if (score >= 70) return 'HIGH';
    if (score >= 40) return 'MEDIUM';
    return 'LOW';
}

function dropoffRiskFrom({ checkoutReached, seatSelected, idleMinutes }) {
    if (checkoutReached && idleMinutes >= 3) return 'HIGH';   // idle at the payment step — the classic abandoned-cart signal
    if (seatSelected && idleMinutes >= 8) return 'HIGH';
    if (idleMinutes >= 10) return 'MEDIUM';
    if (checkoutReached || seatSelected) return 'LOW';
    return idleMinutes >= 5 ? 'MEDIUM' : 'LOW';
}

function actionFrom(level, dropoffRisk, checkoutReached) {
    if (level === 'HIGH' && dropoffRisk !== 'LOW') return 'SHOW_PROMO_OR_HOLD_SEAT';
    if (level === 'HIGH' && checkoutReached) return 'HOLD_SEAT';
    if (level === 'MEDIUM' && dropoffRisk === 'HIGH') return 'SEND_REMINDER';
    if (level === 'LOW' && dropoffRisk !== 'LOW') return 'SEND_REMINDER';
    return 'NO_ACTION';
}

/**
 * Pure computation — no DB access. `logIntent()` below handles the
 * optional persistence step so callers that just want the score (e.g. the
 * personalized search ranking) don't pay for a write they don't need.
 */
function predictIntent({ session_events } = {}) {
    const summary = summarizeEvents(session_events);
    const intent_score = scoreFromSummary(summary);
    const intent_level = levelFromScore(intent_score);
    const dropoff_risk = dropoffRiskFrom(summary);
    const recommended_action = actionFrom(intent_level, dropoff_risk, summary.checkoutReached);

    return {
        intent_score,
        intent_level,
        dropoff_risk,
        recommended_action,
        event_count: summary.eventCount,
    };
}

/** Best-effort persistence for the admin "real-time AI intent log". */
async function logIntent({ user_id, session_id, result }) {
    try {
        await db.query(
            `INSERT INTO ai_intent_log (user_id, session_id, intent_score, intent_level, dropoff_risk, recommended_action, event_count)
             VALUES (?,?,?,?,?,?,?)`,
            [user_id || null, session_id || null, result.intent_score, result.intent_level, result.dropoff_risk, result.recommended_action, result.event_count]
        );
    } catch (e) { /* logging must never break the prediction response */ }
}

module.exports = { predictIntent, logIntent, EVENT_TYPES, WEIGHTS };
