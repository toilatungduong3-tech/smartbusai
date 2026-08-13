# SMARTBUSAI — TECHNICAL REPORT
**Hệ thống Đặt Vé Xe Buýt Liên Tỉnh Thông Minh**
Generated: 2026-08-13 | Source-of-truth: Codebase audit

---

## 1. TỔNG QUAN DỰ ÁN

SmartBusAI là một nền tảng đặt vé xe buýt liên tỉnh tích hợp trí tuệ nhân tạo, phục vụ ba nhóm người dùng: **Hành khách**, **Nhà xe (Operator)**, và **Quản trị viên (Admin)**.

| Chỉ tiêu | Giá trị |
|---|---|
| Loại hệ thống | Web Application (MVC) |
| Ngôn ngữ Backend | JavaScript (Node.js) |
| Framework Backend | Express.js ^5.2.1 |
| Ngôn ngữ Frontend | Vanilla HTML/CSS/JavaScript |
| Database | MySQL (mysql2/promise pool) |
| Cổng máy chủ | 2704 |
| Phiên bản Node tối thiểu | Node 18+ (native ESM + socket.io) |

---

## 2. KIẾN TRÚC HỆ THỐNG

```
┌─────────────────────────────────────────────────────────────┐
│                      CLIENT LAYER                           │
│  /public/pages/{admin, operator, passenger, auth}/*.html    │
│  Vanilla JS + /public/js/api.js (shared utilities)          │
│  PWA Service Worker (public/sw.js)                          │
└───────────────────────┬─────────────────────────────────────┘
                        │ HTTP / WebSocket (Socket.io)
┌───────────────────────▼─────────────────────────────────────┐
│                   EXPRESS SERVER (port 2704)                 │
│  server/server.js                                           │
│  ├── 18 Route Modules (/api/*)                              │
│  ├── Socket.io (seat locking)                               │
│  ├── Rate Limiting (helmet + express-rate-limit)            │
│  ├── CORS (whitelist)                                       │
│  ├── Swagger Docs (/api-docs)                               │
│  └── Static File Server (/public)                           │
└───────────────────────┬─────────────────────────────────────┘
                        │ mysql2/promise pool
┌───────────────────────▼─────────────────────────────────────┐
│                   MySQL DATABASE                             │
│  Database: smartbusai | Port: 3306                          │
│  13 Tables + loyalty_transactions (runtime-created)         │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. STACK CÔNG NGHỆ

### Backend Dependencies (package.json verified)

| Package | Version | Mục đích |
|---|---|---|
| express | ^5.2.1 | HTTP framework |
| mysql2 | latest | MySQL driver (Promise pool) |
| bcryptjs | latest | Password hashing (salt=12) |
| jsonwebtoken | latest | JWT auth (access 15m + refresh 7d) |
| socket.io | latest | Real-time seat locking |
| openai | latest | AI API client (Anthropic Claude) |
| nodemailer | latest | Trip reminder emails |
| qrcode | latest | QR ticket generation |
| express-rate-limit | latest | API rate limiting |
| helmet | latest | HTTP security headers |
| swagger-jsdoc | latest | API documentation generation |
| swagger-ui-express | latest | Swagger UI |
| google-auth-library | latest | Google OAuth support |
| cors | latest | CORS middleware |
| dotenv | latest | Environment variables |

### Dev Dependencies

| Package | Mục đích |
|---|---|
| jest | Unit testing |
| nodemon | Dev auto-restart |

### Frontend (No NPM packages — pure static)
- Vanilla HTML5, CSS3, JavaScript ES6+
- No React, Vue, Angular, or any framework
- Font Awesome icons (CDN)
- Chart.js (CDN — admin/operator dashboards)

---

## 4. CẤU TRÚC THƯ MỤC

```
D:/smartbusai/
├── server/
│   ├── server.js                    # Entry point
│   ├── config/
│   │   ├── db.js                    # MySQL pool
│   │   ├── migrate.js               # Schema migration runner
│   │   ├── payment.config.js        # MoMo/ZaloPay/VNPay config
│   │   ├── migrate_v3.sql           # V3 migrations
│   │   └── migrate_v4.sql           # V4 migrations
│   ├── controllers/                 # 14 controllers
│   ├── routes/                      # 16 route modules
│   ├── middleware/
│   │   └── authMiddleware.js        # JWT verify + role guard
│   ├── services/
│   │   ├── paymentService.js        # MoMo, ZaloPay, VNPay
│   │   ├── pricingEngine.js         # Dynamic pricing
│   │   ├── loyaltyService.js        # Loyalty points
│   │   ├── emailService.js          # Nodemailer
│   │   └── qrService.js             # QR code generation
│   ├── ai/
│   │   ├── recommendation.js        # Collaborative filtering + analytics
│   │   └── transitRouter.js         # BFS/Dijkstra multi-hop routing
│   └── swagger.js                   # Swagger config
├── public/
│   ├── css/style.css                # Global styles
│   ├── js/api.js                    # Shared client utilities
│   ├── sw.js                        # PWA service worker
│   └── pages/
│       ├── admin/                   # 5 admin pages
│       ├── operator/                # 7 operator pages
│       ├── passenger/               # 6 passenger pages
│       └── auth/                    # 3 auth pages
├── tests/
│   ├── transitRouter.test.js
│   └── sprint3.test.js
└── docs/                            # Documentation output
```

---

## 5. MODULE AI

### 5.1 Transit Router (`server/ai/transitRouter.js`)
- **Thuật toán**: BFS có trọng số + Dijkstra-like shortest path
- **Tối đa**: 3 chặng (A→B→C→D), 5 phương án kết quả
- **Chuyển tiếp**: tối thiểu 30 phút, tối đa 16 giờ
- **Virtual trips**: chiếu tuyến thực tế ±16 ngày để tìm kết nối
- **Optimize modes**: `time` (tổng thời gian), `cost` (tổng chi phí), `hops` (ít chặng nhất)
- **City matching**: Haversine distance + normCity() so sánh gần đúng

### 5.2 Recommendation Engine (`server/ai/recommendation.js`)
- **Collaborative Filtering**: User-based (tìm người dùng tương đồng → gợi ý tuyến)
- **Cold start**: fallback sang tuyến phổ biến toàn cục khi user chưa có lịch sử
- **Price Prediction**: Linear regression trên lịch sử giá 60 ngày
- **Demand Forecasting**: Phân tích theo ngày trong tuần + occupancy rate
- **NLP Classification**: Phân loại yêu cầu hỗ trợ

### 5.3 Dynamic Pricing (`server/services/pricingEngine.js`)
- Multiplier theo `days_until_departure`:
  - >14 ngày: -15% (early bird)
  - >7 ngày: -8%
  - >3 ngày: 0% (base)
  - >1 ngày: +10%
  - Ngày khởi hành: +18%
- Multiplier theo `occupancy_rate`:
  - >90%: +20%
  - >75%: +12%
  - >50%: +5%
  - <20%: -10%

### 5.4 AI Chat (Frontend — `public/pages/passenger/index.html`)
- Sử dụng OpenAI SDK (Anthropic Claude API) gọi trực tiếp từ frontend
- Context: thông tin tuyến xe, lịch trình thực tế từ API
- Model: cấu hình từ frontend (không hardcode trong backend)

---

## 6. LUỒNG XÁC THỰC

```
Login → bcrypt.compare() → JWT pair (access 15m + refresh 7d)
     → localStorage: { user, user_id, token, refreshToken }
     → Role redirect: ADMIN→/admin/admin.html
                      OPERATOR→/operator/operator.html
                      PASSENGER→/passenger/index.html

Protected API: Bearer token → authMiddleware.js → jwt.verify()
             → Role check → controller
```

- **Không dùng cookie** — localStorage session
- **Password reset**: check email → hash mới → UPDATE (không dùng OTP/token reset)
- **Google OAuth**: google-auth-library có trong dependencies (chưa xác nhận integration hoàn chỉnh)

---

## 7. REAL-TIME & SOCKET.IO

```
Client joins room: "trip_<trip_id>"
Client locks seat: { tripId, seatId, userId } → server broadcasts "seat_locked"
Server: seatLocks Map { key: "tripId_seatId" → { userId, timer } }
Timer: 5 phút → auto-release → broadcast "seat_released"
Confirm booking: clear lock → broadcast "seat_confirmed"
```

---

## 8. BẢO MẬT

| Biện pháp | Chi tiết |
|---|---|
| Rate limiting | 200 req/min global, 10 logins/15min |
| Helmet | HTTP security headers (CSP disabled cho inline scripts) |
| CORS | Whitelist: localhost:2704, localhost:3000, localhost:5500 |
| bcrypt | salt=12 |
| JWT | HS256, secret từ .env |
| SQL Injection | Parameterized queries (mysql2 prepared statements) |
| Input validation | Kiểm tra ở controller level |

---

## 9. EMAIL & THÔNG BÁO

- **Trigger**: Cronjob mỗi 10 phút trong `server.js`
- **Logic**: Tìm chuyến khởi hành trong 2-24h, chưa gửi nhắc
- **Transport**: nodemailer + SMTP (cấu hình qua .env)
- **Nội dung**: Thông tin chuyến + QR code đính kèm

---

## 10. PWA

- Service Worker: `public/sw.js`
- Cache-first strategy
- Offline support cho static assets
- Manifest: chưa xác nhận file `manifest.json`

---

## 11. CI/CD

- File: `.github/workflows/ci-cd.yml`
- Chi tiết: đã được cập nhật (xem git status)
- Môi trường: GitHub Actions
- Tests: `npm test` (jest)

---

## 12. HẠN CHẾ KỸ THUẬT ĐÃ XÁC NHẬN

1. **Frontend gọi AI trực tiếp**: API key của Anthropic Claude được gọi từ browser — lộ key trong client-side code (thiếu proxy layer)
2. **Password reset không OTP**: Ai biết email người dùng có thể reset mật khẩu
3. **localStorage session**: Không có server-side session invalidation
4. **Virtual trips**: Trip ID dạng `"123_v5"` không tồn tại trong DB — không thể đặt vé trực tiếp cho virtual trip
5. **CSP disabled**: `helmet` không enforce CSP vì frontend dùng inline scripts
6. **loyaltyService**: Tự tạo bảng `loyalty_transactions` khi runtime — không có trong schema chính
7. **Migrate migrations**: migrate_v3.sql và migrate_v4.sql tồn tại nhưng chưa xác nhận đã apply vào production schema
