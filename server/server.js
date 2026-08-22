console.log("🔥 ĐANG CHẠY SERVER ĐÚNG FILE");

/* ================= TIME CONTRACT ================= */
// Pin the process timezone to Vietnam BEFORE any other module loads, so
// every native Date local-time call (toLocaleString, getHours, etc. — used
// by emailService and admin dashboard formatting) is correct regardless of
// the deployment host's default OS timezone. DB-level correctness is
// enforced separately and independently via the mysql2 pool's explicit
// `timezone: '+07:00'` in server/config/db.js. See server/utils/dateTime.js
// for the full time contract documentation (Phase 1 hardening).
process.env.TZ = process.env.TZ || "Asia/Ho_Chi_Minh";

const express = require("express");
const cors    = require("cors");
const path    = require("path");
const helmet  = require("helmet");
const compression = require("compression");
const http    = require("http");
const { Server } = require("socket.io");
const { apiLimiter, loginLimiter } = require("./middleware/rateLimiter");
const sanitizeInput = require("./middleware/sanitizeInput");
const requestId = require("./middleware/requestId");
const logger = require("./utils/logger");

const app = express();
const server = http.createServer(app);

/* Enterprise Hardening Pass — must be the very first middleware so every
   request (including ones rate-limited or CORS-rejected before reaching a
   route) gets a trace_id, and every logger.* call anywhere downstream in
   this request's async chain picks it up automatically. */
app.use(requestId);
const ALLOWED_ORIGINS = [
    'http://localhost:2704',
    'http://127.0.0.1:2704',
    /^http:\/\/192\.168\.\d+\.\d+:2704$/,   // LAN
    /^https?:\/\/.*\.smartbusai\.vn$/,       // production domain
    // Sprint 5: optional deployment-specific origins (comma-separated),
    // additive to the defaults above — e.g. a Docker/staging host that
    // doesn't match any of the fixed patterns. Unset = behavior unchanged.
    ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()).filter(Boolean) : []),
];

const corsOptions = {
    origin: (origin, cb) => {
        // allow same-origin / SSR / curl (no Origin header)
        if (!origin) return cb(null, true);
        const ok = ALLOWED_ORIGINS.some(o =>
            typeof o === 'string' ? o === origin : o.test(origin)
        );
        cb(ok ? null : new Error('CORS blocked'), ok);
    },
    credentials: true
};

const io = new Server(server, {
    cors: { origin: ALLOWED_ORIGINS, methods: ['GET', 'POST'], credentials: true }
});

/* ================= DATABASE ================= */
const db = require("./config/db");

/* ================= SCHEMA MIGRATION =================
   Phase 1 hardening (Section F): previously fired without await and
   swallowed its own errors (see server/config/migrate.js's header) — the
   server could report "running" against an unmigrated schema. runMigration
   is now awaited immediately before server.listen() (see START SERVER,
   below) and a failure there aborts startup instead of continuing. It is
   still required here so the module loads / route files that reference
   `db` don't race the pool, but the actual gating happens at listen time. */
const { runMigration } = require("./config/migrate");

/* ================= DATA SEED ================= */
const { runSeedIfNeeded } = require("./config/seed_full");
setTimeout(runSeedIfNeeded, 2000);

/* ================= SECURITY HEADERS (Helmet) ================= */
// Tắt CSP để không làm hỏng inline scripts hiện có
// Tắt crossOriginEmbedderPolicy để tránh lỗi với static assets
//
// Sprint 7: Tắt HSTS (Strict-Transport-Security) — Helmet gửi header này
// mặc định BẤT KỂ kết nối có thật sự là HTTPS hay không. Server này chạy
// HTTP thuần trên :2704 (không có reverse proxy chấm dứt TLS phía trước
// trong môi trường dev/demo/bảo vệ đồ án) — gửi HSTS ở đây là sai lệch
// (nói với trình duyệt "luôn nâng cấp origin này lên HTTPS" trong khi
// HTTPS không hề tồn tại), và là nguyên nhân hợp lý nhất khiến Service
// Worker đăng ký thất bại với lỗi chung chung "An unknown error occurred
// when fetching the script" (localhost thường được miễn yêu cầu HTTPS
// cho "secure context", nhưng một HSTS policy đang hoạt động cho chính
// origin đó có thể phá vỡ trường hợp miễn trừ này). Nếu triển khai thật
// sự có TLS (qua reverse proxy), bật lại hsts ở đó — Helmet's default
// vẫn đúng cho môi trường HTTPS thật.
/* Content Security Policy (Enterprise Hardening Pass).
   Explicit allowlist built from a real audit of every external domain this
   frontend actually loads (grepped across every page under public/pages — CDN
   <script>/<link> tags, Leaflet tile requests, Google/Facebook OAuth SDKs,
   avatar image hosts) — not a generic template. Anything not on this list
   is refused by the browser, including a payload an attacker might inject
   trying to <script src="evil.example.com/x.js">.

   'unsafe-inline' on script-src/style-src is a deliberate, disclosed
   trade-off, not an oversight: this codebase uses inline onclick="..."
   handlers and inline <style> blocks extensively across every page (a
   pre-existing architectural pattern, not something this pass introduced).
   Removing 'unsafe-inline' would require a nonce/hash on every inline
   script and rewriting every onclick attribute to addEventListener across
   the whole app — a large, invasive refactor with real regression risk
   that is out of scope for this pass (see ENTERPRISE_HARDENING_REPORT.md).
   What this CSP DOES concretely stop, even with 'unsafe-inline' present:
   loading a REMOTE script/style from any domain not on this allowlist —
   the actual payload delivery mechanism a stored-XSS attack normally
   needs, since Sprint 12's sanitizeInput middleware already prevents a
   raw <script> tag from surviving into stored data in the first place.
   This is defense-in-depth layering, not a single silver bullet. */
const cspDirectives = {
    defaultSrc: ["'self'"],
    scriptSrc: [
        "'self'", "'unsafe-inline'",
        "https://unpkg.com", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com",
        "https://accounts.google.com", "https://connect.facebook.net",
    ],
    /* CSP Level 3 splits inline EVENT HANDLER ATTRIBUTES (onclick="...")
       from inline <script> blocks — they're governed by script-src-attr,
       NOT script-src, and Helmet defaults script-src-attr to 'none' for
       any directive set left unspecified. Confirmed live in-browser
       during this pass: without this line, the CSP silently blocked
       EVERY onclick="..." handler in the app (this codebase's dominant
       interactivity pattern) — caught via a securitypolicyviolation
       listener before shipping, not assumed safe from the header alone. */
    scriptSrcAttr: ["'unsafe-inline'"],
    styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://fonts.googleapis.com"],
    fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
    imgSrc: [
        "'self'", "data:", "blob:",
        "https://*.tile.openstreetmap.org", "https://lh3.googleusercontent.com", "https://platform-lookaside.fbsbx.com",
    ],
    connectSrc: [
        "'self'",
        "https://accounts.google.com", "https://www.googleapis.com",
        "https://graph.facebook.com", "https://connect.facebook.net",
        "https://*.tile.openstreetmap.org",
    ],
    frameSrc: ["https://accounts.google.com", "https://www.facebook.com"], // OAuth popup/iframe flows
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'self'"],
};

app.use(helmet({
    contentSecurityPolicy: { directives: cspDirectives },
    crossOriginEmbedderPolicy: false,
    hsts: false
}));

/* ================= COMPRESSION (Sprint 7) =================
   Gzip/deflate every response above the 1KB default threshold — HTML
   pages, JSON API responses, and any static asset not already
   pre-compressed. Placed before express.static/routes so it wraps
   everything downstream; `compression` respects an incoming
   `Accept-Encoding` header and a client request for no compression
   (`x-no-compression`) automatically. */
app.use(compression());

/* ================= MIDDLEWARE ================= */
app.use(cors(corsOptions));
/* 3mb accommodates a base64-encoded 2MB avatar upload (base64 inflates
   size ~33%, plus JSON wrapper overhead) — Express's 100kb default would
   otherwise reject every avatar upload before it reaches the controller's
   own MAX_AVATAR_BYTES check (userController.js uploadAvatar). */
app.use(express.json({ limit: "3mb" }));
app.use(express.urlencoded({ extended: true, limit: "3mb" }));

/* Sprint 12 — request-body/query XSS sanitization (see sanitizeInput.js
   for the full scope note). Skipped entirely for /api/payment/* — those
   routes include VNPay/MoMo/ZaloPay gateway callbacks whose signature
   verification (paymentService.js) hashes the exact fields the gateway
   sent; mutating any field before that check runs is a correctness risk
   this sprint isn't willing to take for a defense-in-depth XSS layer. */
app.use((req, res, next) => {
    if (req.path.startsWith("/api/payment/")) return next();
    sanitizeInput(req, res, next);
});

/* ================= DEBUG REQUEST LOG ================= */
if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
        logger.info(`📥 ${req.method} ${req.url}`);
        next();
    });
}

/* ================= RATE LIMITING ================= */
// Giới hạn 200 request/phút cho toàn bộ API
app.use("/api/", apiLimiter);
// Giới hạn 10 lần đăng nhập/15 phút cho login endpoint
app.use("/api/auth/login", loginLimiter);

/* ================= API CACHE HEADERS ================= */
// GET requests on stable read-only endpoints: short CDN/browser cache
const READ_CACHE_ROUTES = [
    /^\/api\/operators(\?|$)/,
    /^\/api\/trips\/search/,
    /^\/api\/trips\/dynamic-price/,
    /^\/api\/ai\/(trending|search-insight)/,
    /^\/api\/search\/(suggestions|popular-transfers)/,
    /^\/api\/stops/,
];
app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    if (READ_CACHE_ROUTES.some(r => r.test(req.path))) {
        res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    }
    next();
});

/* ================= SWAGGER API DOCS ================= */
const setupSwagger = require('./swagger');
setupSwagger(app);

/* ================= FAVICON ================= */
// Browsers request GET /favicon.ico unconditionally on every page unless a
// <link rel="icon"> says otherwise — there was no file at that path at all
// (only /public/icons/icon.svg, referenced from manifest.json/apple-touch-icon,
// never from a plain favicon link), so every single page load 404'd on this.
// Serves the existing SVG icon directly at the conventional path rather than
// requiring an ICO file — every modern browser (Chrome/Edge/Firefox) accepts
// an SVG favicon regardless of the requested ".ico" extension.
app.get("/favicon.ico", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/icons/icon.svg"), {
        headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=2592000, immutable" },
    });
});

/* ================= STATIC FRONTEND ================= */
// Không cache HTML — browser luôn fetch bản mới nhất khi F5
app.use((req, res, next) => {
    if (req.path.endsWith(".html") || req.path === "/") {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
    }
    next();
});
// Static assets: JS/CSS always revalidated via ETag (304s are cheap, but
// every real edit is picked up on next load instead of hiding behind a
// 7-day max-age with no revalidation — the previous config caused browsers
// to silently keep serving stale api.js/style.css for up to 7 days after
// every deploy, with no way for the client to even ask if it changed).
// Images/fonts change rarely and aren't referenced by content hash, so they
// keep a long cache but still get an ETag for correctness.
app.use(express.static(path.join(__dirname, "../public"), {
    maxAge: 0,
    etag: true,
    lastModified: true,
    setHeaders(res, filePath) {
        if (/\.(js|css)$/.test(filePath)) {
            res.setHeader("Cache-Control", "no-cache");
        } else if (/\.(png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf)$/.test(filePath)) {
            res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
        }
    }
}));

/* ================= ROUTES ================= */
const authRoutes     = require("./routes/authRoutes");
const tripRoutes     = require("./routes/tripRoutes");
const bookingRoutes  = require("./routes/bookingRoutes");
const userRoutes     = require("./routes/userRoutes");
const reviewRoutes   = require("./routes/reviewRoutes");
const adminRoutes    = require("./routes/adminRoutes");
const operatorRoutes = require("./routes/operatorRoutes");
const supportRoutes  = require("./routes/supportRoutes");
const seatRoutes     = require("./routes/seatRoutes");
const busRoutes      = require("./routes/busRoutes");
const settingsRoutes = require("./routes/settingsRoutes");
const searchRoutes   = require("./routes/searchRoutes");
const stopRoutes     = require("./routes/routeStopRoutes");
const passengerAIRoutes    = require("./routes/passengerAIRoutes");
const recommendationRoutes = require("./routes/recommendationRoutes");
const locationRoutes       = require("./routes/locationRoutes");
const paymentRoutes        = require("./routes/paymentRoutes");
const conciergeRoutes      = require("./routes/conciergeRoutes"); // Sprint 4
const healthRoutes         = require("./routes/healthRoutes"); // Sprint 5
const statsRoutes          = require("./routes/statsRoutes");

/* ================= USE ROUTES ================= */
app.use("/api/auth",      authRoutes);
app.use("/api/trips",     tripRoutes);
app.use("/api/bookings",  bookingRoutes);
app.use("/api/users",     userRoutes);
app.use("/api/reviews",   reviewRoutes);
app.use("/api/admin",     adminRoutes);
app.use("/api/operators", operatorRoutes);
app.use("/api/support",   supportRoutes);
app.use("/api/seats",     seatRoutes);
app.use("/api/buses",     busRoutes);
app.use("/api/settings",  settingsRoutes);
app.use("/api/search",    searchRoutes);
app.use("/api/stops",     stopRoutes);
app.use("/api/ai",              passengerAIRoutes);
app.use("/api/recommendations", recommendationRoutes);
app.use("/api/locations",       locationRoutes);
app.use("/api/payment",         paymentRoutes);
app.use("/api/ai/concierge",    conciergeRoutes); // Sprint 4 — AI Booking Concierge
app.use("/api/health",          healthRoutes); // Sprint 5 — production health-check
app.use("/api/stats",           statsRoutes); // public real-time login-page stats

/* ================= DB TEST ================= */
app.get("/api/db-test", async (req, res) => {
    try {
        const [result] = await db.query("SELECT 1");
        res.json({ status: "success", message: "Database connected", data: result });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ status: "error", message: "Database connection failed" });
    }
});

/* ================= ROOT ================= */
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/pages/auth/login.html"));
});

/* ================= 404 HANDLER ================= */
app.use((req, res) => {
    res.status(404).json({ message: "API not found" });
});

/* ================= ERROR HANDLER =================
   Final safety net for any error that reaches Express via next(err) instead
   of being caught inline by a controller's own try/catch. Uses the same
   centralized sendError() as every controller (server/utils/errors.js) so
   an AppError's deliberate, user-facing message/status still comes through,
   while anything else (a real bug, a raw DB error) never leaks err.stack /
   err.message to the client — only a fixed generic message. */
const { sendError } = require("./utils/errors");
app.use((err, req, res, next) => {
    sendError(res, err, "SERVER ERROR", 500, "Internal server error");
});

/* ── Socket.io Seat Lock Manager ── */
const seatLocks    = new Map(); // key: "tripId_seatId", value: { userId, socketId, lockedAt }
const seatLockTmos = new Map(); // key: "tripId_seatId", value: timeoutId  (prevent double-timeout bug)
const LOCK_TIMEOUT = 5 * 60 * 1000; // 5 minutes

function _releaseLock(key, reason) {
    const lock = seatLocks.get(key);
    if (!lock) return;
    clearTimeout(seatLockTmos.get(key));
    seatLockTmos.delete(key);
    seatLocks.delete(key);
    const parts = key.split('_');
    const tripId = parts[0];
    const seatId = parts.slice(1).join('_');
    io.to(`trip_${tripId}`).emit('seat:released', { seatId });
}

io.on('connection', (socket) => {
    logger.info(`🔌 Socket connected: ${socket.id}`);

    // Lock a seat
    socket.on('seat:lock', ({ tripId, seatId, userId }) => {
        const key = `${tripId}_${seatId}`;
        const existing = seatLocks.get(key);

        // Deny if locked by a DIFFERENT socket AND different user
        if (existing && existing.socketId !== socket.id) {
            socket.emit('seat:lock_denied', { seatId, message: 'Ghế đang được người khác chọn' });
            return;
        }

        // Clear any previous timeout for this key (prevents stale auto-release)
        clearTimeout(seatLockTmos.get(key));

        seatLocks.set(key, { userId, socketId: socket.id, lockedAt: Date.now() });

        // Notify only OTHER clients — sender already handled UI locally
        socket.to(`trip_${tripId}`).emit('seat:locked', { seatId, lockedBy: userId ?? 'anonymous' });

        // Auto-release after timeout — store handle to allow cancellation
        const tmo = setTimeout(() => {
            const lock = seatLocks.get(key);
            if (lock && lock.socketId === socket.id) {
                _releaseLock(key, 'timeout');
            }
        }, LOCK_TIMEOUT);
        seatLockTmos.set(key, tmo);
    });

    // Unlock a seat
    socket.on('seat:unlock', ({ tripId, seatId }) => {
        const key = `${tripId}_${seatId}`;
        const lock = seatLocks.get(key);
        if (lock && lock.socketId === socket.id) {
            _releaseLock(key, 'unlock');
        }
    });

    // Join trip room — send current locks with lockedBy so client can distinguish own vs others
    socket.on('trip:join', ({ tripId }) => {
        socket.join(`trip_${tripId}`);
        const lockedSeats = [];
        seatLocks.forEach((lock, key) => {
            if (key.startsWith(`${tripId}_`)) {
                const seatId = key.replace(`${tripId}_`, '');
                lockedSeats.push({ seatId, lockedBy: lock.userId ?? 'anonymous' });
            }
        });
        socket.emit('seat:current_locks', lockedSeats);
    });

    // On disconnect, release all locks held by this socket
    socket.on('disconnect', () => {
        const toRelease = [];
        seatLocks.forEach((lock, key) => {
            if (lock.socketId === socket.id) toRelease.push(key);
        });
        toRelease.forEach(key => _releaseLock(key, 'disconnect'));
    });
});

// REST endpoint to check locked seats
app.get('/api/seats/locks/:tripId', (req, res) => {
    const { tripId } = req.params;
    const locks = [];
    seatLocks.forEach((lock, key) => {
        if (key.startsWith(`${tripId}_`)) {
            locks.push({ seatId: key.replace(`${tripId}_`, ''), lockedAt: lock.lockedAt });
        }
    });
    res.json(locks);
});

/* ================= START SERVER =================
   Phase 1 hardening (Section F): migration is now awaited and gates
   startup — the server never reports "running" against an unmigrated or
   degraded schema. A migration failure (a real connectivity problem, or
   verifySchema() finding a required object still missing) logs a loud,
   unmissable error and exits instead of silently listening anyway. */
const PORT = Number(process.env.PORT) || 2704;

(async () => {
    try {
        /* Waits (with retry/backoff — see db.js's waitForConnection) for
           MySQL to actually accept a connection before ever calling
           runMigration(). Without this, a MySQL/XAMPP instance that's
           still booting at the exact moment this process starts can make
           runMigration()'s very first query lose that race and throw —
           which the catch below treats as fatal (process.exit(1)) by
           design, taking the whole server down over what was really just
           bad timing, not a real problem. */
        const dbReady = await db.waitForConnection();
        if (!dbReady) {
            throw new Error("MySQL not reachable — see the retry log above for connection details");
        }
        logger.info("✅ MySQL Connected Successfully");
        await runMigration();
    } catch (err) {
        logger.error("=================================");
        logger.error("❌ STARTUP ABORTED — migration failed or schema is degraded");
        logger.error(err.message);
        logger.error("Server will NOT start serving traffic against an unverified schema.");
        logger.error("=================================");
        process.exit(1);
        return;
    }

    server.listen(PORT, () => {
        logger.info("=================================");
        logger.info("🚀 SmartBus Server Running");
        logger.info(`🌐 http://localhost:${PORT}`);
        logger.info("=================================");
    });
})();

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        /* Enterprise Hardening Pass fix: this block is a human-actionable,
           copy-paste-a-command instruction, not a log event — it must stay
           on plain console.error. Winston's JSON formatter (logger.js)
           quote-escapes embedded `"` characters when it serializes the
           message field, so a command like `powershell -Command "..."`
           printed through logger.error renders on screen with literal
           backslash-escaped quotes (`\"`) — copy-pasting that exact text
           into a real shell is a syntax error there, not a working command.
           Same rationale as the jwtSecret.js/qrSecret.js console.warn
           exclusions: a fatal, pre-request startup message meant for a
           human's terminal, not for structured log aggregation. */
        console.error(`\n❌ Port ${PORT} đang bị chiếm!`);
        console.error(`👉 Chạy lệnh này để kill process cũ rồi thử lại:`);
        console.error(`   powershell -Command "Get-Process node | Stop-Process -Force"`);
        console.error(`   node server/server.js\n`);
    } else {
        logger.error('Server error:', err);
    }
    process.exit(1);
});

/* ================= TRIP REMINDER EMAILS ================= */
const { sendTripReminder } = require('./services/emailService');
setInterval(async () => {
    try {
        const now = new Date();
        const lo  = new Date(now.getTime() + 115 * 60 * 1000);
        const hi  = new Date(now.getTime() + 125 * 60 * 1000);
        const [rows] = await db.query(
            `SELECT b.booking_id, u.email, u.full_name,
                    r.origin, r.destination, t.departure_time
             FROM booking b
             JOIN users u ON b.user_id = u.user_id
             JOIN trip t ON b.trip_id = t.trip_id
             JOIN route r ON t.route_id = r.route_id
             WHERE b.status = 'PAID'
               AND t.departure_time BETWEEN ? AND ?
               AND (b.reminder_sent IS NULL OR b.reminder_sent = 0)`,
            [lo, hi]
        );
        for (const row of rows) {
            try {
                await sendTripReminder(row.email, row);
                await db.query('UPDATE booking SET reminder_sent=1 WHERE booking_id=?', [row.booking_id]);
            } catch(e) { /* non-critical per booking */ }
        }
    } catch(e) { /* reminder table col may not exist */ }
}, 10 * 60 * 1000);
logger.info('📧 [Email] Trip reminder scheduler started (every 10 min)');

/* ================= AUTO DAILY TRIPS ================= */
const tripCtrl = require("./controllers/tripController");

// Chạy ngay khi server khởi động
tripCtrl.autoGenerateRecurringTrips();

// Lên lịch chạy lúc 00:01 mỗi ngày (backup)
function scheduleAtMidnight(fn) {
    const now  = new Date();
    const next = new Date(now);
    next.setDate(next.getDate() + 1);
    next.setHours(0, 1, 0, 0);
    const ms = next - now;
    setTimeout(() => { fn(); setInterval(fn, 24 * 60 * 60 * 1000); }, ms);
    logger.info(`⏰ [AutoTrip] Lên lịch tạo chuyến lúc ${next.toLocaleTimeString("vi-VN")}`);
}
scheduleAtMidnight(tripCtrl.autoGenerateRecurringTrips);

// Kiểm tra mỗi 1 phút: nếu hết chuyến OPEN có thể đặt → advance ngay sang ngày mai
setInterval(tripCtrl.checkAndAdvanceIfNeeded, 60 * 1000);
logger.info("🔄 [AutoTrip] Polling 1 phút/lần — tự động render chuyến ngày mai khi hết OPEN.");

/* ================= ABANDONED CHECKOUT CLEANUP =================
   Sprint 3: a PENDING booking with no other release path permanently
   locks its seat(s) out of inventory (see trip_seat_hold, Phase 1's
   migrate_v9.sql). Auto-cancels PENDING bookings older than 15 minutes,
   every 5 minutes — see server/services/bookingCleanup.js. */
const { cancelAbandonedBookings, ABANDONED_THRESHOLD_MINUTES } = require("./services/bookingCleanup");
setInterval(() => { cancelAbandonedBookings().catch(err => logger.error("[BookingCleanup] error:", err.message)); }, 5 * 60 * 1000);
logger.info(`🧹 [BookingCleanup] Polling 5 phút/lần — tự động hủy booking PENDING quá ${ABANDONED_THRESHOLD_MINUTES} phút, giải phóng ghế.`);
