# SmartBusAI — Cue Card Demo Sprint 3
**Ngày: 16/07/2026 | ThS. Nguyễn Khánh Tùng**

---

## 7 PHÚT — FLOW CHÍNH

| # | Thời gian | Nội dung | Người |
|---|-----------|----------|-------|
| 1 | 0:00–0:30 | Giới thiệu dự án + nhóm | Tùng Dương |
| 2 | 0:30–1:30 | Thành quả sprint: RBAC, 63 tests, 82% SP | Tùng Dương |
| 3 | 1:30–3:30 | Demo Admin: login → users.html → CRUD | Đức Anh |
| 4 | 3:30–5:00 | Demo Operator: trips.html → 403 ownership | Tùng Dương |
| 5 | 5:00–6:00 | Demo API Transit Search (Postman/curl) | Tuấn Bách |
| 6 | 6:00–7:00 | Tồn đọng + kế hoạch Sprint 4 | Tùng Dương |

---

## URL QUAN TRỌNG

```
Login:     http://localhost:2704/pages/auth/login.html
Admin:     http://localhost:2704/pages/admin/users.html
Operator:  http://localhost:2704/pages/operator/trips.html
API test:  http://localhost:2704/api/trips/transit-search?origin=Hà Nội&destination=Đà Nẵng&date=2026-07-16
```

**Admin:** `admin@gmail.com` | **Backup:** `superadmin@smartbusai.vn`  
*(xác nhận mật khẩu với nhóm trước 30 phút)*

---

## DEMO RBAC — CÚ NHANH

```js
// Trong DevTools Console (F12) — không có token:
fetch('/api/users').then(r=>r.json()).then(console.log)
// → {"message":"Không có token xác thực"}
```

## DEMO OWNERSHIP — 403

Postman: `POST /api/trips` với token Operator A + bus_id của Operator B  
→ HTTP 403: `"Xe này không thuộc quyền quản lý của bạn"`

---

## SỐ LIỆU CẦN NHỚ

| Chỉ số | Giá trị |
|--------|---------|
| Story Points | 55 SP tổng / ~45 SP done (~82%) |
| Tests | 63/63 pass (2 suites) |
| Routes trong DB | 1.095 tuyến |
| Trips trong DB | 11.533 chuyến |
| Users | 54 (2 ADMIN, 8 OPERATOR) |
| Locations | 68 địa điểm, 573 route_stops |
| Port | 2704 |

---

## Q&A NHANH

**"Tại sao JWT không phải session?"**  
→ Stateless, không cần lưu DB, phù hợp REST

**"Soft-delete là gì?"**  
→ Đánh dấu INACTIVE thay vì xóa → giữ lịch sử booking/payment

**"Transit Router hoạt động sao?"**  
→ BFS + Dijkstra, max 3 chặng, chờ 30ph–16h giữa chuyến

**"Haversine bug?"**  
→ `!lat` bắt cả 0 → fix bằng `lat == null || !isFinite(lat)`

**"Tại sao PARTIAL ở US-101/102/201?"**  
→ Backend 100% done, thiếu UI trang riêng → Sprint 4

**"63 tests bao phủ gì?"**  
→ Unit test pure functions: haversine, citiesMatch, CSV parser, auth helpers. Không phải integration test.

---

## SỰ CỐ KHẨN CẤP

| Vấn đề | Làm ngay |
|--------|----------|
| Server chết | `npm start` lại, check MySQL |
| Login fail | Dùng `superadmin@smartbusai.vn` |
| 401 Unauthorized | Đăng xuất → đăng nhập lại |
| Transit trả rỗng | Đổi `date` sang ngày khác |
| Màn chiếu lỗi | Win+P → Duplicate |

---

## KHỞI ĐỘNG NHANH

```bash
cd D:\smartbusai
npm start          # server chạy port 2704
npm test           # xem 63/63 pass
```

---
*In khổ A5, giữ trong tay khi thuyết trình*
