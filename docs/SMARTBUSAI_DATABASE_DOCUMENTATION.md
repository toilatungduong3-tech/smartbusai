# SMARTBUSAI — DATABASE DOCUMENTATION
**Source-of-truth: smartbusai.sql + migrate_v3.sql + migrate_v4.sql + loyaltyService.js (runtime table)**
Generated: 2026-08-13

> Database: `smartbusai` | Engine: InnoDB | Charset: utf8mb4 | Port: 3306

---

## SCHEMA DIAGRAM (ERD text)

```
bus_operator ──< bus ──< trip ──< booking >──< booking_detail >── seat
                          │           │
                         route      review
                          │
                    user_behavior
                          │
                        users ──< booking
                                      │
                                   payment
                                      │
                               support_request
                                      │
                              ai_recommendation
                              loyalty_transactions (runtime-created)
```

---

## TABLES

### 1. `bus_operator`
Nhà xe vận tải.

| Column | Type | Constraint | Mô tả |
|---|---|---|---|
| operator_id | INT | PK AUTO_INCREMENT | |
| name | VARCHAR(100) | NOT NULL | Tên nhà xe |
| email | VARCHAR(100) | UNIQUE | |
| phone | VARCHAR(20) | | |
| address | TEXT | | |
| license_number | VARCHAR(50) | | Số giấy phép |
| status | ENUM('ACTIVE','INACTIVE') | DEFAULT 'ACTIVE' | |
| created_at | TIMESTAMP | DEFAULT NOW() | |
| description | TEXT | | Mô tả |
| logo_url | VARCHAR(255) | | |
| rating | DECIMAL(3,2) | DEFAULT 0 | |

**Seed data**: 8 nhà xe (Phương Trang, Thành Bưởi, Hoàng Long, Kumho Samco, Mai Linh Express, Thanh Thuý, Hải Âu, An Phú)

---

### 2. `bus`
Xe của nhà xe.

| Column | Type | Constraint | Mô tả |
|---|---|---|---|
| bus_id | INT | PK AUTO_INCREMENT | |
| operator_id | INT | FK → bus_operator | |
| plate_number | VARCHAR(20) | UNIQUE NOT NULL | Biển số |
| bus_type | ENUM('STANDARD','LIMOUSINE','VIP') | NOT NULL | |
| total_seats | INT | NOT NULL | |
| status | ENUM('ACTIVE','MAINTENANCE','INACTIVE') | DEFAULT 'ACTIVE' | |
| created_at | TIMESTAMP | | |
| manufacture_year | YEAR | | |
| amenities | TEXT | | JSON string (wifi, ac, ...) |

**Seed data**: 13 xe (mix STANDARD, LIMOUSINE, VIP, 30-45 ghế)

---

### 3. `route`
Tuyến đường.

| Column | Type | Constraint | Mô tả |
|---|---|---|---|
| route_id | INT | PK AUTO_INCREMENT | |
| origin | VARCHAR(100) | NOT NULL | Điểm đi |
| destination | VARCHAR(100) | NOT NULL | Điểm đến |
| distance_km | DECIMAL(10,2) | | |
| estimated_duration | INT | | Phút |
| origin_lat | DECIMAL(10,8) | | Vĩ độ điểm đi |
| origin_lng | DECIMAL(11,8) | | Kinh độ điểm đi |
| dest_lat | DECIMAL(10,8) | | Vĩ độ điểm đến |
| dest_lng | DECIMAL(11,8) | | Kinh độ điểm đến |

**Seed data**: 13 tuyến (HCM↔Đà Lạt, HCM↔Nha Trang, HCM↔Vũng Tàu, HN↔Hải Phòng, v.v.)

---

### 4. `seat`
Ghế trên xe.

| Column | Type | Constraint | Mô tả |
|---|---|---|---|
| seat_id | INT | PK AUTO_INCREMENT | |
| bus_id | INT | FK → bus | |
| seat_number | VARCHAR(10) | NOT NULL | Ví dụ: A1, B2 |
| seat_type | ENUM('STANDARD','VIP','LIMOUSINE') | | |
| floor | INT | DEFAULT 1 | Tầng (1 hoặc 2) |
| row_num | INT | | |
| col_num | INT | | |
| status | ENUM('AVAILABLE','BOOKED','MAINTENANCE') | DEFAULT 'AVAILABLE' | |

---

### 5. `users`
Người dùng.

| Column | Type | Constraint | Mô tả |
|---|---|---|---|
| user_id | INT | PK AUTO_INCREMENT | |
| username | VARCHAR(50) | UNIQUE NOT NULL | |
| full_name | VARCHAR(100) | NOT NULL | |
| email | VARCHAR(100) | UNIQUE NOT NULL | |
| password_hash | VARCHAR(255) | NOT NULL | bcrypt(salt=12) |
| phone | VARCHAR(20) | | |
| gender | ENUM('male','female','other') | | |
| birth_date | DATE | | Yêu cầu tuổi ≥ 15 khi đăng ký |
| province | VARCHAR(100) | | |
| district | VARCHAR(100) | | |
| address_detail | TEXT | | |
| role | ENUM('PASSENGER','OPERATOR','ADMIN') | DEFAULT 'PASSENGER' | |
| status | ENUM('ACTIVE','BANNED') | DEFAULT 'ACTIVE' | |
| created_at | TIMESTAMP | | |
| google_id | VARCHAR(100) | | Google OAuth ID |
| avatar_url | VARCHAR(255) | | |
| loyalty_points | INT | DEFAULT 0 | Thêm bởi loyaltyService (ALTER TABLE) |
| loyalty_tier | ENUM(...) | DEFAULT 'BRONZE' | Thêm bởi loyaltyService |

---

### 6. `trip`
Chuyến xe cụ thể.

| Column | Type | Constraint | Mô tả |
|---|---|---|---|
| trip_id | INT | PK AUTO_INCREMENT | |
| route_id | INT | FK → route | |
| bus_id | INT | FK → bus | |
| departure_time | DATETIME | NOT NULL | |
| arrival_time | DATETIME | NOT NULL | |
| base_price | DECIMAL(10,2) | NOT NULL | |
| status | ENUM('OPEN','CANCELED','FULL','COMPLETED') | DEFAULT 'OPEN' | |
| created_at | TIMESTAMP | | |
| notes | TEXT | | |

**Computed (runtime)**: `available_seats = total_seats - COUNT(DISTINCT booking_detail.seat_id WHERE booking.status IN ('PAID','PENDING','CONFIRMED'))`

**Seed data**: 8 chuyến

---

### 7. `booking`
Phiếu đặt vé.

| Column | Type | Constraint | Mô tả |
|---|---|---|---|
| booking_id | INT | PK AUTO_INCREMENT | |
| user_id | INT | FK → users | |
| trip_id | INT | FK → trip | |
| total_amount | DECIMAL(10,2) | | |
| status | ENUM('PENDING','PAID','CANCELED','CONFIRMED') | DEFAULT 'PENDING' | |
| booking_time | TIMESTAMP | DEFAULT NOW() | |
| payment_method | VARCHAR(50) | | cash/momo/zalopay/vnpay |
| qr_code | TEXT | | Base64 QR |
| notes | TEXT | | |
| contact_name | VARCHAR(100) | | |
| contact_phone | VARCHAR(20) | | |
| contact_email | VARCHAR(100) | | |

**Seed data**: 10 bookings (mix PAID/PENDING/CANCELED)

---

### 8. `booking_detail`
Chi tiết từng ghế trong booking.

| Column | Type | Constraint | Mô tả |
|---|---|---|---|
| booking_detail_id | INT | PK AUTO_INCREMENT | |
| booking_id | INT | FK → booking | |
| seat_id | INT | FK → seat | |
| price | DECIMAL(10,2) | | Giá tại thời điểm đặt |
| passenger_name | VARCHAR(100) | | |
| passenger_phone | VARCHAR(20) | | |
| passenger_id_card | VARCHAR(20) | | |

---

### 9. `review`
Đánh giá chuyến xe.

| Column | Type | Constraint | Mô tả |
|---|---|---|---|
| review_id | INT | PK AUTO_INCREMENT | |
| user_id | INT | FK → users | |
| trip_id | INT | FK → trip | |
| rating | INT | CHECK 1-5 | |
| comment | TEXT | | |
| created_at | TIMESTAMP | | |

**Seed data**: 3 reviews (rating 5, 4, 5)

---

### 10. `user_behavior`
Hành vi người dùng (dữ liệu cho AI recommendation).

| Column | Type | Constraint | Mô tả |
|---|---|---|---|
| behavior_id | INT | PK AUTO_INCREMENT | |
| user_id | INT | FK → users | |
| action_type | VARCHAR(50) | | search/view/book |
| route_id | INT | | |
| trip_id | INT | | |
| origin | VARCHAR(100) | | |
| destination | VARCHAR(100) | | |
| created_at | TIMESTAMP | | |

---

### 11. `payment`
Giao dịch thanh toán.

| Column | Type | Constraint | Mô tả |
|---|---|---|---|
| payment_id | INT | PK AUTO_INCREMENT | |
| booking_id | INT | FK → booking | |
| amount | DECIMAL(10,2) | | |
| method | VARCHAR(50) | | momo/zalopay/vnpay/cash |
| status | ENUM('PENDING','SUCCESS','FAILED','REFUNDED') | | |
| transaction_id | VARCHAR(100) | | ID từ payment gateway |
| payment_time | TIMESTAMP | | |
| gateway_response | TEXT | | JSON response từ gateway |

**Seed data**: 9 payments

---

### 12. `support_request`
Yêu cầu hỗ trợ.

| Column | Type | Constraint | Mô tả |
|---|---|---|---|
| request_id | INT | PK AUTO_INCREMENT | |
| user_id | INT | FK → users | |
| subject | VARCHAR(200) | | |
| message | TEXT | | |
| status | ENUM('OPEN','IN_PROGRESS','RESOLVED','CLOSED') | DEFAULT 'OPEN' | |
| created_at | TIMESTAMP | | |
| admin_response | TEXT | | |
| resolved_at | TIMESTAMP | | |

**Seed data**: 7 requests

---

### 13. `ai_recommendation`
Cache kết quả AI recommendation.

| Column | Type | Constraint | Mô tả |
|---|---|---|---|
| rec_id | INT | PK AUTO_INCREMENT | |
| user_id | INT | FK → users | |
| route_id | INT | FK → route | |
| score | DECIMAL(5,2) | | 0–100 |
| algorithm | VARCHAR(50) | | collaborative_filtering/popularity_based |
| created_at | TIMESTAMP | | |

**Seed data**: 2 records

---

### 14. `loyalty_transactions` *(runtime-created)*
Lịch sử giao dịch điểm thưởng. Được tạo tự động bởi `loyaltyService.js` qua `CREATE TABLE IF NOT EXISTS`.

| Column | Type | Mô tả |
|---|---|---|
| id | INT PK | |
| user_id | INT | FK → users |
| booking_id | INT | |
| type | ENUM('EARN','REDEEM','BONUS','EXPIRE') | |
| points | INT | |
| balance_after | INT | |
| description | VARCHAR(255) | |
| created_at | TIMESTAMP | |

---

## LOYALTY SYSTEM

| Tier | Điểm yêu cầu | Discount | Màu |
|---|---|---|---|
| BRONZE | 0 | 0% | #cd7f32 |
| SILVER | 500 | 5% | #c0c0c0 |
| GOLD | 2000 | 10% | #ffd700 |
| DIAMOND | 5000 | 15% | #b9f2ff |

**Tích điểm**: 1,000 VND = 1 điểm
**Đổi điểm**: 100 điểm = 10,000 VND giảm giá

---

## INDEXES QUAN TRỌNG

- `users(email)` UNIQUE
- `users(username)` UNIQUE
- `bus(plate_number)` UNIQUE
- `trip(departure_time)` — quan trọng cho search
- `booking(user_id)`, `booking(trip_id)`, `booking(status)`
- `booking_detail(booking_id)`, `booking_detail(seat_id)`

---

## GHI CHÚ

1. `available_seats` không được lưu trong DB — tính tại query time bằng `total_seats - COUNT(DISTINCT booking_detail.seat_id)`
2. Migration files (`migrate_v3.sql`, `migrate_v4.sql`) có thể thêm columns mà schema chính chưa có
3. `loyalty_points`, `loyalty_tier` được thêm vào `users` bằng `ALTER TABLE IF NOT EXISTS` — MySQL 5.x không hỗ trợ, silent fail
4. Virtual trip IDs (dạng `"123_v5"`) không tồn tại trong DB, chỉ dùng cho transit routing
