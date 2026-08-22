# SPRINT 3 AUDIT REPORT — SmartBusAI
**Ngày audit:** 2026-07-16  
**Auditor:** Claude Sonnet 4.6 (tự động)  
**Phạm vi:** Sprint Backlog 3 — US-903, US-101, US-102, US-103, US-201, US-501  
**Tổng Story Points:** 55 SP  
**Trạng thái:** AUDIT ONLY — không thay đổi source code

---

## MỤC LỤC

1. [Tóm tắt điều hành](#1-tóm-tắt-điều-hành)
2. [Sprint Backlog 3 Overview](#2-sprint-backlog-3-overview)
3. [US-903: Quản lý người dùng (Admin)](#3-us-903-quản-lý-người-dùng-admin)
4. [US-101: Quản lý tuyến đường (Admin)](#4-us-101-quản-lý-tuyến-đường-admin)
5. [US-102: Quản lý lịch trình (Admin/Operator)](#5-us-102-quản-lý-lịch-trình-adminoperator)
6. [US-103: Tìm kiếm & Lọc nâng cao](#6-us-103-tìm-kiếm--lọc-nâng-cao)
7. [US-201: Quản lý địa điểm](#7-us-201-quản-lý-địa-điểm)
8. [US-501: Quản lý điểm đón/trả (Route Stop)](#8-us-501-quản-lý-điểm-đóntrả-route-stop)
9. [Phân tích bảo mật toàn cục](#9-phân-tích-bảo-mật-toàn-cục)
10. [Phân tích kiến trúc & chất lượng code](#10-phân-tích-kiến-trúc--chất-lượng-code)
11. [Test Coverage](#11-test-coverage)
12. [Ma trận Story Points vs Thực tế](#12-ma-trận-story-points-vs-thực-tế)
13. [Danh sách lỗi ưu tiên](#13-danh-sách-lỗi-ưu-tiên)
14. [Kế hoạch triển khai đề xuất](#14-kế-hoạch-triển-khai-đề-xuất)

---

## 1. Tóm tắt điều hành

### Trạng thái tổng thể

| User Story | Story Points | Backend | Frontend | Auth | Verdict |
|---|---|---|---|---|---|
| US-903 User Management | 13 SP | ✅ Đủ | ⚠️ Chưa xác nhận | ❌ KHÔNG CÓ | 🟡 PARTIAL |
| US-101 Route Management | 8 SP | ⚠️ Read-only | ⚠️ Chưa xác nhận | ❌ KHÔNG CÓ | 🔴 INCOMPLETE |
| US-102 Schedule Management | 13 SP | ✅ Đủ | ✅ Operator | ❌ KHÔNG CÓ | 🟡 PARTIAL |
| US-103 Advanced Search | 8 SP | ✅ Đủ | ✅ Passenger | ✅ N/A | 🟢 DONE |
| US-201 Location Management | 5 SP | ❌ Thiếu CRUD | ❌ Static only | ❌ KHÔNG CÓ | 🔴 INCOMPLETE |
| US-501 Route Stop CRUD | 8 SP | ✅ Đủ | ⚠️ Chưa xác nhận | ❌ KHÔNG CÓ | 🟡 PARTIAL |

### Phát hiện nghiêm trọng nhất (CRITICAL)

> **🚨 TOÀN BỘ API ENDPOINTS đều KHÔNG có xác thực (authentication)**  
> `authMiddleware.js` tồn tại với `authenticate()` và `optionalAuth()` đúng chuẩn JWT,  
> nhưng **KHÔNG được import hoặc sử dụng trong bất kỳ route file nào**.  
> Bất kỳ ai cũng có thể gọi `DELETE /api/users/:id`, `PUT /api/users/:id`, `POST /api/trips`, v.v. mà không cần token.

---

## 2. Sprint Backlog 3 Overview

### Mục tiêu Sprint
Xây dựng các module quản trị nâng cao: User Management, Route/Schedule Management, Advanced Search, Location Management, và Route Stop CRUD.

### Các file liên quan Sprint 3

#### Backend
| File | Dòng | Vai trò |
|---|---|---|
| `server/controllers/userController.js` | ~380 | CRUD users + loyalty + stats |
| `server/controllers/adminController.js` | ~772 | Stats, revenue, AI, route read |
| `server/controllers/tripController.js` | ~320 | Trip CRUD + auto-advance |
| `server/controllers/routeStopController.js` | ~137 | Stop CRUD + Haversine nearest |
| `server/controllers/searchController.js` | ~80 | Suggestions + transit search |
| `server/routes/userRoutes.js` | ~30 | User endpoints (no auth) |
| `server/routes/adminRoutes.js` | ~45 | Admin endpoints (no auth) |
| `server/routes/tripRoutes.js` | ~25 | Trip endpoints (no auth) |
| `server/routes/routeStopRoutes.js` | ~10 | Stop endpoints (no auth) |
| `server/middleware/authMiddleware.js` | ~70 | JWT middleware (EXISTS, UNUSED) |

#### Frontend
| File | Vai trò |
|---|---|
| `public/pages/admin/admin.html` | Admin dashboard (chưa audit chi tiết) |
| `public/pages/operator/trips.html` | Quản lý chuyến xe (đã xác nhận hoạt động) |
| `public/pages/passenger/nha-xe.html` | Trang tìm kiếm chuyến xe |

---

## 3. US-903: Quản lý người dùng (Admin)

**Story Points:** 13 SP  
**Acceptance Criteria:**
- Admin có thể xem danh sách toàn bộ người dùng
- Admin có thể sửa thông tin người dùng (role, status)
- Admin có thể khóa/mở tài khoản
- Admin có thể xóa người dùng

### 3.1 Backend Analysis

**File:** `server/controllers/userController.js`

| Endpoint | Method | Handler | Trạng thái |
|---|---|---|---|
| `/api/users` | GET | `getUsers` | ✅ Hoạt động |
| `/api/users/:id` | GET | `getUserById` | ✅ Hoạt động |
| `/api/users` | POST | `createUser` | ✅ Hoạt động |
| `/api/users/:id` | PUT | `updateUser` | ✅ Hoạt động |
| `/api/users/:id` | DELETE | `deleteUser` | ✅ Hoạt động |
| `/api/users/:id/loyalty` | GET | `getUserLoyalty` | ✅ Hoạt động |
| `/api/users/:id/redeem-points` | POST | `redeemPoints` | ✅ Hoạt động |
| `/api/users/:id/stats` | GET | `getUserStats` | ✅ Hoạt động |
| `/api/users/:id/monthly-stats` | GET | `getMonthlyStats` | ✅ Hoạt động |
| `/api/users/:id/travel-profile` | GET | `getTravelProfile` | ✅ Hoạt động |
| `/api/users/:id/notifications` | GET | `getNotifications` | ✅ Hoạt động |

### 3.2 Phát hiện lỗi

#### 🔴 BUG-001 (CRITICAL): Không có xác thực — toàn bộ User API mở

```javascript
// server/routes/userRoutes.js — KHÔNG có authenticate middleware
router.get("/",         userController.getUsers);         // ai cũng truy cập được
router.delete("/:id",   userController.deleteUser);       // ai cũng xóa được
router.put("/:id",      userController.updateUser);       // ai cũng sửa được
```

**Tác động:** Bất kỳ request HTTP nào đến `/api/users` đều trả dữ liệu. Không cần token. Đây là lỗ hổng bảo mật nghiêm trọng.

**Fix cần thiết:**
```javascript
const { authenticate } = require("../middleware/authMiddleware");
router.get("/", authenticate, userController.getUsers);
router.delete("/:id", authenticate, userController.deleteUser);
// v.v.
```

#### 🔴 BUG-002 (HIGH): Hard DELETE — không có soft delete

```javascript
// userController.js — xóa cứng vĩnh viễn
await db.query("DELETE FROM users WHERE user_id = ?", [id]);
```

**Tác động:** Xóa user là không thể phục hồi. Nếu user có booking lịch sử, sẽ vi phạm ràng buộc FK hoặc mất dữ liệu audit trail.

**Fix:** Thêm cột `is_active` / `deleted_at` vào bảng `users`, dùng soft delete.

#### 🟡 BUG-003 (MEDIUM): Không có phân trang

```javascript
// getUsers — trả TOÀN BỘ users
const [users] = await db.query("SELECT * FROM users ORDER BY created_at DESC");
res.json(users);
```

**Tác động:** Khi hệ thống có hàng nghìn users, request này sẽ tốn nhiều RAM và bandwidth.

**Fix:** Thêm `LIMIT ? OFFSET ?` với query params `?page=1&limit=20`.

#### 🟡 BUG-004 (MEDIUM): Không có bảo vệ tự xóa (self-deletion)

```javascript
exports.deleteUser = async (req, res) => {
    const { id } = req.params;
    // Không kiểm tra: id === req.user.user_id
    await db.query("DELETE FROM users WHERE user_id = ?", [id]);
```

**Tác động:** Admin có thể vô tình xóa chính mình và mất quyền truy cập hệ thống.

#### 🟡 BUG-005 (MEDIUM): `updateUser` không validate role hợp lệ

```javascript
const { full_name, email, phone, role, status } = req.body;
// Không kiểm tra role IN ('ADMIN', 'OPERATOR', 'PASSENGER')
await db.query("UPDATE users SET role=?, status=? ...", [role, status, id]);
```

**Tác động:** Có thể set `role = 'SUPERADMIN'` hoặc giá trị tùy ý vào DB.

### 3.3 Verdict

**Status:** 🟡 PARTIAL — Logic backend hoạt động đúng, nhưng thiếu auth, pagination, và soft delete.  
**Story Points hoàn thành:** ~8/13 SP (60%)

---

## 4. US-101: Quản lý tuyến đường (Admin)

**Story Points:** 8 SP  
**Acceptance Criteria:**
- Admin xem danh sách tất cả tuyến đường
- Admin thêm / sửa / xóa tuyến đường
- Tuyến đường có thể có nhiều điểm dừng (route_stop)

### 4.1 Backend Analysis

**File:** `server/routes/adminRoutes.js`, `server/controllers/adminController.js`

| Endpoint | Method | Handler | Trạng thái |
|---|---|---|---|
| `/api/admin/all-routes` | GET | `getAllRoutes` | ✅ Hoạt động |
| `/api/admin/all-routes` | POST | — | ❌ KHÔNG TỒN TẠI |
| `/api/admin/all-routes/:id` | PUT | — | ❌ KHÔNG TỒN TẠI |
| `/api/admin/all-routes/:id` | DELETE | — | ❌ KHÔNG TỒN TẠI |

### 4.2 Phát hiện lỗi

#### 🔴 BUG-006 (HIGH): Thiếu Route CRUD — chỉ có GET

`getAllRoutes` tổng hợp thống kê tuyến đường đẹp (trip count, booking count, revenue, operator count), nhưng **không có endpoint tạo/sửa/xóa tuyến đường**.

```javascript
// adminRoutes.js
router.get("/all-routes", admin.getAllRoutes);  // Chỉ có GET
// Thiếu: POST, PUT /:id, DELETE /:id
```

**Tác động:** Admin không thể quản lý tuyến đường từ giao diện — chỉ xem. Đây là gap chức năng của US-101.

#### 🔴 BUG-007 (HIGH): Không có bảng route độc lập để admin quản lý

Database có bảng `route` (có `route_id`, `origin`, `destination`, `distance_km`, coords), nhưng không có dedicated controller để admin CRUD bảng này.

**Cần tạo:**
- `server/controllers/routeController.js` — CRUD cho bảng `route`
- Thêm routes vào `adminRoutes.js` với `authenticate` + role check `ADMIN`

#### 🔴 BUG-001 (CRITICAL): Không có xác thực (áp dụng cho tất cả `/api/admin/*`)

```javascript
// adminRoutes.js — không import authMiddleware
router.get("/all-routes", admin.getAllRoutes);  // Không cần token
```

### 4.3 Verdict

**Status:** 🔴 INCOMPLETE — Chỉ có read-only. Thiếu CREATE, UPDATE, DELETE.  
**Story Points hoàn thành:** ~2/8 SP (25%)

---

## 5. US-102: Quản lý lịch trình (Admin/Operator)

**Story Points:** 13 SP  
**Acceptance Criteria:**
- Operator tạo chuyến xe mới (route + bus + thời gian + giá)
- Operator cập nhật trạng thái / giá chuyến xe
- Hệ thống tự động advance chuyến xe hết hạn sang ngày tiếp theo
- Admin xem danh sách tất cả chuyến xe

### 5.1 Backend Analysis

**File:** `server/controllers/tripController.js`

| Endpoint | Method | Handler | Trạng thái |
|---|---|---|---|
| `/api/trips` | GET | `getTrips` | ✅ Hoạt động |
| `/api/trips/running` | GET | `getRunningTrips` | ✅ Hoạt động |
| `/api/trips/search` | GET | `searchTrips` | ✅ Hoạt động |
| `/api/trips/dynamic-price/:id` | GET | `getDynamicPriceForTrip` | ✅ Hoạt động |
| `/api/trips` | POST | `createTrip` | ✅ Hoạt động |
| `/api/trips/status/:id` | PUT | `updateTripStatus` | ✅ Hoạt động |
| `/api/trips/price/:id` | PUT | `updateTripPrice` | ✅ Hoạt động |
| `/api/trips/:id` | GET | `getTripById` | ✅ Hoạt động |
| `/api/trips/:id` | PUT | `updateTrip` | ✅ Hoạt động |
| `/api/trips/:id` | DELETE | `deleteTrip` | ✅ Hoạt động |
| Auto-advance (cron) | — | `autoGenerateRecurringTrips` | ✅ Hoạt động |

### 5.2 Tính năng nổi bật

#### Auto-advance Trip (Recurring Trip System)

```javascript
// tripController.js — tự động advance chuyến đã kết thúc
exports.autoGenerateRecurringTrips = async () => {
    const [completed] = await db.query(
        `SELECT trip_id, departure_time, arrival_time FROM trip
         WHERE status != 'CANCELED' AND arrival_time <= NOW()`
    );
    // Tính nextDep = nextDay(dep) cho đến khi > NOW
    // Cập nhật departure_time + arrival_time + status='OPEN'
};
```

- Chạy ngay khi server khởi động
- Scheduled lúc 00:01 mỗi ngày
- Polling 1 phút/lần qua `checkAndAdvanceIfNeeded`
- Giữ nguyên thời lượng chuyến, không ảnh hưởng chuyến đang chạy

#### Dynamic Pricing Integration

```javascript
// Delegate sang pricingEngine.js — 8 mức multiplier
exports.getDynamicPriceForTrip = async (req, res) => {
    const { getDynamicPrice } = require('../services/pricingEngine');
    const result = await getDynamicPrice(db, req.params.id);
    res.json(result);
};
```

### 5.3 Phát hiện lỗi

#### 🔴 BUG-001: Không có xác thực

```javascript
// tripRoutes.js — không có authenticate
router.delete("/:id", tripController.deleteTrip);  // Ai cũng xóa được chuyến xe
router.post("/",      tripController.createTrip);  // Ai cũng tạo chuyến xe
```

#### 🟡 BUG-008 (MEDIUM): `deleteTrip` dùng hard DELETE

```javascript
await db.query("DELETE FROM trip WHERE trip_id=?", [id]);
```

**Tác động:** Mất audit trail. Nếu có booking liên kết sẽ bị cascade delete hoặc lỗi FK.

#### 🟢 Điểm tốt: `updateTrip` validate đầy đủ fields bắt buộc trong `createTrip`

```javascript
if (!route_id || !bus_id || !departure_time || !arrival_time || !base_price) {
    return res.status(400).json({ message: "Thiếu dữ liệu bắt buộc" });
}
```

### 5.4 Verdict

**Status:** 🟡 PARTIAL — Chức năng đầy đủ, auto-advance hoạt động tốt, nhưng thiếu auth.  
**Story Points hoàn thành:** ~10/13 SP (77%)

---

## 6. US-103: Tìm kiếm & Lọc nâng cao

**Story Points:** 8 SP  
**Acceptance Criteria:**
- Hành khách tìm kiếm theo origin/destination/ngày/loại xe
- Hỗ trợ tìm kiếm transit (trung chuyển) với BFS/Dijkstra
- Gợi ý tìm kiếm (autocomplete)
- AI gợi ý chuyến xe phù hợp

### 6.1 Backend Analysis

| Endpoint | Method | Handler | Trạng thái |
|---|---|---|---|
| `/api/trips/search` | GET | `searchTrips` | ✅ Hoạt động |
| `/api/search/suggestions` | GET | `getSuggestions` | ✅ Hoạt động |
| `/api/search/transit` | GET | `transitSearch` | ✅ Hoạt động |
| `/api/search/popular-transfers` | GET | — | ✅ Hoạt động |
| `/api/ai/trending` | GET | — | ✅ Hoạt động |

### 6.2 Phân tích Transit Search

**File:** `server/ai/transitRouter.js`

Thuật toán BFS + Dijkstra với:
- `MAX_HOPS = 3` (tối đa 3 chặng)
- `MAX_RESULTS = 5` kết quả
- Thời gian chờ tối thiểu giữa 2 chặng: 30 phút
- Hàm Haversine tính khoảng cách km
- Hàm `citiesMatch()` normalize tên thành phố (TP., Thành phố, Tỉnh)

### 6.3 Phát hiện đặc biệt

#### ✅ `searchTrips` có SQL injection prevention đúng chuẩn

```javascript
// Dùng parameterized query — an toàn
if (origin) { sql += " AND r.origin LIKE ?"; params.push(`%${origin}%`); }
```

#### ⚠️ BUG-009 (LOW): `getSuggestions` dùng LIKE trên bảng `route` — không có dedicated location table

```javascript
// searchController.js
const [rows] = await db.query(
    `SELECT DISTINCT origin AS name FROM route WHERE origin LIKE ?
     UNION
     SELECT DISTINCT destination FROM route WHERE destination LIKE ?`,
    [`%${q}%`, `%${q}%`]
);
```

**Tác động:** Gợi ý chỉ trả về tên origin/destination của tuyến đang có. Thành phố không có tuyến chạy sẽ không xuất hiện trong autocomplete.

### 6.4 Test Coverage

**File:** `tests/transitRouter.test.js`

| Test Case | Trạng thái |
|---|---|
| `haversine()` — same point returns 0 | ✅ PASS |
| `haversine()` — Hà Nội → TP.HCM ≈ 1137 km | ✅ PASS |
| `haversine()` — returns Infinity khi coord falsy | ✅ PASS |
| `haversine()` — symmetric | ✅ PASS |
| `citiesMatch()` — exact name | ✅ PASS |
| `citiesMatch()` — prefix stripping "TP. Hồ Chí Minh" | ✅ PASS |
| `searchWithTransit()` — direct route | ✅ PASS |
| `searchWithTransit()` — 1-hop transit A→B→C | ✅ PASS |
| `searchWithTransit()` — DB error returns empty arrays | ✅ PASS |
| `searchWithTransit()` — rejects wait time < 30 min | ✅ PASS |
| `searchWithTransit()` — prefers lower cost when mode=cost | ✅ PASS |

### 6.5 Verdict

**Status:** 🟢 DONE — Đây là US hoàn thiện nhất. Logic đúng, test đầy đủ, frontend hoạt động.  
**Story Points hoàn thành:** ~8/8 SP (100%)

---

## 7. US-201: Quản lý địa điểm

**Story Points:** 5 SP  
**Acceptance Criteria:**
- Admin quản lý danh sách tỉnh thành / địa điểm trong hệ thống
- Thêm / sửa / xóa địa điểm
- Liên kết địa điểm với tuyến đường

### 7.1 Backend Analysis

**Kết quả tìm kiếm:**

| Tiêu chí | Kết quả |
|---|---|
| Bảng `location` trong DB | ❌ KHÔNG TỒN TẠI |
| Controller `locationController.js` | ❌ KHÔNG TỒN TẠI |
| Routes `/api/locations` | ❌ KHÔNG TỒN TẠI |
| File `vietnam-location.json` | ✅ Tồn tại (static) |
| Gợi ý địa điểm trong search | ✅ Từ bảng `route` (LIKE query) |

### 7.2 Phát hiện lỗi

#### 🔴 BUG-010 (HIGH): US-201 chưa được implement

Location Management là **static** — tên thành phố được hardcode trong:
1. `vietnam-location.json` — danh sách tĩnh dùng cho autocomplete frontend
2. `server/config/migrate_v2.sql` — seed tọa độ bằng UPDATE với CASE WHEN hardcoded

Không có khả năng Admin thêm/sửa/xóa địa điểm qua giao diện.

#### 🟡 Thiếu schema: Không có bảng `location`

Nếu muốn implement US-201 đầy đủ, cần:

```sql
CREATE TABLE location (
    location_id   INT AUTO_INCREMENT PRIMARY KEY,
    name          VARCHAR(200) NOT NULL,
    province      VARCHAR(200),
    lat           DECIMAL(10, 7),
    lng           DECIMAL(10, 7),
    is_active     TINYINT(1) DEFAULT 1,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### ✅ Điểm tốt: `route_stop` có tọa độ lat/lng

Bảng `route_stop` có trường `lat`, `lng`, `address` — có thể tái sử dụng làm "location anchor" cho transit routing.

### 7.3 Verdict

**Status:** 🔴 INCOMPLETE — Không có backend CRUD cho location. Static data only.  
**Story Points hoàn thành:** ~1/5 SP (20%)

---

## 8. US-501: Quản lý điểm đón/trả (Route Stop)

**Story Points:** 8 SP  
**Acceptance Criteria:**
- Admin/Operator quản lý điểm đón/trả của từng tuyến
- Tìm điểm đón gần nhất theo vị trí người dùng (Geolocation)
- Hỗ trợ loại điểm: PICKUP, DROPOFF, BOTH
- Soft delete (không mất dữ liệu lịch sử)

### 8.1 Backend Analysis

**File:** `server/controllers/routeStopController.js`

| Endpoint | Method | Handler | Trạng thái |
|---|---|---|---|
| `/api/stops?route_id=X` | GET | `getStopsByRoute` | ✅ Hoạt động |
| `/api/stops/nearest?lat=X&lng=Y` | GET | `getNearestStops` | ✅ Hoạt động |
| `/api/stops` | POST | `createStop` | ✅ Hoạt động |
| `/api/stops/:id` | PUT | `updateStop` | ✅ Hoạt động |
| `/api/stops/:id` | DELETE | `deleteStop` | ✅ Soft delete |

### 8.2 Điểm tốt

#### ✅ Soft Delete đúng chuẩn

```javascript
exports.deleteStop = async (req, res) => {
    await db.query('UPDATE route_stop SET is_active=0 WHERE stop_id=?', [req.params.id]);
    return res.json({ message: 'Đã xoá điểm dừng' });
};
```

#### ✅ Haversine tích hợp chính xác

```javascript
const withDist = stops.map(s => ({
    ...s,
    distance_km: Math.round(
        haversine(userLat, userLng, parseFloat(s.lat), parseFloat(s.lng)) * 10
    ) / 10
})).sort((a, b) => a.distance_km - b.distance_km);
return res.json(withDist.slice(0, 10));
```

Reuse `haversine()` từ `transitRouter.js` — nhất quán, không duplicate.

#### ✅ Deduplication cho nearest stops

Khi không có `route_id`, query GROUP BY `stop_name` để tránh hiển thị trùng bến xe.

### 8.3 Phát hiện lỗi

#### 🔴 BUG-001: Không có xác thực

```javascript
// routeStopRoutes.js
router.post("/",     ctrl.createStop);   // Ai cũng tạo điểm dừng
router.put("/:id",   ctrl.updateStop);   // Ai cũng sửa
router.delete("/:id", ctrl.deleteStop);  // Ai cũng xóa (soft)
```

#### 🟡 BUG-011 (MEDIUM): `updateStop` không validate lat/lng range

```javascript
const { lat, lng } = req.body;
// Không kiểm tra: lat BETWEEN -90 AND 90, lng BETWEEN -180 AND 180
await db.query("UPDATE route_stop SET lat=?, lng=? ...", [lat, lng, id]);
```

#### 🟡 BUG-012 (LOW): `getNearestStops` giới hạn cứng 10 kết quả — không configurable

```javascript
return res.json(withDist.slice(0, 10));  // hardcoded
```

**Gợi ý:** Cho phép `?limit=N` với max 20.

#### 🟢 Điểm tốt: `createStop` validate đầy đủ fields bắt buộc

```javascript
if (!route_id || !stop_name) {
    return res.status(400).json({ message: 'Thiếu route_id hoặc stop_name' });
}
```

### 8.4 Schema Review

**File:** `server/config/migrate_v2.sql`

```sql
CREATE TABLE IF NOT EXISTS route_stop (
    stop_id    INT AUTO_INCREMENT PRIMARY KEY,
    route_id   INT NOT NULL,
    stop_name  VARCHAR(200) NOT NULL,
    stop_type  ENUM('PICKUP','DROPOFF','BOTH') DEFAULT 'BOTH',
    address    VARCHAR(500),
    lat        DECIMAL(10, 7),
    lng        DECIMAL(10, 7),
    stop_order INT DEFAULT 0,
    is_active  TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (route_id) REFERENCES route(route_id) ON DELETE CASCADE,
    INDEX idx_route (route_id),
    INDEX idx_active (is_active)
)
```

Schema được thiết kế tốt. FK với CASCADE, có index phù hợp, ENUM cho stop_type.

### 8.5 Verdict

**Status:** 🟡 PARTIAL — Chức năng backend đầy đủ, soft delete đúng chuẩn, nhưng thiếu auth và validation lat/lng.  
**Story Points hoàn thành:** ~6/8 SP (75%)

---

## 9. Phân tích bảo mật toàn cục

### 9.1 Phát hiện nghiêm trọng: Auth Middleware tồn tại nhưng không được dùng

**File tồn tại:** `server/middleware/authMiddleware.js`

```javascript
// authMiddleware.js — Implementation đúng chuẩn JWT
const authenticate = (req, res, next) => {
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Không có token xác thực" });
    }
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = { user_id: decoded.user_id, role: decoded.role, email: decoded.email };
    next();
};
```

**Audit của tất cả route files:**

```bash
grep -rn "authenticate" server/routes/
# Kết quả: KHÔNG CÓ OUTPUT
```

**Kết luận:** `authenticate` KHÔNG được import hoặc sử dụng trong bất kỳ route file nào.

### 9.2 Bảng tóm tắt bảo mật theo route

| Route File | Auth Middleware | Endpoints nhạy cảm |
|---|---|---|
| `userRoutes.js` | ❌ KHÔNG CÓ | DELETE user, PUT user role |
| `adminRoutes.js` | ❌ KHÔNG CÓ | Tất cả admin stats, revenue, AI |
| `tripRoutes.js` | ❌ KHÔNG CÓ | DELETE trip, POST trip |
| `routeStopRoutes.js` | ❌ KHÔNG CÓ | POST/PUT/DELETE stop |
| `bookingRoutes.js` | ❌ KHÔNG XEM XÉT (ngoài scope) | — |
| `busRoutes.js` | ❌ KHÔNG XEM XÉT | — |
| `operatorRoutes.js` | ❌ KHÔNG XEM XÉT | — |

### 9.3 Attack scenarios

| Scenario | Nguy cơ |
|---|---|
| GET `/api/users` | Lộ toàn bộ danh sách user (email, phone, role) |
| DELETE `/api/users/1` | Xóa vĩnh viễn admin account |
| PUT `/api/users/1` với `{"role":"ADMIN"}` | Leo thang quyền |
| GET `/api/admin/revenue-6months` | Lộ doanh thu kinh doanh |
| POST `/api/trips` với data giả | Tạo chuyến xe giả mạo |
| DELETE `/api/trips/1` | Xóa tất cả chuyến xe |

### 9.4 Phân tích rủi ro

| Mức độ | Số lượng | Mô tả |
|---|---|---|
| 🔴 CRITICAL | 1 | Auth hoàn toàn bị bỏ qua |
| 🔴 HIGH | 3 | Hard delete, thiếu CRUD, no role validation |
| 🟡 MEDIUM | 4 | No pagination, no soft delete trip, no lat/lng validation, no self-delete protection |
| 🟢 LOW | 2 | Hardcoded limit, suggestions từ route table |

---

## 10. Phân tích kiến trúc & chất lượng code

### 10.1 Điểm mạnh

| Điểm mạnh | Chi tiết |
|---|---|
| **Auto-advance trips** | Logic tái sử dụng chuyến xe hàng ngày hoạt động tốt, dùng MySQL NOW() làm timezone reference |
| **Haversine reuse** | `routeStopController` import `haversine` từ `transitRouter.js` — DRY |
| **Parameterized queries** | Tất cả SQL dùng `?` placeholder — không có SQL injection |
| **Async/await nhất quán** | 100% handlers dùng async/await với try/catch |
| **Dynamic pricing** | Delegate đúng đến `pricingEngine.js` — SRP |
| **GET cache** | `api.js` có TTL 45s, max 80 entries, deduplication in-flight |
| **Rate limiting** | 200 req/min global, 10 login/15min — đã implement |
| **Socket.io seat locking** | Realtime seat lock với timeout 5 phút, release on disconnect |

### 10.2 Điểm yếu kiến trúc

| Điểm yếu | Chi tiết |
|---|---|
| **Auth không consistent** | Middleware tồn tại nhưng không áp dụng — nguy cơ hệ thống |
| **Hard deletes** | Cả `users` và `trips` đều hard delete — mất audit trail |
| **Thiếu pagination** | `getUsers`, `getAllRoutes` trả toàn bộ data |
| **No role-based access** | Không phân biệt ADMIN vs OPERATOR vs PASSENGER ở route level |
| **No input sanitization** | Các PUT endpoint không validate type/range của input |
| **US-201 hoàn toàn thiếu** | Không có Location management sau khi audit |

### 10.3 Phân tích `adminController.js` — AI Features

Admin controller có các AI endpoints rất phong phú:

```javascript
router.get("/ai/recommendations",   admin.getAIRecommendations);    // Collaborative filtering
router.get("/ai/revenue-forecast",  admin.getRevenueForecast);       // Linear regression 6 tháng
router.get("/ai/anomalies",         admin.getAnomalyDetection);      // Anomaly detection
router.get("/ai/heatmap",           admin.getBookingHeatmap);        // Booking heatmap
router.get("/ai/price-prediction",  admin.getPricePrediction);       // Price prediction
router.get("/ai/trip-demand",       admin.getTripDemandForecast);    // Demand forecast
router.post("/ai/classify-ticket",  admin.classifySupportTicket);    // Rule-based keyword ticket classification (corrected — was labeled "NLP" here; see server/ai/recommendation.js)
```

Đây là các tính năng AI nâng cao — **nằm ngoài scope Sprint 3** nhưng đã được implement.

---

## 11. Test Coverage

### 11.1 Hiện trạng test

| Module | Test file | Coverage |
|---|---|---|
| `transitRouter.js` | `tests/transitRouter.test.js` | ✅ 11 test cases, đầy đủ |
| `userController.js` | — | ❌ KHÔNG CÓ |
| `adminController.js` | — | ❌ KHÔNG CÓ |
| `tripController.js` | — | ❌ KHÔNG CÓ |
| `routeStopController.js` | — | ❌ KHÔNG CÓ |
| `pricingEngine.js` | — | ❌ KHÔNG CÓ |
| `loyaltyService.js` | — | ❌ KHÔNG CÓ |
| `qrService.js` | — | ❌ KHÔNG CÓ |
| API integration tests | — | ❌ KHÔNG CÓ |

### 11.2 Test cases đang có (transitRouter.test.js)

Đây là test coverage tốt nhất trong codebase:

```
✅ haversine() — same point returns 0
✅ haversine() — Hà Nội → TP.HCM ≈ 1137 km
✅ haversine() — Infinity khi coord falsy
✅ haversine() — symmetric A,B = B,A
✅ citiesMatch() — exact name
✅ citiesMatch() — "TP. Hồ Chí Minh" matches "Hồ Chí Minh"
✅ citiesMatch() — "Thành phố Đà Nẵng" matches "Đà Nẵng"
✅ citiesMatch() — "Tỉnh Bình Dương" matches "Bình Dương"
✅ searchWithTransit() — direct route
✅ searchWithTransit() — 1-hop transit A→B→C
✅ searchWithTransit() — DB error returns empty arrays
✅ searchWithTransit() — rejects wait < 30 min
✅ searchWithTransit() — mode=cost returns cheaper first
```

### 11.3 Test gap nghiêm trọng cho Sprint 3

Cần thêm tối thiểu:

```
❌ userController — CRUD test
❌ userController — auth required test (401 without token)
❌ adminController — getAllRoutes returns correct schema
❌ routeStopController — createStop validation
❌ routeStopController — getNearestStops Haversine sorting
❌ tripController — autoGenerateRecurringTrips advances correctly
❌ Integration — POST /api/users without token → 401
```

---

## 12. Ma trận Story Points vs Thực tế

| User Story | Planned SP | Estimated Completion | Gap SP | Lý do |
|---|---|---|---|---|
| US-903 User Management | 13 | 60% (~8 SP) | 5 SP | Thiếu auth, pagination, soft delete |
| US-101 Route Management | 8 | 25% (~2 SP) | 6 SP | Chỉ có GET, thiếu CRUD |
| US-102 Schedule Management | 13 | 77% (~10 SP) | 3 SP | Thiếu auth |
| US-103 Advanced Search | 8 | 100% (8 SP) | 0 SP | Hoàn chỉnh + tested |
| US-201 Location Management | 5 | 20% (~1 SP) | 4 SP | Không có backend CRUD |
| US-501 Route Stop CRUD | 8 | 75% (~6 SP) | 2 SP | Thiếu auth, lat/lng validation |
| **TỔNG** | **55 SP** | **~35 SP (64%)** | **~20 SP** | |

### Velocity Analysis

- **Planned:** 55 SP
- **Thực tế delivered (demo-ready):** ~35 SP (64%)
- **Blocker chính:** Không có auth middleware → không thể chấp nhận sản phẩm lên production
- **US duy nhất DONE:** US-103 (Advanced Search) với test coverage đầy đủ

---

## 13. Danh sách lỗi ưu tiên

### P0 — Ngăn chặn production deploy

| ID | Mô tả | File | Effort |
|---|---|---|---|
| BUG-001 | Toàn bộ API không có authentication | Tất cả route files | S (2h) |

### P1 — High Priority

| ID | Mô tả | File | Effort |
|---|---|---|---|
| BUG-002 | Hard delete users — mất dữ liệu | `userController.js` | M (4h) |
| BUG-006 | Thiếu Route CRUD (POST/PUT/DELETE) | `adminRoutes.js` + cần `routeController.js` | L (8h) |
| BUG-010 | US-201 Location Management chưa implement | Cần `locationController.js` + migration | XL (16h) |

### P2 — Medium Priority

| ID | Mô tả | File | Effort |
|---|---|---|---|
| BUG-003 | Không có pagination cho getUsers | `userController.js` | S (1h) |
| BUG-004 | Không bảo vệ self-deletion | `userController.js` | S (30m) |
| BUG-005 | Role không được validate | `userController.js` | S (30m) |
| BUG-008 | Hard delete trips | `tripController.js` | M (2h) |
| BUG-011 | Không validate lat/lng range | `routeStopController.js` | S (30m) |

### P3 — Low Priority

| ID | Mô tả | File | Effort |
|---|---|---|---|
| BUG-009 | Suggestions từ route table, không có location table | `searchController.js` | L (phụ thuộc US-201) |
| BUG-012 | Hardcoded limit=10 cho getNearestStops | `routeStopController.js` | XS (15m) |

---

## 14. Kế hoạch triển khai đề xuất

> ⚠️ Đây là đề xuất — chờ lệnh từ Product Owner trước khi triển khai

### Sprint 3 Hotfix (ưu tiên cao nhất)

**Bước 1: Fix BUG-001 — Thêm authenticate vào tất cả route files**

```javascript
// Thêm vào đầu mỗi route file:
const { authenticate } = require("../middleware/authMiddleware");

// Các endpoint cần auth (chỉ example):
router.get("/",       authenticate, userController.getUsers);
router.put("/:id",    authenticate, userController.updateUser);
router.delete("/:id", authenticate, userController.deleteUser);
```

**Bước 2: Thêm role check cho admin endpoints**

```javascript
// Tạo middleware requireAdmin
const requireAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'ADMIN') {
        return res.status(403).json({ message: 'Không có quyền Admin' });
    }
    next();
};

// Áp dụng:
router.get("/all-routes", authenticate, requireAdmin, admin.getAllRoutes);
```

**Bước 3: Soft delete cho users**

```javascript
// Thêm cột is_active vào users (migration)
ALTER TABLE users ADD COLUMN is_active TINYINT(1) DEFAULT 1;

// Sửa deleteUser:
await db.query("UPDATE users SET is_active=0 WHERE user_id=?", [id]);
```

**Bước 4: Pagination cho getUsers**

```javascript
const page  = parseInt(req.query.page)  || 1;
const limit = parseInt(req.query.limit) || 20;
const offset = (page - 1) * limit;
await db.query("SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?", [limit, offset]);
```

### Sprint 4 Backlog (sau khi hotfix xong)

1. Implement US-101 đầy đủ: tạo `routeController.js` với CRUD cho bảng `route`
2. Implement US-201 đầy đủ: tạo bảng `location`, `locationController.js`, admin UI
3. Thêm unit tests cho tất cả controllers
4. Thêm integration tests cho auth flows

---

## Phụ lục A: Cây file đã audit

```
server/
├── middleware/
│   ├── authMiddleware.js      ✅ ĐÚNG (unused)
│   └── rateLimiter.js         ✅ OK
├── controllers/
│   ├── userController.js      ✅ Audited
│   ├── adminController.js     ✅ Audited  
│   ├── tripController.js      ✅ Audited
│   ├── routeStopController.js ✅ Audited
│   └── searchController.js    ✅ Audited
├── routes/
│   ├── userRoutes.js          ✅ Audited
│   ├── adminRoutes.js         ✅ Audited
│   ├── tripRoutes.js          ✅ Audited
│   └── routeStopRoutes.js     ✅ Audited
├── ai/
│   └── transitRouter.js       ✅ Audited (via tests)
├── config/
│   └── migrate_v2.sql         ✅ Audited
└── server.js                  ✅ Audited

tests/
└── transitRouter.test.js      ✅ Audited (11 test cases)
```

## Phụ lục B: Định nghĩa mức độ severity

| Level | Mô tả |
|---|---|
| 🔴 CRITICAL | Ngăn chặn deploy, hoặc lỗ hổng bảo mật cho phép leo thang quyền |
| 🔴 HIGH | Mất dữ liệu, thiếu chức năng chính của US |
| 🟡 MEDIUM | Hiệu năng, UX, hoặc data integrity ở mức vừa |
| 🟢 LOW | Cải tiến nhỏ, không ảnh hưởng nghiệp vụ |

---

*Báo cáo được tạo tự động từ audit source code. Không có source code nào bị chỉnh sửa trong quá trình audit.*  
*Audit date: 2026-07-16 | SmartBusAI Sprint 3*
