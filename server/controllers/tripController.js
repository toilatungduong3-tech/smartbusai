const db = require("../config/db");
const { ownsOperator } = require("../middleware/operatorScope");
const { toDbDateTime, parseDbDateTime, isValidDate } = require("../utils/dateTime");
const { parsePagination, paginatedResponse } = require("../utils/pagination");
const aiUserProfilingService = require("../services/aiUserProfilingService");
const aiSearchRanking = require("../services/aiSearchRanking");
const cache = require("../services/cacheManager");
const { isConnectionError, sendDegraded } = require("../utils/dbErrors");
const logger = require('../utils/logger');

/* Sprint 12 — Cache-Aside invalidation. A trip status/price/full edit can
   change what the "hot trips" trending list (recommendationRoutes.js)
   and the public stats hero numbers (statsController.js) should show —
   both are invalidated together rather than trying to compute exactly
   which one a given write actually affects, since both are cheap to
   recompute on the next read and correctness matters more here than
   shaving one query. */
async function invalidateTripCaches() {
    await Promise.all([
        cache.invalidate("trips:trending"),
        cache.invalidate("stats:public-summary"),
    ]);
}

/* ===============================
   isValidTripDate — F-24/F-25 zero-date containment (Phase 2D)
   Rejects: SQL NULL, MySQL zero-date ('0000-00-00 00:00:00', which the
   mysql2 driver surfaces as JS null under this project's non-dateStrings
   config), and any other value that fails to parse into a real Date.
   Shared by autoGenerateRecurringTrips/checkAndAdvanceIfNeeded and
   updateTrip so both places fail closed on the same rule instead of
   duplicating ad-hoc date logic.

   Phase 1 hardening: delegates to the shared time-contract util
   (server/utils/dateTime.js) instead of a local, UTC-forcing ('+Z') parse
   — a naive "YYYY-MM-DD HH:mm:ss" string from this DB is Vietnam LOCAL
   time (see dateTime.js header), not UTC.
=============================== */
function isValidTripDate(v) {
    return isValidDate(v);
}
exports._isValidTripDate = isValidTripDate; // exported for direct unit testing only

/* Dedup set: warn once per trip_id per process lifetime instead of every
   60s poll cycle for the same already-known-bad row. Reset on restart. */
const warnedInvalidTripIds = new Set();

/* ===============================
   BASE SELECT (ĐẾM GHẾ CHUẨN)
=============================== */
const baseSelect = `
    SELECT
        t.trip_id,
        r.route_id,
        r.origin,
        r.destination,
        r.distance_km,
        r.origin_lat,
        r.origin_lng,
        r.dest_lat,
        r.dest_lng,
        t.departure_time,
        t.arrival_time,
        t.base_price,
        t.status,
        b.bus_id,
        b.plate_number,
        b.bus_type,
        b.total_seats,
        o.operator_id,
        o.name AS operator_name,
        COUNT(DISTINCT bd.seat_id) AS booked_seats,
        (b.total_seats - COUNT(DISTINCT bd.seat_id)) AS available_seats,
        IFNULL(AVG(rv.rating), 0) AS avg_rating,
        COUNT(DISTINCT rv.review_id) AS review_count
    FROM trip t
    JOIN route r ON t.route_id = r.route_id
    JOIN bus b ON t.bus_id = b.bus_id
    JOIN bus_operator o ON b.operator_id = o.operator_id
    LEFT JOIN booking bk ON bk.trip_id = t.trip_id
                         AND bk.status IN ('PAID','PENDING','CONFIRMED')
    LEFT JOIN booking_detail bd ON bd.booking_id = bk.booking_id
    LEFT JOIN review rv ON rv.trip_id = t.trip_id
`;

/* ===============================
   LẤY TẤT CẢ CHUYẾN XE
=============================== */
exports.getTrips = async (req, res) => {
    try {
        const { bus_id, operator_id } = req.query;
        let sql = baseSelect;
        const params = [];
        /* Chuyến chưa khởi hành — dành cho hành khách đặt vé & danh sách operator */
        const wheres = ["t.departure_time > NOW()"];
        if (bus_id)      { wheres.push("t.bus_id = ?");      params.push(bus_id); }
        if (operator_id) { wheres.push("o.operator_id = ?"); params.push(operator_id); }
        const whereClause = " WHERE " + wheres.join(" AND ");
        sql += whereClause;
        sql += " GROUP BY t.trip_id ORDER BY t.departure_time ASC";

        /* Sprint 6 — opt-in pagination (see server/utils/pagination.js for
           why this isn't a blanket always-on default). Omitting ?page=/
           ?limit= returns the exact same raw array as before. */
        const paging = parsePagination(req.query);
        if (!paging) {
            const [result] = await db.query(sql, params);
            return res.json(result);
        }

        const [[{ total }]] = await db.query(
            `SELECT COUNT(*) AS total FROM trip t
             JOIN route r ON t.route_id = r.route_id
             JOIN bus b ON t.bus_id = b.bus_id
             JOIN bus_operator o ON b.operator_id = o.operator_id
             ${whereClause}`,
            params
        );
        const [result] = await db.query(sql + " LIMIT ? OFFSET ?", [...params, paging.limit, paging.offset]);
        res.json(paginatedResponse(result, total, paging));
    } catch (err) {
        logger.error("GET TRIPS ERROR:", err);
        res.status(500).json({ message: "Database error" });
    }
};

/* ===============================
   GET RUNNING TRIPS  — /api/trips/running
   Trả về TẤT CẢ chuyến đang diễn ra theo thời gian thực:
     departure_time <= NOW()  AND  arrival_time > NOW()
   Không lọc theo ngày. Hoạt động qua nửa đêm, qua ngày.
=============================== */
exports.getRunningTrips = async (req, res) => {
    try {
        const { operator_id } = req.query;
        let sql = baseSelect + `
            WHERE t.departure_time <= NOW()
              AND t.arrival_time   >  NOW()
              AND t.status        != 'CANCELED'`;
        const params = [];
        if (operator_id) {
            sql += " AND o.operator_id = ?";
            params.push(operator_id);
        }
        sql += " GROUP BY t.trip_id ORDER BY t.departure_time ASC";
        const [result] = await db.query(sql, params);
        res.json(result);
    } catch (err) {
        logger.error("GET RUNNING TRIPS ERROR:", err);
        res.status(500).json({ message: "Database error" });
    }
};

/* ===============================
   SEARCH TRIP — core query, shared with the AI Booking Concierge
   Sprint 4: extracted so server/ai/bookingConcierge.js calls the exact
   same SQL engine as this HTTP handler — never a duplicate/mock search
   implementation. Returns { rows } on success or { error: {status,
   message} } on a validation problem (never throws for that — only a
   genuine DB/infra failure should reach a catch block).
=============================== */
async function runTripSearch(db, { origin, destination, date, busType, sort, minPrice, maxPrice } = {}) {
        let sql = baseSelect + " WHERE t.departure_time > NOW()";
        const params = [];

        if (origin)      { sql += " AND r.origin LIKE ?";           params.push(`%${origin}%`); }
        if (destination) { sql += " AND r.destination LIKE ?";       params.push(`%${destination}%`); }
        if (date)        { sql += " AND DATE(t.departure_time) = ?"; params.push(date); }
        /* Phase 2 fix: bus.bus_type is a free-text VARCHAR(50), not the
           clean ENUM('NORMAL','VIP','LIMOUSINE') the UI's three filter
           chips assume — live data actually contains values like
           "VIP Limousine 16 chỗ", "Giường nằm 34 chỗ", "STANDARD",
           "EXPRESS", "SLEEPER". An exact `=` match against the chip's
           literal value ('VIP','NORMAL','LIMOUSINE') matched zero real
           buses for VIP/NORMAL and only the 10 buses literally named
           "LIMOUSINE" (missing the "VIP Limousine ..." buses) — the
           filter silently returned empty/incomplete results for real
           searches. Keyword-matched instead, mirroring the categorization
           already implied by the chip labels ("💎 VIP" / "👑 Limousine" /
           "🚌 Thường"). A bus can match both VIP and LIMOUSINE (e.g. "VIP
           Limousine 16 chỗ") — intentional, both labels genuinely apply. */
        if (busType === 'VIP') {
            sql += " AND UPPER(b.bus_type) LIKE ?"; params.push('%VIP%');
        } else if (busType === 'LIMOUSINE') {
            sql += " AND UPPER(b.bus_type) LIKE ?"; params.push('%LIMOUSINE%');
        } else if (busType === 'NORMAL') {
            sql += " AND UPPER(b.bus_type) NOT LIKE ? AND UPPER(b.bus_type) NOT LIKE ?";
            params.push('%VIP%', '%LIMOUSINE%');
        } else if (busType) {
            sql += " AND b.bus_type = ?"; params.push(busType);
        }

        /* Priority 3 — price-range filter, server-side (not a frontend-only hide).
           Phase 2 hardening: plain isNaN()/Number() coercion is too lenient —
           it silently accepted hex ("0x10"→16) and exponential ("1e2"→100)
           notation as valid prices, and Number("Infinity") passes isNaN/>=0
           but crashes mysql2's parameter serialization into a raw 500 when
           used as a query bound value. A strict "plain decimal digits,
           optional single decimal point" regex is checked first — this is a
           numeric API parameter (never a Vietnamese-formatted currency
           string; the frontend only ever sends literal JS number values). */
        const PRICE_RE = /^\d+(\.\d+)?$/;
        let min = null, max = null;
        if (minPrice !== undefined && minPrice !== null && minPrice !== "") {
            if (!PRICE_RE.test(String(minPrice).trim())) {
                return { error: { status: 422, message: "minPrice phải là số không âm" } };
            }
            min = Number(minPrice);
            if (!Number.isFinite(min) || min < 0) {
                return { error: { status: 422, message: "minPrice phải là số không âm" } };
            }
        }
        if (maxPrice !== undefined && maxPrice !== null && maxPrice !== "") {
            if (!PRICE_RE.test(String(maxPrice).trim())) {
                return { error: { status: 422, message: "maxPrice phải là số không âm" } };
            }
            max = Number(maxPrice);
            if (!Number.isFinite(max) || max < 0) {
                return { error: { status: 422, message: "maxPrice phải là số không âm" } };
            }
        }
        if (min !== null && max !== null && min > max) {
            return { error: { status: 422, message: "minPrice không được lớn hơn maxPrice" } };
        }
        if (min !== null) { sql += " AND t.base_price >= ?"; params.push(min); }
        if (max !== null) { sql += " AND t.base_price <= ?"; params.push(max); }

        sql += " GROUP BY t.trip_id";
        if (sort === "asc")       sql += " ORDER BY t.base_price ASC";
        else if (sort === "desc") sql += " ORDER BY t.base_price DESC";
        else                      sql += " ORDER BY t.departure_time ASC";

        const [rows] = await db.query(sql, params);
        return { rows };
}

exports.searchTrips = async (req, res) => {
    try {
        const result = await runTripSearch(db, req.query);
        if (result.error) return res.status(result.error.status).json({ message: result.error.message });

        let rows = result.rows;
        /* Sprint 11 — Personalized Search Ranking (S_match). Only applies
           when a real user_id is resolvable AND no explicit sort was
           requested (an explicit price sort is the user's own stated
           intent — the AI never overrides it). Anonymous searches and
           already-sorted searches are returned byte-for-byte as before:
           zero shape/order change, so this can never regress the plain
           search path. See aiSearchRanking.js for the scoring formula. */
        const userId = (req.user && req.user.user_id) || (req.query.user_id ? Number(req.query.user_id) : null);
        if (userId && !req.query.sort) {
            try {
                const profile = await aiUserProfilingService.getUserProfile(userId);
                rows = aiSearchRanking.rankTrips(rows, profile);
            } catch (e) {
                logger.error("SEARCH PERSONALIZATION ERROR:", e.message); // never breaks search
            }
        }

        res.json(rows);
    } catch (err) {
        logger.error("SEARCH ERROR:", err);
        /* Sprint 12 — Graceful Degradation: a dropped DB connection is not
           the same failure as a broken query, and shouldn't look like one
           to the client. 503 + degraded:true lets the frontend show "tạm
           thời không tìm được chuyến" instead of a hard error, and never
           hides the failure behind a fake empty-but-successful 200. */
        if (isConnectionError(err)) return sendDegraded(res, "rows", "Không thể kết nối cơ sở dữ liệu, vui lòng thử lại sau giây lát.");
        res.status(500).json({ message: "Database error" });
    }
};

exports._runTripSearch = runTripSearch; // shared with server/ai/bookingConcierge.js; also exported for direct unit testing

/* ===============================
   GET TRIP BY ID
=============================== */
exports.getTripById = async (req, res) => {
    try {
        const { id } = req.params;
        const sql = baseSelect + " WHERE t.trip_id = ? GROUP BY t.trip_id";
        const [result] = await db.query(sql, [id]);
        if (result.length === 0) return res.status(404).json({ message: "Trip not found" });
        res.json(result[0]);
    } catch (err) {
        logger.error("GET TRIP BY ID ERROR:", err);
        res.status(500).json({ message: "Database error" });
    }
};

/* ===============================
   CREATE TRIP (Operator)
=============================== */
exports.createTrip = async (req, res) => {
    try {
        const { route_id, bus_id, departure_time, arrival_time, base_price } = req.body;
        if (!route_id || !bus_id || !departure_time || !arrival_time || !base_price) {
            return res.status(400).json({ message: "Thiếu dữ liệu bắt buộc" });
        }
        const dep = new Date(departure_time);
        const arr = new Date(arrival_time);
        if (isNaN(dep) || isNaN(arr)) {
            return res.status(422).json({ message: "departure_time hoặc arrival_time không hợp lệ" });
        }
        if (arr <= dep) {
            return res.status(422).json({ message: "arrival_time phải sau departure_time" });
        }
        const price = Number(base_price);
        if (isNaN(price) || price < 0) {
            return res.status(422).json({ message: "base_price phải là số không âm" });
        }

        /* Operator chỉ được dùng xe của mình — ownership now derived from
           the canonical users.operator_id FK (see operatorScope.js),
           never from email matching. */
        if (req.user && req.user.role === 'OPERATOR') {
            const [[bus]] = await db.query("SELECT operator_id FROM bus WHERE bus_id=?", [bus_id]);
            if (!bus || !ownsOperator(req, bus.operator_id)) {
                return res.status(403).json({ message: "Xe này không thuộc quyền quản lý của bạn" });
            }
        }

        /* Phase 1 hardening (Section D — transaction audit): the conflict
           check and the INSERT were two separate, unguarded db.query()
           calls — two concurrent createTrip requests for the SAME bus and
           overlapping time window could both pass the conflict check
           before either INSERTs, both succeeding and double-booking the
           bus. A named MySQL advisory lock (GET_LOCK/RELEASE_LOCK), scoped
           to bus_id and held on one dedicated connection for the whole
           check+insert, serializes concurrent creates for the same bus
           without needing a real transaction (advisory locks aren't tied
           to a transaction boundary). */
        const conn = await db.getConnection();
        const lockName = `trip_create_bus_${bus_id}`;
        try {
            const [[{ locked }]] = await conn.query('SELECT GET_LOCK(?, 10) AS locked', [lockName]);
            if (!locked) {
                return res.status(409).json({ message: "Hệ thống đang bận xử lý chuyến khác cho xe này, vui lòng thử lại" });
            }
            try {
                /* Kiểm tra xe không có chuyến trùng giờ */
                const [[conflict]] = await conn.query(
                    `SELECT trip_id FROM trip
                     WHERE bus_id=? AND status != 'CANCELED'
                       AND departure_time < ? AND arrival_time > ?`,
                    [bus_id, arrival_time, departure_time]
                );
                if (conflict) {
                    return res.status(409).json({ message: "Xe này đã có chuyến trong khung giờ đó", conflict_trip_id: conflict.trip_id });
                }

                const [result] = await conn.query(
                    `INSERT INTO trip (route_id, bus_id, departure_time, arrival_time, base_price, status)
                     VALUES (?, ?, ?, ?, ?, 'OPEN')`,
                    [route_id, bus_id, departure_time, arrival_time, price]
                );
                return res.status(201).json({ message: "Tạo chuyến xe thành công", trip_id: result.insertId });
            } finally {
                await conn.query('SELECT RELEASE_LOCK(?)', [lockName]);
            }
        } finally {
            conn.release();
        }
    } catch (err) {
        logger.error("CREATE TRIP ERROR:", err);
        res.status(500).json({ message: "Database error" });
    }
};

/* ===============================
   UPDATE TRIP
=============================== */
exports.updateTrip = async (req, res) => {
    try {
        const { id } = req.params;
        const body = req.body || {};

        /* F-24/F-25 (Bug A) fix — Phase 2D.
           A partial body (e.g. Live ETA's {arrival_time}) must never blank out
           fields it didn't mention. We fetch the current row, merge only the
           fields the caller actually supplied (checked via `in`, so an
           omitted key is distinguished from an explicitly-sent null), then
           validate the resulting COMPLETE state before writing it back. */
        const [[existing]] = await db.query(
            `SELECT route_id, bus_id, departure_time, arrival_time, base_price, status FROM trip WHERE trip_id=?`,
            [id]
        );
        if (!existing) return res.status(404).json({ message: "Không tìm thấy chuyến xe" });

        const FIELDS = ["route_id", "bus_id", "departure_time", "arrival_time", "base_price", "status"];
        for (const f of FIELDS) {
            if (f in body && body[f] === null) {
                return res.status(422).json({ message: `Trường ${f} không được đặt thành null` });
            }
        }
        const merged = {};
        for (const f of FIELDS) merged[f] = (f in body) ? body[f] : existing[f];

        if (!isValidTripDate(merged.departure_time) || !isValidTripDate(merged.arrival_time)) {
            return res.status(422).json({
                message: "Thời gian không hợp lệ (hoặc chuyến xe hiện có dữ liệu ngày giờ bị lỗi — cần sửa dữ liệu trước khi cập nhật)"
            });
        }
        const dep = parseDbDateTime(merged.departure_time);
        const arr = parseDbDateTime(merged.arrival_time);
        if (arr <= dep) {
            return res.status(422).json({ message: "arrival_time phải sau departure_time" });
        }
        if (merged.base_price != null) {
            const price = Number(merged.base_price);
            if (isNaN(price) || price < 0) {
                return res.status(422).json({ message: "base_price phải là số không âm" });
            }
        }
        const VALID_STATUS = new Set(["OPEN","FULL","RUNNING","COMPLETED","CANCELED"]);
        if (merged.status != null && !VALID_STATUS.has(merged.status)) {
            return res.status(422).json({ message: `status không hợp lệ: ${[...VALID_STATUS].join(", ")}` });
        }

        /* Operator chỉ được sửa chuyến xe của mình — dùng merged.bus_id (không
           phải body.bus_id thô) để không bị "false negative" khi bus_id bị
           lược bỏ khỏi partial update. Ownership derived from the canonical
           users.operator_id FK, never from email matching. */
        if (req.user && req.user.role === 'OPERATOR') {
            const [[bus]] = await db.query("SELECT operator_id FROM bus WHERE bus_id=?", [merged.bus_id]);
            if (!bus || !ownsOperator(req, bus.operator_id)) {
                return res.status(403).json({ message: "Chuyến này không thuộc quyền quản lý của bạn" });
            }
        }

        /* Sprint 6 — CRUD validation: changing what a trip actually IS
           (route/bus/departure/arrival) after real tickets are sold would
           silently invalidate what those passengers paid for. Only blocks
           on these four structural fields — status/base_price changes go
           through updateTripStatus/updateTripPrice, which stay unaffected
           (e.g. the auto-advance cron job must still be able to mark a
           booked trip COMPLETED). Re-submitting the same values is a no-op,
           not a change, and is not blocked. */
        const structuralFields = ['route_id', 'bus_id', 'departure_time', 'arrival_time'];
        const changingStructure = structuralFields.some(f => String(merged[f]) !== String(existing[f]));
        if (changingStructure) {
            const [[activeBooking]] = await db.query(
                "SELECT COUNT(*) AS cnt FROM booking WHERE trip_id=? AND status IN ('PAID','PENDING')", [id]
            );
            if (activeBooking.cnt > 0) {
                return res.status(409).json({
                    message: `Không thể đổi tuyến/xe/giờ khởi hành — chuyến này đang có ${activeBooking.cnt} vé ở trạng thái đã đặt/chờ thanh toán`
                });
            }
        }

        await db.query(
            `UPDATE trip SET route_id=?, bus_id=?, departure_time=?, arrival_time=?, base_price=?, status=?
             WHERE trip_id=?`,
            [merged.route_id, merged.bus_id, merged.departure_time, merged.arrival_time, merged.base_price, merged.status, id]
        );
        await invalidateTripCaches(); // Sprint 12 — a full trip edit can change anything the cached lists show
        res.json({ message: "Cập nhật chuyến xe thành công" });
    } catch (err) {
        logger.error("UPDATE TRIP ERROR:", err);
        res.status(500).json({ message: "Database error" });
    }
};

/* ===============================
   UPDATE TRIP STATUS
=============================== */
exports.updateTripStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const VALID = new Set(["OPEN","FULL","RUNNING","COMPLETED","CANCELED"]);
        if (!status || !VALID.has(status)) {
            return res.status(422).json({ message: `status không hợp lệ: ${[...VALID].join(", ")}` });
        }
        /* Phase 2I Step 2: previously had NO ownership check at all — any
           authenticated OPERATOR could change any other operator's trip
           status. */
        if (req.user && req.user.role === 'OPERATOR') {
            const [[trip]] = await db.query(
                "SELECT b.operator_id FROM trip t JOIN bus b ON t.bus_id=b.bus_id WHERE t.trip_id=?", [id]
            );
            if (!trip || !ownsOperator(req, trip.operator_id)) {
                return res.status(403).json({ message: "Chuyến này không thuộc quyền quản lý của bạn" });
            }
        }
        await db.query("UPDATE trip SET status=? WHERE trip_id=?", [status, id]);
        await invalidateTripCaches(); // Sprint 12 — trending list + public stats can both change with a status flip
        res.json({ message: "Cập nhật trạng thái thành công" });
    } catch (err) {
        logger.error("UPDATE TRIP STATUS ERROR:", err);
        res.status(500).json({ message: "Database error" });
    }
};

/* ===============================
   UPDATE TRIP PRICE
=============================== */
exports.updateTripPrice = async (req, res) => {
    try {
        const { id } = req.params;
        const { price } = req.body;
        const p = Number(price);
        if (isNaN(p) || p < 0) {
            return res.status(422).json({ message: "price phải là số không âm" });
        }
        /* Phase 2I Step 2: previously had NO ownership check at all — any
           authenticated OPERATOR could reprice any other operator's trip. */
        if (req.user && req.user.role === 'OPERATOR') {
            const [[trip]] = await db.query(
                "SELECT b.operator_id FROM trip t JOIN bus b ON t.bus_id=b.bus_id WHERE t.trip_id=?", [id]
            );
            if (!trip || !ownsOperator(req, trip.operator_id)) {
                return res.status(403).json({ message: "Chuyến này không thuộc quyền quản lý của bạn" });
            }
        }
        await db.query("UPDATE trip SET base_price=? WHERE trip_id=?", [p, id]);
        await invalidateTripCaches(); // Sprint 12 — a repriced trip must not keep serving its old cached price
        res.json({ message: "Cập nhật giá thành công" });
    } catch (err) {
        logger.error("UPDATE TRIP PRICE ERROR:", err);
        res.status(500).json({ message: "Database error" });
    }
};

/* ===============================
   AUTO-ADVANCE COMPLETED TRIPS
   Chỉ advance chuyến đã KẾT THÚC (arrival_time < NOW).
   Chuyến đang chạy KHÔNG bị đụng — /api/trips/running tự query trực tiếp.
=============================== */
exports.autoGenerateRecurringTrips = async () => {
    try {
        /* Chỉ advance các chuyến đã HOÀN THÀNH (arrival_time đã qua).
           Chuyến đang chạy (dep <= NOW < arr) → GIỮ NGUYÊN.
           Dùng MySQL làm chuẩn thời gian để tránh timezone JS vs DB.
           F-24/F-25 (Bug B) fix — Phase 2D: eligibility is now an explicit
           whitelist of pre-completion statuses (OPEN/FULL/RUNNING) instead
           of "!= CANCELED". A blacklist let already-COMPLETED trips (and
           any other unexpected status) keep re-entering this loop forever,
           which — combined with a zero-date/NULL source row — was the
           mechanism that produced an unbounded chain of zero-date clones.
           Trips with NULL status (e.g. trip_id 4, 12) are also naturally
           excluded by this whitelist, same as before. */
        const [completed] = await db.query(
            `SELECT trip_id, route_id, bus_id, departure_time, arrival_time, base_price
             FROM trip
             WHERE status IN ('OPEN','FULL','RUNNING')
               AND arrival_time <= NOW()`
        );
        if (!completed.length) {
            logger.info(`ℹ️ [AutoTrip] No completed trips to advance`);
            return;
        }

        const [[{ nowMs }]] = await db.query(`SELECT UNIX_TIMESTAMP(NOW()) * 1000 AS nowMs`);
        const now = Number(nowMs);

        let cloned = 0, inplace = 0, skippedInvalid = 0;
        for (const t of completed) {
            /* F-24/F-25 (Bug B) fix — Phase 2D: never let an invalid/zero-date
               source row reach date arithmetic. Fail closed: skip and warn
               once per trip_id (module-level Set), not every 60s cycle. */
            if (!isValidTripDate(t.departure_time) || !isValidTripDate(t.arrival_time)) {
                skippedInvalid++;
                if (!warnedInvalidTripIds.has(t.trip_id)) {
                    warnedInvalidTripIds.add(t.trip_id);
                    logger.warn(`⚠️ [AutoTrip] Skipping trip_id=${t.trip_id} — invalid/zero source date ` +
                        `(departure_time=${t.departure_time}, arrival_time=${t.arrival_time}); needs manual data repair, not auto-advanced`);
                }
                continue;
            }
            const dep = parseDbDateTime(t.departure_time).getTime();
            const arr = parseDbDateTime(t.arrival_time).getTime();
            const dur = arr - dep;

            /* Advance by whole days via epoch-ms arithmetic (not calendar
               setDate/setUTCDate mutation) — 24h is exactly 1 calendar day
               in Asia/Ho_Chi_Minh since Vietnam observes no DST, so this
               is equivalent and avoids any dependency on which Date
               accessor (local vs UTC) "day" arithmetic happens to use. */
            const DAY_MS = 24 * 60 * 60 * 1000;
            let nextDepMs = dep + DAY_MS;
            while (nextDepMs <= now) nextDepMs += DAY_MS;
            const nextDep = new Date(nextDepMs);
            const nextArr = new Date(nextDepMs + dur);

            /* Kiểm tra trip có booking lịch sử không */
            const [[{ cnt }]] = await db.query(
                `SELECT COUNT(*) AS cnt FROM booking WHERE trip_id=?`, [t.trip_id]
            );

            if (Number(cnt) > 0) {
                /* Có booking → KHÔNG sửa departure_time cũ (bảo toàn lịch sử).
                   Chỉ INSERT trip mới nếu chưa có chuyến tương lai cho bus/route này. */
                const [[existing]] = await db.query(
                    `SELECT trip_id FROM trip
                     WHERE bus_id=? AND route_id=? AND status != 'CANCELED'
                       AND departure_time > NOW() LIMIT 1`,
                    [t.bus_id, t.route_id]
                );
                if (!existing) {
                    await db.query(
                        `INSERT INTO trip (route_id, bus_id, departure_time, arrival_time, base_price, status)
                         VALUES (?, ?, ?, ?, ?, 'OPEN')`,
                        [t.route_id, t.bus_id, toDbDateTime(nextDep), toDbDateTime(nextArr), t.base_price]
                    );
                    cloned++;
                }
                /* Đánh dấu chuyến cũ là COMPLETED (giữ nguyên departure_time) */
                await db.query(`UPDATE trip SET status='COMPLETED' WHERE trip_id=?`, [t.trip_id]);
            } else {
                /* Không có booking → cập nhật in-place (chuyến template chưa được đặt) */
                await db.query(
                    `UPDATE trip SET departure_time=?, arrival_time=?, status='OPEN' WHERE trip_id=?`,
                    [toDbDateTime(nextDep), toDbDateTime(nextArr), t.trip_id]
                );
                inplace++;
            }
        }
        if (cloned + inplace > 0)
            logger.info(`✅ [AutoTrip] Advanced: ${inplace} in-place, ${cloned} cloned (with bookings)`);
        if (skippedInvalid > 0)
            logger.info(`⚠️ [AutoTrip] Skipped ${skippedInvalid} trip(s) with invalid/zero source dates this cycle`);
    } catch (err) {
        logger.error("❌ [AutoTrip] Error:", err);
    }
};

/* ===============================
   PERIODIC CHECK (mỗi 2 phút)
   Trigger advance ngay khi hết chuyến OPEN có thể đặt vé.
   Chuyến đang chạy (RUNNING) vẫn giữ nguyên, chỉ advance các chuyến đã xong.
=============================== */
exports.checkAndAdvanceIfNeeded = async () => {
    try {
        // Advance tất cả chuyến đã hoàn thành (arrival_time đã qua)
        // F-24/F-25 (Bug B) fix — Phase 2D: same OPEN/FULL/RUNNING whitelist
        // as autoGenerateRecurringTrips, so this trigger-check doesn't keep
        // firing forever for a COMPLETED (or otherwise ineligible) trip.
        const [[{ doneCnt }]] = await db.query(
            `SELECT COUNT(*) AS doneCnt FROM trip
             WHERE status IN ('OPEN','FULL','RUNNING') AND arrival_time <= NOW()`
        );
        if (Number(doneCnt) > 0) {
            logger.info(`🔄 [AutoTrip] Có ${doneCnt} chuyến đã đến nơi → advance sang ngày mai...`);
            await exports.autoGenerateRecurringTrips();
        }
    } catch (err) {
        logger.error("❌ [AutoTrip] checkAndAdvance error:", err);
    }
};

/* ===============================
   DYNAMIC PRICING
=============================== */
exports.getDynamicPriceForTrip = async (req, res) => {
    try {
        const { getDynamicPrice } = require('../services/pricingEngine');
        const result = await getDynamicPrice(db, req.params.id);
        res.json(result);
    } catch (err) {
        logger.error("DYNAMIC PRICE ERROR:", err);
        if (err.message === 'Trip not found') return res.status(404).json({ message: 'Trip not found' });
        res.status(500).json({ message: 'Database error' });
    }
};

/* ===============================
   DELETE TRIP
=============================== */
exports.deleteTrip = async (req, res) => {
    try {
        const { id } = req.params;
        const [[{ bookingCount }]] = await db.query(
            "SELECT COUNT(*) AS bookingCount FROM booking WHERE trip_id=?", [id]
        );
        if (bookingCount > 0) {
            /* Soft delete — không xóa chuyến có booking lịch sử */
            await db.query("UPDATE trip SET status='CANCELED' WHERE trip_id=?", [id]);
            return res.json({ message: "Chuyến đã có booking — đã hủy thay vì xóa", soft: true });
        }
        await db.query("DELETE FROM trip WHERE trip_id=?", [id]);
        res.json({ message: "Đã xóa chuyến xe", soft: false });
    } catch (err) {
        logger.error("DELETE TRIP ERROR:", err);
        res.status(500).json({ message: "Database error" });
    }
};
