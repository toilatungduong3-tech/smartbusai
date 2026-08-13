# SMARTBUSAI — DEFENSE READINESS REPORT
**Chuẩn bị Bảo vệ Đồ án Tốt nghiệp**
Generated: 2026-08-13

---

## TỔNG ĐÁNH GIÁ

| Hạng mục | Điểm | Nhận xét |
|---|---|---|
| Phạm vi tính năng | 8.5/10 | Vượt xa scope đề tài gốc |
| Chất lượng kỹ thuật | 7/10 | AI thực, thuật toán thực, bảo mật cần hoàn thiện |
| Truy vết yêu cầu | 6/10 | ~68% user stories có evidence trong code |
| Tài liệu | 5/10 | Code tốt nhưng thiếu diagrams, SRS, báo cáo |
| Kiểm thử | 5/10 | Có test files nhưng coverage thấp |
| Sẵn sàng demo | 8/10 | Hệ thống chạy được, UI hoàn chỉnh |

---

## ĐIỂM MẠNH (Nên nhấn mạnh khi bảo vệ)

### 1. Thuật toán Transit Routing Thực Sự Hoạt Động
- BFS/Dijkstra trong `transitRouter.js` với 3 optimize modes (time/cost/hops)
- Virtual trip projection ±16 ngày để tìm kết nối
- Min/max transfer time validation (30min – 16h)
- **Demo**: Tìm tuyến HCM → Hà Nội không trực tiếp → hệ thống tìm được trung chuyển

### 2. AI Recommendation Có Triết Lý Rõ Ràng
- User-based Collaborative Filtering với cosine similarity ngầm
- Cold start problem có giải pháp (fallback popular routes)
- Weighted score breakdown (4 factors: user_history 40%, booking 25%, popularity 20%, price 15%)
- **Demo**: So sánh gợi ý cho user có lịch sử vs. user mới

### 3. Dynamic Pricing Engine Có Logic Kinh Doanh
- Multiplier dựa trên 2 factors: days_until_departure + occupancy_rate
- Early bird discount, last-minute surcharge, scarcity surcharge
- **Demo**: Chọn 2 chuyến giống nhau, 1 sắp khởi hành + 1 còn nhiều ghế → khác giá

### 4. Real-time Seat Locking
- Socket.io seat lock với 5-phút timeout
- Broadcast cho tất cả users trong cùng trip room
- **Demo**: Mở 2 tab cùng lúc, lock ghế ở tab 1 → tab 2 thấy ghế bị khóa ngay

### 5. Hệ sinh thái tính năng vượt scope
- Payment gateways (MoMo/ZaloPay/VNPay) thực sự implemented
- Loyalty Program 4 tiers
- PWA với service worker
- Swagger API documentation

---

## ĐIỂM YẾU (Cần chuẩn bị câu trả lời)

### Q: "Backlog ghi Sprint 3-6 là 0 Done, nhưng code lại có đủ tính năng. Giải thích?"
**A**: Team phát triển song song và không cập nhật backlog status đúng tiến độ. Bằng chứng thực tế là source code chạy được. Đây là bài học về Agile discipline — trong dự án thực tế, team sẽ dùng Jira/Trello để cập nhật real-time.

### Q: "Tại sao không dùng Spring Boot + React như kế hoạch ban đầu?"
**A**: Sau Sprint 1, team quyết định pivot sang Node.js + Vanilla JS vì: (1) Thời gian học Spring Boot/React trong 3 tháng quá ngắn, (2) Node.js cho phép dùng cùng ngôn ngữ JS xuyên suốt full-stack, (3) Vanilla JS đủ để demo tính năng, không cần overhead của framework. Kết quả: delivered được nhiều tính năng hơn dự kiến.

### Q: "API Key AI ở frontend là lỗi bảo mật nghiêm trọng?"
**A**: Đúng, đây là technical debt đã nhận biết. Trong môi trường production, sẽ có proxy layer ở backend (passengerAIController.js) để không expose key. Demo hiện tại chạy trên môi trường dev.

### Q: "Leaflet.js/bản đồ không thấy trong source?"
**A**: Leaflet.js không có trong package.json vì frontend là static HTML — Leaflet được load qua CDN trong HTML. Tọa độ GPS của tất cả routes đã có trong DB (origin_lat/lng, dest_lat/lng). [Cần kiểm tra HTML pages để xác nhận CDN link]

### Q: "Chưa có đánh giá mô hình AI (Precision@3, F1-Score)?"
**A**: Đây là mục tiêu Sprint 5 (US-703) chưa hoàn thành. Để đánh giá offline, cần bộ test data người dùng giả lập. Thay vào đó, đánh giá qua demo live: với user có lịch sử booking HCM-Đà Lạt, model gợi ý đúng tuyến tương tự.

### Q: "Password reset không có OTP có phải lỗ hổng không?"
**A**: Đúng, đây là simplification cho prototype. Trong production sẽ cần: generate token → gửi email verification link → verify token → cho phép reset. Nodemailer đã được cài đặt sẵn.

---

## KỊCH BẢN DEMO KHUYẾN NGHỊ

### Demo 1: Luồng tìm kiếm & trung chuyển (5 phút)
1. Mở trang chủ `/pages/passenger/index.html`
2. Tìm tuyến "Hà Nội → Đà Nẵng" → hiển thị kết quả trực tiếp
3. Tìm tuyến không có direct → hệ thống tìm được 3 phương án trung chuyển
4. Chọn "Nhanh nhất" vs "Rẻ nhất" → giá/thời gian khác nhau
5. Mở Route Detail Modal → xem thông tin đầy đủ

### Demo 2: AI Recommendation (3 phút)
1. Đăng nhập với user có lịch sử booking
2. Scroll xuống section "AI Gợi ý" → thấy gợi ý cá nhân hóa
3. Xem AI Score breakdown (hover card)
4. Chat với AI: hỏi "Chuyến nào từ HCM đi Đà Lạt rẻ nhất?"

### Demo 3: Dynamic Pricing (2 phút)
1. So sánh 2 chuyến cùng tuyến: 1 chuyến ngày mai (near) vs 1 chuyến 30 ngày sau (far)
2. Chuyến ngày mai có surge badge + giá cao hơn

### Demo 4: Real-time Seat Lock (3 phút)
1. Mở 2 tab cùng booking page cùng trip
2. Tab 1: click chọn ghế A1 → ghế đổi màu locked
3. Tab 2: refresh → thấy ghế A1 đã bị khóa ngay lập tức

### Demo 5: Admin Dashboard (2 phút)
1. Đăng nhập admin
2. Xem stats: tổng doanh thu, bookings, users
3. Biểu đồ doanh thu 6 tháng (Chart.js)

---

## CHECKLIST TRƯỚC BUỔI BẢO VỆ

### Kỹ thuật
- [ ] Server chạy được (npm start tại port 2704)
- [ ] MySQL XAMPP đang chạy với database `smartbusai`
- [ ] Seed data đầy đủ (8 operators, 13 routes, 8 trips, 10 bookings)
- [ ] Test tìm kiếm trực tiếp hoạt động
- [ ] Test transit routing hoạt động (ít nhất 1 cặp không có direct route)
- [ ] AI recommendation trả về kết quả (cần user có booking history)
- [ ] Payment gateways: cần test/sandbox credentials

### Tài liệu
- [ ] Swagger docs tại /api-docs
- [ ] Báo cáo kỹ thuật (file này)
- [ ] Slide bảo vệ chuẩn bị
- [ ] ERD/Database diagram (export từ MySQL Workbench)

### Backup
- [ ] Chạy `git commit` toàn bộ changes
- [ ] Backup database dump
- [ ] Screenshot các màn hình demo nếu live demo fail

---

## CÂU HỎI KỸ THUẬT CÓ THỂ BỊ HỎI

| Câu hỏi | Trả lời ngắn |
|---|---|
| BFS vs Dijkstra khác nhau thế nào? | BFS tìm theo số hops (unweighted), Dijkstra tìm theo cost/time (weighted). transitRouter.js dùng cả hai tùy `mode` param |
| Collaborative Filtering hoạt động thế nào? | Tìm users có lịch sử booking tương đồng → gợi ý routes họ book nhưng user hiện tại chưa book |
| Cold start problem là gì và giải quyết thế nào? | User mới không có lịch sử → fallback sang tuyến phổ biến toàn cục |
| Dynamic pricing tính thế nào? | multiplier = f(days_until_departure) × f(occupancy_rate) × base_price |
| Socket.io dùng cho gì? | Real-time seat locking — khi user A chọn ghế, user B thấy ngay không cần refresh |
| JWT và localStorage session có an toàn không? | Trong scope demo OK. Production cần HTTPS + httpOnly cookie + token rotation |
| Tại sao chọn Node.js thay Spring Boot? | Full-stack JS, nhanh hơn để prototype, team đã quen |
| Database có index chưa? | Unique indexes trên email, username, plate_number. Cần thêm index trên departure_time, route FK |
