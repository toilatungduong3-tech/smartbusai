# 🚌 SmartBusAI

<div align="center">

**Hệ thống đặt vé xe khách thông minh — Smart Bus Booking System**

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express.js-5.x-000000?style=for-the-badge&logo=express&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-8.0-4479A1?style=for-the-badge&logo=mysql&logoColor=white)
![Socket.io](https://img.shields.io/badge/Socket.io-4.x-010101?style=for-the-badge&logo=socketdotio&logoColor=white)
![License](https://img.shields.io/badge/License-ISC-blue?style=for-the-badge)

*Nền tảng đặt vé xe khách thông minh với AI chatbot, chọn ghế realtime, bản đồ lộ trình 3D và dashboard quản lý toàn diện.*

</div>

---

## 📋 Mục lục

- [Giới thiệu](#-giới-thiệu)
- [Tính năng nổi bật](#-tính-năng-nổi-bật)
- [Kiến trúc hệ thống](#-kiến-trúc-hệ-thống)
- [Cài đặt & Khởi chạy](#-cài-đặt--khởi-chạy)
- [Cấu trúc thư mục](#-cấu-trúc-thư-mục)
- [API Documentation](#-api-documentation)
- [Socket.io Events](#-socketio-events)
- [Tài khoản mặc định](#-tài-khoản-mặc-định)
- [Các trang giao diện](#-các-trang-giao-diện)
- [Luồng xác thực](#-luồng-xác-thực-auth-flow)
- [Công nghệ sử dụng](#-công-nghệ-sử-dụng)
- [Chạy với Docker](#-chạy-với-docker)
- [Đóng góp](#-đóng-góp)

---

## 🎯 Giới thiệu

**SmartBusAI** là hệ thống đặt vé xe khách trực tuyến tích hợp AI, được xây dựng trên nền tảng Node.js + Express.js với giao diện thuần HTML/CSS/JS. Hệ thống hỗ trợ ba vai trò người dùng: hành khách, nhà xe (operator) và quản trị viên (admin), cung cấp trải nghiệm đặt vé thông minh với chọn ghế realtime và tư vấn tuyến đường bằng AI chatbot.

---

## ✨ Tính năng nổi bật

### 👤 Dành cho Hành khách
- 🔍 **Tìm kiếm chuyến xe** theo điểm đi, điểm đến, ngày khởi hành, loại xe
- 💺 **Chọn ghế realtime** — khoá ghế tạm thời qua Socket.io (5 phút timeout)
- 🗺️ **Bản đồ lộ trình** tương tác với Leaflet.js + hiệu ứng 3D canvas
- 🤖 **AI Chatbot** tư vấn chuyến xe, gợi ý lộ trình phù hợp (OpenAI)
- 📱 **QR Code vé** sau khi đặt thành công
- 📧 **Email nhắc nhở** tự động 2 giờ trước khi khởi hành
- ⭐ **Đánh giá chuyến đi** sau khi hoàn thành
- 🎫 **Quản lý vé** — xem lịch sử, huỷ vé

### 🚌 Dành cho Nhà xe (Operator)
- 📊 **Dashboard doanh thu** trực quan với biểu đồ
- 🗓️ **Quản lý chuyến xe** — tạo, chỉnh sửa, huỷ chuyến
- 🚍 **Quản lý phương tiện** — thêm xe, cập nhật trạng thái
- 💺 **Cấu hình sơ đồ ghế** theo từng loại xe
- 📋 **Theo dõi đặt chỗ** — xác nhận, xử lý booking
- 💰 **Báo cáo doanh thu** theo ngày, tuần, tháng
- 📱 **Quét QR Code** xác nhận lên xe

### 🛡️ Dành cho Admin
- 👥 **Quản lý người dùng** — xem, khoá, phân quyền
- 🏢 **Quản lý nhà xe** — duyệt, theo dõi hoạt động
- 📈 **Thống kê toàn hệ thống** — users, trips, revenue
- 🤖 **AI Analytics** — phân tích xu hướng đặt vé
- 🎫 **Xem toàn bộ đặt chỗ**
- 🆘 **Xử lý yêu cầu hỗ trợ** từ khách hàng
- ⚙️ **Cài đặt hệ thống**

### ⚙️ Tính năng kỹ thuật
- 🔄 **Tự động tạo chuyến** định kỳ hàng ngày lúc 00:01
- 🔒 **Rate limiting** — 200 req/phút toàn API, 10 lần đăng nhập/15 phút
- 🛡️ **Helmet.js** bảo mật HTTP headers
- 📖 **Swagger API Docs** tại `/api-docs`
- 📧 **Email service** qua Nodemailer (nhắc chuyến, xác nhận vé)
- 🔐 **bcryptjs** mã hoá mật khẩu
- 📊 **Pricing engine** tính giá động
- 🎁 **Loyalty service** tích điểm thưởng

---

## 🏗️ Kiến trúc hệ thống

```
┌─────────────────────────────────────────────────────┐
│                    CLIENT (Browser)                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │  Admin   │  │ Operator │  │    Passenger     │   │
│  │  Pages   │  │  Pages   │  │     Pages        │   │
│  └────┬─────┘  └────┬─────┘  └────────┬─────────┘   │
│       └─────────────┴─────────────────┘              │
│                    api.js (shared)                   │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP / WebSocket
┌──────────────────────▼──────────────────────────────┐
│              EXPRESS.JS SERVER (port 2704)           │
│  ┌───────────┐  ┌────────────┐  ┌─────────────────┐ │
│  │  Routes   │  │Controllers │  │   Middleware     │ │
│  │ /api/...  │→ │  Business  │  │ Auth, RateLimit  │ │
│  └───────────┘  │   Logic    │  └─────────────────┘ │
│                 └─────┬──────┘                       │
│  ┌──────────────────┐ │  ┌──────────────────────┐   │
│  │   Socket.io      │ │  │      Services        │   │
│  │  (Seat Locking)  │ │  │ Email, QR, Loyalty   │   │
│  └──────────────────┘ │  │ Pricing, AI (OpenAI) │   │
│                        │  └──────────────────────┘   │
└───────────────────────┼─────────────────────────────┘
                         │
┌───────────────────────▼─────────────────────────────┐
│              MySQL 8.0 (port 3306)                   │
│              Database: smartbusai                    │
└─────────────────────────────────────────────────────┘
```

---

## 🚀 Cài đặt & Khởi chạy

### Yêu cầu hệ thống

| Công cụ | Phiên bản |
|---------|-----------|
| Node.js | >= 18.x   |
| npm     | >= 9.x    |
| MySQL   | >= 8.0    |

### Bước 1 — Clone repository

```bash
git clone https://github.com/your-username/smartbusai.git
cd smartbusai
```

### Bước 2 — Cài đặt dependencies

```bash
npm install
```

### Bước 3 — Cài đặt MySQL Database

Đăng nhập vào MySQL và tạo database:

```sql
CREATE DATABASE smartbusai CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Import schema và dữ liệu mẫu:

```bash
mysql -u root smartbusai < smartbusai.sql
```

> ⚠️ **Cấu hình mặc định**: host `localhost`, user `root`, password *(không có)*, port `3306`.
> Nếu khác, chỉnh sửa file `server/config/db.js`.

### Bước 4 — Khởi chạy server

**Môi trường production:**
```bash
npm start
# hoặc
node server/server.js
```

**Môi trường development (auto-reload với nodemon):**
```bash
npm run dev
```

### Bước 5 — Truy cập ứng dụng

| URL | Mô tả |
|-----|-------|
| `http://localhost:2704` | Trang chính (redirect đến login) |
| `http://localhost:2704/pages/auth/login.html` | Đăng nhập |
| `http://localhost:2704/pages/auth/register.html` | Đăng ký |
| `http://localhost:2704/api-docs` | Swagger API Docs |
| `http://localhost:2704/api/db-test` | Kiểm tra kết nối DB |

---

## 📁 Cấu trúc thư mục

```
smartbusai/
│
├── 📄 package.json              # Dependencies & scripts
├── 📄 smartbusai.sql            # Database schema + seed data
├── 📄 docker-compose.yml        # Docker Compose config
├── 📄 Dockerfile                # Docker image config
├── 📄 Jenkinsfile               # CI/CD pipeline (Jenkins)
│
├── 📂 server/                   # Backend (Node.js + Express)
│   ├── 📄 server.js             # Entry point — HTTP + Socket.io server
│   ├── 📄 swagger.js            # Swagger/OpenAPI setup
│   │
│   ├── 📂 config/
│   │   └── 📄 db.js             # MySQL connection pool (mysql2/promise)
│   │
│   ├── 📂 middleware/
│   │   ├── 📄 authMiddleware.js # Auth guard
│   │   └── 📄 rateLimiter.js    # express-rate-limit config
│   │
│   ├── 📂 routes/               # Route definitions
│   │   ├── 📄 authRoutes.js
│   │   ├── 📄 tripRoutes.js
│   │   ├── 📄 bookingRoutes.js
│   │   ├── 📄 userRoutes.js
│   │   ├── 📄 busRoutes.js
│   │   ├── 📄 seatRoutes.js
│   │   ├── 📄 operatorRoutes.js
│   │   ├── 📄 adminRoutes.js
│   │   ├── 📄 reviewRoutes.js
│   │   ├── 📄 supportRoutes.js
│   │   └── 📄 settingsRoutes.js
│   │
│   ├── 📂 controllers/          # Business logic
│   │   ├── 📄 authController.js
│   │   ├── 📄 tripController.js      # Bao gồm autoGenerateRecurringTrips
│   │   ├── 📄 bookingController.js
│   │   ├── 📄 userController.js
│   │   ├── 📄 busController.js
│   │   ├── 📄 seatController.js
│   │   ├── 📄 operatorController.js
│   │   ├── 📄 adminController.js
│   │   ├── 📄 reviewController.js
│   │   ├── 📄 supportController.js
│   │   └── 📄 settingsController.js
│   │
│   ├── 📂 services/             # Shared services
│   │   ├── 📄 emailService.js   # Nodemailer — xác nhận vé, nhắc nhở
│   │   ├── 📄 qrService.js      # Tạo QR Code vé
│   │   ├── 📄 loyaltyService.js # Điểm tích luỹ
│   │   ├── 📄 pricingEngine.js  # Tính giá động
│   │   └── 📄 recommendation.js # AI gợi ý chuyến (OpenAI)
│   │
│   └── 📂 ai/
│       └── 📄 recommendation.js # AI recommendation engine
│
└── 📂 public/                   # Frontend (Static HTML/CSS/JS)
    ├── 📄 manifest.json         # PWA manifest
    ├── 📄 sw.js                 # Service Worker
    │
    ├── 📂 pages/
    │   ├── 📂 auth/
    │   │   ├── 📄 login.html
    │   │   ├── 📄 register.html
    │   │   └── 📄 forgot-password.html
    │   │
    │   ├── 📂 passenger/
    │   │   ├── 📄 index.html        # Tìm kiếm chuyến + AI chatbot
    │   │   ├── 📄 booking.html      # Đặt vé + chọn ghế realtime
    │   │   ├── 📄 profile.html      # Hồ sơ + lịch sử vé
    │   │   ├── 📄 hotro.html        # Hỗ trợ khách hàng
    │   │   └── 📄 nha-xe.html       # Danh sách nhà xe
    │   │
    │   ├── 📂 operator/
    │   │   ├── 📄 operator.html     # Dashboard nhà xe
    │   │   ├── 📄 trips.html        # Quản lý chuyến xe
    │   │   ├── 📄 vehicles.html     # Quản lý phương tiện
    │   │   ├── 📄 seats.html        # Cấu hình sơ đồ ghế
    │   │   ├── 📄 bookings.html     # Quản lý đặt chỗ
    │   │   ├── 📄 revenue.html      # Báo cáo doanh thu
    │   │   └── 📄 scan.html         # Quét QR Code xác nhận lên xe
    │   │
    │   └── 📂 admin/
    │       ├── 📄 admin.html        # Dashboard tổng quan + AI analytics
    │       ├── 📄 users.html        # Quản lý người dùng
    │       ├── 📄 operators.html    # Quản lý nhà xe
    │       ├── 📄 support.html      # Xử lý ticket hỗ trợ
    │       └── 📄 settings.html     # Cài đặt hệ thống
    │
    ├── 📂 js/
    │   ├── 📄 api.js            # Shared API client (get/post/put/delete + utils)
    │   ├── 📄 app.js            # App-level init
    │   ├── 📄 register.js       # Register page logic
    │   └── 📄 admin-notif.js    # Admin notifications
    │
    ├── 📂 css/                  # Stylesheets
    ├── 📂 images/               # Static images
    ├── 📂 icons/                # App icons (PWA)
    └── 📂 data/                 # Static data files
```

---

## 📡 API Documentation

API đầy đủ có thể xem tại: **`http://localhost:2704/api-docs`** (Swagger UI)

### Tổng quan các endpoint

#### 🔐 Auth — `/api/auth`

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `POST` | `/api/auth/login` | Đăng nhập, trả về thông tin user |
| `POST` | `/api/auth/register` | Đăng ký tài khoản mới |
| `POST` | `/api/auth/forgot-password` | Yêu cầu đặt lại mật khẩu |

#### 🚌 Trips — `/api/trips`

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/trips` | Lấy danh sách chuyến, hỗ trợ filter |
| `GET` | `/api/trips/search` | Tìm kiếm theo origin/destination/date/type |
| `GET` | `/api/trips/:id` | Chi tiết một chuyến |
| `POST` | `/api/trips` | Tạo chuyến mới (Operator) |
| `PUT` | `/api/trips/:id` | Cập nhật chuyến |
| `PUT` | `/api/trips/:id/status` | Cập nhật trạng thái chuyến |
| `PUT` | `/api/trips/:id/price` | Cập nhật giá vé |
| `DELETE` | `/api/trips/:id` | Xoá chuyến |

#### 🎫 Bookings — `/api/bookings`

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/bookings` | Lấy tất cả đặt chỗ |
| `GET` | `/api/bookings/user/:userId` | Đặt chỗ của một user |
| `POST` | `/api/bookings` | Tạo đặt chỗ (MySQL transaction) |
| `PUT` | `/api/bookings/:id/status` | Cập nhật trạng thái (PAID/CANCELLED) |

#### 💺 Seats — `/api/seats`

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/seats/trip/:tripId` | Lấy sơ đồ ghế theo chuyến |
| `POST` | `/api/seats/generate` | Tạo ghế tự động cho chuyến |
| `PUT` | `/api/seats/:id` | Cập nhật trạng thái ghế |
| `GET` | `/api/seats/locks/:tripId` | Danh sách ghế đang bị khoá (Socket.io) |

#### 👥 Users — `/api/users`

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/users` | Danh sách người dùng (Admin) |
| `GET` | `/api/users/:id` | Thông tin một user |
| `PUT` | `/api/users/:id` | Cập nhật thông tin, role, status |
| `DELETE` | `/api/users/:id` | Xoá user |

#### 🚍 Buses — `/api/buses`

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/buses` | Danh sách xe |
| `GET` | `/api/buses/:id` | Chi tiết một xe |
| `POST` | `/api/buses` | Thêm xe mới |
| `PUT` | `/api/buses/:id` | Cập nhật xe |
| `PUT` | `/api/buses/:id/status` | Cập nhật trạng thái xe |
| `DELETE` | `/api/buses/:id` | Xoá xe |

#### 🏢 Operators — `/api/operators`

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/operators` | Danh sách nhà xe |
| `GET/POST/PUT/DELETE` | `/api/operators/:id` | CRUD nhà xe |
| `GET` | `/api/operators/:id/dashboard/stats` | Thống kê tổng quan |
| `GET` | `/api/operators/:id/dashboard/revenue` | Doanh thu |
| `GET` | `/api/operators/:id/dashboard/routes` | Tuyến đường |
| `GET` | `/api/operators/:id/dashboard/booking-status` | Trạng thái đặt chỗ |
| `GET` | `/api/operators/:id/dashboard/seat-occupancy` | Tỉ lệ lấp đầy ghế |
| `GET` | `/api/operators/:id/dashboard/recent-trips` | Chuyến gần đây |
| `GET` | `/api/operators/:id/dashboard/buses` | Xe của nhà xe |
| `GET` | `/api/operators/:id/dashboard/reviews` | Đánh giá |
| `GET` | `/api/operators/:id/dashboard/payments` | Thanh toán |
| `GET` | `/api/operators/:id/dashboard/bookings` | Đặt chỗ |

#### 🛡️ Admin — `/api/admin`

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/admin/stats` | Thống kê tổng hệ thống |
| `GET` | `/api/admin/revenue` | Doanh thu toàn hệ thống |
| `GET` | `/api/admin/bookings` | Tất cả đặt chỗ |
| `GET` | `/api/admin/users` | Tất cả người dùng |
| `GET` | `/api/admin/trips` | Tất cả chuyến xe |
| `GET` | `/api/admin/ai-analytics` | Phân tích AI |

#### ⭐ Reviews — `/api/reviews`

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `POST` | `/api/reviews` | Tạo đánh giá sau chuyến đi |

#### 🆘 Support — `/api/support`

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/support` | Danh sách yêu cầu hỗ trợ |
| `POST` | `/api/support` | Gửi yêu cầu hỗ trợ mới |
| `PUT` | `/api/support/:id` | Cập nhật trạng thái yêu cầu |

#### ⚙️ Settings — `/api/settings`

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/settings` | Lấy cài đặt hệ thống |
| `PUT` | `/api/settings` | Cập nhật cài đặt |

---

## 🔌 Socket.io Events

Hệ thống sử dụng Socket.io để khoá ghế realtime khi nhiều người dùng cùng chọn ghế trên cùng một chuyến.

### Client → Server

| Event | Payload | Mô tả |
|-------|---------|-------|
| `trip:join` | `{ tripId }` | Tham gia phòng theo dõi ghế của chuyến |
| `seat:lock` | `{ tripId, seatId, userId }` | Khoá ghế (timeout 5 phút) |
| `seat:unlock` | `{ tripId, seatId }` | Giải phóng ghế thủ công |

### Server → Client

| Event | Payload | Mô tả |
|-------|---------|-------|
| `seat:locked` | `{ seatId, lockedBy }` | Ghế vừa bị khoá bởi user khác |
| `seat:released` | `{ seatId }` | Ghế vừa được giải phóng |
| `seat:lock_denied` | `{ seatId, message }` | Bị từ chối khoá (ghế đã có người) |
| `seat:current_locks` | `[{ seatId }]` | Danh sách ghế đang bị khoá khi join phòng |

---

## 👤 Tài khoản mặc định

> Các tài khoản sau được tạo sẵn trong file `smartbusai.sql` để demo:

| Vai trò | Email | Mật khẩu | Trang đích sau login |
|---------|-------|----------|--------------------|
| **Admin** | `admin@smartbusai.com` | `admin123` | `/pages/admin/admin.html` |
| **Operator** | `operator@smartbusai.com` | `operator123` | `/pages/operator/operator.html` |
| **Passenger** | `passenger@smartbusai.com` | `passenger123` | `/pages/passenger/index.html` |

> ⚠️ Vui lòng đổi mật khẩu sau khi triển khai lên môi trường production.

---

## 🖥️ Các trang giao diện

### 🔐 Authentication
| Trang | Đường dẫn | Mô tả |
|-------|-----------|-------|
| Đăng nhập | `/pages/auth/login.html` | Form đăng nhập, redirect theo role |
| Đăng ký | `/pages/auth/register.html` | Form đăng ký tài khoản hành khách |
| Quên mật khẩu | `/pages/auth/forgot-password.html` | Gửi email đặt lại mật khẩu |

### 👤 Passenger (Hành khách)
| Trang | Đường dẫn | Mô tả |
|-------|-----------|-------|
| Tìm chuyến | `/pages/passenger/index.html` | Search + AI chatbot + bản đồ lộ trình |
| Đặt vé | `/pages/passenger/booking.html` | Chọn ghế realtime + thanh toán |
| Hồ sơ | `/pages/passenger/profile.html` | Thông tin cá nhân + lịch sử vé |
| Hỗ trợ | `/pages/passenger/hotro.html` | Gửi yêu cầu hỗ trợ |
| Nhà xe | `/pages/passenger/nha-xe.html` | Danh sách nhà xe |

### 🚌 Operator (Nhà xe)
| Trang | Đường dẫn | Mô tả |
|-------|-----------|-------|
| Dashboard | `/pages/operator/operator.html` | Tổng quan doanh thu, thống kê |
| Chuyến xe | `/pages/operator/trips.html` | CRUD chuyến xe |
| Phương tiện | `/pages/operator/vehicles.html` | Quản lý xe buýt |
| Sơ đồ ghế | `/pages/operator/seats.html` | Cấu hình layout ghế |
| Đặt chỗ | `/pages/operator/bookings.html` | Danh sách & xử lý booking |
| Doanh thu | `/pages/operator/revenue.html` | Báo cáo tài chính |
| Quét QR | `/pages/operator/scan.html` | Xác nhận lên xe bằng QR Code |

### 🛡️ Admin
| Trang | Đường dẫn | Mô tả |
|-------|-----------|-------|
| Dashboard | `/pages/admin/admin.html` | Thống kê toàn hệ thống + AI analytics |
| Người dùng | `/pages/admin/users.html` | Quản lý tất cả user |
| Nhà xe | `/pages/admin/operators.html` | Duyệt & quản lý nhà xe |
| Hỗ trợ | `/pages/admin/support.html` | Xử lý ticket hỗ trợ |
| Cài đặt | `/pages/admin/settings.html` | Cấu hình hệ thống |

---

## 🔄 Luồng xác thực (Auth Flow)

```
Người dùng đăng nhập
        │
        ▼
POST /api/auth/login
        │
        ▼
Server xác thực + trả về { user, token }
        │
        ▼
Frontend lưu vào localStorage:
  - user (object đầy đủ)
  - user_id
        │
        ▼
Role-based redirect:
  ADMIN     → /pages/admin/admin.html
  OPERATOR  → /pages/operator/operator.html
  PASSENGER → /pages/passenger/index.html
```

Tất cả các trang được bảo vệ bằng `api.requireLogin()` từ `/js/api.js`.

### Shared API Client (`/js/api.js`)

`api.js` được include ở tất cả các trang và cung cấp:

| Hàm | Mô tả |
|-----|-------|
| `api.get(url)` | HTTP GET |
| `api.post(url, data)` | HTTP POST |
| `api.put(url, data)` | HTTP PUT |
| `api.delete(url)` | HTTP DELETE |
| `getUser()` | Lấy object user từ localStorage |
| `getUserId()` | Lấy user_id |
| `getRole()` | Lấy role (ADMIN/OPERATOR/PASSENGER) |
| `requireLogin()` | Redirect về login nếu chưa đăng nhập |
| `logout()` | Xoá session + redirect login |
| `formatMoney(n)` | Format tiền VND |
| `formatDate(d)` | Format ngày giờ tiếng Việt |
| `showToast(msg)` | Hiển thị toast notification |

---

## 🛠️ Công nghệ sử dụng

### Backend
| Thư viện | Phiên bản | Mục đích |
|----------|-----------|----------|
| express | ^5.2.1 | Web framework |
| mysql2 | ^3.18.2 | MySQL driver (promise-based pool) |
| socket.io | ^4.8.3 | Realtime seat locking |
| bcryptjs | ^3.0.3 | Mã hoá mật khẩu |
| jsonwebtoken | ^9.0.3 | JWT token |
| helmet | ^8.1.0 | HTTP security headers |
| express-rate-limit | ^8.3.1 | Rate limiting |
| cors | ^2.8.6 | CORS policy |
| nodemailer | ^8.0.4 | Gửi email |
| openai | ^6.25.0 | AI chatbot (GPT) |
| qrcode | ^1.5.4 | Tạo QR vé |
| swagger-jsdoc | ^6.2.8 | API documentation |
| swagger-ui-express | ^5.0.1 | Swagger UI |
| dotenv | ^17.3.1 | Environment variables |
| nodemon | ^3.1.14 | Hot-reload (dev) |

### Frontend
| Công nghệ | Mô tả |
|-----------|-------|
| Vanilla HTML/CSS/JS | Không framework |
| Leaflet.js | Bản đồ lộ trình tương tác |
| Socket.io Client | Kết nối realtime với server |
| Canvas API | Hiệu ứng 3D bản đồ |
| PWA (Service Worker) | Progressive Web App support |

### DevOps & CI/CD
| Công cụ | Mô tả |
|---------|-------|
| Docker | Containerization |
| Docker Compose | Multi-service orchestration (app + MySQL) |
| Jenkins | CI/CD pipeline (`Jenkinsfile`) |
| GitHub Actions | Automated CI/CD workflows |

---

## 🐳 Chạy với Docker

```bash
# Build & chạy toàn bộ stack (app + MySQL)
docker-compose up --build

# Chạy nền (detached mode)
docker-compose up -d --build

# Xem logs
docker-compose logs -f

# Dừng
docker-compose down
```

> Sau khi chạy, truy cập: `http://localhost:2704`

---

## 🤝 Đóng góp

Mọi đóng góp đều được chào đón! Vui lòng làm theo các bước sau:

1. **Fork** repository này
2. Tạo branch mới:
   ```bash
   git checkout -b feature/ten-tinh-nang
   ```
3. Commit thay đổi:
   ```bash
   git commit -m "feat: thêm tính năng X"
   ```
4. Push lên branch:
   ```bash
   git push origin feature/ten-tinh-nang
   ```
5. Tạo **Pull Request** về nhánh `main`

### Quy ước đặt tên commit

| Prefix | Mô tả |
|--------|-------|
| `feat:` | Tính năng mới |
| `fix:` | Sửa bug |
| `refactor:` | Cải thiện code, không thay đổi chức năng |
| `docs:` | Cập nhật tài liệu |
| `style:` | Thay đổi giao diện/CSS |
| `chore:` | Cấu hình, build, tooling |
| `test:` | Thêm/sửa test |

### Báo cáo lỗi

Mở một [GitHub Issue](https://github.com/your-username/smartbusai/issues) với thông tin:
- Mô tả lỗi rõ ràng
- Các bước tái hiện lỗi
- Môi trường (OS, Node.js version, browser)
- Screenshot nếu có

---

## 🗺️ Hướng phát triển

- [ ] Tích hợp cổng thanh toán thật (VNPay, Momo, ZaloPay)
- [ ] Nâng cấp AI chatbot (RAG, fine-tuning)
- [ ] Mobile app (React Native / Flutter)
- [ ] Thống kê nâng cao cho Admin (BI dashboard)
- [ ] Multi-language support (EN/VI)
- [ ] Push notifications (Firebase Cloud Messaging)
- [ ] Unit & integration tests (Jest)

---

## 📄 License

Dự án được phân phối theo giấy phép **ISC**.

---

<div align="center">

Được xây dựng với ❤️ bởi nhóm SmartBusAI

**[⬆ Về đầu trang](#-smartbusai)**

</div>
