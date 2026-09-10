# SMARTBUSAI — TECHNICAL DEBT REPORT
**Các vấn đề kỹ thuật cần giải quyết**
Source: Codebase audit
Generated: 2026-08-13

---

## PHÂN LOẠI

| Mức độ | Ký hiệu | Mô tả |
|---|---|---|
| Critical | 🔴 | Lỗ hổng bảo mật, dữ liệu không nhất quán, crash |
| High | 🟠 | Vấn đề nghiêm trọng ảnh hưởng tính năng |
| Medium | 🟡 | Code quality, maintainability |
| Low | 🟢 | Minor improvements |

---

## 🔴 CRITICAL

### TD-01: API Key AI lộ ở Frontend

**Vị trí**: `public/pages/passenger/index.html` — passengerAIController
**Vấn đề**: OpenAI/Anthropic Claude API được gọi trực tiếp từ browser. API key có thể bị extract từ browser devtools, network inspector, hoặc source code.
**Rủi ro**: Unauthorized usage, bill vô hạn trên tài khoản AI.
**Fix**: Tạo proxy endpoint `/api/ai/chat` ở backend; frontend chỉ gọi internal API.

---

### TD-02: Password Reset Không Có Token/OTP

**Vị trí**: `server/controllers/authController.js` — `resetPassword()`
**Vấn đề**: API `POST /auth/reset-password` chỉ cần `{ email, new_password }` mà không cần xác minh quyền sở hữu email (không có OTP, không có reset token, không có email verification link).
**Rủi ro**: Bất kỳ ai biết email người dùng đều có thể đặt lại mật khẩu.
**Fix**: Implement flow: generate time-limited token → gửi email → verify token → reset password.

---

### TD-03: JWT Secret Hardcoded Fallback

**Vị trí**: `server/controllers/authController.js` line ~11
```javascript
const JWT_SECRET = process.env.JWT_SECRET || "smartbusai_jwt_secret_key_2024_international";
```
**Vấn đề**: Secret hardcoded trong source code. Nếu `.env` không có `JWT_SECRET`, dùng fallback public secret — có thể forge tokens.
**Fix**: Throw error nếu `JWT_SECRET` không được set trong production.

---

### TD-04: CSP Disabled

**Vị trí**: `server/server.js` — helmet config
**Vấn đề**: Content Security Policy bị tắt vì frontend dùng inline `<script>` tags.
**Rủi ro**: XSS attacks không được mitigate bởi CSP.
**Fix**: Refactor inline scripts sang external files, re-enable CSP với nonce-based policy.

---

## 🟠 HIGH

### TD-05: Virtual Trip IDs Không Đặt Được Vé

**Vị trí**: `server/ai/transitRouter.js`
**Vấn đề**: Transit router trả về trip IDs dạng `"123_v5"` (virtual projections) không tồn tại trong DB. Nếu user cố đặt vé từ kết quả transit, booking sẽ fail vì không tìm thấy trip.
**Fix**: Frontend cần xử lý virtual trips khác biệt (chỉ hiển thị info, không cho đặt); hoặc backend resolve virtual → real trip.

---

### TD-06: loyaltyService ALTER TABLE Silent Fail trên MySQL 5.x

**Vị trí**: `server/services/loyaltyService.js` — `ensureColumns()`
**Vấn đề**: MySQL 5.x không hỗ trợ `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. Code catch error và bỏ qua silently, nhưng loyalty columns sẽ không được thêm → loyalty features broken.
**Fix**: Kiểm tra version MySQL; dùng migration script thay vì runtime ALTER.

---

### TD-07: localStorage Session — Không Có Invalidation

**Vị trí**: `public/js/api.js` + auth flow
**Vấn đề**: Session lưu trong localStorage. Không có server-side blacklist/invalidation cho refresh tokens. Nếu user bị ban, token cũ vẫn valid đến khi expire (15m access / 7d refresh).
**Fix**: Implement token blacklist (Redis hoặc DB) để invalidate refresh tokens ngay lập tức.

---

### TD-08: Không Có Validation Schema cho Request Body

**Vị trí**: Tất cả controllers
**Vấn đề**: Không dùng Joi, Zod, hay express-validator. Validation thủ công, inconsistent giữa controllers.
**Rủi ro**: Edge cases với dữ liệu không hợp lệ (null, undefined, wrong types) có thể gây crash hoặc SQL error leak.
**Fix**: Thêm middleware validation layer (Joi schemas) cho tất cả POST/PUT endpoints.

---

### TD-09: Booking không Verify Seat Availability Trong Transaction

**Vị trí**: `server/controllers/bookingController.js`
**Vấn đề**: Cần verify seat chưa được book bên trong DB transaction. Socket.io lock là in-memory — nếu server restart, locks mất.
**Fix**: Thêm `FOR UPDATE` lock trong SQL query của transaction, kiểm tra seat status trong transaction.

---

## 🟡 MEDIUM

### TD-10: index.html Quá Lớn (7500+ dòng)

**Vị trí**: `public/pages/passenger/index.html`
**Vấn đề**: Toàn bộ JS logic (~5000 dòng) inline trong 1 file HTML. Không thể test, khó maintain, browser parse time lớn.
**Fix**: Tách JS ra các file module riêng (search.js, recommendations.js, chatbot.js, ...).

---

### TD-11: Recommendation Score Không Normalized

**Vị trí**: `server/ai/recommendation.js` — `getPersonalizedRoutes()`
**Vấn đề**: Score trả về là `freq * (avg_rating / 5)` — không có upper bound. Có thể trả về score > 100 nếu route có nhiều bookings.
**Fix**: Normalize score về [0, 100] range.

---

### TD-12: Migrate Files Không Được Quản Lý Đúng Cách

**Vị trí**: `server/config/migrate.js`, `migrate_v3.sql`, `migrate_v4.sql`
**Vấn đề**: Không có migration versioning system (không có bảng `schema_migrations`). Không rõ migrate nào đã apply.
**Fix**: Dùng migration tool (db-migrate, Knex migrations) với version tracking.

---

### TD-13: CORS Origin Chỉ Cho localhost

**Vị trí**: `server/server.js` — CORS config
**Vấn đề**: Chỉ whitelist `localhost:2704`, `localhost:3000`, `localhost:5500`. Production deployment cần update cứng trong code.
**Fix**: Đọc `ALLOWED_ORIGINS` từ `.env` để dễ config cho production.

---

### TD-14: Email Service Không Có Rate Limiting

**Vị trí**: `server/services/emailService.js`
**Vấn đề**: Cronjob gửi email mỗi 10 phút, không có tracking "đã gửi" — có thể gửi duplicate nếu booking không update đúng.
**Fix**: Thêm column `reminder_sent_at` trong booking table; chỉ gửi nếu null.

---

### TD-15: Không Có Error Boundary Chung Cho API

**Vị trí**: Tất cả controllers
**Vấn đề**: Mỗi controller tự catch error và trả 500. Stack trace có thể leak qua response.
**Fix**: Thêm global Express error handler middleware; sanitize error messages cho production.

---

## 🟢 LOW

### TD-16: Console.log Còn Trong Production Code

**Vị trí**: Nhiều controllers
**Vấn đề**: `console.error("GET TRIPS ERROR:", err)` expose error details. Không có structured logging.
**Fix**: Dùng logging library (winston, pino) với log levels.

---

### TD-17: Test Coverage Thấp

**Vị trí**: `tests/`
**Vấn đề**: Chỉ có 2 test files (transitRouter, sprint3). Không test controllers, services, authentication flow.
**Fix**: Thêm unit tests cho controllers, integration tests cho API endpoints.

---

### TD-18: Swagger Docs Chưa Đầy Đủ

**Vị trí**: `server/swagger.js`
**Vấn đề**: Một số endpoints chưa có Swagger annotations đầy đủ.
**Fix**: Thêm JSDoc cho tất cả routes.

---

## TÓM TẮT

| Mức độ | Số lượng |
|---|---|
| 🔴 Critical | 4 |
| 🟠 High | 5 |
| 🟡 Medium | 6 |
| 🟢 Low | 3 |
| **Tổng** | **18** |

**Ưu tiên fix trước bảo vệ đồ án**: TD-01 (API key), TD-02 (password reset), TD-03 (JWT secret).
