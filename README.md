🚍 HỆ THỐNG ĐẶT VÉ XE TRỰC TUYẾN TÍCH HỢP AI AGENT
📌 Giới thiệu

Đây là hệ thống đặt vé xe trực tuyến cho phép người dùng:

Tìm kiếm chuyến xe
Đặt vé
Chọn ghế
Thanh toán (giả lập)
Quản lý chuyến đi

Ngoài ra hệ thống có tích hợp AI Agent hỗ trợ:

Gợi ý chuyến xe phù hợp
Tự động trả lời hỗ trợ người dùng
Phân tích hành vi đặt vé
🛠 Công nghệ sử dụng
Backend
Node.js (Express)
MySQL (quản lý bằng phpMyAdmin)
Frontend
HTML, CSS, JS
AI Agent
Xử lý logic gợi ý & hỗ trợ (custom logic / API)
📁 Cấu trúc thư mục
smartbusai/
│
├── server/
│   ├── controllers/      # Xử lý logic
│   ├── routes/           # Định nghĩa API
│   ├── middleware/       # Xác thực, bảo mật
│   └── server.js         # File chạy chính
│
├── client/ (nếu có)
├── README.md
⚙️ Cài đặt hệ thống
1. Clone project
git clone https://github.com/your-repo/smartbusai.git
cd smartbusai
2. Cài dependencies
npm install
3. Cấu hình database (MySQL - phpMyAdmin)
Mở phpMyAdmin
Tạo database:
smartbusai
Import file .sql (nếu có)
4. Cấu hình kết nối database

Mở file (thường là config hoặc trong server.js), sửa:

const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "",
    database: "smartbusai"
});
▶️ Chạy hệ thống

Chạy bằng lệnh:

node server/server.js
🌐 Thông tin server
Port: 2704
URL:
http://localhost:2704
🔑 Các chức năng chính
👤 Người dùng
Đăng ký / đăng nhập
Tìm kiếm chuyến xe
Xem chi tiết chuyến
Chọn ghế
Đặt vé
🧑‍💼 Admin
Quản lý chuyến xe
Quản lý người dùng
Quản lý đặt vé
🤖 AI Agent
Gợi ý chuyến xe theo:
lịch sử
thời gian
giá
Chat hỗ trợ người dùng
Tự động xử lý yêu cầu đơn giản
🔌 API mẫu
Đăng nhập
POST /api/auth/login
Lấy danh sách chuyến
GET /api/trips
Đặt vé
POST /api/bookings
🧪 Test nhanh

Mở trình duyệt:

http://localhost:2704

Hoặc dùng Postman test API.

⚠️ Lưu ý
Phải bật MySQL trước khi chạy
Đảm bảo đúng port 2704
Nếu lỗi:
Check database
Check port có bị trùng không
📌 Hướng phát triển
Tích hợp thanh toán thật (VNPay, Momo)
Nâng cấp AI Agent (Chatbot thông minh hơn)
Làm mobile app