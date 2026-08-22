'use strict';

/* ═══════════════════════════════════════════════════════════════
   SmartBusAI — AI Automated Booking Concierge
   Sprint 4.

   Rule-based Vietnamese NLU (regex/keyword matching against real data —
   see the file-level rule at the bottom of this header). This is NOT a
   trained/statistical NLP model, consistent with how every other "AI"
   feature in this codebase is honestly labeled (server/ai/recommendation.js).

   Extracts: origin, destination, travel_date, bus_type, time_window,
   seat_count from a single free-text Vietnamese message, then — if origin
   and destination were both found — calls tripController's real
   _runTripSearch(db, params) (the exact same SQL engine backing
   GET /api/trips/search, Sprint 2) to fetch real trips from the database.
   Never fabricates a trip result and never maintains an independent mock
   trip list — every trip this module can return is a row the real search
   engine actually produced.

   City recognition is grounded in the real `route` table (DISTINCT
   origin/destination values, cached briefly) rather than a hardcoded
   guess-list, so the concierge can only ever "recognize" a city that
   genuinely has routes in this database.
═══════════════════════════════════════════════════════════════ */

const { pad } = require('../utils/dateTime');
const { normCity } = require('./transitRouter');

/* ── City recognition — grounded in real route data, not a fixed list ── */
let _cityCache = null;
let _cityCacheAt = 0;
const CITY_CACHE_TTL_MS = 5 * 60 * 1000;

async function getKnownCities(db) {
    const now = Date.now();
    if (_cityCache && (now - _cityCacheAt) < CITY_CACHE_TTL_MS) return _cityCache;
    const [rows] = await db.query(
        `SELECT DISTINCT origin AS city FROM route
         UNION
         SELECT DISTINCT destination AS city FROM route`
    );
    const cities = rows.map(r => r.city).filter(Boolean);
    // Longest-first so "Hồ Chí Minh" is matched whole before any shorter
    // accidental substring elsewhere in the known-city list could win.
    cities.sort((a, b) => b.length - a.length);
    _cityCache = cities;
    _cityCacheAt = now;
    return cities;
}

/** Test-only hook to reset the memoized city cache between test cases. */
function _resetCityCache() { _cityCache = null; _cityCacheAt = 0; }

// Matches against city names with their administrative prefix ("TP. ",
// "Tỉnh ", "Thành phố ") stripped via the same normCity() already used by
// transitRouter.js's real-route matching — the `route` table stores
// destinations like "TP. Hồ Chí Minh", but users naturally type just
// "Hồ Chí Minh", so an exact-substring match against the raw DB value
// would never fire. All position/overlap math happens in the normalized
// text's coordinate space; only the canonical (DB-stored) city string is
// returned, since it's what downstream LIKE-based search params need.
function findCityMentions(text, cities) {
    const lower = normCity(text);
    const found = [];
    for (const city of cities) {
        const nc = normCity(city);
        if (!nc) continue;
        const idx = lower.indexOf(nc);
        if (idx !== -1) found.push({ city, index: idx, end: idx + nc.length });
    }
    found.sort((a, b) => a.index - b.index);
    const result = [];
    const usedRanges = [];
    for (const f of found) {
        const overlaps = usedRanges.some(r => f.index < r.end && f.end > r.start);
        if (!overlaps) { result.push(f.city); usedRanges.push({ start: f.index, end: f.end }); }
    }
    return result;
}

/** Positional heuristic: first city mentioned = origin, second = destination.
 *  Covers the overwhelmingly common phrasings ("từ X đến Y", "X đi Y",
 *  "X - Y", "X → Y"). Does not attempt to parse reversed phrasings like
 *  "đi Y từ X" — a known, documented limitation of a rule-based extractor. */
function extractRoute(text, cities) {
    const mentions = findCityMentions(text, cities);
    return { origin: mentions[0] || null, destination: mentions[1] || null };
}

/* ── Travel date — relative Vietnamese date phrases, Asia/Ho_Chi_Minh local ── */
function fmtDate(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function extractTravelDate(text, now = new Date()) {
    const lower = text.toLowerCase();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (/\bhôm nay\b/.test(lower)) return fmtDate(startOfDay);

    if (/\bngày mốt\b/.test(lower) || /\bmốt\b/.test(lower)) {
        const d = new Date(startOfDay); d.setDate(d.getDate() + 2); return fmtDate(d);
    }
    if (/\bngày mai\b/.test(lower) || /\bmai\b/.test(lower)) {
        const d = new Date(startOfDay); d.setDate(d.getDate() + 1); return fmtDate(d);
    }
    if (/\bcuối tuần\b/.test(lower)) {
        const dow = startOfDay.getDay(); // 0=Sun..6=Sat
        const d = new Date(startOfDay);
        if (dow !== 6 && dow !== 0) d.setDate(d.getDate() + (6 - dow)); // next Saturday
        return fmtDate(d);
    }
    // Explicit dd/mm or dd-mm (rolls into next year if the date already passed this year)
    const dm = lower.match(/\b(\d{1,2})[\/\-](\d{1,2})\b/);
    if (dm) {
        const day = parseInt(dm[1], 10), month = parseInt(dm[2], 10);
        if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
            let d = new Date(startOfDay.getFullYear(), month - 1, day);
            if (d < startOfDay) d = new Date(startOfDay.getFullYear() + 1, month - 1, day);
            return fmtDate(d);
        }
    }
    return null;
}

/* ── Bus type — keyword-matched to the same VIP/LIMOUSINE/NORMAL
   categorization already fixed in tripController.searchTrips (Sprint 2) ── */
function extractBusType(text) {
    const lower = text.toLowerCase();
    if (/\blimousine\b/.test(lower)) return 'LIMOUSINE';
    if (/\bvip\b/.test(lower)) return 'VIP';
    if (/giường nằm|\bsleeper\b|xe nằm/.test(lower)) return 'NORMAL';
    if (/ghế ngồi|\bseater\b|xe ghế|\bthường\b/.test(lower)) return 'NORMAL';
    return null;
}

/* ── Time window — vague (sáng/chiều/tối/đêm) or an explicit hour ── */
function extractTimeWindow(text) {
    const lower = text.toLowerCase();

    const hourMatch = lower.match(/(\d{1,2})\s*(?:h|giờ)\b/);
    if (hourMatch) {
        let hour = parseInt(hourMatch[1], 10);
        if (hour >= 0 && hour <= 23) {
            const context = lower.slice(Math.max(0, hourMatch.index - 12), hourMatch.index + 18);
            if (/tối|đêm/.test(context) && hour < 12) hour += 12;
            else if (/chiều/.test(context) && hour < 12) hour += 12;
            else if (/sáng/.test(context) && hour === 12) hour = 0;
            return { type: 'exact', hour, label: `khoảng ${String(hour).padStart(2, '0')}:00` };
        }
    }
    if (/\bsáng\b/.test(lower)) return { type: 'range', range: [6, 12], label: 'buổi sáng (06:00-12:00)' };
    if (/\btrưa\b/.test(lower)) return { type: 'range', range: [11, 13], label: 'buổi trưa (11:00-13:00)' };
    if (/\bchiều\b/.test(lower)) return { type: 'range', range: [12, 18], label: 'buổi chiều (12:00-18:00)' };
    if (/\btối\b/.test(lower)) return { type: 'range', range: [18, 24], label: 'buổi tối (18:00-24:00)' };
    if (/\bđêm\b|\bkhuya\b/.test(lower)) return { type: 'range', range: [0, 6], label: 'ban đêm (00:00-06:00)' };
    return null;
}

/* ── Seat count ── */
function extractSeatCount(text) {
    const lower = text.toLowerCase();
    const m = lower.match(/(\d{1,2})\s*(?:vé|ghế|chỗ|người|khách)/);
    if (m) {
        const n = parseInt(m[1], 10);
        if (n > 0 && n <= 20) return n;
    }
    return null;
}

/** Extracts every recognized field from one free-text message. Pure/sync
 *  except city recognition, which needs the real route list from the DB. */
async function extractIntent(db, text, now = new Date()) {
    const cities = await getKnownCities(db);
    const { origin, destination } = extractRoute(text, cities);
    return {
        origin,
        destination,
        travel_date: extractTravelDate(text, now),
        bus_type: extractBusType(text),
        time_window: extractTimeWindow(text),
        seat_count: extractSeatCount(text),
    };
}

function buildClarifyingReply(intent) {
    const have = [];
    if (intent.origin) have.push(`điểm đi **${intent.origin}**`);
    if (intent.destination) have.push(`điểm đến **${intent.destination}**`);
    const haveText = have.length ? `Mình đã hiểu ${have.join(', ')}. ` : '';
    const missing = [];
    if (!intent.origin) missing.push('điểm đi');
    if (!intent.destination) missing.push('điểm đến');
    return `${haveText}Bạn cho mình biết thêm ${missing.join(' và ')} nhé? Ví dụ: "Tôi muốn đi từ Hà Nội đến Đà Nẵng ngày mai".`;
}

function buildResultsReply(intent, trips) {
    const parts = [`🚌 ${intent.origin} → ${intent.destination}`];
    if (intent.travel_date) parts.push(`ngày ${intent.travel_date}`);
    if (intent.time_window) parts.push(intent.time_window.label);
    if (intent.bus_type) parts.push(intent.bus_type);
    if (intent.seat_count) parts.push(`${intent.seat_count} vé`);
    const header = parts.join(' · ');

    if (!trips.length) {
        return `${header}\n\nMình không tìm thấy chuyến nào phù hợp với yêu cầu này. Bạn thử đổi ngày, giờ hoặc loại xe xem sao?`;
    }
    return `${header}\n\nMình tìm được ${trips.length} chuyến phù hợp — bạn xem danh sách bên dưới nhé!`;
}

/** Full pipeline: parse -> (if enough info) run the REAL search -> reply.
 *  `db` is required explicitly (never a module-level singleton) so this
 *  is directly unit-testable with a mocked connection, matching this
 *  codebase's established convention (see server/services/pricingEngine.js). */
async function handleMessage(db, text, now = new Date()) {
    const trimmed = (text || '').trim();
    if (!trimmed) {
        return { reply: 'Bạn muốn đi đâu? Ví dụ: "Tôi muốn đi từ Hà Nội đến Đà Nẵng tối mai tầm 8h, vé Limousine".', intent: null, trips: [], needsInfo: ['origin', 'destination'] };
    }

    const intent = await extractIntent(db, trimmed, now);

    if (!intent.origin || !intent.destination) {
        const needsInfo = [];
        if (!intent.origin) needsInfo.push('origin');
        if (!intent.destination) needsInfo.push('destination');
        return { reply: buildClarifyingReply(intent), intent, trips: [], needsInfo };
    }

    // Sprint 4 requirement: reuse the REAL search engine (Sprint 2's
    // tripController._runTripSearch), never an independent mock search.
    const { _runTripSearch } = require('../controllers/tripController');
    const result = await _runTripSearch(db, {
        origin: intent.origin,
        destination: intent.destination,
        date: intent.travel_date || undefined,
        busType: intent.bus_type || undefined,
        sort: 'asc',
    });

    if (result.error) {
        return { reply: `Xin lỗi, mình gặp lỗi khi tìm chuyến: ${result.error.message}`, intent, trips: [], needsInfo: [] };
    }

    let trips = result.rows;
    if (intent.time_window) {
        const tw = intent.time_window;
        trips = trips.filter(t => {
            const h = new Date(t.departure_time).getHours();
            return tw.type === 'exact' ? Math.abs(h - tw.hour) <= 2 : (h >= tw.range[0] && h < tw.range[1]);
        });
    }
    if (intent.seat_count) {
        trips = trips.filter(t => Number(t.available_seats) >= intent.seat_count);
    }
    trips = trips.slice(0, 5);

    return { reply: buildResultsReply(intent, trips), intent, trips, needsInfo: [] };
}

module.exports = {
    handleMessage, extractIntent,
    // exported for direct unit testing of each extraction rule
    extractRoute, extractTravelDate, extractBusType, extractTimeWindow, extractSeatCount,
    findCityMentions, getKnownCities, _resetCityCache,
};
