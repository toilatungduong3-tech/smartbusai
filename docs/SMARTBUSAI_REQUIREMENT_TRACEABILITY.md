# SMARTBUSAI — REQUIREMENT TRACEABILITY MATRIX
**Truy vết yêu cầu từ Phiếu giao đề tài → Product Backlog → Source Code**
Generated: 2026-08-13

> **RTM Rule**: Chỉ đánh dấu IMPLEMENTED khi có bằng chứng trong source code.
> Status "Done" trong backlog KHÔNG đủ để xác nhận hoàn thành.

---

## MỤC TIÊU ĐỀ TÀI (từ Phiếu giao đề tài & Product Goals)

| ID | Mục tiêu | Backlog Epic | Trạng thái Code | File bằng chứng |
|---|---|---|---|---|
| G1 | Hệ thống web tìm kiếm hành trình xe khách theo điểm đi, điểm đến, thời gian | EPIC 3xx | ✅ Implemented | searchController.js, tripController.searchTrips |
| G2 | Tuyến trực tiếp + hành trình trung chuyển + gợi ý điểm đón trả theo GPS | EPIC 3xx, 4xx, 5xx | ✅ Implemented | transitRouter.js, routeStopController.js |
| G3 | CSDL quản lý tuyến xe, điểm đón trả, giờ chạy, giá vé | EPIC 1xx, 2xx | ✅ Implemented | smartbusai.sql (13 tables) |
| G4 | Bản đồ số Leaflet/OpenStreetMap hiển thị lộ trình | EPIC 6xx | ⚠️ Partial | Không tìm thấy Leaflet trong package.json; GPS coords có trong DB |
| G5 | Gợi ý AI dựa trên lịch sử tìm kiếm và hành vi người dùng | EPIC 7xx | ✅ Implemented | recommendation.js (collaborative filtering) |
| G6 | Báo cáo thống kê tuyến phổ biến và điểm trung chuyển tối ưu | EPIC 8xx | ⚠️ Partial | adminController (top routes ✅, transfer stats ❌) |
| G7 | Tài liệu phân tích, thiết kế, kiểm thử, báo cáo đồ án | EPIC 11xx | ⚠️ Partial | docs/ directory + tests/ |

---

## TRUY VẾT THEO USER STORY

### EPIC 0 & 0B: Phân tích & Thiết kế

| US ID | User Story | Backlog | Code Evidence | Verdict |
|---|---|---|---|---|
| US-001 | SRS analysis | Done | ❌ Không có SRS trong repo | KHÔNG XÁC NHẬN |
| US-002 | Use Case Diagram | In Progress | ❌ Không có diagram | KHÔNG XÁC NHẬN |
| US-003 | Technology Stack choice | Done | ✅ package.json (Node.js, Express) | XÁC NHẬN (pivot sang Node.js) |
| US-004 | Product Backlog + Sprint plan | Done | ✅ Excel file tồn tại | XÁC NHẬN |
| US-005 | Route data research | Done | ✅ 13 routes với GPS coords trong DB | XÁC NHẬN |
| US-006 | AI technique research | Done | ✅ Collaborative Filtering implemented | XÁC NHẬN |
| US-007 | Wireframes | Done | ❌ Không có file wireframe trong repo | KHÔNG XÁC NHẬN |
| US-008 | System architecture | Done | ✅ server.js (3-tier MVC) | XÁC NHẬN |
| US-009 | ERD design | In Progress | ✅ 13 tables trong SQL | XÁC NHẬN |
| US-010 | API contract (Swagger) | In Progress | ✅ swagger.js + /api-docs | XÁC NHẬN |
| US-011 | Algorithm design (BFS/Dijkstra) | Done | ✅ transitRouter.js | XÁC NHẬN |
| US-012 | AI data model | Done | ✅ user_behavior, ai_recommendation tables | XÁC NHẬN |
| US-013 | Class/Sequence Diagrams | In Progress | ❌ Không có diagram file | KHÔNG XÁC NHẬN |

### EPIC 1xx: Quản lý tuyến xe

| US ID | User Story | Code Evidence | Verdict |
|---|---|---|---|
| US-101 | Admin thêm/sửa/xóa tuyến xe | ✅ busController + operatorRoutes + tripController | XÁC NHẬN |
| US-102 | Import Excel/CSV tuyến xe (Apache POI) | ❌ Không có import feature | CHƯA IMPLEMENT |
| US-103 | Quản lý giờ chạy và giá vé | ✅ trip CRUD trong tripController | XÁC NHẬN |

### EPIC 2xx: Quản lý địa điểm

| US ID | User Story | Code Evidence | Verdict |
|---|---|---|---|
| US-201 | Thêm/sửa điểm đi/đến kèm GPS | ✅ route table (origin_lat/lng, dest_lat/lng) | XÁC NHẬN |
| US-202 | Autocomplete tìm kiếm địa điểm | ✅ Frontend autocomplete trong index.html | XÁC NHẬN |

### EPIC 3xx: Tìm kiếm trực tiếp

| US ID | User Story | Code Evidence | Verdict |
|---|---|---|---|
| US-301 | Tìm tuyến trực tiếp theo ngày | ✅ searchController + searchRoutes | XÁC NHẬN |
| US-302 | Lọc kết quả (giờ, giá, nhà xe) | ✅ busType, sort, origin/destination params | XÁC NHẬN (partial) |
| US-303 | Chi tiết chuyến xe | ✅ Route modal trong index.html | XÁC NHẬN |

### EPIC 4xx: Trung chuyển

| US ID | User Story | Code Evidence | Verdict |
|---|---|---|---|
| US-401 | Hành trình trung chuyển BFS | ✅ transitRouter.js (đầy đủ, có test) | XÁC NHẬN ✅ |

### EPIC 5xx: Điểm đón trả

| US ID | User Story | Code Evidence | Verdict |
|---|---|---|---|
| US-501 | Quản lý điểm đón trả GPS | ✅ routeStopController + routeStopRoutes | XÁC NHẬN |
| US-502 | Gợi ý điểm đón trả theo GPS | ✅ locationRoutes /nearby + Haversine | XÁC NHẬN |

### EPIC 6xx: Bản đồ

| US ID | User Story | Code Evidence | Verdict |
|---|---|---|---|
| US-601 | Bản đồ Leaflet vẽ lộ trình | ⚠️ GPS coords có nhưng Leaflet không trong package.json | PARTIAL |
| US-602 | So sánh đa phương án trên bản đồ | ❌ Không có | CHƯA IMPLEMENT |

### EPIC 7xx: AI Recommendation

| US ID | User Story | Code Evidence | Verdict |
|---|---|---|---|
| US-701 | Gợi ý dựa trên lịch sử tìm kiếm | ✅ recommendation.js collaborative filtering | XÁC NHẬN |
| US-702 | Top tuyến phổ biến (cold start) | ✅ recommendation.js getPersonalizedRoutes cold start | XÁC NHẬN |
| US-703 | Đánh giá mô hình Precision@3 >80% | ❌ Không có evaluation script | CHƯA IMPLEMENT |

### EPIC 8xx: Dashboard thống kê

| US ID | User Story | Code Evidence | Verdict |
|---|---|---|---|
| US-801 | Dashboard top routes + biểu đồ | ✅ adminController + Chart.js trong admin.html | XÁC NHẬN |
| US-802 | Thống kê điểm trung chuyển | ❌ Không có /analytics/transfer-points | CHƯA IMPLEMENT |

### EPIC 9xx: Quản lý người dùng

| US ID | User Story | Code Evidence | Verdict |
|---|---|---|---|
| US-903 | Khóa/mở tài khoản, phân quyền | ✅ userController updateUser (status, role) | XÁC NHẬN |

### EPIC 10xx & 11xx: Kiểm thử & Báo cáo

| US ID | User Story | Code Evidence | Verdict |
|---|---|---|---|
| US-1001 | Test >50 ca tìm kiếm | ✅ tests/transitRouter.test.js + sprint3.test.js | PARTIAL |
| US-1002 | Kiểm thử 100% dữ liệu | ❌ Chưa có validation script | CHƯA IMPLEMENT |
| US-1003 | Tối ưu <3s response | ❌ Chưa có benchmark | CHƯA IMPLEMENT |
| US-1004 | Cross-browser/responsive | ❌ Chưa có | CHƯA IMPLEMENT |
| US-1101 | Báo cáo đồ án | ⚠️ docs/ có một số file | PARTIAL |
| US-1102 | Slide bảo vệ | ❌ Không có trong repo | CHƯA CÓ |

---

## TỔNG KẾT RTM

| Kết quả | Số lượng |
|---|---|
| XÁC NHẬN đầy đủ | 20 |
| PARTIAL (một phần) | 6 |
| CHƯA IMPLEMENT | 8 |
| KHÔNG XÁC NHẬN (tài liệu, diagrams) | 4 |
| **Tổng** | **38** |

**Tỷ lệ tính năng core implemented**: ~68% (20/29 functional stories)

---

## CÁC YÊU CẦU TRONG SOURCE NHƯNG KHÔNG TRONG BACKLOG

Những tính năng này xuất hiện trong codebase nhưng không có trong Product Backlog gốc — chứng tỏ phạm vi dự án mở rộng đáng kể so với đề tài:

1. **Booking Flow** (chọn ghế, đặt vé, QR code) — bookingController, seatController, qrService
2. **Multi-gateway Payment** (MoMo, ZaloPay, VNPay) — paymentService, paymentRoutes
3. **Dynamic Pricing Engine** — pricingEngine.js
4. **Loyalty Program** (4 tiers, earn/redeem) — loyaltyService.js
5. **Operator Dashboard** (doanh thu, thống kê riêng cho nhà xe) — operatorController
6. **Real-time Seat Locking** (Socket.io) — server.js
7. **Email Reminders** (cronjob) — emailService.js
8. **AI Chat Interface** (Claude API) — passengerAIController
9. **Auto-generate Recurring Trips** — tripController
10. **PWA/Service Worker** — public/sw.js
11. **Price Prediction (Linear Regression)** — recommendation.js
12. **Review/Rating System** — reviewController
13. **Support Request System** — supportController
