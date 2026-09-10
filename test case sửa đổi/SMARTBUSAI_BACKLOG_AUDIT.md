# SMARTBUSAI — BACKLOG AUDIT
**So sánh Product Backlog vs. Trạng thái Cài đặt Thực tế**
Source: Product Backlog Excel (8 sheets) + Codebase audit
Generated: 2026-08-13

> **Quy tắc**: SOURCE CODE > DATABASE > RUNTIME EVIDENCE > PRODUCT BACKLOG STATUS
> Status trong backlog là khai báo của team — không phải bằng chứng hoàn thành.

---

## THÔNG TIN DỰ ÁN

| Chỉ tiêu | Giá trị |
|---|---|
| Trường | ĐH CMC |
| GVHD | ThS. Phạm Ngọc Đông, ThS. Nguyễn Khánh Tùng |
| Thời gian | 01/06/2026 – 30/08/2026 |
| Sprints | 6 Sprint × 2 tuần |

### Thành viên nhóm

| Tên | Vai trò chính |
|---|---|
| Phạm Nguyễn Tùng Dương | Nhóm trưởng, Backend, DB, API |
| Nguyễn Khắc Tuấn Bách | Dữ liệu, QA, Testing |
| Lê Đức Anh | Thuật toán tìm kiếm/transit |
| Nguyễn Hồng Nhung | AI Recommendation |
| Nguyễn Thanh Lâm | Frontend/UI |

---

## THAY ĐỔI CÔNG NGHỆ (CÓ BẰNG CHỨNG)

> **Quan trọng**: Backlog kế hoạch != Cài đặt thực tế

| Thành phần | Backlog dự kiến | Thực tế (verified) |
|---|---|---|
| Backend framework | Spring Boot | Node.js + Express ^5.2.1 |
| Frontend | React | Vanilla HTML/CSS/JavaScript |
| Bản đồ | Leaflet.js / OpenStreetMap | Không có Leaflet trong source (chỉ nhắc đến trong comment) |
| AI library | scikit-learn / Surprise | Custom implementation trong Node.js |
| Excel import | Apache POI | Không có trong source |
| Database | MySQL (giữ nguyên) | MySQL ✅ |
| Thuật toán | BFS/Dijkstra | BFS/Dijkstra ✅ (triển khai trong Node.js) |
| CI/CD | GitHub Actions | ✅ `.github/workflows/ci-cd.yml` |

**Nhận xét**: Nhóm đã pivot từ Spring Boot + React sang Node.js + Vanilla JS. Đây là thay đổi architecture lớn không được phản ánh trong backlog. Stack thực tế đơn giản hơn nhưng đã delivered được nhiều tính năng.

---

## AUDIT THEO EPIC

### EPIC 0: Phân tích yêu cầu & Lập kế hoạch

| Story | Backlog Status | Evidence trong code |
|---|---|---|
| US-001 SRS analysis | Done (backlog) | Không có SRS doc trong repo |
| US-002 Use Case Diagram | In Progress (backlog) | Không có diagram file trong repo |
| US-003 Technology Stack | Done | ✅ stack chọn Node.js thay Spring Boot |
| US-004 Product Backlog | Done | ✅ file Excel tồn tại |
| US-005 Route data research | Done | ✅ 13 routes trong DB |
| US-006 AI technique research | Done | ✅ Collaborative Filtering triển khai |
| US-007 Wireframes | Done | Không có file wireframe trong repo |

---

### EPIC 0B: Thiết kế hệ thống & Kiến trúc

| Story | Backlog Status | Evidence trong code |
|---|---|---|
| US-008 Architecture design | Done | ✅ server.js thể hiện 3-tier architecture |
| US-009 ERD design | In Progress | ✅ 13 tables trong smartbusai.sql |
| US-010 API Contract (Swagger) | In Progress | ✅ swagger.js + /api-docs endpoint |
| US-011 Algorithm design | Done (thuật toán) / To Do (review) | ✅ transitRouter.js BFS/Dijkstra |
| US-012 AI data model | Done | ✅ user_behavior, ai_recommendation tables |
| US-013 Class/Sequence Diagrams | In Progress | Không có diagram file trong repo |

---

### EPIC 1xx: Quản lý tuyến xe (Admin)

| Story | Backlog Status | Evidence trong code |
|---|---|---|
| US-101 Thêm/sửa/xóa tuyến xe | Done (API) / Done (UI) | ✅ `/api/buses`, `/api/operators` + admin.html |
| US-102 Import Excel/CSV tuyến xe | Done (Apache POI) / To Do (test) | ❌ Không có import Excel feature trong source |
| US-103 Quản lý giờ chạy và giá vé | Done (API) / To Do (UI+data) | ✅ tripController CRUD, tripRoutes |

---

### EPIC 2xx: Quản lý địa điểm

| Story | Backlog Status | Evidence trong code |
|---|---|---|
| US-201 Thêm/sửa điểm đi/đến GPS | Done (API) | ✅ locationRoutes.js, route table với lat/lng |
| US-202 Autocomplete tìm kiếm | Done/In Progress | ✅ Frontend search với suggestions |

---

### EPIC 3xx: Tìm kiếm tuyến trực tiếp

| Story | Backlog Status | Evidence trong code |
|---|---|---|
| US-301 Tìm kiếm tuyến trực tiếp | Done (engine) / In Progress (UI+API) | ✅ searchController + /api/search endpoint |
| US-302 Lọc kết quả (giờ, giá, nhà xe) | In Progress | ✅ `busType`, `sort` params trong searchTrips |
| US-303 Chi tiết chuyến xe | Done (API) / In Progress (UI) | ✅ Trip detail modal trong index.html |

---

### EPIC 4xx: Hành trình trung chuyển

| Story | Backlog Status | Evidence trong code |
|---|---|---|
| US-401 BFS/Dijkstra transit routing | Done | ✅ transitRouter.js — đầy đủ, hoạt động |
| "Nhanh nhất/Rẻ nhất" badge | Done (backlog) | ✅ `/api/search/transit?mode=time\|cost\|hops` |

---

### EPIC 5xx: Điểm đón trả

| Story | Backlog Status | Evidence trong code |
|---|---|---|
| US-501 Quản lý điểm đón trả GPS | Done | ✅ routeStopController + routeStopRoutes |
| US-502 Gợi ý điểm đón trả theo GPS | Done (API) / To Do (UI hiển thị) | ✅ `/api/location/nearby` + Haversine |

---

### EPIC 6xx: Bản đồ Leaflet

| Story | Backlog Status | Evidence trong code |
|---|---|---|
| US-601 Vẽ lộ trình Leaflet | Done (backlog) | ❓ Leaflet không có trong package.json; chưa xác nhận tích hợp đầy đủ trong frontend |
| US-602 So sánh đa phương án bản đồ | To Do | ❌ Không có evidence trong source |

---

### EPIC 7xx: AI Recommendation

| Story | Backlog Status | Evidence trong code |
|---|---|---|
| US-701 Collaborative Filtering | To Do (backlog Sprint 5) | ✅ recommendation.js — fully implemented |
| US-702 Tuyến phổ biến | To Do | ✅ `/api/recommendations/popular` |
| US-703 Đánh giá mô hình (Precision@3, F1) | To Do | ❌ Không có evaluation script |

**Nhận xét**: AI Recommendation đã được implement trước Sprint 5 (backlog). Nhưng không có evaluation metrics (Precision@3, Recall, F1) như yêu cầu.

---

### EPIC 8xx: Dashboard Admin

| Story | Backlog Status | Evidence trong code |
|---|---|---|
| US-801 Dashboard top routes + chart | To Do | ✅ adminController getStats, getTopRoutes + Chart.js trong admin.html |
| US-802 Thống kê điểm trung chuyển | To Do | ❌ Không có `/api/analytics/transfer-points` |

---

### EPIC 9xx: Quản lý người dùng (Admin)

| Story | Backlog Status | Evidence trong code |
|---|---|---|
| US-903 Khóa/mở tài khoản, phân quyền | Done (API) | ✅ userController + updateUser (role, status) |

---

### EPIC 10xx: Kiểm thử (Sprint 6)

| Story | Backlog Status | Evidence trong code |
|---|---|---|
| US-1001 Test tìm kiếm >50 ca | To Do | ✅ tests/transitRouter.test.js + tests/sprint3.test.js |
| US-1002 Kiểm thử 100% dữ liệu | To Do | 13 routes trong DB — chưa đủ 30+ như kế hoạch |
| US-1003 Tối ưu <3s response | To Do | Chưa có benchmark |
| US-1004 Cross-browser/responsive test | To Do | Chưa có |

---

### EPIC 11xx: Báo cáo & Bảo vệ (Sprint 6)

| Story | Backlog Status | Evidence |
|---|---|---|
| US-1101 Báo cáo 6 chương | To Do | `/docs/` directory có một số docs |
| US-1102 Slide bảo vệ | To Do | — |

---

## TỔNG KẾT STORY POINTS THEO SPRINT

| Sprint | Thời gian | Tổng SP (backlog) | Done SP (backlog) | Ghi chú |
|---|---|---|---|---|
| Sprint 1 | 01-15/06 | 31 | 22 | Done |
| Sprint 2 | 16-30/06 | ~30 | ~20 | In Progress |
| Sprint 3 | 01-15/07 | 55 | 0 | Báo cáo "To Do" toàn bộ |
| Sprint 4 | 16-31/07 | 67 | 0 | Báo cáo "To Do" toàn bộ |
| Sprint 5 | 01-15/08 | 44 | 0 | Báo cáo "To Do" toàn bộ |
| Sprint 6 | 16-30/08 | 59 | 0 | Báo cáo "To Do" toàn bộ |

**Cảnh báo quan trọng**: Backlog ghi nhận Sprint 3-6 có 0 Done Story Points, nhưng codebase cho thấy hầu hết tính năng đã được triển khai. Điều này cho thấy team **không cập nhật backlog** song song với việc code — backlog không phản ánh thực trạng code.

---

## CÁC TÍNH NĂNG IMPLEMENTED NHƯNG KHÔNG CÓ TRONG BACKLOG GỐC

(Những tính năng này xuất hiện trong source code nhưng không được lên kế hoạch trong Product Backlog)

| Tính năng | Vị trí |
|---|---|
| Đặt vé + chọn ghế (booking flow) | bookingController.js, seats UI |
| Thanh toán MoMo/ZaloPay/VNPay | paymentService.js, paymentRoutes |
| Socket.io real-time seat locking | server.js, index.html |
| Dynamic Pricing Engine | pricingEngine.js, tripController |
| Loyalty Points (Bronze/Silver/Gold/Diamond) | loyaltyService.js |
| QR Code vé | qrService.js |
| Nhắc nhở chuyến xe qua email | emailService.js |
| Operator Dashboard (doanh thu, thống kê) | operatorController.js |
| PWA Service Worker | public/sw.js |
| Auto-generate recurring trips | tripController.autoGenerateRecurringTrips |
| Chat AI (Claude API) | passengerAIController.js |
| Review/Rating chuyến xe | reviewController.js |
| Support Request | supportController.js |

**Nhận xét**: Sản phẩm thực tế vượt xa scope được định nghĩa trong Product Backlog. Nhóm đã tự thêm nhiều tính năng thương mại (payment, loyalty, booking) nằm ngoài đề tài gốc về "tìm kiếm và gợi ý hành trình".
