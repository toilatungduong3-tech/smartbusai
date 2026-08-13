# SMARTBUSAI — FEATURE MATRIX
**Trạng thái tính năng theo vai trò người dùng**
Source: Codebase audit (controllers + routes + frontend pages)
Generated: 2026-08-13

> Legend: ✅ Implemented | ⚠️ Partial | ❌ Not Found | 🔒 Auth Required

---

## HÀNH KHÁCH (PASSENGER)

### Tìm kiếm & Khám phá

| Tính năng | Status | File | Ghi chú |
|---|---|---|---|
| Tìm tuyến trực tiếp (origin/destination/date) | ✅ | searchController.js | Sort: price/time/rating |
| Filter (loại xe, giá) | ✅ | tripController.searchTrips | busType, sort params |
| Tìm hành trình trung chuyển | ✅ | transitRouter.js | BFS/Dijkstra, max 3 hops |
| Optimize: nhanh nhất/rẻ nhất/ít chặng | ✅ | transitRouter.js | mode: time/cost/hops |
| Autocomplete điểm đi/đến | ✅ | index.html | Frontend dropdown |
| Tìm bến xe gần GPS | ✅ | locationRoutes.js | Haversine distance |
| Xem chi tiết chuyến xe (modal) | ✅ | index.html | Route modal |
| So sánh 2 chuyến xe | ✅ | index.html | Compare modal |
| Chuyến đang chạy (live) | ✅ | tripController.getRunningTrips | |
| Giá động (dynamic pricing) | ✅ | pricingEngine.js | Days+occupancy multiplier |
| Điểm đón trả gần GPS | ✅ | routeStopController.js | nearby endpoint |
| Bản đồ lộ trình (Leaflet) | ⚠️ | Không xác nhận trong HTML | Backlog planned, not confirmed |

### AI & Gợi ý

| Tính năng | Status | File | Ghi chú |
|---|---|---|---|
| Gợi ý AI cá nhân hóa | ✅ | recommendation.js | Collaborative filtering |
| Cold start (user mới) | ✅ | recommendation.js | Fallback tuyến phổ biến |
| AI Score breakdown (4 factors) | ✅ | index.html _renderRecoCard | user_history·booking_history·popularity·price |
| Chat AI hỏi đáp | ✅ | passengerAIController.js | Claude API |
| Ghi nhận hành vi người dùng | ✅ | user_behavior table | action_type: search/view/book |
| Đánh giá mô hình AI (Precision/Recall) | ❌ | Không có | Backlog yêu cầu, chưa implement |

### Đặt vé & Thanh toán

| Tính năng | Status | File | Ghi chú |
|---|---|---|---|
| Chọn ghế (sơ đồ ghế) | ✅ 🔒 | seatController.js + booking.html | |
| Real-time seat locking (Socket.io) | ✅ | server.js | 5-phút timeout |
| Tạo booking | ✅ 🔒 | bookingController.js | Transaction: lock→create→QR |
| Thanh toán MoMo | ✅ 🔒 | paymentService.js | HMAC-SHA256 signature |
| Thanh toán ZaloPay | ✅ 🔒 | paymentService.js | |
| Thanh toán VNPay | ✅ 🔒 | paymentService.js | |
| Thanh toán tiền mặt | ✅ 🔒 | paymentService.js | Method: cash |
| QR Code vé | ✅ | qrService.js | Base64 embedded |
| Hủy vé | ✅ 🔒 | bookingController.js PATCH status | |
| Lịch sử đặt vé | ✅ 🔒 | bookingController.js /my | |

### Tài khoản & Hồ sơ

| Tính năng | Status | File | Ghi chú |
|---|---|---|---|
| Đăng ký (tuổi ≥ 15) | ✅ | authController.register | |
| Đăng nhập | ✅ | authController.login | JWT access 15m + refresh 7d |
| Đặt lại mật khẩu | ✅ | authController.resetPassword | Không cần OTP |
| Cập nhật hồ sơ | ✅ 🔒 | userController.js | |
| Xem điểm loyalty | ✅ 🔒 | loyaltyService.js + userRoutes | |
| Đổi điểm thưởng | ✅ 🔒 | loyaltyService.js | 100 pts = 10,000 VND |
| Đăng nhập Google | ⚠️ | authRoutes + google-auth-library | Chưa xác nhận flow đầy đủ |
| Đánh giá chuyến xe | ✅ 🔒 | reviewController.js | Rating 1-5 + comment |
| Gửi yêu cầu hỗ trợ | ✅ 🔒 | supportController.js | |
| Nhắc nhở chuyến qua email | ✅ | emailService.js | Cronjob 10 phút |

---

## NHÀ XE (OPERATOR)

### Dashboard

| Tính năng | Status | File |
|---|---|---|
| Thống kê tổng quan | ✅ | operatorController /dashboard/stats |
| Doanh thu (biểu đồ) | ✅ | operatorController /dashboard/revenue |
| Booking status breakdown | ✅ | operatorController /dashboard/booking-status |
| Tỷ lệ lấp đầy ghế | ✅ | operatorController /dashboard/seat-occupancy |
| Chuyến gần đây | ✅ | operatorController /dashboard/recent-trips |
| Đánh giá từ khách | ✅ | operatorController /dashboard/reviews |
| Báo cáo thanh toán | ✅ | operatorController /dashboard/payments |

### Quản lý Chuyến xe

| Tính năng | Status | File |
|---|---|---|
| Xem danh sách chuyến | ✅ | tripController.getTrips |
| Tạo chuyến mới | ✅ | tripController.createTrip |
| Cập nhật chuyến | ✅ | tripController.updateTrip |
| Hủy chuyến | ✅ | tripController PATCH status |
| Tự động tạo chuyến lặp lại | ✅ | tripController.autoGenerateRecurringTrips |
| Dynamic pricing | ✅ | pricingEngine.getDynamicPrice |
| Scan QR vé | ✅ | operator/scan.html |

### Quản lý Xe

| Tính năng | Status | File |
|---|---|---|
| Thêm/sửa/xóa xe | ✅ | busController.js |
| Cập nhật trạng thái xe | ✅ | busController PATCH status |
| Tạo sơ đồ ghế | ✅ | seatController.generateSeats |

---

## QUẢN TRỊ VIÊN (ADMIN)

| Tính năng | Status | File |
|---|---|---|
| Dashboard thống kê | ✅ | adminController.getStats |
| Doanh thu 6 tháng | ✅ | adminController.getRevenue6Months |
| Top tuyến phổ biến | ✅ | adminController.getTopRoutes |
| Đặt vé theo ngày | ✅ | adminController.getBookingsPerDay |
| Quản lý người dùng (CRUD) | ✅ | userController.js |
| Khóa/mở tài khoản | ✅ | userController updateUser status |
| Phân quyền (role) | ✅ | userController updateUser role |
| Quản lý nhà xe (CRUD) | ✅ | operatorRoutes.js |
| Quản lý tuyến đường | ✅ | routeStopRoutes.js |
| Quản lý yêu cầu hỗ trợ | ✅ | supportController.js |
| AI Analytics | ✅ | adminController /ai-analytics |
| Cài đặt hệ thống | ✅ | settingsController.js |
| Export báo cáo Excel/PDF | ❌ | Không có trong source |
| Import Excel tuyến xe | ❌ | Không có trong source |

---

## TÍNH NĂNG PHI CHỨC NĂNG

| Tính năng | Status | Chi tiết |
|---|---|---|
| Rate limiting | ✅ | 200 req/min global, 10 login/15min |
| Helmet security headers | ✅ | CSP disabled (inline scripts) |
| CORS whitelist | ✅ | localhost:2704/3000/5500 |
| JWT authentication | ✅ | 15m access + 7d refresh |
| Password hashing | ✅ | bcrypt salt=12 |
| SQL injection prevention | ✅ | Parameterized queries |
| Swagger documentation | ✅ | /api-docs |
| PWA | ✅ | sw.js service worker |
| Real-time notifications | ✅ | Socket.io seat events |
| Email notifications | ✅ | Nodemailer cronjob |
| Responsive design | ✅ | CSS media queries |
| Dark mode | ⚠️ | Partial in some pages |
| Unit tests | ✅ | Jest (transitRouter, sprint3) |
| CI/CD | ✅ | GitHub Actions |
| Cross-browser testing | ❌ | Backlog Sprint 6, not done |
| Performance benchmark | ❌ | Backlog Sprint 6, not done |
