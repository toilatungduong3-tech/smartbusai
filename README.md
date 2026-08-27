# 🚌 SmartBusAI

<div align="center">

**Hệ thống tìm kiếm và gợi ý hành trình xe khách thông minh — Smart Bus Search & Booking Platform**

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express.js-5.x-000000?style=for-the-badge&logo=express&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-8.0-4479A1?style=for-the-badge&logo=mysql&logoColor=white)
![Socket.io](https://img.shields.io/badge/Socket.io-4.x-010101?style=for-the-badge&logo=socketdotio&logoColor=white)
![Jest](https://img.shields.io/badge/Tests-800%20passing-15c213?style=for-the-badge&logo=jest&logoColor=white)
![License](https://img.shields.io/badge/License-ISC-blue?style=for-the-badge)

*Nền tảng đặt vé xe khách liên tỉnh: tìm kiếm trực tiếp + đa chặng, chọn ghế realtime, thanh toán đa cổng, và các cơ chế hỗ trợ phân tích/gợi ý dựa trên dữ liệu thật.*

</div>

---

## 📋 Mục lục

- [Giới thiệu](#-giới-thiệu)
- [Tính năng nổi bật](#-tính-năng-nổi-bật)
- [Kiến trúc hệ thống](#-kiến-trúc-hệ-thống)
- [Cài đặt & Khởi chạy](#-cài-đặt--khởi-chạy)
- [Tài khoản demo](#-tài-khoản-demo)
- [Hướng dẫn sử dụng chi tiết](#-hướng-dẫn-sử-dụng-chi-tiết)
- [Cấu trúc thư mục](#-cấu-trúc-thư-mục)
- [API Documentation](#-api-documentation)
- [Socket.io Events](#-socketio-events)
- [Kiểm thử tự động](#-kiểm-thử-tự-động)
- [Xử lý sự cố thường gặp](#-xử-lý-sự-cố-thường-gặp)
- [Luồng xác thực](#-luồng-xác-thực-auth-flow)
- [Công nghệ sử dụng](#-công-nghệ-sử-dụng)
- [Chạy với Docker](#-chạy-với-docker)
- [Đóng góp](#-đóng-góp)
- [Hướng phát triển](#-hướng-phát-triển)

---

## 🎯 Giới thiệu

**SmartBusAI** là hệ thống web hỗ trợ tìm kiếm hành trình, lựa chọn chuyến xe và thực hiện các nghiệp vụ đặt vé xe khách liên tỉnh, xây dựng trên Node.js + Express.js (backend) và HTML/CSS/JavaScript thuần — không dùng framework frontend (React/Vue/Angular). Hệ thống phục vụ ba nhóm người dùng: **Hành khách**, **Nhà xe (Operator)** và **Quản trị viên (Admin)**, mỗi nhóm có cổng giao diện riêng trên cùng một backend và cơ sở dữ liệu MySQL dùng chung.

Ngoài tìm kiếm chuyến trực tiếp, hệ thống có một engine tìm kiếm **đa chặng** (ghép nối 2+ chuyến khi không có tuyến trực tiếp, dùng MinHeap + ràng buộc thời gian chờ chuyển tiếp ≥30 phút — xem `server/ai/transitRouter.js`), cơ chế **giữ ghế thời gian thực** qua Socket.io kết hợp khoá ở tầng CSDL, và các module **hỗ trợ phân tích/gợi ý** (điểm ý định đặt vé, dự báo nhu cầu, xếp hạng kết quả tìm kiếm) — đây là các công thức thống kê/rule-based có thể giải thích và kiểm thử được, **không phải mô hình machine learning đã huấn luyện**.

> 📄 Báo cáo rà soát kỹ thuật đầy đủ (kiến trúc, 24 bảng CSDL, 166 API endpoint, 400+ luồng hoạt động, 41 test suite) nằm tại [`report.html`](report.html) — mở trực tiếp bằng trình duyệt.

---

## ✨ Tính năng nổi bật

### 👤 Dành cho Hành khách
- 🔍 **Tìm kiếm chuyến trực tiếp & đa chặng** — lọc theo điểm đi/đến, ngày, loại xe, khoảng giá
- 💺 **Chọn ghế realtime** — khoá ghế tạm thời qua Socket.io, sơ đồ ghế 2D + panorama 3D (Three.js)
- 🗺️ **Bản đồ & trực quan hoá lộ trình** — Leaflet.js, polyline lộ trình thật qua OSRM, mô phỏng hành trình theo thời gian
- 💰 **Giá động (dynamic pricing)** — giảm giá đặt sớm, phụ thu giờ chót, điều chỉnh theo độ lấp đầy ghế
- 🎁 **Hạng thành viên & đổi điểm** — 4 hạng (Đồng/Bạc/Vàng/Bạch Kim), đổi điểm lấy voucher vé miễn phí (lưu trữ server-side thật)
- 🔐 **Xác thực 2 lớp (2FA/TOTP)** — server-side thật, mã hoá AES-256-GCM, không phải mô phỏng client
- 💳 **Thanh toán đa cổng** — MoMo, VNPay, ZaloPay, VietQR (chữ ký HMAC thật; đang chạy môi trường sandbox, xem mục Hướng phát triển)
- 📱 **QR Code vé** — sinh + xác thực bằng checksum HMAC, soát vé bằng camera ở cổng Nhà xe
- 🤖 **Trợ lý AI & Concierge đặt vé** — NLU tiếng Việt trích intent (tuyến/ngày/loại xe), qua backend proxy `/api/ai/chat` (không lộ API key ra trình duyệt)
- 📧 **Email tự động** — xác nhận đặt vé, huỷ vé, nhắc lịch trình trước giờ khởi hành
- ⭐ **Đánh giá chuyến đi & nhà xe** sau khi hoàn thành

### 🚌 Dành cho Nhà xe (Operator)
- 📊 **Dashboard doanh thu** trực quan (Chart.js) — theo ngày/tuần/tháng, theo tuyến, theo loại xe
- 🗓️ **Quản lý chuyến xe** — tạo/sửa/huỷ, theo dõi chuyến đang chạy realtime, cập nhật ETA
- 🚍 **Quản lý phương tiện** — CRUD xe, tự sinh sơ đồ ghế theo loại xe (Dynamic Seat Layout Engine)
- 💺 **Sửa loại ghế hàng loạt** theo hàng/cột, không cần sửa từng ghế
- 🚫 **Chặn xe chạy trùng khung giờ** — một xe không thể được gán cho 2 chuyến có thời gian chồng lấn, kiểm tra cả khi tạo lẫn khi sửa chuyến
- 📋 **Theo dõi & xử lý đặt chỗ**, xác nhận thanh toán thủ công
- 📱 **Quét QR Code** xác nhận vé lên xe (camera hoặc nhập mã tay)

### 🛡️ Dành cho Admin
- 👥 **Quản lý người dùng** — CRUD, khoá/mở khoá, gán vai trò & liên kết nhà xe, import CSV hàng loạt
- 🏢 **Quản lý nhà xe** — duyệt, đình chỉ, điểm AI Trust Score
- 📈 **Thống kê toàn hệ thống** — 10 tab dashboard (tổng quan, doanh thu, chuyến xe, người dùng, đặt vé, tuyến đường, AI & hành vi, đánh giá, AI Engine, tìm kiếm)
- 🤖 **AI Engine** — dự báo doanh thu, phát hiện bất thường, heatmap booking, dự đoán giá theo tuyến
- 🗺️ **Import tuyến đường hàng loạt** từ CSV/Excel, có bước xem trước
- 🆘 **Xử lý ticket hỗ trợ** — Kanban/danh sách, mẫu trả lời, phân loại bằng AI
- ⚙️ **Cấu hình hệ thống** — phí dịch vụ (trần 0–2%), phụ thu VIP, chính sách đặt vé/bảo mật, chế độ bảo trì
- 🧪 **Defense Dashboard** — health-check realtime, chạy trực tiếp 3 kịch bản demo kỹ thuật (AI Concierge, chống đặt trùng ghế, transit đa chặng)

### ⚙️ Tính năng kỹ thuật & bảo mật
- 🔄 **Migration tự động** khi khởi động server — `server/config/migrate.js` chạy tuần tự `migrate_v2.sql` → `migrate_v24.sql`, xác minh schema, fail-fast nếu thiếu
- 🌱 **Seed dữ liệu tuyến/chuyến tự động** — `server/config/seed_full.js`, idempotent (bỏ qua nếu đã có dữ liệu)
- 🔒 **Rate limiting theo tầng** — toàn API, đăng nhập, thanh toán, AI, 2FA đều có giới hạn riêng
- 🛡️ **Helmet CSP whitelist**, sanitize input chống XSS đệ quy (trừ field chữ ký thanh toán)
- 🔐 **Mã hoá PII at-rest** — CCCD/số định danh mã hoá AES-256-GCM trong CSDL, không lưu plaintext
- 🎫 **Token versioning** — logout/đổi mật khẩu thu hồi thật mọi token cũ, không chỉ xoá phía client
- 🚦 **Chống race condition** — advisory lock (`GET_LOCK`) theo bus_id khi tạo/sửa chuyến, khoá ghế Socket.io + backstop unique key ở tầng CSDL khi đặt vé
- 📖 **Swagger API Docs** tại `/api-docs`
- 💾 **Cache-aside** (Redis, tự fallback in-memory nếu không có Redis) cho các endpoint công khai
- 🧹 **Tự dọn booking bỏ dở** (PENDING quá 15 phút), tự advance trạng thái chuyến, tự sinh chuyến lặp lại hằng ngày — 4 tiến trình nền chạy bằng `setInterval` trong tiến trình Express

---

## 🏗️ Kiến trúc hệ thống

```
┌───────────────────────────────────────────────────────────┐
│                      CLIENT (Browser)                      │
│  ┌──────────┐   ┌──────────┐   ┌──────────────────────┐   │
│  │  Admin   │   │ Operator │   │      Passenger        │   │
│  │ (6 trang)│   │ (7 trang)│   │      (6 trang)        │   │
│  └────┬─────┘   └────┬─────┘   └──────────┬────────────┘   │
│       └──────────────┴────────────────────┘                │
│           /js/api.js (fetch wrapper, cache, auto-refresh)   │
└──────────────────────────┬──────────────────────────────────┘
                            │ HTTP / WebSocket
┌───────────────────────────▼──────────────────────────────────┐
│                EXPRESS.JS SERVER (port 2704)                  │
│  requestId → helmet → compression → cors → sanitizeInput      │
│  → apiLimiter → 20 nhóm route (/api/auth, /api/trips, ...)     │
│  ┌────────────┐  ┌───────────────┐  ┌───────────────────┐    │
│  │ Controllers│  │  Middleware    │  │     Services       │    │
│  │  (20 file) │  │ auth, RBAC,    │  │ payment, loyalty,   │    │
│  │            │  │ operatorScope  │  │ pricing, qr, email, │    │
│  └────────────┘  └───────────────┘  │ totp, piiCrypto,    │    │
│  ┌──────────────────┐                │ anthropicService     │    │
│  │   Socket.io       │                └───────────────────┘    │
│  │ (giữ ghế realtime) │  4 tiến trình nền (setInterval):        │
│  └──────────────────┘  nhắc lịch · auto-advance · auto-trip ·   │
│                         dọn booking bỏ dở                       │
└───────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼───────────────────────────────────┐
│                   MySQL 8.0 (port 3306) — 24 bảng                │
│         Database: smartbusai · migrate.js quản lý version        │
└───────────────────────────────────────────────────────────────┘
```

---

## 🚀 Cài đặt & Khởi chạy

### Yêu cầu hệ thống

| Công cụ | Phiên bản | Ghi chú |
|---------|-----------|---------|
| Node.js | >= 18.x   | cần `fetch` toàn cục (dùng cho backend AI proxy) |
| npm     | >= 9.x    | |
| MySQL   | >= 8.0    | |
| Redis   | tuỳ chọn  | không có vẫn chạy được — tự fallback cache in-memory |

### Bước 1 — Clone repository & cài dependencies

```bash
git clone <repository-url>
cd smartbusai
npm install
```

### Bước 2 — Tạo database

```sql
CREATE DATABASE smartbusai CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Import schema + dữ liệu nền:

```bash
mysql -u root smartbusai < smartbusai.sql
```

### Bước 3 — Cấu hình biến môi trường

Sao chép file mẫu rồi điền giá trị:

```bash
cp .env.example .env
```

Các biến **bắt buộc** để chạy được ở mức tối thiểu:

```dotenv
PORT=2704
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=smartbusai
JWT_SECRET=<chuỗi ngẫu nhiên bất kỳ, càng dài càng tốt>
```

Các biến **tuỳ chọn** (bỏ trống vẫn chạy được, tính năng liên quan tự fallback an toàn — xem comment chi tiết trong `.env.example`):

| Biến | Nếu bỏ trống thì sao |
|------|----------------------|
| `QR_SECRET`, `PII_ENCRYPTION_KEY` | Server tự sinh khoá ngẫu nhiên mỗi lần khởi động (cảnh báo ra log) — QR/CCCD mã hoá trước đó sẽ không đọc lại được sau khi restart. Đặt cố định nếu cần dữ liệu tồn tại qua nhiều lần chạy |
| `ANTHROPIC_API_KEY` | 2 tính năng trợ lý AI (trang chủ hành khách, ticket hỗ trợ Admin) tự động chạy bằng engine rule-based cục bộ thay vì gọi LLM thật |
| `MOMO_*`, `VNPAY_*`, `VIETQR_*` | Dùng credential sandbox công khai mặc định — thanh toán demo hoạt động ở mức logic/chữ ký, không thể thanh toán bằng ví thật |
| `GOOGLE_CLIENT_ID`, `FACEBOOK_APP_ID`/`FACEBOOK_APP_SECRET` | Ẩn nút đăng nhập Google/Facebook, đăng nhập email/mật khẩu vẫn hoạt động bình thường |
| `SMTP_*` | Email xác nhận/nhắc lịch bị bỏ qua (không lỗi), các luồng khác không bị ảnh hưởng |
| `REDIS_URL`/`REDIS_HOST` | Cache tự fallback in-memory |

### Bước 4 — Khởi chạy server

```bash
# Development (auto-reload khi sửa code, dùng nodemon)
npm run dev

# Production (không auto-reload — sửa code backend phải tắt/bật lại thủ công)
npm start
```

Khi khởi động, server sẽ tự động, theo đúng thứ tự:
1. Kết nối MySQL
2. Chạy migration (`migrate_v2.sql` → `migrate_v24.sql`), xác minh schema — **server sẽ dừng và báo lỗi rõ ràng nếu migration thất bại**, không âm thầm chạy tiếp trên schema thiếu
3. Seed dữ liệu tuyến/điểm dừng/chuyến xe nếu CSDL còn trống (bỏ qua nếu đã có — an toàn chạy lại nhiều lần)
4. Khởi động 4 tiến trình nền (nhắc lịch email, tự sinh chuyến, auto-advance trạng thái, dọn booking bỏ dở)
5. Lắng nghe HTTP + Socket.io tại `http://localhost:2704`

### Bước 5 — Dừng / khởi động lại server (khi sửa code backend ở chế độ `npm start`)

`npm start` **không** có hot-reload — mọi thay đổi trong `server/` cần tắt hẳn tiến trình cũ rồi chạy lại:

```bash
# Windows — tìm PID đang giữ cổng 2704 rồi kill
netstat -ano | findstr :2704
taskkill /PID <pid> /F

# rồi chạy lại
npm start
```

Nếu dùng `npm run dev` (nodemon) thì không cần bước này — nodemon tự restart khi phát hiện file `.js` trong `server/` thay đổi.

### Bước 6 — Truy cập ứng dụng

| URL | Mô tả |
|-----|-------|
| `http://localhost:2704` | Trang chủ (redirect theo trạng thái đăng nhập) |
| `http://localhost:2704/pages/auth/login.html` | Đăng nhập |
| `http://localhost:2704/pages/auth/register.html` | Đăng ký tài khoản Hành khách |
| `http://localhost:2704/api-docs` | Swagger API Docs |
| `http://localhost:2704/api/health` | Health-check (DB latency, uptime, RAM, trạng thái migration) |

---

## 👤 Tài khoản demo

Hệ thống **không** có tài khoản demo với mật khẩu cố định sẵn trong mã nguồn — mật khẩu các tài khoản ADMIN/OPERATOR có sẵn trong dữ liệu seed đã được băm (bcrypt) và không thể suy ngược. Có 2 cách hợp lệ để có tài khoản dùng thử:

**Cách 1 — Tự đăng ký tài khoản Hành khách** (không cần thao tác gì thêm):
Vào `/pages/auth/register.html`, đăng ký bình thường — được tạo với role `PASSENGER` ngay lập tức.

**Cách 2 — Đặt lại mật khẩu cho tài khoản ADMIN/OPERATOR có sẵn**, dùng script tiện ích đi kèm:

```bash
# Đặt lại mật khẩu cho 1 tài khoản đã tồn tại
node scripts/reset_demo_password.js admin@gmail.com "MatKhauMoi123"

# Hoặc tạo mới hẳn 1 tài khoản với role chỉ định (nếu email chưa tồn tại)
node scripts/reset_demo_password.js demo.operator@smartbusai.vn "MatKhauMoi123" --create OPERATOR
```

Sau khi chạy, đăng nhập bình thường bằng email + mật khẩu vừa đặt tại `/pages/auth/login.html`. Vai trò `OPERATOR` cần được gán `operator_id` liên kết với một nhà xe thật để dashboard hiển thị dữ liệu — có thể gán qua trang Admin → Người dùng, hoặc trực tiếp: `UPDATE users SET operator_id=<id nhà xe> WHERE email='...'`.

> ⚠️ Không dùng script này hoặc bất kỳ tài khoản demo nào cho môi trường production thật.

---

## 📚 Hướng dẫn sử dụng chi tiết

### Với vai trò Hành khách

1. **Tìm chuyến**: tại trang chủ, nhập điểm đi/đến/ngày → nhấn "Tìm chuyến xe". Kết quả hiện cả chuyến trực tiếp và các phương án ghép chặng trung chuyển nếu không có chuyến thẳng.
2. **Xem chi tiết & lộ trình**: nhấn "🗺 Xem lộ trình" trên 1 chuyến để mở bản đồ mô phỏng hành trình theo thời gian thực (2D Leaflet hoặc canvas 3D cách điệu).
3. **Đặt vé nhanh ngay trang chủ**: dùng widget "Đặt vé thông minh" — nhập tiêu chí, hệ thống tự đề xuất chuyến phù hợp trong ngân sách, chọn ghế và đặt luôn không cần chuyển trang.
4. **Đặt vé đầy đủ**: nhấn vào 1 chuyến → trang `booking.html` → chọn ghế trên sơ đồ 2D (hoặc bấm "Xem 3D" để vào chế độ panorama nội thất xe) → áp voucher/mã giảm giá nếu có → chọn phương thức thanh toán → xác nhận.
5. **Quản lý tài khoản**: trang Hồ sơ (`profile.html`) có 4 tab — Thông tin cá nhân, Vé đã đặt (xem/huỷ/thanh toán/xem QR), Thống kê cá nhân, và AI & Bản đồ hành trình.
6. **Bật xác thực 2 bước**: trong tab Thông tin → mục Bảo mật → "Bật 2FA" → quét QR bằng ứng dụng Authenticator (Google Authenticator, Authy...) → nhập mã 6 số để xác nhận → lưu lại 8 mã dự phòng.
7. **Đổi điểm lấy voucher**: trong tab Vé đã đặt, mục điểm thưởng → "Đổi điểm" → chọn phần thưởng (1/2/3 vé miễn phí) → xác nhận. Voucher tạo ra dùng được ngay ở trang đặt vé kế tiếp.
8. **Soát vé lên xe**: xuất trình mã QR trong "Xem vé QR" cho nhân viên nhà xe quét.

### Với vai trò Nhà xe (Operator)

1. **Đăng nhập** → chuyển thẳng tới `operator.html` (dashboard doanh thu/booking/đội xe).
2. **Thêm xe mới**: `vehicles.html` → "＋ Thêm xe mới" → nhập biển số, loại xe, số ghế — hệ thống tự sinh sơ đồ ghế phù hợp loại xe.
3. **Tạo chuyến xe**: `trips.html` → "＋ Thêm chuyến xe" → chọn tuyến, xe, thời gian, giá. Hệ thống tự chặn nếu xe đã có chuyến khác trùng khung giờ (báo lỗi kèm mã chuyến xung đột).
4. **Sửa/di chuyển giờ chuyến hiện có**: cùng validate như trên — đổi giờ hoặc đổi xe cho 1 chuyến đã tồn tại vẫn bị chặn nếu gây trùng lịch xe.
5. **Theo dõi chuyến đang chạy**: chip "Đang chạy" trong `trips.html` — có thể cập nhật ETA, đánh dấu đã đến nơi, kích hoạt SOS khẩn cấp.
6. **Sửa loại ghế hàng loạt**: `seats.html` → chọn xe/chuyến → chọn cả 1 hàng hoặc 1 cột ghế → gán loại (Thường/VIP) → "Lưu thay đổi" (gộp thành 1 request, không phải sửa từng ghế).
7. **Xử lý đặt chỗ**: `bookings.html` — xác nhận thanh toán thủ công (tiền mặt) hoặc huỷ vé.
8. **Soát vé**: `scan.html` — quét QR bằng camera hoặc nhập mã tay để xác thực vé khi khách lên xe.

### Với vai trò Admin

1. **Dashboard tổng quan**: `admin.html` — 10 tab thống kê, mỗi tab tải dữ liệu lazy khi click lần đầu.
2. **Quản lý người dùng**: `users.html` — tìm kiếm, lọc theo vai trò, khoá/mở khoá hàng loạt, import CSV, gán `operator_id` cho tài khoản OPERATOR.
3. **Quản lý nhà xe**: `operators.html` — duyệt/đình chỉ, xem điểm AI Trust Score tổng hợp từ dữ liệu thật.
4. **Import tuyến đường hàng loạt**: trong `admin.html` tab Tuyến đường → "📥 Import CSV/Excel" → xem trước → xác nhận.
5. **Cấu hình hệ thống**: `settings.html` — 7 nhóm cài đặt (Chung, Thanh toán, Đặt vé, AI, Bảo mật, Thông báo, Hệ thống & Log). Phí dịch vụ giới hạn cứng 0–2%, không thể vượt qua giao diện lẫn API.
6. **Xử lý hỗ trợ khách hàng**: `support.html` — xem Kanban hoặc danh sách, dùng mẫu trả lời có sẵn hoặc để AI soạn thảo/phân loại.
7. **Demo kỹ thuật trực tiếp**: `defense-dashboard.html` — chạy trực tiếp 3 kịch bản minh hoạ (AI Concierge trả lời từ dữ liệu thật, chống đặt trùng ghế bằng 2 request đồng thời, tìm kiếm đa chặng transit) kèm đo thời gian thực thi — hữu ích khi demo trước hội đồng.

---

## 📁 Cấu trúc thư mục

```
smartbusai/
│
├── 📄 package.json              # Dependencies & scripts
├── 📄 smartbusai.sql            # Database schema nền
├── 📄 .env.example              # Mẫu biến môi trường (đầy đủ comment)
├── 📄 docker-compose.yml        # Docker Compose config (app + MySQL + Redis)
├── 📄 Dockerfile                # Docker image config
├── 📄 Jenkinsfile               # CI/CD pipeline (Jenkins)
├── 📄 report.html               # Báo cáo rà soát kỹ thuật toàn diện
│
├── 📂 scripts/                  # Script tiện ích một-lần / bảo trì dữ liệu
│   ├── 📄 fix-null-data.js
│   ├── 📄 backfill_bus_fleet.js
│   └── 📄 reset_demo_password.js
│
├── 📂 server/                   # Backend (Node.js + Express)
│   ├── 📄 server.js             # Entry point — HTTP + Socket.io + 4 tiến trình nền
│   ├── 📄 swagger.js            # Swagger/OpenAPI setup
│   │
│   ├── 📂 config/
│   │   ├── 📄 db.js             # MySQL connection pool (mysql2/promise)
│   │   ├── 📄 migrate.js        # Chạy + xác minh migration khi khởi động
│   │   ├── 📄 migrate_v2.sql … migrate_v24.sql
│   │   ├── 📄 seed_full.js      # Seed tuyến/điểm dừng/chuyến (idempotent)
│   │   ├── 📄 jwtSecret.js, qrSecret.js, piiKey.js
│   │   └── 📄 payment.config.js # Credential MoMo/VNPay/VietQR
│   │
│   ├── 📂 middleware/
│   │   ├── 📄 authMiddleware.js  # JWT + RBAC guard
│   │   ├── 📄 operatorScope.js   # Cô lập dữ liệu theo tenant (nhà xe)
│   │   ├── 📄 rateLimiter.js
│   │   └── 📄 sanitizeInput.js
│   │
│   ├── 📂 routes/               # 20 nhóm route — xem mục API Documentation
│   ├── 📂 controllers/          # Business logic, 1 file/nhóm route
│   │
│   ├── 📂 services/
│   │   ├── 📄 emailService.js       # Nodemailer
│   │   ├── 📄 qrService.js          # Sinh/xác thực QR vé (HMAC)
│   │   ├── 📄 loyaltyService.js     # Điểm thưởng, hạng, voucher
│   │   ├── 📄 pricingEngine.js      # Giá động
│   │   ├── 📄 paymentService.js     # MoMo/VNPay/ZaloPay/VietQR
│   │   ├── 📄 anthropicService.js   # Backend proxy cho AI chat (Sprint 24)
│   │   ├── 📄 seatLayoutService.js  # Sinh sơ đồ ghế theo loại xe
│   │   ├── 📄 aiIntentPredictor.js  # Booking Intent Score
│   │   ├── 📄 aiDemandForecaster.js # Dự báo nhu cầu theo tuyến
│   │   ├── 📄 aiUserProfilingService.js
│   │   ├── 📄 aiSearchRanking.js
│   │   ├── 📄 bookingCleanup.js     # Dọn booking PENDING bỏ dở
│   │   └── 📄 cacheManager.js       # Cache-aside (Redis + fallback)
│   │
│   ├── 📂 utils/
│   │   ├── 📄 totp.js            # TOTP (RFC 6238) server-side
│   │   ├── 📄 piiCrypto.js       # AES-256-GCM cho CCCD/số định danh
│   │   ├── 📄 dateTime.js        # Time contract (giờ địa phương VN)
│   │   └── 📄 errors.js, pagination.js, logger.js
│   │
│   └── 📂 ai/
│       ├── 📄 transitRouter.js   # Tìm kiếm đa chặng (MinHeap)
│       └── 📄 recommendation.js  # Gợi ý chuyến (explainable scoring)
│
└── 📂 public/                   # Frontend (Static HTML/CSS/JS)
    ├── 📂 pages/
    │   ├── 📂 auth/       login.html, register.html, forgot-password.html
    │   ├── 📂 passenger/  index.html, booking.html, profile.html, hotro.html, nha-xe.html, payment-result.html
    │   ├── 📂 operator/   operator.html, trips.html, vehicles.html, seats.html, bookings.html, revenue.html, scan.html
    │   ├── 📂 admin/      admin.html, users.html, operators.html, support.html, settings.html, defense-dashboard.html
    │   └── 📂 legal/      terms-of-service.html, privacy-policy.html
    │
    ├── 📂 js/
    │   ├── 📄 api.js            # Shared API client (cache, auto-refresh token)
    │   ├── 📄 pricing.js        # applyUserTierDiscount — công thức giá canonical dùng chung FE/BE
    │   ├── 📄 routeInference.js # Suy luận lộ trình hiển thị (không bịa toạ độ)
    │   ├── 📄 mapRouting.js
    │   └── 📄 admin-notif.js
    │
    ├── 📂 css/, 📂 images/, 📂 icons/, 📂 data/
    └── 📄 manifest.json, sw.js  # PWA
```

---

## 📡 API Documentation

API đầy đủ (166 endpoint) có thể xem tại **`http://localhost:2704/api-docs`** (Swagger UI). Dưới đây là 20 nhóm route và mục đích chính — chi tiết method/path/middleware từng endpoint nằm trong [`report.html`](report.html) mục 04.

| Nhóm route | Số endpoint | Mục đích chính |
|------------|:-----------:|-----------------|
| `/api/auth` | 11 | Đăng ký, đăng nhập, refresh/logout, Google/Facebook OAuth, 2FA (setup/verify/disable/login-verify) |
| `/api/trips` | 10 | CRUD chuyến, tìm kiếm, giá động, chống trùng lịch xe |
| `/api/bookings` | 10 | Tạo/huỷ/thanh toán vé, tra cứu khách vãng lai, QR vé |
| `/api/users` | 17 | Hồ sơ, đổi mật khẩu, avatar, loyalty, voucher, hành khách đã lưu |
| `/api/reviews` | 4 | Đánh giá chuyến & nhà xe |
| `/api/admin` | 46 | Thống kê, quản lý booking/tuyến/địa điểm, AI Engine, import CSV |
| `/api/operators` | 13 | CRUD nhà xe, dashboard 9 chỉ số |
| `/api/support` | 4 | Ticket hỗ trợ khách hàng |
| `/api/seats` | 8 | Sơ đồ ghế, sinh ghế, sửa hàng loạt |
| `/api/buses` | 7 | CRUD xe, sơ đồ ghế theo loại xe |
| `/api/settings` | 2 | Cấu hình hệ thống |
| `/api/search` | 5 | Tìm kiếm đa chặng, log tìm kiếm, gợi ý autocomplete |
| `/api/stops` | 5 | Điểm dừng theo tuyến, điểm gần nhất |
| `/api/ai` | 7 | Gợi ý cá nhân hoá, Intent Score, Demand Forecast, **AI chat proxy** |
| `/api/recommendations` | 2 | Gợi ý của chính người dùng đang đăng nhập |
| `/api/locations` | 2 | Autocomplete địa điểm |
| `/api/payment` | 9 | MoMo/VNPay/ZaloPay/VietQR — tạo giao dịch, callback/IPN |
| `/api/ai/concierge` | 1 | AI Booking Concierge (NLU tiếng Việt) |
| `/api/health` | 1 | Health-check production |
| `/api/stats` | 2 | Thống kê công khai realtime cho trang đăng nhập/chủ |

---

## 🔌 Socket.io Events

Dùng để đồng bộ trạng thái giữ ghế theo thời gian thực khi nhiều người cùng chọn ghế trên 1 chuyến — mỗi chuyến là 1 phòng (`trip_${tripId}`).

### Client → Server

| Event | Payload | Mô tả |
|-------|---------|-------|
| `trip:join` | `{ tripId }` | Tham gia phòng theo dõi ghế của chuyến |
| `seat:lock` | `{ tripId, seatId, userId }` | Yêu cầu khoá ghế (tự nhả sau timeout nếu không đặt) |
| `seat:unlock` | `{ tripId, seatId }` | Giải phóng ghế thủ công |

### Server → Client

| Event | Payload | Mô tả |
|-------|---------|-------|
| `seat:locked` | `{ seatId, lockedBy }` | Ghế vừa bị người khác khoá |
| `seat:lock_denied` | `{ seatId, message }` | Bị từ chối khoá — ghế đã có người giữ |
| `seat:unlocked`/`seat:released` | `{ seatId }` | Ghế vừa được giải phóng (thủ công hoặc do huỷ booking) |
| `seat:current_locks` | `[{ seatId, lockedBy }]` | Danh sách ghế đang bị khoá, gửi ngay khi `trip:join` |

---

## 🧪 Kiểm thử tự động

```bash
npm test              # chạy toàn bộ 41 test suite / 800 test case (Jest)
npm test -- --silent  # bớt log console trong lúc chạy
npx jest tests/phase1-time-contract.test.js   # chạy 1 file cụ thể
```

Bộ test bao phủ không chỉ luồng chức năng thông thường mà cả race condition (đặt trùng ghế, trùng lịch xe, đổi điểm 2 lần), IDOR/RBAC, giả mạo giá thanh toán, và regression cho từng bug đã sửa trong quá trình phát triển — chi tiết từng file nằm trong [`report.html`](report.html) mục 05.

---

## 🩺 Xử lý sự cố thường gặp

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|-------------|--------------------------|-------------|
| `EADDRINUSE: address already in use :::2704` | Tiến trình `node server/server.js` cũ chưa tắt hẳn | Windows: `netstat -ano \| findstr :2704` rồi `taskkill /PID <pid> /F` |
| Server dừng ngay khi khởi động, log `Schema verification FAILED` | Migration lỗi giữa chừng (thường do thiếu quyền DB hoặc mất kết nối) | Đọc đúng dòng `missing:` trong log để biết bảng/cột nào chưa có, sửa quyền DB rồi chạy lại `npm start` |
| Đăng nhập báo "Không kết nối được server" dù server đang chạy | CORS hoặc sai `PORT` giữa `.env` và URL truy cập | Đảm bảo truy cập đúng `http://localhost:<PORT trong .env>` |
| Sửa code backend nhưng hành vi không đổi | Đang chạy `npm start` (không hot-reload) với tiến trình cũ | Tắt hẳn tiến trình cũ (xem bảng trên) rồi chạy lại, hoặc chuyển sang `npm run dev` |
| Trình duyệt vẫn hiện giao diện/JS cũ sau khi sửa frontend | Service Worker (PWA) cache trang cũ | DevTools → Application → Service Workers → Unregister, và Clear storage, rồi tải lại trang |
| AI chat luôn trả lời kiểu "rule-based", không giống LLM thật | `ANTHROPIC_API_KEY` chưa cấu hình trong `.env` | Đây là hành vi fallback có chủ đích, không phải lỗi — điền key thật để bật LLM |
| Quét mã MoMo báo lỗi/không thanh toán được bằng ví thật | Đang dùng credential **sandbox** mặc định (`payment.config.js`) | Cần đăng ký merchant MoMo/VNPay thật và điền vào `.env` — xem mục Hướng phát triển |

---

## 🔄 Luồng xác thực (Auth Flow)

```
POST /api/auth/login (email, password)
        │
        ▼
   Tài khoản có bật 2FA?
   ├── Không → trả về { user, accessToken, refreshToken } ngay
   │             → lưu localStorage → điều hướng theo role
   │
   └── Có → trả về { requires2FA: true, pendingToken }
                 (pendingToken KHÔNG dùng được cho bất kỳ API nào khác)
                 │
                 ▼
        Người dùng nhập mã OTP/mã dự phòng
                 │
                 ▼
        POST /api/auth/2fa/login-verify { pendingToken, code }
                 │
                 ▼
        Trả về { user, accessToken, refreshToken } → như trên
```

Mọi trang được bảo vệ bằng `requireLogin()` từ `/js/api.js`; mọi request API kèm `Authorization: Bearer <accessToken>` được `api.js` tự gắn và tự làm mới token hết hạn.

### Shared API Client (`/js/api.js`)

| Hàm | Mô tả |
|-----|-------|
| `api.get(url)` / `api.post(url, data)` / `api.put(url, data)` / `api.delete(url)` | HTTP wrapper — tự gắn Bearer token, tự cache GET an toàn, tự retry sau khi refresh token hết hạn |
| `getUser()` / `getUserId()` / `getRole()` | Đọc session từ localStorage |
| `requireLogin()` | Redirect về login nếu chưa đăng nhập |
| `logout()` | Gọi `POST /api/auth/logout` (thu hồi token thật ở server) rồi xoá session |
| `formatMoney(n)` / `formatDate(d)` | Format hiển thị |
| `showToast(msg, type)` | Toast notification |

---

## 🛠️ Công nghệ sử dụng

### Backend — `dependencies` (17 gói)

| Thư viện | Mục đích thực tế |
|----------|-------------------|
| `express` ^5.2.1 | Web framework — 20 nhóm route |
| `mysql2` ^3.18.2 | MySQL driver (promise pool) |
| `socket.io` ^4.8.3 | Giữ ghế realtime |
| `jsonwebtoken` ^9.0.3 | Access/refresh token + token versioning |
| `bcryptjs` ^3.0.3 | Băm mật khẩu |
| `helmet` ^8.1.0 | Security headers + CSP |
| `cors` ^2.8.6 | CORS policy |
| `express-rate-limit` ^8.3.1 | Rate limit theo tầng (API/login/payment/AI/2FA) |
| `compression` ^1.8.1 | Gzip response |
| `body-parser` ^2.2.2 | Parse body |
| `dotenv` ^17.3.1 | Biến môi trường |
| `winston` ^3.19.0 | Structured logging + trace_id |
| `nodemailer` ^8.0.4 | Gửi email thật |
| `qrcode` ^1.5.4 | Sinh ảnh QR vé |
| `google-auth-library` ^10.9.1 | Xác thực Google Sign-In server-side |
| `ioredis` ^6.0.0 | Cache-aside (tự fallback nếu không có Redis) |
| `swagger-ui-express` ^5.0.1 | Swagger UI tại `/api-docs` |

> ⚠️ `openai` (^6.25.0) có trong `package.json` nhưng **không có file backend nào sử dụng** — trợ lý AI trong ứng dụng gọi Anthropic qua `server/services/anthropicService.js`, không qua gói này.

### Frontend

| Công nghệ | Mô tả |
|-----------|-------|
| Vanilla HTML/CSS/JS (ES6+) | Không dùng framework |
| Three.js r134 | Panorama 3D sơ đồ ghế |
| Leaflet 1.9.4 | Bản đồ lộ trình 2D |
| Chart.js | Biểu đồ dashboard |
| html5-qrcode | Quét QR bằng camera |
| Socket.io Client | Kết nối realtime |
| PWA (Service Worker) | Cache tài nguyên tĩnh |

### DevOps

| Công cụ | Mô tả |
|---------|-------|
| Jest + Supertest | 41 test suite / 800 test case |
| Docker / Docker Compose | Containerization (app + MySQL + Redis) |
| Jenkins | CI/CD pipeline (`Jenkinsfile`) |

---

## 🐳 Chạy với Docker

```bash
docker-compose up --build       # build & chạy toàn bộ stack (app + MySQL + Redis)
docker-compose up -d --build    # chạy nền
docker-compose logs -f          # xem log
docker-compose down             # dừng
```

Sau khi chạy, truy cập `http://localhost:2704`. Biến môi trường cho container đọc từ `.env` cùng cấp `docker-compose.yml`.

---

## 🤝 Đóng góp

1. **Fork** repository này
2. Tạo branch mới: `git checkout -b feature/ten-tinh-nang`
3. Commit: `git commit -m "feat: thêm tính năng X"`
4. Push: `git push origin feature/ten-tinh-nang`
5. Tạo **Pull Request** về nhánh `main`

### Quy ước đặt tên commit

| Prefix | Mô tả |
|--------|-------|
| `feat:` | Tính năng mới |
| `fix:` | Sửa bug |
| `refactor:` | Cải thiện code, không đổi hành vi |
| `docs:` | Cập nhật tài liệu |
| `style:` | Giao diện/CSS |
| `chore:` | Cấu hình, build, tooling |
| `test:` | Thêm/sửa test |

---

## 🗺️ Hướng phát triển

Các hạng mục dưới đây là hạn chế thật của phiên bản hiện tại, không phải khẩu hiệu chung chung — xem chi tiết đầy đủ trong [`report.html`](report.html) mục 06:

- [ ] Đăng ký tài khoản merchant MoMo/VNPay **sandbox thật** để hoàn thiện luồng thanh toán end-to-end (hiện dùng credential sandbox công khai, chữ ký/logic đã đúng chuẩn)
- [ ] Cấu hình `ANTHROPIC_API_KEY` thật trên môi trường triển khai để trợ lý AI dùng LLM thay vì rule-based fallback
- [ ] Chuyển nốt các tính năng còn client-side (SmartBot chat ở trang hỗ trợ, danh sách thiết bị đăng nhập) sang lưu trữ server-side
- [ ] Thu thập dữ liệu hành vi thực tế quy mô lớn hơn để phát triển Intent Score/Demand Forecast từ mô hình học từ dữ liệu thay vì công thức trọng số cố định
- [ ] Hạ tầng production: hot-reload an toàn, giám sát/cảnh báo, log tập trung, sao lưu định kỳ, kiểm thử tải

---

## 📄 License

Dự án được phân phối theo giấy phép **ISC**.

---

<div align="center">

Được xây dựng bởi nhóm SmartBusAI

**[⬆ Về đầu trang](#-smartbusai)**

</div>
