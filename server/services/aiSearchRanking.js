'use strict';
const { classifyVehicleType, timeBucket } = require('./aiUserProfilingService');

/* ═══════════════════════════════════════════════════════════
   aiSearchRanking.js — Sprint 11: personalized search Match Score.

     S_match = w_price·Score_price + w_time·Score_time
             + w_vehicle·Score_vehicle + w_rating·Score_rating   (∈ [0,1])

   Weights: price 0.30, time 0.30, vehicle 0.25, rating 0.15 (sum = 1).
   Price and time-of-day are weighted highest because they come directly
   from what the user has actually paid for and actually traveled at —
   the strongest behavioral signal available; rating is weighted lowest
   because it reflects general trip quality, not personal preference.

   Each Score_X is in [0,1] on its own:
     Score_price   — 1.0 if the trip's price falls inside the user's
                     observed [min,max] range; otherwise decays linearly
                     with distance from that range relative to their avg
                     price (so a trip 2x their average price scores near 0).
     Score_time    — the user's own normalized weight for this trip's
                     departure-hour bucket (already ∈ [0,1] from the
                     profiling service — "what fraction of your past
                     trips left at this time of day").
     Score_vehicle — same idea for the trip's bus-type bucket.
     Score_rating  — trip.avg_rating / 5, clamped to [0,1].

   ai_match_score = round(S_match × 100). Only computed when the caller
   has a real profile with has_data:true — an anonymous/no-history
   search is left completely alone (no fields added), so this never
   changes behavior for the vast majority of unauthenticated searches.
═══════════════════════════════════════════════════════════ */

const WEIGHTS = { price: 0.30, time: 0.30, vehicle: 0.25, rating: 0.15 };

function scorePrice(tripPrice, price) {
    if (!price || !Number.isFinite(tripPrice)) return null;
    if (tripPrice >= price.min && tripPrice <= price.max) return 1;
    const distance = tripPrice < price.min ? price.min - tripPrice : tripPrice - price.max;
    const scale = price.avg > 0 ? price.avg : 1;
    return Math.max(0, 1 - distance / scale);
}

function scoreTime(departureTime, time_weights) {
    if (!time_weights) return null;
    const hour = new Date(departureTime).getHours();
    const bucket = timeBucket(hour);
    return time_weights[bucket] != null ? time_weights[bucket] : 0;
}

function scoreVehicle(busType, vehicle_pref) {
    if (!vehicle_pref) return null;
    const bucket = classifyVehicleType(busType);
    return vehicle_pref[bucket] != null ? vehicle_pref[bucket] : 0;
}

function scoreRating(avgRating) {
    const r = Number(avgRating);
    if (!Number.isFinite(r) || r <= 0) return null;
    return Math.max(0, Math.min(1, r / 5));
}

const TIME_LABEL = { morning: 'sáng sớm', afternoon: 'buổi chiều', evening: 'buổi tối', night: 'đêm khuya' };
const TIME_RANGE_LABEL = { morning: '05:00–11:00', afternoon: '11:00–17:00', evening: '17:00–22:00', night: '22:00–05:00' };
const VEHICLE_LABEL = { GIUONG_NAM: 'Giường nằm', LIMOUSINE: 'Limousine', GHE_NGOI: 'Ghế ngồi' };

function buildReason(components, profile) {
    // Pick the strongest 1-2 contributing factors (score >= 0.5) for a
    // short, human-readable, specifically-truthful explanation — never a
    // generic "AI recommends this" placeholder.
    const strong = Object.entries(components)
        .filter(([, s]) => s != null && s >= 0.5)
        .sort((a, b) => b[1] - a[1]);

    if (strong.length === 0) return { reason: null, detail: null };

    const parts = [];
    if (components._timeBucket && components.time >= 0.5) {
        parts.push({ kind: 'time', label: `chuyến ${TIME_LABEL[components._timeBucket]}`, count: profile.time_counts ? profile.time_counts[components._timeBucket] : null, range: TIME_RANGE_LABEL[components._timeBucket] });
    }
    if (components._vehicleBucket && components.vehicle >= 0.5) {
        parts.push({ kind: 'vehicle', label: `xe ${VEHICLE_LABEL[components._vehicleBucket]}`, count: profile.vehicle_counts ? profile.vehicle_counts[components._vehicleBucket] : null });
    }
    if (components.price >= 0.5 && parts.length < 2) {
        parts.push({ kind: 'price', label: 'mức giá bạn thường chọn', count: null });
    }
    if (components.rating >= 0.5 && parts.length < 2) {
        parts.push({ kind: 'rating', label: 'đánh giá cao từ hành khách khác', count: null });
    }

    if (parts.length === 0) return { reason: null, detail: null };

    const reason = 'Phù hợp với ' + parts.map(p => p.label).join(' & ') + ' của bạn';

    const detailClauses = parts
        .filter(p => p.count != null && p.count > 0)
        .map(p => p.kind === 'time'
            ? `${p.count} lần bạn đi khung giờ ${p.range}`
            : p.kind === 'vehicle'
                ? `${p.count} lần bạn chọn ${p.label}`
                : null)
        .filter(Boolean);
    const detail = detailClauses.length > 0 ? `Dựa trên ${detailClauses.join(', ')} trong ${30} ngày qua` : null;

    return { reason, detail };
}

/**
 * Scores one trip row (shape matches tripController.js's baseSelect
 * output: base_price, departure_time, bus_type, avg_rating) against a
 * user profile from aiUserProfilingService.getUserProfile(). Returns
 * null when the profile has no usable data — callers should leave the
 * trip unmodified in that case, not attach a meaningless 0% badge.
 */
function scoreTrip(trip, profile) {
    if (!profile || !profile.has_data) return null;

    const priceScore = scorePrice(Number(trip.base_price), profile.price);
    const timeScoreRaw = scoreTime(trip.departure_time, profile.time_weights);
    const vehicleScoreRaw = scoreVehicle(trip.bus_type, profile.vehicle_pref);
    const ratingScore = scoreRating(trip.avg_rating);

    const parts = [];
    let weightSum = 0, weighted = 0;
    const contribs = { price: priceScore, time: timeScoreRaw, vehicle: vehicleScoreRaw, rating: ratingScore };
    for (const [key, score] of Object.entries(contribs)) {
        if (score == null) continue;
        weighted += WEIGHTS[key] * score;
        weightSum += WEIGHTS[key];
    }
    if (weightSum === 0) return null; // no signal at all for this trip

    const S_match = weighted / weightSum; // re-normalize over the signals actually available
    const ai_match_score = Math.max(0, Math.min(100, Math.round(S_match * 100)));

    const components = {
        price: priceScore, time: timeScoreRaw, vehicle: vehicleScoreRaw, rating: ratingScore,
        _timeBucket: trip.departure_time ? timeBucket(new Date(trip.departure_time).getHours()) : null,
        _vehicleBucket: trip.bus_type ? classifyVehicleType(trip.bus_type) : null,
    };
    const { reason, detail } = buildReason(components, profile);

    return { ai_match_score, ai_match_reason: reason, ai_match_detail: detail };
}

/** Ranks trips by ai_match_score (desc); trips with no score keep their
 *  relative order at the end. Attaches the score fields only to trips
 *  that got one — a trip with insufficient signal is returned unchanged. */
function rankTrips(trips, profile) {
    if (!profile || !profile.has_data) return trips;

    const scored = trips.map(trip => {
        const result = scoreTrip(trip, profile);
        return result ? { ...trip, ...result } : trip;
    });

    const withScore = scored.filter(t => t.ai_match_score != null);
    const withoutScore = scored.filter(t => t.ai_match_score == null);
    withScore.sort((a, b) => b.ai_match_score - a.ai_match_score);
    return [...withScore, ...withoutScore];
}

module.exports = { scoreTrip, rankTrips, WEIGHTS };
