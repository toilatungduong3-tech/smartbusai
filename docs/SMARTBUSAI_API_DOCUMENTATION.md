# SMARTBUSAI — API DOCUMENTATION
**Source-of-truth: server/routes/*.js + server/controllers/*.js**
Generated: 2026-08-13

> Base URL: `http://localhost:2704/api`
> Auth: `Authorization: Bearer <access_token>`
> Swagger UI: `http://localhost:2704/api-docs`

---

## AUTH `/api/auth`

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| POST | `/register` | ❌ | Đăng ký (username, full_name, email, password, phone, gender, birth_date, province, district, address_detail). Yêu cầu tuổi ≥ 15 |
| POST | `/login` | ❌ | Đăng nhập → `{ accessToken, refreshToken, user }` |
| POST | `/refresh` | ❌ | Làm mới access token |
| POST | `/logout` | ✅ | Đăng xuất |
| POST | `/check-email` | ❌ | Kiểm tra email tồn tại (forgot-password step 1) |
| POST | `/reset-password` | ❌ | Đặt lại mật khẩu bằng email + new_password |
| GET | `/me` | ✅ | Lấy thông tin user hiện tại |

**Rate limit**: 10 login attempts / 15 phút

---

## TRIPS `/api/trips`

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| GET | `/` | ❌ | Lấy tất cả chuyến sắp khởi hành (lọc theo bus_id, operator_id) |
| GET | `/search` | ❌ | Tìm chuyến (origin, destination, date, busType, sort) |
| GET | `/running` | ❌ | Chuyến đang chạy (departure≤NOW≤arrival) |
| GET | `/:id` | ❌ | Chi tiết 1 chuyến |
| POST | `/` | ✅ OPERATOR | Tạo chuyến mới |
| PUT | `/:id` | ✅ OPERATOR | Cập nhật chuyến |
| DELETE | `/:id` | ✅ OPERATOR | Xóa chuyến |
| PATCH | `/:id/status` | ✅ OPERATOR | Cập nhật trạng thái (OPEN/CANCELED/FULL) |
| PATCH | `/:id/price` | ✅ OPERATOR | Cập nhật giá |
| GET | `/dynamic-price/:id` | ❌ | Lấy giá động (pricingEngine) |
| POST | `/auto-generate` | ✅ ADMIN | Tự động tạo chuyến lặp lại |

**Search params**: `origin`, `destination`, `date` (YYYY-MM-DD), `busType` (LIMOUSINE/STANDARD/VIP), `sort` (price_asc/price_desc/time_asc)

---

## BOOKINGS `/api/bookings`

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| GET | `/` | ✅ ADMIN | Tất cả đặt vé |
| GET | `/my` | ✅ | Đặt vé của user hiện tại |
| GET | `/:id` | ✅ | Chi tiết 1 booking |
| POST | `/` | ✅ | Tạo booking (transaction: lock seats → create booking → create booking_details → generate QR) |
| PATCH | `/:id/status` | ✅ | Cập nhật trạng thái (PAID/CANCELED/CONFIRMED) |
| GET | `/:id/qr` | ✅ | Lấy QR code |

**Create booking body**: `{ trip_id, seat_ids[], total_amount, payment_method }`

---

## USERS `/api/users`

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| GET | `/` | ✅ ADMIN | Tất cả users |
| GET | `/:id` | ✅ | User theo ID |
| PUT | `/:id` | ✅ | Cập nhật user (role, status, profile fields) |
| DELETE | `/:id` | ✅ ADMIN | Xóa user |
| GET | `/:id/loyalty` | ✅ | Loyalty points + tier info |
| POST | `/:id/loyalty/redeem` | ✅ | Đổi điểm thưởng |

---

## BUSES `/api/buses`

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| GET | `/` | ❌ | Tất cả xe (lọc theo operator_id) |
| GET | `/:id` | ❌ | Chi tiết xe |
| POST | `/` | ✅ OPERATOR | Thêm xe |
| PUT | `/:id` | ✅ OPERATOR | Cập nhật xe |
| DELETE | `/:id` | ✅ OPERATOR | Xóa xe |
| PATCH | `/:id/status` | ✅ OPERATOR | Cập nhật trạng thái |

---

## OPERATORS `/api/operators`

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| GET | `/` | ❌ | Danh sách nhà xe |
| GET | `/:id` | ❌ | Chi tiết nhà xe |
| POST | `/` | ✅ ADMIN | Tạo nhà xe |
| PUT | `/:id` | ✅ | Cập nhật nhà xe |
| DELETE | `/:id` | ✅ ADMIN | Xóa nhà xe |
| GET | `/:id/dashboard/stats` | ✅ OPERATOR | Thống kê dashboard |
| GET | `/:id/dashboard/revenue` | ✅ OPERATOR | Doanh thu |
| GET | `/:id/dashboard/routes` | ✅ OPERATOR | Tuyến đường |
| GET | `/:id/dashboard/booking-status` | ✅ OPERATOR | Trạng thái đặt vé |
| GET | `/:id/dashboard/seat-occupancy` | ✅ OPERATOR | Tỷ lệ lấp đầy ghế |
| GET | `/:id/dashboard/recent-trips` | ✅ OPERATOR | Chuyến gần đây |
| GET | `/:id/dashboard/buses` | ✅ OPERATOR | Danh sách xe |
| GET | `/:id/dashboard/reviews` | ✅ OPERATOR | Đánh giá |
| GET | `/:id/dashboard/payments` | ✅ OPERATOR | Thanh toán |
| GET | `/:id/dashboard/bookings` | ✅ OPERATOR | Đặt vé |

---

## ADMIN `/api/admin`

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| GET | `/stats` | ✅ ADMIN | Thống kê tổng quan (totalRevenue, totalBookings, totalUsers, ...) |
| GET | `/revenue` | ✅ ADMIN | Doanh thu 6 tháng |
| GET | `/bookings-per-day` | ✅ ADMIN | Đặt vé theo ngày |
| GET | `/top-routes` | ✅ ADMIN | Tuyến phổ biến |
| GET | `/bookings` | ✅ ADMIN | Tất cả booking |
| GET | `/users` | ✅ ADMIN | Tất cả users |
| GET | `/trips` | ✅ ADMIN | Tất cả trips |
| GET | `/ai-analytics` | ✅ ADMIN | AI analytics |

---

## SEATS `/api/seats`

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| GET | `/trip/:tripId` | ❌ | Sơ đồ ghế của chuyến |
| POST | `/generate` | ✅ OPERATOR | Tạo ghế cho xe |
| PATCH | `/:id` | ✅ | Cập nhật trạng thái ghế |

---

## SEARCH `/api/search`

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| GET | `/` | ❌ | Tìm kiếm nâng cao |
| GET | `/transit` | ❌ | Tìm hành trình trung chuyển (multi-hop BFS) |
| GET | `/nearby` | ❌ | Tìm bến xe gần theo tọa độ GPS |

**Transit params**: `origin`, `destination`, `date`, `mode` (time/cost/hops)
**Nearby params**: `lat`, `lng`, `radius` (km, default 50)

---

## RECOMMENDATIONS `/api/recommendations`

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| GET | `/` | ✅ | Gợi ý tuyến cá nhân hóa (collaborative filtering) |
| GET | `/popular` | ❌ | Tuyến phổ biến (cold-start fallback) |
| POST | `/behavior` | ✅ | Ghi nhận hành vi người dùng |

---

## PAYMENT `/api/payment`

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| POST | `/momo` | ✅ | Tạo thanh toán MoMo → `{ payUrl }` |
| GET | `/momo/return` | ❌ | MoMo IPN callback |
| POST | `/zalopay` | ✅ | Tạo thanh toán ZaloPay |
| GET | `/zalopay/callback` | ❌ | ZaloPay callback |
| POST | `/vnpay` | ✅ | Tạo thanh toán VNPay |
| GET | `/vnpay/return` | ❌ | VNPay return URL |

---

## REVIEWS `/api/reviews`

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| GET | `/trip/:tripId` | ❌ | Đánh giá của chuyến |
| POST | `/` | ✅ | Tạo đánh giá (trip_id, rating 1-5, comment) |

---

## SUPPORT `/api/support`

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| GET | `/` | ✅ ADMIN | Tất cả yêu cầu hỗ trợ |
| POST | `/` | ✅ | Gửi yêu cầu hỗ trợ |
| PATCH | `/:id/status` | ✅ ADMIN | Cập nhật trạng thái |

---

## ROUTE STOPS `/api/route-stops`

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| GET | `/route/:routeId` | ❌ | Điểm dừng của tuyến |
| POST | `/` | ✅ OPERATOR | Thêm điểm dừng |
| DELETE | `/:id` | ✅ OPERATOR | Xóa điểm dừng |

---

## LOCATION `/api/location`

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| GET | `/nearby` | ❌ | Bến xe gần theo GPS |
| GET | `/provinces` | ❌ | Danh sách tỉnh thành |

---

## PASSENGER AI `/api/passenger-ai`

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| POST | `/chat` | ✅ | Chat với AI (Claude API) |
| GET | `/recommendations` | ✅ | Gợi ý AI cho hành khách |

---

## SETTINGS `/api/settings`

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| GET | `/` | ✅ ADMIN | Cài đặt hệ thống |
| PUT | `/` | ✅ ADMIN | Cập nhật cài đặt |

---

## SOCKET.IO EVENTS

| Event | Direction | Payload | Mô tả |
|---|---|---|---|
| `join_trip` | Client→Server | `{ tripId }` | Tham gia phòng chuyến xe |
| `lock_seat` | Client→Server | `{ tripId, seatId, userId }` | Khóa ghế tạm thời (5 phút) |
| `seat_locked` | Server→Client | `{ seatId, userId }` | Broadcast khi ghế bị khóa |
| `seat_released` | Server→Client | `{ seatId }` | Broadcast khi ghế được giải phóng |
| `seat_confirmed` | Server→Client | `{ seatId }` | Broadcast khi booking xác nhận |

---

## RESPONSE FORMAT

**Success:**
```json
{ "data": ..., "message": "..." }
```

**Error:**
```json
{ "message": "Error description" }
```

**HTTP Status Codes:**
- 200: OK
- 201: Created
- 400: Bad Request
- 401: Unauthorized (missing/invalid token)
- 403: Forbidden (wrong role)
- 404: Not Found
- 429: Too Many Requests (rate limited)
- 500: Internal Server Error
