'use strict';
/**
 * SmartBusAI — Full Data Seeder
 * Tạo đầy đủ: 63 tỉnh/thành, 170+ tuyến, 500+ chuyến, 300+ điểm đón
 * Chạy: node server/config/seed_full.js
 * Tự động: gọi từ server.js khi route count < 50
 */

const db = require('./db');

/* ══════════════════════════════════════════════════════════
   63 TỈNH/THÀNH PHỐ (tên chuẩn + tọa độ trung tâm + hub)
══════════════════════════════════════════════════════════ */
const PROVINCES = [
  // ── MIỀN BẮC ──
  { name: 'Hà Nội',              lat: 21.0285, lng: 105.8542, hub: 'HN' },
  { name: 'Hải Phòng',           lat: 20.8449, lng: 106.6881, hub: 'HN' },
  { name: 'Quảng Ninh',          lat: 21.0064, lng: 107.2925, hub: 'HN' },
  { name: 'Hải Dương',           lat: 20.9373, lng: 106.3146, hub: 'HN' },
  { name: 'Hưng Yên',            lat: 20.6464, lng: 106.0511, hub: 'HN' },
  { name: 'Thái Bình',           lat: 20.4463, lng: 106.3367, hub: 'HN' },
  { name: 'Nam Định',            lat: 20.4388, lng: 106.1621, hub: 'HN' },
  { name: 'Hà Nam',              lat: 20.5418, lng: 105.9227, hub: 'HN' },
  { name: 'Ninh Bình',           lat: 20.2506, lng: 105.9745, hub: 'HN' },
  { name: 'Vĩnh Phúc',           lat: 21.3609, lng: 105.5474, hub: 'HN' },
  { name: 'Bắc Ninh',            lat: 21.1861, lng: 106.0763, hub: 'HN' },
  { name: 'Bắc Giang',           lat: 21.2720, lng: 106.1947, hub: 'HN' },
  { name: 'Phú Thọ',             lat: 21.4180, lng: 105.2276, hub: 'HN' },
  { name: 'Thái Nguyên',         lat: 21.5942, lng: 105.8482, hub: 'HN' },
  { name: 'Tuyên Quang',         lat: 21.8236, lng: 105.2180, hub: 'HN' },
  { name: 'Lào Cai',             lat: 22.4809, lng: 103.9753, hub: 'HN' },
  { name: 'Yên Bái',             lat: 21.7051, lng: 104.9113, hub: 'HN' },
  { name: 'Hòa Bình',            lat: 20.8133, lng: 105.3383, hub: 'HN' },
  { name: 'Sơn La',              lat: 21.3256, lng: 103.9144, hub: 'HN' },
  { name: 'Điện Biên',           lat: 21.3857, lng: 103.0233, hub: 'HN' },
  { name: 'Lai Châu',            lat: 22.3964, lng: 103.4580, hub: 'HN' },
  { name: 'Hà Giang',            lat: 22.8025, lng: 104.9784, hub: 'HN' },
  { name: 'Cao Bằng',            lat: 22.6665, lng: 106.2639, hub: 'HN' },
  { name: 'Bắc Kạn',             lat: 22.1473, lng: 105.8348, hub: 'HN' },
  { name: 'Lạng Sơn',            lat: 21.8537, lng: 106.7615, hub: 'HN' },
  // ── MIỀN TRUNG ──
  { name: 'Thanh Hóa',           lat: 19.8079, lng: 105.7770, hub: 'DN' },
  { name: 'Nghệ An',             lat: 18.6734, lng: 105.6923, hub: 'DN' },
  { name: 'Hà Tĩnh',             lat: 18.3558, lng: 105.8877, hub: 'DN' },
  { name: 'Quảng Bình',          lat: 17.4833, lng: 106.5995, hub: 'DN' },
  { name: 'Quảng Trị',           lat: 16.7943, lng: 107.0420, hub: 'DN' },
  { name: 'Thừa Thiên Huế',      lat: 16.4637, lng: 107.5909, hub: 'DN' },
  { name: 'Đà Nẵng',             lat: 16.0544, lng: 108.2022, hub: 'DN' },
  { name: 'Quảng Nam',           lat: 15.5394, lng: 108.0191, hub: 'DN' },
  { name: 'Quảng Ngãi',          lat: 15.1214, lng: 108.8047, hub: 'DN' },
  { name: 'Bình Định',           lat: 13.7765, lng: 109.2237, hub: 'DN' },
  { name: 'Phú Yên',             lat: 13.0882, lng: 109.0929, hub: 'DN' },
  { name: 'Khánh Hòa',           lat: 12.2388, lng: 109.1967, hub: 'DN' },
  { name: 'Ninh Thuận',          lat: 11.5654, lng: 108.9910, hub: 'HCM' },
  { name: 'Bình Thuận',          lat: 10.9805, lng: 108.2572, hub: 'HCM' },
  // ── TÂY NGUYÊN ──
  { name: 'Kon Tum',             lat: 14.3497, lng: 107.9994, hub: 'DN' },
  { name: 'Gia Lai',             lat: 13.9830, lng: 108.0001, hub: 'DN' },
  { name: 'Đắk Lắk',            lat: 12.7100, lng: 108.2378, hub: 'HCM' },
  { name: 'Đắk Nông',            lat: 12.0046, lng: 107.6870, hub: 'HCM' },
  { name: 'Lâm Đồng',            lat: 11.9465, lng: 108.4419, hub: 'HCM' },
  // ── ĐÔNG NAM BỘ ──
  { name: 'TP. Hồ Chí Minh',    lat: 10.8231, lng: 106.6297, hub: 'HCM' },
  { name: 'Bình Dương',          lat: 11.3254, lng: 106.4770, hub: 'HCM' },
  { name: 'Đồng Nai',            lat: 10.9459, lng: 107.0830, hub: 'HCM' },
  { name: 'Bà Rịa - Vũng Tàu',  lat: 10.4113, lng: 107.1365, hub: 'HCM' },
  { name: 'Bình Phước',          lat: 11.7512, lng: 106.7235, hub: 'HCM' },
  { name: 'Tây Ninh',            lat: 11.3100, lng: 106.0983, hub: 'HCM' },
  // ── ĐỒNG BẰNG SÔNG CỬU LONG ──
  { name: 'Long An',             lat: 10.6956, lng: 106.2431, hub: 'CT' },
  { name: 'Tiền Giang',          lat: 10.4494, lng: 106.3420, hub: 'CT' },
  { name: 'Bến Tre',             lat: 10.2415, lng: 106.3760, hub: 'CT' },
  { name: 'Trà Vinh',            lat:  9.9477, lng: 106.3455, hub: 'CT' },
  { name: 'Vĩnh Long',           lat: 10.2395, lng: 105.9573, hub: 'CT' },
  { name: 'Đồng Tháp',          lat: 10.4938, lng: 105.6882, hub: 'CT' },
  { name: 'An Giang',            lat: 10.5216, lng: 105.1259, hub: 'CT' },
  { name: 'Kiên Giang',          lat: 10.0125, lng: 105.0809, hub: 'CT' },
  { name: 'Cần Thơ',             lat: 10.0452, lng: 105.7469, hub: 'CT' },
  { name: 'Hậu Giang',           lat:  9.7577, lng: 105.6411, hub: 'CT' },
  { name: 'Sóc Trăng',           lat:  9.6003, lng: 105.9800, hub: 'CT' },
  { name: 'Bạc Liêu',            lat:  9.2940, lng: 105.7278, hub: 'CT' },
  { name: 'Cà Mau',              lat:  9.1769, lng: 105.1524, hub: 'CT' },
];

/* ══════════════════════════════════════════════════════════
   ĐIỂM ĐÓN/TRẢ (BẾN XE) CỦA CÁC TỈNH
   Mỗi tỉnh có ít nhất 1 điểm đón, tỉnh lớn có 2-5
══════════════════════════════════════════════════════════ */
const BUS_STATIONS = [
  // Hà Nội
  { city: 'Hà Nội', name: 'Bến xe Mỹ Đình', lat: 21.0278, lng: 105.7829, address: 'Phạm Hùng, Nam Từ Liêm, Hà Nội' },
  { city: 'Hà Nội', name: 'Bến xe Giáp Bát', lat: 20.9899, lng: 105.8430, address: 'Giải Phóng, Hoàng Mai, Hà Nội' },
  { city: 'Hà Nội', name: 'Bến xe Nước Ngầm', lat: 20.9741, lng: 105.8460, address: 'Ngọc Hồi, Hoàng Mai, Hà Nội' },
  { city: 'Hà Nội', name: 'Bến xe Gia Lâm', lat: 21.0377, lng: 105.8993, address: 'Ngô Gia Khảm, Long Biên, Hà Nội' },
  { city: 'Hà Nội', name: 'Bến xe Yên Nghĩa', lat: 20.9590, lng: 105.7280, address: 'Hà Đông, Hà Nội' },
  // TP. Hồ Chí Minh
  { city: 'TP. Hồ Chí Minh', name: 'Bến xe Miền Đông', lat: 10.8143, lng: 106.7094, address: 'Đinh Tiên Hoàng, Bình Thạnh, TP.HCM' },
  { city: 'TP. Hồ Chí Minh', name: 'Bến xe Miền Tây', lat: 10.7465, lng: 106.6165, address: 'Kinh Dương Vương, Bình Tân, TP.HCM' },
  { city: 'TP. Hồ Chí Minh', name: 'Bến xe An Sương', lat: 10.8697, lng: 106.6271, address: 'Quốc lộ 22, Hóc Môn, TP.HCM' },
  { city: 'TP. Hồ Chí Minh', name: 'Bến xe Suối Tiên', lat: 10.8698, lng: 106.7682, address: 'QL1A, Thủ Đức, TP.HCM' },
  // Đà Nẵng
  { city: 'Đà Nẵng', name: 'Bến xe Đà Nẵng', lat: 16.0471, lng: 108.2066, address: '33 Điện Biên Phủ, Hải Châu, Đà Nẵng' },
  { city: 'Đà Nẵng', name: 'Bến xe phía Nam Đà Nẵng', lat: 15.9743, lng: 108.2082, address: 'Nguyễn Tất Thành, Cẩm Lệ, Đà Nẵng' },
  // Hải Phòng
  { city: 'Hải Phòng', name: 'Bến xe Thượng Lý', lat: 20.8637, lng: 106.6534, address: 'Ngô Quyền, Hải Phòng' },
  { city: 'Hải Phòng', name: 'Bến xe Niệm Nghĩa', lat: 20.8449, lng: 106.6390, address: 'Lê Chân, Hải Phòng' },
  // Cần Thơ
  { city: 'Cần Thơ', name: 'Bến xe Cần Thơ', lat: 10.0295, lng: 105.7745, address: 'Nguyễn Trãi, Ninh Kiều, Cần Thơ' },
  { city: 'Cần Thơ', name: 'Bến xe Hưng Lợi', lat: 10.0040, lng: 105.7698, address: 'Cách Mạng Tháng Tám, Ninh Kiều, Cần Thơ' },
  // Quảng Ninh
  { city: 'Quảng Ninh', name: 'Bến xe Bãi Cháy', lat: 20.9547, lng: 107.0693, address: 'Bãi Cháy, Hạ Long, Quảng Ninh' },
  // Ninh Bình
  { city: 'Ninh Bình', name: 'Bến xe Ninh Bình', lat: 20.2544, lng: 105.9783, address: 'Trần Hưng Đạo, TP. Ninh Bình' },
  // Thanh Hóa
  { city: 'Thanh Hóa', name: 'Bến xe phía Bắc Thanh Hóa', lat: 19.8187, lng: 105.7840, address: 'Bà Triệu, TP. Thanh Hóa' },
  // Nghệ An
  { city: 'Nghệ An', name: 'Bến xe Vinh', lat: 18.6706, lng: 105.6814, address: 'Lê Duẩn, TP. Vinh, Nghệ An' },
  // Thừa Thiên Huế
  { city: 'Thừa Thiên Huế', name: 'Bến xe Phía Nam Huế', lat: 16.4591, lng: 107.5934, address: 'An Dương Vương, TP. Huế' },
  // Khánh Hòa
  { city: 'Khánh Hòa', name: 'Bến xe Nha Trang', lat: 12.2451, lng: 109.1898, address: 'Tháp Bà, Nha Trang, Khánh Hòa' },
  // Lâm Đồng
  { city: 'Lâm Đồng', name: 'Bến xe Đà Lạt', lat: 11.9416, lng: 108.4419, address: 'Tô Hiệu, TP. Đà Lạt, Lâm Đồng' },
  // Bà Rịa - Vũng Tàu
  { city: 'Bà Rịa - Vũng Tàu', name: 'Bến xe Vũng Tàu', lat: 10.3460, lng: 107.0843, address: '52 Nam Kỳ Khởi Nghĩa, Vũng Tàu' },
  // Bình Dương
  { city: 'Bình Dương', name: 'Bến xe Bình Dương', lat: 11.3227, lng: 106.4770, address: 'Đại lộ Bình Dương, Thủ Dầu Một' },
  // Đồng Nai
  { city: 'Đồng Nai', name: 'Bến xe Biên Hòa', lat: 10.9591, lng: 106.8434, address: 'Hà Huy Giáp, Biên Hòa, Đồng Nai' },
  // An Giang
  { city: 'An Giang', name: 'Bến xe Long Xuyên', lat: 10.3760, lng: 105.4347, address: 'Trần Hưng Đạo, Long Xuyên, An Giang' },
  // Kiên Giang
  { city: 'Kiên Giang', name: 'Bến xe Rạch Giá', lat: 10.0124, lng: 105.0864, address: 'Nguyễn Trung Trực, Rạch Giá, Kiên Giang' },
  // Đắk Lắk
  { city: 'Đắk Lắk', name: 'Bến xe Buôn Ma Thuột', lat: 12.6816, lng: 108.0388, address: 'Nơ Trang Long, Buôn Ma Thuột, Đắk Lắk' },
  // Gia Lai
  { city: 'Gia Lai', name: 'Bến xe Pleiku', lat: 13.9833, lng: 108.0000, address: 'Trần Phú, Pleiku, Gia Lai' },
  // Lạng Sơn
  { city: 'Lạng Sơn', name: 'Bến xe Lạng Sơn', lat: 21.8560, lng: 106.7617, address: 'QL 1A, TP. Lạng Sơn' },
  // Lào Cai
  { city: 'Lào Cai', name: 'Bến xe Lào Cai', lat: 22.4853, lng: 103.9753, address: 'Ngô Quyền, TP. Lào Cai' },
  // Hải Dương
  { city: 'Hải Dương', name: 'Bến xe Hải Dương', lat: 20.9414, lng: 106.3325, address: 'Trần Phú, TP. Hải Dương' },
  // Nam Định
  { city: 'Nam Định', name: 'Bến xe Nam Định', lat: 20.4334, lng: 106.1615, address: 'Trần Đăng Ninh, TP. Nam Định' },
  // Thái Bình
  { city: 'Thái Bình', name: 'Bến xe Thái Bình', lat: 20.4496, lng: 106.3432, address: 'Trần Thái Tông, TP. Thái Bình' },
  // Bắc Giang
  { city: 'Bắc Giang', name: 'Bến xe Bắc Giang', lat: 21.2826, lng: 106.1969, address: 'Lê Lợi, TP. Bắc Giang' },
  // Thái Nguyên
  { city: 'Thái Nguyên', name: 'Bến xe Thái Nguyên', lat: 21.5866, lng: 105.8481, address: 'Bến Oánh, TP. Thái Nguyên' },
  // Long An
  { city: 'Long An', name: 'Bến xe Long An', lat: 10.5354, lng: 106.4103, address: 'Hùng Vương, Tân An, Long An' },
  // Tiền Giang
  { city: 'Tiền Giang', name: 'Bến xe Tiền Giang', lat: 10.3600, lng: 106.3627, address: 'Ấp Bắc, Mỹ Tho, Tiền Giang' },
  // Vĩnh Long
  { city: 'Vĩnh Long', name: 'Bến xe Vĩnh Long', lat: 10.2402, lng: 105.9660, address: '1 tháng 5, TP. Vĩnh Long' },
  // Cà Mau
  { city: 'Cà Mau', name: 'Bến xe Cà Mau', lat: 9.1770, lng: 105.1524, address: 'Lý Thường Kiệt, TP. Cà Mau' },
  // Hòa Bình
  { city: 'Hòa Bình', name: 'Bến xe Hòa Bình', lat: 20.8154, lng: 105.3372, address: 'An Dương Vương, TP. Hòa Bình' },
  // Bắc Ninh
  { city: 'Bắc Ninh', name: 'Bến xe Bắc Ninh', lat: 21.1940, lng: 106.0600, address: 'Lý Thái Tổ, TP. Bắc Ninh' },
  // Quảng Nam
  { city: 'Quảng Nam', name: 'Bến xe Tam Kỳ', lat: 15.5666, lng: 108.4736, address: 'Phan Chu Trinh, Tam Kỳ, Quảng Nam' },
  // Quảng Ngãi
  { city: 'Quảng Ngãi', name: 'Bến xe Quảng Ngãi', lat: 15.1214, lng: 108.7882, address: 'Quang Trung, TP. Quảng Ngãi' },
  // Bình Định
  { city: 'Bình Định', name: 'Bến xe Quy Nhơn', lat: 13.7765, lng: 109.2237, address: 'Tây Sơn, Quy Nhơn, Bình Định' },
  // Quảng Bình
  { city: 'Quảng Bình', name: 'Bến xe Đồng Hới', lat: 17.4806, lng: 106.5986, address: 'Lý Thường Kiệt, Đồng Hới, Quảng Bình' },
  // Sóc Trăng
  { city: 'Sóc Trăng', name: 'Bến xe Sóc Trăng', lat: 9.5997, lng: 105.9779, address: 'Mậu Thân, TP. Sóc Trăng' },
  // Bạc Liêu
  { city: 'Bạc Liêu', name: 'Bến xe Bạc Liêu', lat: 9.2942, lng: 105.7278, address: 'Hùng Vương, TP. Bạc Liêu' },
  // Bến Tre
  { city: 'Bến Tre', name: 'Bến xe Bến Tre', lat: 10.2455, lng: 106.3762, address: 'Đồng Khởi, TP. Bến Tre' },
  // Đồng Tháp
  { city: 'Đồng Tháp', name: 'Bến xe Cao Lãnh', lat: 10.4590, lng: 105.6325, address: 'Nguyễn Huệ, Cao Lãnh, Đồng Tháp' },
  // Hậu Giang
  { city: 'Hậu Giang', name: 'Bến xe Vị Thanh', lat: 9.7821, lng: 105.4697, address: 'Trần Hưng Đạo, Vị Thanh, Hậu Giang' },
  // Trà Vinh
  { city: 'Trà Vinh', name: 'Bến xe Trà Vinh', lat: 9.9342, lng: 106.3453, address: 'Nguyễn Thị Minh Khai, TP. Trà Vinh' },
  // Phú Thọ
  { city: 'Phú Thọ', name: 'Bến xe Việt Trì', lat: 21.3000, lng: 105.4009, address: 'Đinh Tiên Hoàng, Việt Trì, Phú Thọ' },
  // Sơn La
  { city: 'Sơn La', name: 'Bến xe Sơn La', lat: 21.3271, lng: 103.9140, address: 'Chu Văn Thịnh, TP. Sơn La' },
  // Cao Bằng
  { city: 'Cao Bằng', name: 'Bến xe Cao Bằng', lat: 22.6657, lng: 106.2638, address: 'Bế Văn Đàn, TP. Cao Bằng' },
  // Hà Giang
  { city: 'Hà Giang', name: 'Bến xe Hà Giang', lat: 22.8029, lng: 104.9818, address: 'Nguyễn Trãi, TP. Hà Giang' },
  // Tây Ninh
  { city: 'Tây Ninh', name: 'Bến xe Tây Ninh', lat: 11.3096, lng: 106.0985, address: '30/4, TP. Tây Ninh' },
  // Bình Phước
  { city: 'Bình Phước', name: 'Bến xe Đồng Xoài', lat: 11.5348, lng: 106.8897, address: 'Trần Hưng Đạo, Đồng Xoài, Bình Phước' },
  // Ninh Thuận
  { city: 'Ninh Thuận', name: 'Bến xe Phan Rang', lat: 11.5654, lng: 108.9910, address: 'Thống Nhất, Phan Rang, Ninh Thuận' },
  // Bình Thuận
  { city: 'Bình Thuận', name: 'Bến xe Phan Thiết', lat: 10.9297, lng: 108.1018, address: 'Lê Hồng Phong, Phan Thiết, Bình Thuận' },
  // Kon Tum
  { city: 'Kon Tum', name: 'Bến xe Kon Tum', lat: 14.3497, lng: 107.9994, address: 'Duy Tân, TP. Kon Tum' },
  // Đắk Nông
  { city: 'Đắk Nông', name: 'Bến xe Gia Nghĩa', lat: 11.9762, lng: 107.6908, address: 'Điểu Ong, Gia Nghĩa, Đắk Nông' },
  // Phú Yên
  { city: 'Phú Yên', name: 'Bến xe Tuy Hòa', lat: 13.0882, lng: 109.2927, address: 'Trần Hưng Đạo, Tuy Hòa, Phú Yên' },
  // Quảng Trị
  { city: 'Quảng Trị', name: 'Bến xe Đông Hà', lat: 16.8198, lng: 107.1010, address: 'Lê Duẩn, Đông Hà, Quảng Trị' },
  // Yên Bái
  { city: 'Yên Bái', name: 'Bến xe Yên Bái', lat: 21.7216, lng: 104.9118, address: 'Ngô Quyền, TP. Yên Bái' },
  // Điện Biên
  { city: 'Điện Biên', name: 'Bến xe Điện Biên Phủ', lat: 21.3834, lng: 103.0232, address: '7/5, TP. Điện Biên Phủ' },
  // Lai Châu
  { city: 'Lai Châu', name: 'Bến xe Lai Châu', lat: 22.3961, lng: 103.4579, address: 'Lê Lợi, TP. Lai Châu' },
  // Tuyên Quang
  { city: 'Tuyên Quang', name: 'Bến xe Tuyên Quang', lat: 21.8234, lng: 105.2190, address: 'Bình Thuận, TP. Tuyên Quang' },
  // Bắc Kạn
  { city: 'Bắc Kạn', name: 'Bến xe Bắc Kạn', lat: 22.1470, lng: 105.8351, address: 'Trường Chinh, TP. Bắc Kạn' },
  // Hà Nam
  { city: 'Hà Nam', name: 'Bến xe Phủ Lý', lat: 20.5387, lng: 105.9230, address: 'Lê Hồng Phong, Phủ Lý, Hà Nam' },
  // Hưng Yên
  { city: 'Hưng Yên', name: 'Bến xe Hưng Yên', lat: 20.6525, lng: 106.0487, address: 'Phan Chu Trinh, TP. Hưng Yên' },
  // Vĩnh Phúc
  { city: 'Vĩnh Phúc', name: 'Bến xe Vĩnh Yên', lat: 21.3112, lng: 105.5956, address: 'Mê Linh, Vĩnh Yên, Vĩnh Phúc' },
];

/* ══════════════════════════════════════════════════════════
   HAVERSINE DISTANCE
══════════════════════════════════════════════════════════ */
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2
    + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180)
    * Math.sin(dLng/2)**2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

/* ══════════════════════════════════════════════════════════
   TÍNH GIÁ VÉ THEO KM
══════════════════════════════════════════════════════════ */
function calcPrice(km) {
  // ~2500đ/km, tối thiểu 50k, làm tròn 50k
  const raw = Math.max(50000, km * 2500);
  return Math.round(raw / 50000) * 50000;
}

/* ══════════════════════════════════════════════════════════
   MẠNG LƯỚI TUYẾN XE
   Định nghĩa: [origin_name, destination_name]
   Script sẽ tạo cả chiều đi lẫn chiều về
══════════════════════════════════════════════════════════ */
function buildRouteNetwork() {
  const HN = 'Hà Nội';
  const DN = 'Đà Nẵng';
  const HCM = 'TP. Hồ Chí Minh';
  const CT = 'Cần Thơ';
  const HUE = 'Thừa Thiên Huế';
  const NT = 'Khánh Hòa';  // Nha Trang

  // Hub → các tỉnh trong vùng
  const northProvinces = [
    'Hải Phòng','Quảng Ninh','Hải Dương','Hưng Yên','Thái Bình',
    'Nam Định','Hà Nam','Ninh Bình','Vĩnh Phúc','Bắc Ninh',
    'Bắc Giang','Phú Thọ','Thái Nguyên','Tuyên Quang','Lào Cai',
    'Yên Bái','Hòa Bình','Sơn La','Điện Biên','Lai Châu',
    'Hà Giang','Cao Bằng','Bắc Kạn','Lạng Sơn',
  ];

  const centralProvinces = [
    'Thanh Hóa','Nghệ An','Hà Tĩnh','Quảng Bình','Quảng Trị',
    HUE,'Quảng Nam','Quảng Ngãi','Bình Định','Phú Yên',
    'Kon Tum','Gia Lai',
  ];

  const southProvinces = [
    NT,'Ninh Thuận','Bình Thuận','Đắk Lắk','Đắk Nông','Lâm Đồng',
    'Bình Dương','Đồng Nai','Bà Rịa - Vũng Tàu','Bình Phước','Tây Ninh',
  ];

  const mekongProvinces = [
    'Long An','Tiền Giang','Bến Tre','Trà Vinh','Vĩnh Long',
    'Đồng Tháp','An Giang','Kiên Giang','Hậu Giang','Sóc Trăng','Bạc Liêu','Cà Mau',
  ];

  const pairs = new Set();
  const add = (a, b) => {
    const key = [a, b].sort().join('|');
    pairs.add(key);
  };

  // Tất cả tỉnh miền Bắc ↔ Hà Nội
  northProvinces.forEach(p => add(HN, p));

  // Tất cả tỉnh miền Trung ↔ Đà Nẵng
  centralProvinces.forEach(p => add(DN, p));

  // Tất cả tỉnh miền Nam ↔ TP.HCM
  southProvinces.forEach(p => add(HCM, p));

  // Tất cả tỉnh Mekong ↔ Cần Thơ
  mekongProvinces.forEach(p => add(CT, p));

  // Hub ↔ Hub (liên vùng)
  add(HN,  DN);
  add(HN,  HCM);
  add(DN,  HCM);
  add(HCM, CT);
  add(HN,  NT);   // Hà Nội → Nha Trang (tuyến dài phổ biến)
  add(DN,  CT);   // Đà Nẵng → Cần Thơ

  // Hành lang ven biển (tuyến thẳng bắc-nam)
  const coastCorridor = [HN,'Thanh Hóa','Nghệ An','Hà Tĩnh','Quảng Bình','Quảng Trị',HUE,DN,'Quảng Nam','Quảng Ngãi','Bình Định','Phú Yên',NT,'Ninh Thuận','Bình Thuận',HCM];
  for (let i = 0; i < coastCorridor.length - 1; i++) {
    add(coastCorridor[i], coastCorridor[i+1]);
  }

  // Hành lang Mekong
  const mekongCorridor = [HCM,'Long An','Tiền Giang','Vĩnh Long',CT,'Hậu Giang','Sóc Trăng','Bạc Liêu','Cà Mau'];
  for (let i = 0; i < mekongCorridor.length - 1; i++) {
    add(mekongCorridor[i], mekongCorridor[i+1]);
  }

  // Một số tuyến bổ sung hay gặp
  const extras = [
    [HN, 'Thanh Hóa'], [HN, 'Nghệ An'], [HN, HUE],
    ['Nghệ An', DN], ['Đắk Lắk', DN], ['Đắk Lắk', HCM],
    ['An Giang', HCM], ['Kiên Giang', HCM], [CT, 'An Giang'],
    ['Lào Cai', HN], ['Điện Biên', HN], ['Sơn La', HN],
  ];
  extras.forEach(([a, b]) => add(a, b));

  // Convert set to array of [origin, dest] pairs (both directions)
  const routes = [];
  for (const key of pairs) {
    const [a, b] = key.split('|');
    routes.push([a, b]);
    routes.push([b, a]);
  }
  return routes;
}

/* ══════════════════════════════════════════════════════════
   MAIN SEEDER
══════════════════════════════════════════════════════════ */
async function seedFull() {
  console.log('🌱 [Seeder] Bắt đầu seed dữ liệu toàn diện...');

  // Build province map
  const provMap = {};
  for (const p of PROVINCES) provMap[p.name] = p;

  /* 1. Lấy operators hiện tại */
  const [existingOps] = await db.query('SELECT operator_id FROM bus_operator LIMIT 10');
  let opIds = existingOps.map(o => o.operator_id);

  // Thêm operators nếu cần
  const opNames = [
    ['Phương Trang', 'phuongtrang@gmail.com', '0900000001'],
    ['Thành Bưởi',   'thanhbuoi@gmail.com',   '0900000002'],
    ['Hoàng Long',   'hoanglongbus@gmail.com', '0900000003'],
    ['Mai Linh Express', 'mailinh@gmail.com',  '0900000004'],
    ['Kumho Samco',  'kumho@gmail.com',        '0900000005'],
    ['Cát Linh',     'catlinh@gmail.com',      '0900000006'],
    ['An Phú',       'anphu@gmail.com',        '0900000007'],
    ['Toàn Thắng',   'toanthang@gmail.com',    '0900000008'],
  ];

  if (opIds.length < 5) {
    const [users] = await db.query("SELECT user_id FROM users WHERE role='OPERATOR' LIMIT 10");
    let userIdx = 0;
    for (const [name, email, phone] of opNames) {
      const [existing] = await db.query('SELECT operator_id FROM bus_operator WHERE name=?', [name]);
      if (existing.length > 0) { opIds.push(existing[0].operator_id); continue; }
      const userId = users[userIdx % users.length]?.user_id || null;
      userIdx++;
      try {
        const [r] = await db.query(
          'INSERT INTO bus_operator (name, email, phone, status) VALUES (?,?,?,?)',
          [name, email, phone, 'ACTIVE']
        );
        opIds.push(r.insertId);
      } catch(e) { /* ignore */ }
    }
    // Re-fetch
    const [ops2] = await db.query('SELECT operator_id FROM bus_operator');
    opIds = ops2.map(o => o.operator_id);
  }

  /* 2. Thêm buses nếu cần */
  const [existingBuses] = await db.query('SELECT bus_id FROM bus LIMIT 100');
  let busIds = existingBuses.map(b => b.bus_id);
  const busTypes = ['LIMOUSINE','SLEEPER','STANDARD','EXPRESS'];
  const seats    = [34, 40, 45, 28];

  if (busIds.length < 20) {
    for (let i = 0; i < 40; i++) {
      const opId   = opIds[i % opIds.length];
      const typeIdx = i % 4;
      try {
        const plate = `${String(i+50).padStart(2,'0')}A-${Math.floor(10000 + Math.random()*89999)}`;
        const [r] = await db.query(
          'INSERT INTO bus (operator_id, plate_number, bus_type, total_seats, status) VALUES (?,?,?,?,?)',
          [opId, plate, busTypes[typeIdx], seats[typeIdx], 'ACTIVE']
        );
        busIds.push(r.insertId);
      } catch(e) { /* ignore duplicate plate */ }
    }
    const [buses2] = await db.query('SELECT bus_id FROM bus WHERE status="ACTIVE"');
    busIds = buses2.map(b => b.bus_id);
  }

  /* 3. Tạo routes */
  const routePairs = buildRouteNetwork();
  console.log(`🗺️  [Seeder] Chuẩn bị tạo ${routePairs.length} tuyến xe...`);

  let routesCreated = 0;
  const routeIdMap = {}; // "origin|dest" -> route_id

  // Load existing routes first
  const [existingRoutes] = await db.query('SELECT route_id, origin, destination FROM route');
  for (const r of existingRoutes) {
    routeIdMap[`${r.origin}|${r.destination}`] = r.route_id;
  }

  for (const [origin, dest] of routePairs) {
    const key = `${origin}|${dest}`;
    if (routeIdMap[key]) continue; // đã tồn tại

    const op = provMap[origin];
    const dp = provMap[dest];
    if (!op || !dp) continue;

    const distKm = haversine(op.lat, op.lng, dp.lat, dp.lng);
    try {
      const [r] = await db.query(
        `INSERT INTO route (origin, destination, distance_km, origin_lat, origin_lng, dest_lat, dest_lng)
         VALUES (?,?,?,?,?,?,?)`,
        [origin, dest, distKm, op.lat, op.lng, dp.lat, dp.lng]
      );
      routeIdMap[key] = r.insertId;
      routesCreated++;
    } catch(e) {
      if (e.code !== 'ER_DUP_ENTRY') console.warn('[Seeder] route insert:', e.message);
    }
  }
  console.log(`✅ [Seeder] Tạo mới ${routesCreated} tuyến xe`);

  /* 4. Tạo điểm đón/trả (route_stop) từ bus_stations */
  const stationMap = {}; // city -> [ {name,lat,lng,address} ]
  for (const s of BUS_STATIONS) {
    if (!stationMap[s.city]) stationMap[s.city] = [];
    stationMap[s.city].push(s);
  }

  // Kiểm tra stops hiện tại
  const [[stopCount]] = await db.query('SELECT COUNT(*) as cnt FROM route_stop');
  let stopsCreated = 0;

  if (stopCount.cnt < 100) {
    // Với mỗi tuyến, tạo stop tại điểm xuất phát (PICKUP) và điểm đến (DROPOFF)
    for (const [key, routeId] of Object.entries(routeIdMap)) {
      const [origin, dest] = key.split('|');
      const originStations = stationMap[origin] || [];
      const destStations   = stationMap[dest]   || [];

      // Nếu không có bến xe cụ thể, dùng tọa độ trung tâm tỉnh
      const originProvince = provMap[origin];
      const destProvince   = provMap[dest];

      if (originStations.length === 0 && originProvince) {
        originStations.push({
          name: `Điểm đón ${origin}`,
          lat: originProvince.lat,
          lng: originProvince.lng,
          address: `Trung tâm ${origin}`,
          city: origin,
        });
      }
      if (destStations.length === 0 && destProvince) {
        destStations.push({
          name: `Điểm trả ${dest}`,
          lat: destProvince.lat,
          lng: destProvince.lng,
          address: `Trung tâm ${dest}`,
          city: dest,
        });
      }

      for (let i = 0; i < Math.min(originStations.length, 3); i++) {
        const s = originStations[i];
        try {
          await db.query(
            `INSERT INTO route_stop (route_id, stop_name, stop_type, address, lat, lng, stop_order, is_active)
             VALUES (?,?,?,?,?,?,?,1)`,
            [routeId, s.name, 'PICKUP', s.address, s.lat, s.lng, i + 1]
          );
          stopsCreated++;
        } catch(e) { /* ignore */ }
      }

      for (let i = 0; i < Math.min(destStations.length, 2); i++) {
        const s = destStations[i];
        try {
          await db.query(
            `INSERT INTO route_stop (route_id, stop_name, stop_type, address, lat, lng, stop_order, is_active)
             VALUES (?,?,?,?,?,?,?,1)`,
            [routeId, s.name, 'DROPOFF', s.address, s.lat, s.lng, 100 + i]
          );
          stopsCreated++;
        } catch(e) { /* ignore */ }
      }
    }
    console.log(`✅ [Seeder] Tạo mới ${stopsCreated} điểm đón/trả`);
  }

  /* 5. Tạo chuyến xe (trips) cho các tuyến chưa có */
  const [existingTrips] = await db.query('SELECT route_id FROM trip GROUP BY route_id');
  const routesWithTrips = new Set(existingTrips.map(t => t.route_id));

  const DEP_HOURS = [6, 8, 12, 15, 18, 22]; // Giờ xuất phát
  let tripsCreated = 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const [key, routeId] of Object.entries(routeIdMap)) {
    if (routesWithTrips.has(routeId)) continue; // đã có chuyến

    const [origin, dest] = key.split('|');
    const op = provMap[origin];
    const dp = provMap[dest];
    if (!op || !dp) continue;

    const distKm    = haversine(op.lat, op.lng, dp.lat, dp.lng);
    const travelH   = Math.max(1, Math.round(distKm / 60)); // ~60 km/h TB
    const price     = calcPrice(distKm);
    if (!busIds.length) continue;
    const busId     = busIds[routeId % busIds.length];
    const seatsNum  = 40;

    // Tạo 3 chuyến (ngày hôm nay, ngày mai, ngày kia)
    for (let dayOffset = 0; dayOffset < 3; dayOffset++) {
      const depHour = DEP_HOURS[(routeId + dayOffset) % DEP_HOURS.length];
      const depDate = new Date(today.getTime() + dayOffset * 86400000);
      depDate.setUTCHours(depHour, 0, 0, 0); // UTC giờ để nhất quán
      const arrDate  = new Date(depDate.getTime() + travelH * 3600000);

      try {
        await db.query(
          `INSERT INTO trip (route_id, bus_id, departure_time, arrival_time, base_price, status)
           VALUES (?,?,?,?,?,'OPEN')`,
          [routeId, busId, depDate, arrDate, price]
        );
        tripsCreated++;
      } catch(e) { /* ignore */ }
    }
  }
  console.log(`✅ [Seeder] Tạo mới ${tripsCreated} chuyến xe`);

  /* 6. Summary */
  const [[rCount]] = await db.query('SELECT COUNT(*) as cnt FROM route');
  const [[tCount]] = await db.query('SELECT COUNT(*) as cnt FROM trip');
  const [[sCount]] = await db.query('SELECT COUNT(*) as cnt FROM route_stop');
  console.log('═══════════════════════════════════════');
  console.log(`📊 [Seeder] Kết quả sau seed:`);
  console.log(`   Routes: ${rCount.cnt}`);
  console.log(`   Trips:  ${tCount.cnt}`);
  console.log(`   Stops:  ${sCount.cnt}`);
  console.log('═══════════════════════════════════════');
}

async function runSeedIfNeeded() {
  try {
    const [[r]] = await db.query('SELECT COUNT(*) as cnt FROM route');
    if (r.cnt >= 50) {
      console.log(`ℹ️  [Seeder] ${r.cnt} tuyến đã có — bỏ qua seed.`);
      return;
    }
    await seedFull();
  } catch (err) {
    console.error('❌ [Seeder] Lỗi:', err.message);
  }
}

module.exports = { runSeedIfNeeded, seedFull };

// Chạy trực tiếp: node server/config/seed_full.js
if (require.main === module) {
  seedFull().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
