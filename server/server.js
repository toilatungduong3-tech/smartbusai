console.log("🔥 ĐANG CHẠY SERVER ĐÚNG FILE");

const express = require("express");
const cors    = require("cors");
const path    = require("path");
const helmet  = require("helmet");
const http    = require("http");
const { Server } = require("socket.io");
const { apiLimiter, loginLimiter } = require("./middleware/rateLimiter");

const app = express();
const server = http.createServer(app);
const ALLOWED_ORIGINS = [
    'http://localhost:2704',
    'http://127.0.0.1:2704',
    /^http:\/\/192\.168\.\d+\.\d+:2704$/,   // LAN
    /^https?:\/\/.*\.smartbusai\.vn$/        // production domain
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

/* ================= SCHEMA MIGRATION ================= */
const { runMigration } = require("./config/migrate");
runMigration();

/* ================= DATA SEED ================= */
const { runSeedIfNeeded } = require("./config/seed_full");
setTimeout(runSeedIfNeeded, 2000);

/* ================= SECURITY HEADERS (Helmet) ================= */
// Tắt CSP để không làm hỏng inline scripts hiện có
// Tắt crossOriginEmbedderPolicy để tránh lỗi với static assets
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

/* ================= MIDDLEWARE ================= */
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ================= DEBUG REQUEST LOG ================= */
if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
        console.log(`📥 ${req.method} ${req.url}`);
        next();
    });
}

/* ================= RATE LIMITING ================= */
// Giới hạn 200 request/phút cho toàn bộ API
app.use("/api/", apiLimiter);
// Giới hạn 10 lần đăng nhập/15 phút cho login endpoint
app.use("/api/auth/login", loginLimiter);

/* ================= SWAGGER API DOCS ================= */
const setupSwagger = require('./swagger');
setupSwagger(app);

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
app.use(express.static(path.join(__dirname, "../public"), { maxAge: 0, etag: false }));

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

/* ================= DB TEST ================= */
app.get("/api/db-test", async (req, res) => {
    try {
        const [result] = await db.query("SELECT 1");
        res.json({ status: "success", message: "Database connected", data: result });
    } catch (err) {
        console.error(err);
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

/* ================= ERROR HANDLER ================= */
app.use((err, req, res, next) => {
    console.error("SERVER ERROR:", err);
    res.status(500).json({ message: "Internal server error" });
});

/* ── Socket.io Seat Lock Manager ── */
const seatLocks = new Map(); // key: "tripId_seatId", value: { userId, socketId, lockedAt }
const LOCK_TIMEOUT = 5 * 60 * 1000; // 5 minutes

io.on('connection', (socket) => {
    console.log(`🔌 Socket connected: ${socket.id}`);

    // Lock a seat
    socket.on('seat:lock', ({ tripId, seatId, userId }) => {
        const key = `${tripId}_${seatId}`;
        const existing = seatLocks.get(key);

        if (existing && existing.socketId !== socket.id) {
            socket.emit('seat:lock_denied', { seatId, message: 'Ghế đang được người khác chọn' });
            return;
        }

        seatLocks.set(key, { userId, socketId: socket.id, lockedAt: Date.now() });

        io.to(`trip_${tripId}`).emit('seat:locked', { seatId, lockedBy: userId === null ? 'anonymous' : userId });

        setTimeout(() => {
            const lock = seatLocks.get(key);
            if (lock && lock.socketId === socket.id) {
                seatLocks.delete(key);
                io.to(`trip_${tripId}`).emit('seat:released', { seatId });
            }
        }, LOCK_TIMEOUT);
    });

    // Unlock a seat
    socket.on('seat:unlock', ({ tripId, seatId }) => {
        const key = `${tripId}_${seatId}`;
        const lock = seatLocks.get(key);
        if (lock && lock.socketId === socket.id) {
            seatLocks.delete(key);
            io.to(`trip_${tripId}`).emit('seat:released', { seatId });
        }
    });

    // Join trip room
    socket.on('trip:join', ({ tripId }) => {
        socket.join(`trip_${tripId}`);
        const lockedSeats = [];
        seatLocks.forEach((lock, key) => {
            if (key.startsWith(`${tripId}_`)) {
                const seatId = key.replace(`${tripId}_`, '');
                lockedSeats.push({ seatId });
            }
        });
        socket.emit('seat:current_locks', lockedSeats);
    });

    // On disconnect, release all locks by this socket
    socket.on('disconnect', () => {
        const toRelease = [];
        seatLocks.forEach((lock, key) => {
            if (lock.socketId === socket.id) toRelease.push(key);
        });
        toRelease.forEach(key => {
            const [tripId] = key.split('_');
            const seatId = key.replace(`${tripId}_`, '');
            seatLocks.delete(key);
            io.to(`trip_${tripId}`).emit('seat:released', { seatId });
        });
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

/* ================= START SERVER ================= */
const PORT = 2704;
server.listen(PORT, () => {
    console.log("=================================");
    console.log("🚀 SmartBus Server Running");
    console.log(`🌐 http://localhost:${PORT}`);
    console.log("=================================");
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n❌ Port ${PORT} đang bị chiếm!`);
        console.error(`👉 Chạy lệnh này để kill process cũ rồi thử lại:`);
        console.error(`   powershell -Command "Get-Process node | Stop-Process -Force"`);
        console.error(`   node server/server.js\n`);
    } else {
        console.error('Server error:', err);
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
console.log('📧 [Email] Trip reminder scheduler started (every 10 min)');

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
    console.log(`⏰ [AutoTrip] Lên lịch tạo chuyến lúc ${next.toLocaleTimeString("vi-VN")}`);
}
scheduleAtMidnight(tripCtrl.autoGenerateRecurringTrips);

// Kiểm tra mỗi 1 phút: nếu hết chuyến OPEN có thể đặt → advance ngay sang ngày mai
setInterval(tripCtrl.checkAndAdvanceIfNeeded, 60 * 1000);
console.log("🔄 [AutoTrip] Polling 1 phút/lần — tự động render chuyến ngày mai khi hết OPEN.");
