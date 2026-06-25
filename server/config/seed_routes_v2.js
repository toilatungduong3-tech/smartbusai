'use strict';
/**
 * SmartBusAI — Route Network Graph v2
 * ─────────────────────────────────────────────────────────────────
 * Xây dựng mạng lưới tuyến xe toàn quốc theo 3 tầng:
 *   T1 · Adjacency   — tỉnh giáp nhau (địa lý thực tế)
 *   T2 · Hub-Spoke   — 6 hub lớn nối thẳng mọi tỉnh vùng
 *   T3 · Express     — tuyến liên vùng / tuyến nối hệ thống
 *
 * Mục tiêu: 800 – 1 200 routes, đảm bảo mọi cặp (A, B)
 *           tìm được hành trình ≤ 3 chặng.
 *
 * Chạy độc lập: node server/config/seed_routes_v2.js
 * ─────────────────────────────────────────────────────────────────
 */

const db = require('./db');

/* ══════════════════════════════════════════════════════════════════
   TỌA ĐỘ 63 TỈNH / THÀNH PHỐ
══════════════════════════════════════════════════════════════════ */
const COORDS = {
  'Hà Nội':              [21.0285, 105.8542],
  'Hải Phòng':           [20.8449, 106.6881],
  'Quảng Ninh':          [21.0064, 107.2925],
  'Hải Dương':           [20.9373, 106.3146],
  'Hưng Yên':            [20.6464, 106.0511],
  'Thái Bình':           [20.4463, 106.3367],
  'Nam Định':            [20.4388, 106.1621],
  'Hà Nam':              [20.5418, 105.9227],
  'Ninh Bình':           [20.2506, 105.9745],
  'Vĩnh Phúc':           [21.3609, 105.5474],
  'Bắc Ninh':            [21.1861, 106.0763],
  'Bắc Giang':           [21.2720, 106.1947],
  'Phú Thọ':             [21.4180, 105.2276],
  'Thái Nguyên':         [21.5942, 105.8482],
  'Tuyên Quang':         [21.8236, 105.2180],
  'Lào Cai':             [22.4809, 103.9753],
  'Yên Bái':             [21.7051, 104.9113],
  'Hòa Bình':            [20.8133, 105.3383],
  'Sơn La':              [21.3256, 103.9144],
  'Điện Biên':           [21.3857, 103.0233],
  'Lai Châu':            [22.3964, 103.4580],
  'Hà Giang':            [22.8025, 104.9784],
  'Cao Bằng':            [22.6665, 106.2639],
  'Bắc Kạn':             [22.1473, 105.8348],
  'Lạng Sơn':            [21.8537, 106.7615],
  'Thanh Hóa':           [19.8079, 105.7770],
  'Nghệ An':             [18.6734, 105.6923],
  'Hà Tĩnh':             [18.3558, 105.8877],
  'Quảng Bình':          [17.4833, 106.5995],
  'Quảng Trị':           [16.7943, 107.0420],
  'Thừa Thiên Huế':      [16.4637, 107.5909],
  'Đà Nẵng':             [16.0544, 108.2022],
  'Quảng Nam':           [15.5394, 108.0191],
  'Quảng Ngãi':          [15.1214, 108.8047],
  'Bình Định':           [13.7765, 109.2237],
  'Phú Yên':             [13.0882, 109.0929],
  'Khánh Hòa':           [12.2388, 109.1967],
  'Ninh Thuận':          [11.5654, 108.9910],
  'Bình Thuận':          [10.9805, 108.2572],
  'Kon Tum':             [14.3497, 107.9994],
  'Gia Lai':             [13.9830, 108.0001],
  'Đắk Lắk':            [12.7100, 108.2378],
  'Đắk Nông':            [12.0046, 107.6870],
  'Lâm Đồng':            [11.9465, 108.4419],
  'TP. Hồ Chí Minh':    [10.8231, 106.6297],
  'Bình Dương':          [11.3254, 106.4770],
  'Đồng Nai':            [10.9459, 107.0830],
  'Bà Rịa - Vũng Tàu':  [10.4113, 107.1365],
  'Bình Phước':          [11.7512, 106.7235],
  'Tây Ninh':            [11.3100, 106.0983],
  'Long An':             [10.6956, 106.2431],
  'Tiền Giang':          [10.4494, 106.3420],
  'Bến Tre':             [10.2415, 106.3760],
  'Trà Vinh':            [ 9.9477, 106.3455],
  'Vĩnh Long':           [10.2395, 105.9573],
  'Đồng Tháp':          [10.4938, 105.6882],
  'An Giang':            [10.5216, 105.1259],
  'Kiên Giang':          [10.0125, 105.0809],
  'Cần Thơ':             [10.0452, 105.7469],
  'Hậu Giang':           [ 9.7577, 105.6411],
  'Sóc Trăng':           [ 9.6003, 105.9800],
  'Bạc Liêu':            [ 9.2940, 105.7278],
  'Cà Mau':              [ 9.1769, 105.1524],
};

/* ══════════════════════════════════════════════════════════════════
   TẦNG 1 · ADJACENCY — CÁC TỈNH GIÁP NHAU
   Chỉ định 1 chiều; seeder tự tạo chiều ngược lại.
══════════════════════════════════════════════════════════════════ */
const ADJACENCY = [
  // ── ĐỒNG BẰNG BẮC BỘ ──────────────────────────────────────────
  ['Hà Nội',     'Hải Phòng'],
  ['Hà Nội',     'Bắc Ninh'],
  ['Hà Nội',     'Bắc Giang'],
  ['Hà Nội',     'Thái Nguyên'],
  ['Hà Nội',     'Vĩnh Phúc'],
  ['Hà Nội',     'Hòa Bình'],
  ['Hà Nội',     'Hà Nam'],
  ['Hà Nội',     'Hưng Yên'],
  ['Hà Nội',     'Hải Dương'],
  ['Hải Phòng',  'Quảng Ninh'],
  ['Hải Phòng',  'Hải Dương'],
  ['Hải Phòng',  'Thái Bình'],
  ['Quảng Ninh', 'Hải Dương'],
  ['Quảng Ninh', 'Bắc Giang'],
  ['Quảng Ninh', 'Lạng Sơn'],
  ['Quảng Ninh', 'Bắc Kạn'],
  ['Hải Dương',  'Bắc Ninh'],
  ['Hải Dương',  'Hưng Yên'],
  ['Hải Dương',  'Thái Bình'],
  ['Hưng Yên',   'Thái Bình'],
  ['Hưng Yên',   'Hà Nam'],
  ['Thái Bình',  'Nam Định'],
  ['Nam Định',   'Hà Nam'],
  ['Nam Định',   'Ninh Bình'],
  ['Hà Nam',     'Ninh Bình'],
  ['Hà Nam',     'Hòa Bình'],
  ['Ninh Bình',  'Thanh Hóa'],
  ['Ninh Bình',  'Hòa Bình'],
  // ── TRUNG DU & MIỀN NÚI BẮC BỘ ────────────────────────────────
  ['Vĩnh Phúc',  'Phú Thọ'],
  ['Vĩnh Phúc',  'Thái Nguyên'],
  ['Vĩnh Phúc',  'Tuyên Quang'],
  ['Bắc Ninh',   'Bắc Giang'],
  ['Bắc Ninh',   'Thái Nguyên'],
  ['Bắc Giang',  'Thái Nguyên'],
  ['Bắc Giang',  'Lạng Sơn'],
  ['Bắc Giang',  'Bắc Kạn'],
  ['Phú Thọ',    'Yên Bái'],
  ['Phú Thọ',    'Tuyên Quang'],
  ['Phú Thọ',    'Hòa Bình'],
  ['Phú Thọ',    'Sơn La'],
  ['Thái Nguyên','Lạng Sơn'],
  ['Thái Nguyên','Bắc Kạn'],
  ['Thái Nguyên','Tuyên Quang'],
  ['Tuyên Quang','Yên Bái'],
  ['Tuyên Quang','Hà Giang'],
  ['Tuyên Quang','Bắc Kạn'],
  ['Lào Cai',    'Yên Bái'],
  ['Lào Cai',    'Lai Châu'],
  ['Lào Cai',    'Hà Giang'],
  ['Yên Bái',    'Lai Châu'],
  ['Yên Bái',    'Sơn La'],
  ['Yên Bái',    'Hà Giang'],
  ['Hòa Bình',   'Sơn La'],
  ['Hòa Bình',   'Thanh Hóa'],
  ['Sơn La',     'Điện Biên'],
  ['Sơn La',     'Lai Châu'],
  ['Sơn La',     'Thanh Hóa'],
  ['Điện Biên',  'Lai Châu'],
  ['Hà Giang',   'Cao Bằng'],
  ['Hà Giang',   'Bắc Kạn'],
  ['Cao Bằng',   'Bắc Kạn'],
  ['Cao Bằng',   'Lạng Sơn'],
  ['Bắc Kạn',    'Lạng Sơn'],
  // ── BẮC TRUNG BỘ ───────────────────────────────────────────────
  ['Thanh Hóa',      'Nghệ An'],
  ['Nghệ An',        'Hà Tĩnh'],
  ['Hà Tĩnh',        'Quảng Bình'],
  ['Quảng Bình',     'Quảng Trị'],
  ['Quảng Trị',      'Thừa Thiên Huế'],
  ['Thừa Thiên Huế', 'Đà Nẵng'],
  ['Thừa Thiên Huế', 'Quảng Nam'],
  // ── NAM TRUNG BỘ ───────────────────────────────────────────────
  ['Đà Nẵng',    'Quảng Nam'],
  ['Quảng Nam',  'Quảng Ngãi'],
  ['Quảng Nam',  'Kon Tum'],
  ['Quảng Nam',  'Gia Lai'],
  ['Quảng Ngãi', 'Bình Định'],
  ['Quảng Ngãi', 'Kon Tum'],
  ['Bình Định',  'Phú Yên'],
  ['Bình Định',  'Gia Lai'],
  ['Phú Yên',    'Khánh Hòa'],
  ['Phú Yên',    'Gia Lai'],
  ['Phú Yên',    'Đắk Lắk'],
  ['Khánh Hòa',  'Ninh Thuận'],
  ['Khánh Hòa',  'Đắk Lắk'],
  ['Khánh Hòa',  'Lâm Đồng'],
  ['Ninh Thuận', 'Bình Thuận'],
  ['Ninh Thuận', 'Lâm Đồng'],
  ['Bình Thuận', 'Lâm Đồng'],
  ['Bình Thuận', 'Đồng Nai'],
  ['Bình Thuận', 'Bình Phước'],
  ['Bình Thuận', 'Bà Rịa - Vũng Tàu'],
  // ── TÂY NGUYÊN ─────────────────────────────────────────────────
  ['Kon Tum',  'Gia Lai'],
  ['Gia Lai',  'Đắk Lắk'],
  ['Đắk Lắk', 'Đắk Nông'],
  ['Đắk Lắk', 'Lâm Đồng'],
  ['Đắk Nông', 'Lâm Đồng'],
  ['Đắk Nông', 'Bình Phước'],
  ['Đắk Nông', 'Đồng Nai'],
  ['Đắk Nông', 'Bình Dương'],
  // ── ĐÔNG NAM BỘ ────────────────────────────────────────────────
  ['TP. Hồ Chí Minh', 'Bình Dương'],
  ['TP. Hồ Chí Minh', 'Đồng Nai'],
  ['TP. Hồ Chí Minh', 'Long An'],
  ['TP. Hồ Chí Minh', 'Tây Ninh'],
  ['Bình Dương', 'Đồng Nai'],
  ['Bình Dương', 'Bình Phước'],
  ['Bình Dương', 'Tây Ninh'],
  ['Đồng Nai',   'Bình Phước'],
  ['Đồng Nai',   'Lâm Đồng'],
  ['Đồng Nai',   'Bà Rịa - Vũng Tàu'],
  ['Bà Rịa - Vũng Tàu', 'Bình Thuận'],
  ['Bình Phước', 'Tây Ninh'],
  ['Tây Ninh',   'Long An'],
  // ── ĐỒNG BẰNG SÔNG CỬU LONG ────────────────────────────────────
  ['Long An',   'Đồng Tháp'],
  ['Long An',   'Tiền Giang'],
  ['Tiền Giang','Bến Tre'],
  ['Tiền Giang','Vĩnh Long'],
  ['Tiền Giang','Đồng Tháp'],
  ['Bến Tre',   'Vĩnh Long'],
  ['Bến Tre',   'Trà Vinh'],
  ['Trà Vinh',  'Vĩnh Long'],
  ['Trà Vinh',  'Sóc Trăng'],
  ['Vĩnh Long', 'Đồng Tháp'],
  ['Vĩnh Long', 'Cần Thơ'],
  ['Vĩnh Long', 'Sóc Trăng'],
  ['Đồng Tháp', 'An Giang'],
  ['Đồng Tháp', 'Cần Thơ'],
  ['An Giang',  'Cần Thơ'],
  ['An Giang',  'Kiên Giang'],
  ['Kiên Giang','Cần Thơ'],
  ['Kiên Giang','Hậu Giang'],
  ['Kiên Giang','Bạc Liêu'],
  ['Kiên Giang','Cà Mau'],
  ['Cần Thơ',   'Hậu Giang'],
  ['Cần Thơ',   'Sóc Trăng'],
  ['Hậu Giang', 'Bạc Liêu'],
  ['Hậu Giang', 'Sóc Trăng'],
  ['Sóc Trăng', 'Bạc Liêu'],
  ['Bạc Liêu',  'Cà Mau'],
];

/* ══════════════════════════════════════════════════════════════════
   TẦNG 2 · HUB-SPOKE
   6 hub chính: Hà Nội, Đà Nẵng, TP.HCM, Cần Thơ, Nghệ An, Khánh Hòa
   Mỗi hub kết nối trực tiếp với các tỉnh trong vùng ảnh hưởng.
══════════════════════════════════════════════════════════════════ */
const HUB_SPOKES = {
  /* HÀ NỘI — hub miền Bắc, nối toàn bộ 24 tỉnh miền Bắc */
  'Hà Nội': [
    'Quảng Ninh','Hải Dương','Hưng Yên','Thái Bình','Nam Định','Hà Nam',
    'Ninh Bình','Vĩnh Phúc','Bắc Ninh','Bắc Giang','Phú Thọ','Thái Nguyên',
    'Tuyên Quang','Lào Cai','Yên Bái','Hòa Bình','Sơn La','Điện Biên',
    'Lai Châu','Hà Giang','Cao Bằng','Bắc Kạn','Lạng Sơn',
    // cross-region express từ HN
    'Thanh Hóa','Nghệ An','Thừa Thiên Huế','Đà Nẵng',
    'Khánh Hòa','TP. Hồ Chí Minh',
  ],
  /* ĐÀ NẴNG — hub miền Trung */
  'Đà Nẵng': [
    'Thừa Thiên Huế','Quảng Nam','Quảng Ngãi','Bình Định','Phú Yên',
    'Khánh Hòa','Kon Tum','Gia Lai','Đắk Lắk',
    // cross-region
    'Quảng Trị','Quảng Bình','Hà Tĩnh','Nghệ An','Thanh Hóa',
    'Hà Nội','TP. Hồ Chí Minh','Cần Thơ',
  ],
  /* TP. HỒ CHÍ MINH — hub miền Nam */
  'TP. Hồ Chí Minh': [
    'Bình Dương','Đồng Nai','Bà Rịa - Vũng Tàu','Bình Phước','Tây Ninh',
    'Long An','Tiền Giang','Bến Tre','Vĩnh Long','An Giang','Kiên Giang',
    'Cần Thơ','Sóc Trăng','Bạc Liêu','Cà Mau','Hậu Giang','Trà Vinh','Đồng Tháp',
    'Lâm Đồng','Đắk Lắk','Đắk Nông',
    // cross-region
    'Khánh Hòa','Ninh Thuận','Bình Thuận','Đà Nẵng','Hà Nội',
  ],
  /* CẦN THƠ — hub đồng bằng sông Cửu Long */
  'Cần Thơ': [
    'Long An','Tiền Giang','Bến Tre','Trà Vinh','Vĩnh Long','Đồng Tháp',
    'An Giang','Kiên Giang','Hậu Giang','Sóc Trăng','Bạc Liêu','Cà Mau',
    'TP. Hồ Chí Minh','Đà Nẵng',
  ],
  /* NGHỆ AN (Vinh) — hub bắc miền Trung */
  'Nghệ An': [
    'Thanh Hóa','Hà Tĩnh','Quảng Bình','Quảng Trị','Thừa Thiên Huế',
    'Hà Nội','Đà Nẵng','Ninh Bình','Sơn La','Hòa Bình',
  ],
  /* KHÁNH HÒA (Nha Trang) — hub nam miền Trung */
  'Khánh Hòa': [
    'Phú Yên','Ninh Thuận','Bình Thuận','Đắk Lắk','Lâm Đồng','Gia Lai',
    'Bình Định','Quảng Ngãi','Đà Nẵng',
    'TP. Hồ Chí Minh','Hà Nội',
  ],
};

/* ══════════════════════════════════════════════════════════════════
   TẦNG 3 · EXPRESS — TUYẾN QUAN TRỌNG KHÔNG NẰM TRONG T1-T2
   Bổ sung các cặp O-D phổ biến còn thiếu.
══════════════════════════════════════════════════════════════════ */
const EXPRESS = [
  // Bắc ↔ Trung
  ['Hà Nội',     'Quảng Bình'],
  ['Hà Nội',     'Quảng Trị'],
  ['Hà Nội',     'Quảng Nam'],
  ['Hà Nội',     'Bình Định'],
  ['Hà Nội',     'Phú Yên'],
  ['Hà Nội',     'Lâm Đồng'],
  ['Hải Phòng',  'Đà Nẵng'],
  ['Hải Phòng',  'Khánh Hòa'],
  ['Hải Phòng',  'TP. Hồ Chí Minh'],
  // Bắc ↔ Nam
  ['Hà Nội',     'Cần Thơ'],
  ['Hà Nội',     'An Giang'],
  ['Hà Nội',     'Cà Mau'],
  ['Lào Cai',    'Đà Nẵng'],
  ['Lào Cai',    'TP. Hồ Chí Minh'],
  ['Lạng Sơn',   'Đà Nẵng'],
  ['Lạng Sơn',   'TP. Hồ Chí Minh'],
  ['Điện Biên',  'Đà Nẵng'],
  ['Điện Biên',  'TP. Hồ Chí Minh'],
  // Trung ↔ Nam
  ['Đà Nẵng',    'Lâm Đồng'],
  ['Đà Nẵng',    'TP. Hồ Chí Minh'],
  ['Đà Nẵng',    'Cần Thơ'],
  ['Đà Nẵng',    'An Giang'],
  ['Quảng Ngãi', 'TP. Hồ Chí Minh'],
  ['Bình Định',  'TP. Hồ Chí Minh'],
  ['Phú Yên',    'TP. Hồ Chí Minh'],
  ['Khánh Hòa',  'Cần Thơ'],
  ['Khánh Hòa',  'An Giang'],
  ['Khánh Hòa',  'Đắk Lắk'],
  ['Ninh Thuận', 'Đà Nẵng'],
  ['Ninh Thuận', 'Hà Nội'],
  ['Bình Thuận', 'Đà Nẵng'],
  ['Bình Thuận', 'Hà Nội'],
  // Tây Nguyên ↔ đồng bằng
  ['Kon Tum',    'Hà Nội'],
  ['Kon Tum',    'TP. Hồ Chí Minh'],
  ['Kon Tum',    'Đà Nẵng'],
  ['Gia Lai',    'Hà Nội'],
  ['Gia Lai',    'TP. Hồ Chí Minh'],
  ['Đắk Lắk',   'Hà Nội'],
  ['Đắk Lắk',   'Đà Nẵng'],
  ['Đắk Lắk',   'Cần Thơ'],
  ['Đắk Nông',   'Hà Nội'],
  ['Đắk Nông',   'Đà Nẵng'],
  ['Đắk Nông',   'Cần Thơ'],
  ['Lâm Đồng',   'Hà Nội'],
  ['Lâm Đồng',   'Đà Nẵng'],
  ['Lâm Đồng',   'Cần Thơ'],
  ['Lâm Đồng',   'Khánh Hòa'],
  // Đông Nam Bộ liên tỉnh
  ['Bình Dương', 'Khánh Hòa'],
  ['Bình Dương', 'Đà Nẵng'],
  ['Bình Dương', 'Đắk Lắk'],
  ['Đồng Nai',   'Đà Nẵng'],
  ['Đồng Nai',   'Khánh Hòa'],
  ['Bà Rịa - Vũng Tàu', 'Đà Nẵng'],
  ['Bà Rịa - Vũng Tàu', 'Khánh Hòa'],
  ['Bà Rịa - Vũng Tàu', 'Cần Thơ'],
  ['Bình Phước', 'Đà Nẵng'],
  ['Bình Phước', 'Khánh Hòa'],
  ['Tây Ninh',   'Đà Nẵng'],
  ['Tây Ninh',   'Khánh Hòa'],
  ['Tây Ninh',   'Cần Thơ'],
  // Mekong ↔ cross-region
  ['Long An',    'Đà Nẵng'],
  ['Long An',    'Khánh Hòa'],
  ['Tiền Giang', 'Đà Nẵng'],
  ['Tiền Giang', 'Khánh Hòa'],
  ['Vĩnh Long',  'Đà Nẵng'],
  ['Vĩnh Long',  'Khánh Hòa'],
  ['An Giang',   'Đà Nẵng'],
  ['An Giang',   'Khánh Hòa'],
  ['Kiên Giang', 'Đà Nẵng'],
  ['Kiên Giang', 'Khánh Hòa'],
  ['Cà Mau',     'Đà Nẵng'],
  ['Cà Mau',     'Khánh Hòa'],
  ['Cà Mau',     'Hà Nội'],
  // Hành lang ven biển (chuỗi liên tục)
  ['Thanh Hóa',      'Hà Tĩnh'],
  ['Thanh Hóa',      'Quảng Bình'],
  ['Thanh Hóa',      'Đà Nẵng'],
  ['Nghệ An',        'Quảng Trị'],
  ['Nghệ An',        'Thừa Thiên Huế'],
  ['Nghệ An',        'Đà Nẵng'],
  ['Hà Tĩnh',        'Thừa Thiên Huế'],
  ['Hà Tĩnh',        'Đà Nẵng'],
  ['Quảng Bình',     'Đà Nẵng'],
  ['Quảng Bình',     'Quảng Nam'],
  ['Quảng Trị',      'Quảng Nam'],
  ['Quảng Ngãi',     'Đà Nẵng'],
  ['Quảng Ngãi',     'Khánh Hòa'],
  ['Bình Định',      'Đà Nẵng'],
  ['Bình Định',      'Khánh Hòa'],
  // Tuyến nội bắc quan trọng
  ['Hải Phòng',  'Hà Nam'],
  ['Hải Phòng',  'Nam Định'],
  ['Hải Phòng',  'Ninh Bình'],
  ['Hải Phòng',  'Thanh Hóa'],
  ['Hải Phòng',  'Nghệ An'],
  ['Quảng Ninh', 'Hà Nam'],
  ['Quảng Ninh', 'Nam Định'],
  ['Quảng Ninh', 'Ninh Bình'],
  ['Quảng Ninh', 'Thanh Hóa'],
  ['Lạng Sơn',   'Hải Phòng'],
  ['Lạng Sơn',   'Hà Nam'],
  ['Lạng Sơn',   'Ninh Bình'],
  ['Cao Bằng',   'Hải Phòng'],
  ['Cao Bằng',   'Thái Nguyên'],
  ['Hà Giang',   'Lào Cai'],
  ['Hà Giang',   'Thái Nguyên'],
  ['Bắc Kạn',    'Thái Nguyên'],
  ['Điện Biên',  'Lào Cai'],
  ['Lai Châu',   'Lào Cai'],
  ['Sơn La',     'Lào Cai'],
  ['Sơn La',     'Điện Biên'],
  // Nội vùng Mekong bổ sung
  ['Long An',   'Vĩnh Long'],
  ['Long An',   'An Giang'],
  ['Long An',   'Cần Thơ'],
  ['Tiền Giang','Cần Thơ'],
  ['Tiền Giang','An Giang'],
  ['Bến Tre',   'Cần Thơ'],
  ['Bến Tre',   'Sóc Trăng'],
  ['Trà Vinh',  'Cần Thơ'],
  ['Trà Vinh',  'Bạc Liêu'],
  ['Trà Vinh',  'Cà Mau'],
  ['Đồng Tháp', 'Kiên Giang'],
  ['An Giang',  'Hậu Giang'],
  ['An Giang',  'Sóc Trăng'],
  ['An Giang',  'Bạc Liêu'],
  ['An Giang',  'Cà Mau'],
  ['Kiên Giang','Sóc Trăng'],
  ['Hậu Giang', 'Cà Mau'],
  ['Sóc Trăng', 'Cà Mau'],
];

/* ══════════════════════════════════════════════════════════════════
   UTILITY FUNCTIONS
══════════════════════════════════════════════════════════════════ */
function haversine(c1, c2) {
  if (!c1 || !c2) return 500;
  const [lat1, lng1] = c1, [lat2, lng2] = c2;
  const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

function calcPrice(km) {
  // ≈ 2 500đ/km; tối thiểu 50 000đ; làm tròn 10 000đ
  return Math.round(Math.max(50000, km * 2500) / 10000) * 10000;
}

function travelHours(km) {
  // Tốc độ trung bình xe khách đường dài: 55 km/h
  return Math.max(1, Math.round(km / 55));
}

/* ══════════════════════════════════════════════════════════════════
   TẦNG 4 · CLUSTER MESH — kết nối nội vùng theo khoảng cách
   Hai tỉnh cùng cluster + haversine ≤ MAX_KM → tạo tuyến trực tiếp
══════════════════════════════════════════════════════════════════ */
const CLUSTERS = {
  NORTH:    ['Hà Nội','Hải Phòng','Quảng Ninh','Hải Dương','Hưng Yên','Thái Bình',
             'Nam Định','Hà Nam','Ninh Bình','Vĩnh Phúc','Bắc Ninh','Bắc Giang',
             'Phú Thọ','Thái Nguyên','Tuyên Quang','Lào Cai','Yên Bái','Hòa Bình',
             'Sơn La','Điện Biên','Lai Châu','Hà Giang','Cao Bằng','Bắc Kạn','Lạng Sơn'],
  NORTH_CENTRAL: ['Thanh Hóa','Nghệ An','Hà Tĩnh','Quảng Bình','Quảng Trị','Thừa Thiên Huế'],
  SOUTH_CENTRAL: ['Đà Nẵng','Quảng Nam','Quảng Ngãi','Bình Định','Phú Yên','Khánh Hòa','Ninh Thuận','Bình Thuận'],
  HIGHLAND:      ['Kon Tum','Gia Lai','Đắk Lắk','Đắk Nông','Lâm Đồng'],
  SOUTHEAST:     ['TP. Hồ Chí Minh','Bình Dương','Đồng Nai','Bà Rịa - Vũng Tàu','Bình Phước','Tây Ninh'],
  MEKONG:        ['Long An','Tiền Giang','Bến Tre','Trà Vinh','Vĩnh Long','Đồng Tháp',
                  'An Giang','Kiên Giang','Cần Thơ','Hậu Giang','Sóc Trăng','Bạc Liêu','Cà Mau'],
};
// Khoảng cách tối đa (km) để tạo tuyến nội cluster
const CLUSTER_MAX_KM = { NORTH: 320, NORTH_CENTRAL: 400, SOUTH_CENTRAL: 350,
                         HIGHLAND: 280, SOUTHEAST: 200, MEKONG: 250 };

function buildClusterMeshPairs() {
  const pairs = [];
  for (const [cluster, provinces] of Object.entries(CLUSTERS)) {
    const maxKm = CLUSTER_MAX_KM[cluster];
    for (let i = 0; i < provinces.length; i++) {
      for (let j = i + 1; j < provinces.length; j++) {
        const a = provinces[i], b = provinces[j];
        if (!COORDS[a] || !COORDS[b]) continue;
        const km = haversine(COORDS[a], COORDS[b]);
        if (km <= maxKm) pairs.push([a, b]);
      }
    }
  }
  return pairs;
}

/* ══════════════════════════════════════════════════════════════════
   BUILD ROUTE PAIR SET
   Gộp T1+T2+T3+T4, loại trùng, tự thêm chiều ngược lại
══════════════════════════════════════════════════════════════════ */
function buildAllPairs() {
  const seen = new Set();
  const pairs = [];

  function add(a, b) {
    if (a === b) return;
    if (!COORDS[a] || !COORDS[b]) { console.warn('[skip] Không tìm thấy tọa độ:', a, '/', b); return; }
    const fwd = `${a}|||${b}`;
    const rev = `${b}|||${a}`;
    if (!seen.has(fwd)) { seen.add(fwd); pairs.push([a, b]); }
    if (!seen.has(rev)) { seen.add(rev); pairs.push([b, a]); }
  }

  // T1 – Adjacency
  for (const [a, b] of ADJACENCY) add(a, b);

  // T2 – Hub spokes
  for (const [hub, targets] of Object.entries(HUB_SPOKES)) {
    for (const t of targets) add(hub, t);
  }

  // T3 – Express
  for (const [a, b] of EXPRESS) add(a, b);

  // T4 – Cluster mesh (intra-regional proximity)
  for (const [a, b] of buildClusterMeshPairs()) add(a, b);

  return pairs;
}

/* ══════════════════════════════════════════════════════════════════
   MAIN SEEDER
══════════════════════════════════════════════════════════════════ */
async function seedRoutesV2() {
  console.log('🚌 [SeedV2] Bắt đầu xây dựng Route Graph v2...\n');

  /* ── 0. Tải dữ liệu hiện tại ─────────────────────────────────── */
  const [existingRoutes] = await db.query('SELECT route_id, origin, destination FROM route');
  const existingSet = new Set(existingRoutes.map(r => `${r.origin}|||${r.destination}`));
  const routeIdMap  = {};
  for (const r of existingRoutes) routeIdMap[`${r.origin}|||${r.destination}`] = r.route_id;
  console.log(`ℹ️  Hiện có ${existingRoutes.length} routes trong DB`);

  /* ── 1. Lấy bus có operator hợp lệ ─────────────────────────────*/
  const [buses] = await db.query(`
    SELECT b.bus_id, b.total_seats, o.operator_id FROM bus b
    JOIN bus_operator o ON b.operator_id = o.operator_id
    WHERE b.status IN ('AVAILABLE','ACTIVE')
    ORDER BY b.bus_id
  `);
  if (!buses.length) { console.error('❌ Không có bus hợp lệ'); return; }
  const getBus = (idx) => buses[idx % buses.length];

  /* ── 2. Build pair list & insert routes ─────────────────────────*/
  const allPairs = buildAllPairs();
  console.log(`📋 Tổng cặp O-D cần tạo: ${allPairs.length}`);

  let routesAdded = 0, routesSkipped = 0;

  for (const [orig, dest] of allPairs) {
    const key = `${orig}|||${dest}`;
    if (existingSet.has(key)) { routeIdMap[key] = routeIdMap[key]; routesSkipped++; continue; }

    const km = haversine(COORDS[orig], COORDS[dest]);
    const [co, cd] = [COORDS[orig], COORDS[dest]];
    try {
      const [r] = await db.query(
        `INSERT INTO route (origin, destination, distance_km, origin_lat, origin_lng, dest_lat, dest_lng)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [orig, dest, km, co[0], co[1], cd[0], cd[1]]
      );
      routeIdMap[key] = r.insertId;
      existingSet.add(key);
      routesAdded++;
    } catch (e) {
      if (e.code !== 'ER_DUP_ENTRY') console.warn('[route insert]', orig, dest, e.message.slice(0,60));
    }
  }
  console.log(`✅ Routes mới: +${routesAdded} | Đã có: ${routesSkipped}`);

  /* ── 3. Tạo trips cho các route chưa có ─────────────────────────*/
  const [routesWithTrips] = await db.query('SELECT DISTINCT route_id FROM trip');
  const hasTrips = new Set(routesWithTrips.map(r => r.route_id));

  // Giờ khởi hành UTC: 00 / 06 / 12 / 18 (tương ứng 7h/13h/19h/01h VN)
  const DEP_UTC_HOURS = [0, 6, 12, 18];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  let tripsAdded = 0;

  for (const [key, routeId] of Object.entries(routeIdMap)) {
    if (hasTrips.has(routeId)) continue;

    const [orig, dest] = key.split('|||');
    const km      = haversine(COORDS[orig], COORDS[dest]);
    const travelH = travelHours(km);
    const price   = calcPrice(km);
    const bus     = getBus(routeId);

    // Tạo 4 chuyến / ngày × 3 ngày tới
    for (let day = 0; day < 3; day++) {
      for (const utcH of DEP_UTC_HOURS) {
        const dep = new Date(today.getTime() + day * 86400000 + utcH * 3600000);
        const arr = new Date(dep.getTime() + travelH * 3600000);
        try {
          await db.query(
            `INSERT INTO trip (route_id, bus_id, departure_time, arrival_time, base_price, status)
             VALUES (?, ?, ?, ?, ?, 'OPEN')`,
            [routeId, bus.bus_id, dep, arr, price]
          );
          tripsAdded++;
        } catch(e) { /* bỏ qua duplicate */ }
      }
    }
    hasTrips.add(routeId);
  }
  console.log(`✅ Trips mới: +${tripsAdded}`);

  /* ── 4. Tổng kết ─────────────────────────────────────────────── */
  const [[rc]] = await db.query('SELECT COUNT(*) c FROM route');
  const [[tc]] = await db.query('SELECT COUNT(*) c FROM trip');
  const [[sc]] = await db.query('SELECT COUNT(*) c FROM route_stop');

  console.log('\n═══════════════════════════════════════════════');
  console.log('📊 KẾT QUẢ SAU SEED V2:');
  console.log(`   Routes: ${rc.c}`);
  console.log(`   Trips:  ${tc.c}`);
  console.log(`   Stops:  ${sc.c}`);
  console.log('═══════════════════════════════════════════════');
}

/* ══════════════════════════════════════════════════════════════════
   VERIFY CONNECTIVITY — Từ mọi tỉnh đến mọi hub
══════════════════════════════════════════════════════════════════ */
async function verifyConnectivity() {
  console.log('\n🔍 Kiểm tra kết nối graph...');

  const [routes] = await db.query('SELECT origin, destination FROM route');
  // Build adjacency map
  const graph = {};
  for (const r of routes) {
    if (!graph[r.origin]) graph[r.origin] = new Set();
    graph[r.origin].add(r.destination);
  }

  const HUBS = ['Hà Nội', 'Đà Nẵng', 'TP. Hồ Chí Minh', 'Cần Thơ', 'Nghệ An', 'Khánh Hòa'];
  const allProvinces = Object.keys(COORDS);

  // BFS từ mỗi tỉnh, kiểm tra có đến được ít nhất 1 hub trong 3 bước
  let isolated = [];
  for (const start of allProvinces) {
    const visited = new Set([start]);
    const queue   = [[start, 0]];
    let reachesHub = false;
    while (queue.length && !reachesHub) {
      const [cur, depth] = queue.shift();
      if (HUBS.includes(cur) && cur !== start) { reachesHub = true; break; }
      if (depth >= 2) continue;
      for (const next of (graph[cur] || [])) {
        if (!visited.has(next)) { visited.add(next); queue.push([next, depth+1]); }
      }
    }
    if (!reachesHub) isolated.push(start);
  }

  if (isolated.length === 0) {
    console.log('✅ TẤT CẢ 63 tỉnh/thành đều kết nối được với ít nhất 1 hub trong ≤ 2 bước!');
  } else {
    console.log(`⚠️  ${isolated.length} tỉnh cô lập (chưa đến hub trong 2 bước):`, isolated);
  }

  // Test cụ thể: một số cặp khó
  const testCases = [
    ['Cao Bằng',  'Cà Mau'],
    ['Điện Biên', 'Bạc Liêu'],
    ['Lai Châu',  'Bà Rịa - Vũng Tàu'],
    ['Hà Giang',  'Kiên Giang'],
    ['Kon Tum',   'Hải Phòng'],
    ['Bắc Kạn',   'Cà Mau'],
  ];

  console.log('\n📍 Test tuyến khó (BFS ≤ 3 bước):');
  for (const [from, to] of testCases) {
    const visited = new Set([from]);
    const queue   = [[from, 0, [from]]];
    let found = null;
    while (queue.length && !found) {
      const [cur, depth, path] = queue.shift();
      if (cur === to) { found = path; break; }
      if (depth >= 3) continue;
      for (const next of (graph[cur] || [])) {
        if (!visited.has(next)) { visited.add(next); queue.push([next, depth+1, [...path, next]]); }
      }
    }
    if (found) {
      console.log(`  ✅ ${from} → ${to}: ${found.join(' → ')}`);
    } else {
      console.log(`  ❌ ${from} → ${to}: chưa tìm được trong 3 bước`);
    }
  }
}

/* ══════════════════════════════════════════════════════════════════
   ENTRY POINT
══════════════════════════════════════════════════════════════════ */
async function run() {
  try {
    await seedRoutesV2();
    await verifyConnectivity();
    process.exit(0);
  } catch (e) {
    console.error('❌ [SeedV2] Lỗi:', e.message);
    process.exit(1);
  }
}

run();
