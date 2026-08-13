# SMARTBUSAI — AUDIT SUMMARY
**Tóm tắt Kiểm toán Kỹ thuật Toàn diện**
Generated: 2026-08-13 | Auditor: Technical Audit Engine

---

## 1. THÔNG TIN DỰ ÁN

| | |
|---|---|
| **Tên đề tài** | Xây dựng hệ thống tìm kiếm và gợi ý hành trình xe khách thông minh |
| **Trường** | ĐH CMC |
| **Thời gian** | 01/06/2026 – 30/08/2026 |
| **Nhóm** | 5 thành viên (Lead: Phạm Nguyễn Tùng Dương) |
| **GVHD** | ThS. Phạm Ngọc Đông, ThS. Nguyễn Khánh Tùng |

---

## 2. STACK THỰC TẾ (Verified)

```
Backend:  Node.js + Express ^5.2.1 (port 2704)
Frontend: Vanilla HTML/CSS/JavaScript (no framework)
Database: MySQL 13 tables (mysql2/promise pool)
AI:       Custom Node.js (Collaborative Filtering + BFS/Dijkstra)
Auth:     bcryptjs + JWT (15m access + 7d refresh)
Realtime: Socket.io (seat locking)
Payment:  MoMo + ZaloPay + VNPay (HMAC-SHA256 signatures)
Email:    nodemailer (trip reminders, cronjob 10min)
Docs:     Swagger (/api-docs)
PWA:      Service Worker
CI/CD:    GitHub Actions
Tests:    Jest (transitRouter, sprint3)
```

**Thay đổi so với kế hoạch**: Spring Boot → Node.js | React → Vanilla JS | scikit-learn → Custom JS | Apache POI → Không implement

---

## 3. PHẠM VI TÍNH NĂNG

### ✅ IMPLEMENTED & VERIFIED

**Core (theo đề tài)**:
- Tìm kiếm tuyến trực tiếp với filter (loại xe, giá, sort)
- Hành trình trung chuyển BFS/Dijkstra (max 3 hops, 3 modes: time/cost/hops)
- Gợi ý điểm đón trả theo GPS (Haversine distance)
- AI Recommendation (Collaborative Filtering + Cold Start)
- Dashboard Admin (thống kê, biểu đồ Chart.js)
- Quản lý tuyến xe, chuyến xe, nhà xe

**Extended (ngoài scope đề tài)**:
- Đặt vé + Chọn ghế + QR Code
- Thanh toán MoMo/ZaloPay/VNPay
- Real-time seat locking (Socket.io)
- Dynamic Pricing Engine
- Loyalty Program (Bronze/Silver/Gold/Diamond)
- Operator Dashboard (riêng cho nhà xe)
- AI Chat (Claude API)
- Email Reminders (nodemailer)
- Auto-generate recurring trips

### ⚠️ PARTIAL

- Bản đồ Leaflet (GPS coords có trong DB nhưng Leaflet CDN chưa xác nhận trong HTML)
- Dashboard thống kê điểm trung chuyển (thiếu `/analytics/transfer-points`)
- Google OAuth (package có nhưng flow chưa xác nhận hoàn chỉnh)

### ❌ KHÔNG IMPLEMENT

- Import Excel tuyến xe (backlog nói Apache POI)
- Evaluation metrics AI (Precision@3, Recall, F1-Score)
- So sánh đa phương án trên bản đồ
- Performance benchmark (<3s response với 1000+ routes)
- Cross-browser/responsive testing documented

---

## 4. PHÂN TÍCH BACKLOG vs. CODE

**Khoảng cách lớn nhất**:

| Vấn đề | Chi tiết |
|---|---|
| Sprint 3-6 ghi 0 Done trong backlog | Nhưng code đã implement phần lớn tính năng — team không cập nhật backlog |
| Stack pivot chưa được phản ánh | Backlog vẫn ghi Spring Boot + React |
| Scope mở rộng tự phát | 13+ tính năng không có trong backlog gốc |
| Tài liệu thiếu | SRS, diagrams, báo cáo, wireframes không có trong repo |

---

## 5. TOP 5 RỦI RO KỸ THUẬT

| # | Rủi ro | Mức độ |
|---|---|---|
| 1 | AI API Key lộ ở browser (client-side) | 🔴 Critical |
| 2 | Password reset không có OTP/token verification | 🔴 Critical |
| 3 | JWT secret fallback hardcoded | 🔴 Critical |
| 4 | Virtual trip IDs không thể book | 🟠 High |
| 5 | Real-time seat lock chỉ là in-memory (mất khi restart) | 🟠 High |

---

## 6. ĐIỂM NỔI BẬT KỸ THUẬT

1. **Transit Router**: BFS/Dijkstra đầy đủ, virtual trip projection, 3 optimize modes — thuật toán chính của đề tài được triển khai tốt nhất.

2. **Recommendation Engine**: User-based CF, cold start xử lý, weighted score 4 factors — vượt mức yêu cầu.

3. **Payment Integration**: 3 gateways với HMAC-SHA256 signature verification — production-ready design.

4. **Architecture**: Clean MVC, 14 controllers, 16 route modules, pooled DB connections, swagger docs — maintainable codebase.

---

## 7. TỶ LỆ COVERAGE

| Chỉ tiêu | Giá trị |
|---|---|
| User Stories implemented (verified) | 20/29 (69%) |
| Product Goals implemented | 5/7 (71%) |
| Critical security issues | 3 (unresolved) |
| Test files | 2 files |
| API Endpoints documented | ~60 endpoints |
| DB Tables | 13 (+1 runtime) |
| Frontend Pages | 21 pages |

---

## 8. DANH SÁCH TÀI LIỆU ĐÃ TẠO

| File | Mô tả |
|---|---|
| `SMARTBUSAI_TECHNICAL_REPORT.md` | Báo cáo kỹ thuật tổng quan (stack, architecture, modules AI) |
| `SMARTBUSAI_API_DOCUMENTATION.md` | Tài liệu API đầy đủ (60+ endpoints + Socket.io events) |
| `SMARTBUSAI_DATABASE_DOCUMENTATION.md` | Tài liệu database (14 tables, schema, ERD text, loyalty system) |
| `SMARTBUSAI_BACKLOG_AUDIT.md` | Kiểm toán backlog (so sánh planned vs. actual, pivot tech) |
| `SMARTBUSAI_REQUIREMENT_TRACEABILITY.md` | Ma trận truy vết yêu cầu (38 user stories, verdict cho từng story) |
| `SMARTBUSAI_FEATURE_MATRIX.md` | Ma trận tính năng theo vai trò (Passenger/Operator/Admin) |
| `SMARTBUSAI_TECHNICAL_DEBT.md` | Báo cáo nợ kỹ thuật (18 issues phân loại Critical→Low) |
| `SMARTBUSAI_DEFENSE_READINESS.md` | Chuẩn bị bảo vệ (Q&A, demo script, checklist) |
| `SMARTBUSAI_AUDIT_SUMMARY.md` | File này — tóm tắt tổng hợp |

---

## 9. KHUYẾN NGHỊ TRƯỚC BẢO VỆ

**Ưu tiên cao (nên fix):**
1. Move AI API calls về backend proxy (1-2 giờ)
2. Cập nhật backlog status trong Excel để match thực tế code
3. Chuẩn bị 1 diagram ERD (MySQL Workbench → export PNG)

**Ưu tiên trung bình:**
4. Thêm JWT_SECRET check — throw nếu không có .env
5. Chuẩn bị kịch bản demo với data seed đầy đủ
6. Test tất cả 5 luồng demo trước ngày bảo vệ

**Không cần làm trước bảo vệ:**
- Refactor index.html (quá lớn)
- OTP password reset
- Full Leaflet integration
