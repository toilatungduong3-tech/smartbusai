-- SmartBusAI Migration v2
-- Thêm: route_stop (điểm đón/trả), search_log (lịch sử tìm kiếm)
-- Tương thích ngược với schema cũ

-- ─────────────────────────────────────────
-- 1. ĐIỂM ĐÓN / TRẢ KHÁCH (route_stop)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS route_stop (
    stop_id       INT AUTO_INCREMENT PRIMARY KEY,
    route_id      INT NOT NULL,
    stop_name     VARCHAR(200) NOT NULL,
    stop_type     ENUM('PICKUP','DROPOFF','BOTH') DEFAULT 'BOTH',
    address       VARCHAR(500),
    lat           DECIMAL(10, 7),
    lng           DECIMAL(10, 7),
    stop_order    INT DEFAULT 0,
    is_active     TINYINT(1) DEFAULT 1,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (route_id) REFERENCES route(route_id) ON DELETE CASCADE,
    INDEX idx_route (route_id),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────
-- 2. LỊCH SỬ TÌM KIẾM (search_log)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS search_log (
    log_id        INT AUTO_INCREMENT PRIMARY KEY,
    user_id       INT,
    origin        VARCHAR(200),
    destination   VARCHAR(200),
    travel_date   DATE,
    result_count  INT DEFAULT 0,
    transit_count INT DEFAULT 0,
    is_success    TINYINT(1) DEFAULT 0,
    search_time   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_route (origin, destination),
    INDEX idx_time (search_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────
-- 3. Thêm coordinates vào bảng route (nếu chưa có)
-- ─────────────────────────────────────────
ALTER TABLE route ADD COLUMN origin_lat  DECIMAL(10,7);
ALTER TABLE route ADD COLUMN origin_lng  DECIMAL(10,7);
ALTER TABLE route ADD COLUMN dest_lat    DECIMAL(10,7);
ALTER TABLE route ADD COLUMN dest_lng    DECIMAL(10,7);

-- ─────────────────────────────────────────
-- 4. Seed tọa độ một số tỉnh thành Việt Nam vào route
-- Chỉ update các route ĐÃ CÓ, không tạo mới
-- ─────────────────────────────────────────
-- Cập nhật tọa độ bằng CASE dựa theo tên tỉnh/thành phố
UPDATE route SET
    origin_lat = CASE
        WHEN origin LIKE '%Hà Nội%'        THEN 21.0285 WHEN origin LIKE '%TP.HCM%' OR origin LIKE '%Hồ Chí Minh%' THEN 10.8231
        WHEN origin LIKE '%Đà Nẵng%'       THEN 16.0544 WHEN origin LIKE '%Hải Phòng%'  THEN 20.8449
        WHEN origin LIKE '%Cần Thơ%'       THEN 10.0452 WHEN origin LIKE '%Nha Trang%'  THEN 12.2388
        WHEN origin LIKE '%Huế%'           THEN 16.4637 WHEN origin LIKE '%Vinh%'        THEN 18.6796
        WHEN origin LIKE '%Đà Lạt%'        THEN 11.9404 WHEN origin LIKE '%Vũng Tàu%'   THEN 10.3460
        WHEN origin LIKE '%Quảng Ngãi%'    THEN 15.1214 WHEN origin LIKE '%Quy Nhơn%'   THEN 13.7830
        WHEN origin LIKE '%Phan Thiết%'    THEN 10.9281 WHEN origin LIKE '%Buôn Ma Thuột%' THEN 12.6667
        WHEN origin LIKE '%Pleiku%'        THEN 13.9833 WHEN origin LIKE '%Kon Tum%'     THEN 14.3497
        WHEN origin LIKE '%Quảng Bình%'    THEN 17.4689 WHEN origin LIKE '%Hội An%'      THEN 15.8801
        WHEN origin LIKE '%Thanh Hóa%'     THEN 19.8075 WHEN origin LIKE '%Nghệ An%'     THEN 18.6699
        WHEN origin LIKE '%Hà Tĩnh%'       THEN 18.3559 WHEN origin LIKE '%Long Xuyên%'  THEN 10.3866
        WHEN origin LIKE '%Rạch Giá%'      THEN 10.0117 WHEN origin LIKE '%Bạc Liêu%'    THEN 9.2941
        WHEN origin LIKE '%Cà Mau%'        THEN 9.1769  WHEN origin LIKE '%Sóc Trăng%'   THEN 9.6000
        WHEN origin LIKE '%Mỹ Tho%'        THEN 10.3601 WHEN origin LIKE '%Bến Tre%'     THEN 10.2415
        WHEN origin LIKE '%Vĩnh Long%'     THEN 10.2539 WHEN origin LIKE '%Trà Vinh%'    THEN 9.9347
        WHEN origin LIKE '%Đồng Tháp%'     THEN 10.4938 WHEN origin LIKE '%An Giang%'    THEN 10.5216
        WHEN origin LIKE '%Kiên Giang%'    THEN 10.0117 WHEN origin LIKE '%Hậu Giang%'   THEN 9.7736
        WHEN origin LIKE '%Tiền Giang%'    THEN 10.3601 WHEN origin LIKE '%Bình Dương%'  THEN 11.3254
        WHEN origin LIKE '%Đồng Nai%'      THEN 10.9456 WHEN origin LIKE '%Bình Phước%'  THEN 11.7512
        WHEN origin LIKE '%Tây Ninh%'      THEN 11.3351 WHEN origin LIKE '%Bà Rịa%'      THEN 10.5417
        WHEN origin LIKE '%Lâm Đồng%'      THEN 11.9404 WHEN origin LIKE '%Bình Thuận%'  THEN 10.9281
        WHEN origin LIKE '%Ninh Thuận%'    THEN 11.5645 WHEN origin LIKE '%Khánh Hòa%'   THEN 12.2388
        WHEN origin LIKE '%Phú Yên%'       THEN 13.0956 WHEN origin LIKE '%Gia Lai%'     THEN 13.9833
        WHEN origin LIKE '%Đắk Lắk%'       THEN 12.6667 WHEN origin LIKE '%Đắk Nông%'   THEN 12.0046
        WHEN origin LIKE '%Quảng Nam%'     THEN 15.5394 WHEN origin LIKE '%Quảng Trị%'   THEN 16.7500
        WHEN origin LIKE '%Quảng Ninh%'    THEN 21.0064 WHEN origin LIKE '%Hà Nam%'      THEN 20.5835
        WHEN origin LIKE '%Nam Định%'      THEN 20.4200 WHEN origin LIKE '%Thái Bình%'   THEN 20.4463
        WHEN origin LIKE '%Ninh Bình%'     THEN 20.2539 WHEN origin LIKE '%Hòa Bình%'    THEN 20.8133
        WHEN origin LIKE '%Sơn La%'        THEN 21.3272 WHEN origin LIKE '%Điện Biên%'   THEN 21.3860
        WHEN origin LIKE '%Lai Châu%'      THEN 22.3964 WHEN origin LIKE '%Lào Cai%'     THEN 22.4856
        WHEN origin LIKE '%Yên Bái%'       THEN 21.7168 WHEN origin LIKE '%Phú Thọ%'     THEN 21.4000
        WHEN origin LIKE '%Vĩnh Phúc%'    THEN 21.3609 WHEN origin LIKE '%Hà Giang%'    THEN 22.8025
        WHEN origin LIKE '%Cao Bằng%'      THEN 22.6653 WHEN origin LIKE '%Bắc Kạn%'     THEN 22.1477
        WHEN origin LIKE '%Tuyên Quang%'   THEN 21.8236 WHEN origin LIKE '%Lạng Sơn%'    THEN 21.8537
        WHEN origin LIKE '%Bắc Giang%'     THEN 21.2812 WHEN origin LIKE '%Bắc Ninh%'    THEN 21.1861
        WHEN origin LIKE '%Thái Nguyên%'   THEN 21.5672 WHEN origin LIKE '%Hưng Yên%'    THEN 20.6464
        WHEN origin LIKE '%Hải Dương%'     THEN 20.9373 WHEN origin LIKE '%Hà Tây%'      THEN 20.9500
        ELSE NULL
    END,
    origin_lng = CASE
        WHEN origin LIKE '%Hà Nội%'        THEN 105.8542 WHEN origin LIKE '%TP.HCM%' OR origin LIKE '%Hồ Chí Minh%' THEN 106.6297
        WHEN origin LIKE '%Đà Nẵng%'       THEN 108.2022 WHEN origin LIKE '%Hải Phòng%'  THEN 106.6881
        WHEN origin LIKE '%Cần Thơ%'       THEN 105.6361 WHEN origin LIKE '%Nha Trang%'  THEN 109.1967
        WHEN origin LIKE '%Huế%'           THEN 107.5909 WHEN origin LIKE '%Vinh%'        THEN 105.6813
        WHEN origin LIKE '%Đà Lạt%'        THEN 108.4583 WHEN origin LIKE '%Vũng Tàu%'   THEN 107.0843
        WHEN origin LIKE '%Quảng Ngãi%'    THEN 108.7947 WHEN origin LIKE '%Quy Nhơn%'   THEN 109.2197
        WHEN origin LIKE '%Phan Thiết%'    THEN 108.1009 WHEN origin LIKE '%Buôn Ma Thuột%' THEN 108.0500
        WHEN origin LIKE '%Pleiku%'        THEN 108.0000 WHEN origin LIKE '%Kon Tum%'     THEN 108.0000
        WHEN origin LIKE '%Quảng Bình%'    THEN 106.6036 WHEN origin LIKE '%Hội An%'      THEN 108.3380
        WHEN origin LIKE '%Thanh Hóa%'     THEN 105.7769 WHEN origin LIKE '%Nghệ An%'     THEN 105.6813
        WHEN origin LIKE '%Hà Tĩnh%'       THEN 105.9063 WHEN origin LIKE '%Long Xuyên%'  THEN 105.4355
        WHEN origin LIKE '%Rạch Giá%'      THEN 105.0809 WHEN origin LIKE '%Bạc Liêu%'    THEN 105.7278
        WHEN origin LIKE '%Cà Mau%'        THEN 105.1500 WHEN origin LIKE '%Sóc Trăng%'   THEN 105.9800
        WHEN origin LIKE '%Mỹ Tho%'        THEN 106.3600 WHEN origin LIKE '%Bến Tre%'     THEN 106.3750
        WHEN origin LIKE '%Vĩnh Long%'     THEN 105.9722 WHEN origin LIKE '%Trà Vinh%'    THEN 106.3453
        WHEN origin LIKE '%Đồng Tháp%'     THEN 105.6882 WHEN origin LIKE '%An Giang%'    THEN 105.1259
        WHEN origin LIKE '%Kiên Giang%'    THEN 105.0809 WHEN origin LIKE '%Hậu Giang%'   THEN 105.6412
        WHEN origin LIKE '%Tiền Giang%'    THEN 106.3600 WHEN origin LIKE '%Bình Dương%'  THEN 106.6774
        WHEN origin LIKE '%Đồng Nai%'      THEN 107.1886 WHEN origin LIKE '%Bình Phước%'  THEN 106.9234
        WHEN origin LIKE '%Tây Ninh%'      THEN 106.1098 WHEN origin LIKE '%Bà Rịa%'      THEN 107.2431
        WHEN origin LIKE '%Lâm Đồng%'      THEN 108.4583 WHEN origin LIKE '%Bình Thuận%'  THEN 108.1009
        WHEN origin LIKE '%Ninh Thuận%'    THEN 108.9880 WHEN origin LIKE '%Khánh Hòa%'   THEN 109.1967
        WHEN origin LIKE '%Phú Yên%'       THEN 109.3184 WHEN origin LIKE '%Gia Lai%'     THEN 108.0000
        WHEN origin LIKE '%Đắk Lắk%'       THEN 108.0500 WHEN origin LIKE '%Đắk Nông%'   THEN 107.6900
        WHEN origin LIKE '%Quảng Nam%'     THEN 108.0191 WHEN origin LIKE '%Quảng Trị%'   THEN 107.1900
        WHEN origin LIKE '%Quảng Ninh%'    THEN 107.2925 WHEN origin LIKE '%Hà Nam%'      THEN 105.9230
        WHEN origin LIKE '%Nam Định%'      THEN 106.1621 WHEN origin LIKE '%Thái Bình%'   THEN 106.3414
        WHEN origin LIKE '%Ninh Bình%'     THEN 105.9745 WHEN origin LIKE '%Hòa Bình%'    THEN 105.3383
        WHEN origin LIKE '%Sơn La%'        THEN 103.9188 WHEN origin LIKE '%Điện Biên%'   THEN 102.9979
        WHEN origin LIKE '%Lai Châu%'      THEN 103.4594 WHEN origin LIKE '%Lào Cai%'     THEN 103.9753
        WHEN origin LIKE '%Yên Bái%'       THEN 104.9055 WHEN origin LIKE '%Phú Thọ%'     THEN 105.2300
        WHEN origin LIKE '%Vĩnh Phúc%'    THEN 105.5969 WHEN origin LIKE '%Hà Giang%'    THEN 104.9836
        WHEN origin LIKE '%Cao Bằng%'      THEN 106.2569 WHEN origin LIKE '%Bắc Kạn%'     THEN 105.8346
        WHEN origin LIKE '%Tuyên Quang%'   THEN 105.2281 WHEN origin LIKE '%Lạng Sơn%'    THEN 106.7610
        WHEN origin LIKE '%Bắc Giang%'     THEN 106.1947 WHEN origin LIKE '%Bắc Ninh%'    THEN 106.0630
        WHEN origin LIKE '%Thái Nguyên%'   THEN 105.8342 WHEN origin LIKE '%Hưng Yên%'    THEN 106.0511
        WHEN origin LIKE '%Hải Dương%'     THEN 106.3309 WHEN origin LIKE '%Hà Tây%'      THEN 105.7800
        ELSE NULL
    END
WHERE origin_lat IS NULL OR origin_lat = 0;

UPDATE route SET
    dest_lat = CASE
        WHEN destination LIKE '%Hà Nội%'        THEN 21.0285 WHEN destination LIKE '%TP.HCM%' OR destination LIKE '%Hồ Chí Minh%' THEN 10.8231
        WHEN destination LIKE '%Đà Nẵng%'       THEN 16.0544 WHEN destination LIKE '%Hải Phòng%'  THEN 20.8449
        WHEN destination LIKE '%Cần Thơ%'       THEN 10.0452 WHEN destination LIKE '%Nha Trang%'  THEN 12.2388
        WHEN destination LIKE '%Huế%'           THEN 16.4637 WHEN destination LIKE '%Vinh%'        THEN 18.6796
        WHEN destination LIKE '%Đà Lạt%'        THEN 11.9404 WHEN destination LIKE '%Vũng Tàu%'   THEN 10.3460
        WHEN destination LIKE '%Quảng Ngãi%'    THEN 15.1214 WHEN destination LIKE '%Quy Nhơn%'   THEN 13.7830
        WHEN destination LIKE '%Phan Thiết%'    THEN 10.9281 WHEN destination LIKE '%Buôn Ma Thuột%' THEN 12.6667
        WHEN destination LIKE '%Pleiku%'        THEN 13.9833 WHEN destination LIKE '%Kon Tum%'     THEN 14.3497
        WHEN destination LIKE '%Quảng Bình%'    THEN 17.4689 WHEN destination LIKE '%Hội An%'      THEN 15.8801
        WHEN destination LIKE '%Thanh Hóa%'     THEN 19.8075 WHEN destination LIKE '%Nghệ An%'     THEN 18.6699
        WHEN destination LIKE '%Hà Tĩnh%'       THEN 18.3559 WHEN destination LIKE '%Long Xuyên%'  THEN 10.3866
        WHEN destination LIKE '%Rạch Giá%'      THEN 10.0117 WHEN destination LIKE '%Bạc Liêu%'    THEN 9.2941
        WHEN destination LIKE '%Cà Mau%'        THEN 9.1769  WHEN destination LIKE '%Sóc Trăng%'   THEN 9.6000
        WHEN destination LIKE '%Mỹ Tho%'        THEN 10.3601 WHEN destination LIKE '%Bến Tre%'     THEN 10.2415
        WHEN destination LIKE '%Vĩnh Long%'     THEN 10.2539 WHEN destination LIKE '%Trà Vinh%'    THEN 9.9347
        WHEN destination LIKE '%Đồng Tháp%'     THEN 10.4938 WHEN destination LIKE '%An Giang%'    THEN 10.5216
        WHEN destination LIKE '%Kiên Giang%'    THEN 10.0117 WHEN destination LIKE '%Hậu Giang%'   THEN 9.7736
        WHEN destination LIKE '%Tiền Giang%'    THEN 10.3601 WHEN destination LIKE '%Bình Dương%'  THEN 11.3254
        WHEN destination LIKE '%Đồng Nai%'      THEN 10.9456 WHEN destination LIKE '%Bình Phước%'  THEN 11.7512
        WHEN destination LIKE '%Tây Ninh%'      THEN 11.3351 WHEN destination LIKE '%Bà Rịa%'      THEN 10.5417
        WHEN destination LIKE '%Lâm Đồng%'      THEN 11.9404 WHEN destination LIKE '%Bình Thuận%'  THEN 10.9281
        WHEN destination LIKE '%Ninh Thuận%'    THEN 11.5645 WHEN destination LIKE '%Khánh Hòa%'   THEN 12.2388
        WHEN destination LIKE '%Phú Yên%'       THEN 13.0956 WHEN destination LIKE '%Gia Lai%'     THEN 13.9833
        WHEN destination LIKE '%Đắk Lắk%'       THEN 12.6667 WHEN destination LIKE '%Đắk Nông%'   THEN 12.0046
        WHEN destination LIKE '%Quảng Nam%'     THEN 15.5394 WHEN destination LIKE '%Quảng Trị%'   THEN 16.7500
        WHEN destination LIKE '%Quảng Ninh%'    THEN 21.0064 WHEN destination LIKE '%Hà Nam%'      THEN 20.5835
        WHEN destination LIKE '%Nam Định%'      THEN 20.4200 WHEN destination LIKE '%Thái Bình%'   THEN 20.4463
        WHEN destination LIKE '%Ninh Bình%'     THEN 20.2539 WHEN destination LIKE '%Hòa Bình%'    THEN 20.8133
        WHEN destination LIKE '%Sơn La%'        THEN 21.3272 WHEN destination LIKE '%Điện Biên%'   THEN 21.3860
        WHEN destination LIKE '%Lai Châu%'      THEN 22.3964 WHEN destination LIKE '%Lào Cai%'     THEN 22.4856
        WHEN destination LIKE '%Yên Bái%'       THEN 21.7168 WHEN destination LIKE '%Phú Thọ%'     THEN 21.4000
        WHEN destination LIKE '%Vĩnh Phúc%'    THEN 21.3609 WHEN destination LIKE '%Hà Giang%'    THEN 22.8025
        WHEN destination LIKE '%Cao Bằng%'      THEN 22.6653 WHEN destination LIKE '%Bắc Kạn%'     THEN 22.1477
        WHEN destination LIKE '%Tuyên Quang%'   THEN 21.8236 WHEN destination LIKE '%Lạng Sơn%'    THEN 21.8537
        WHEN destination LIKE '%Bắc Giang%'     THEN 21.2812 WHEN destination LIKE '%Bắc Ninh%'    THEN 21.1861
        WHEN destination LIKE '%Thái Nguyên%'   THEN 21.5672 WHEN destination LIKE '%Hưng Yên%'    THEN 20.6464
        WHEN destination LIKE '%Hải Dương%'     THEN 20.9373 WHEN destination LIKE '%Hà Tây%'      THEN 20.9500
        ELSE NULL
    END,
    dest_lng = CASE
        WHEN destination LIKE '%Hà Nội%'        THEN 105.8542 WHEN destination LIKE '%TP.HCM%' OR destination LIKE '%Hồ Chí Minh%' THEN 106.6297
        WHEN destination LIKE '%Đà Nẵng%'       THEN 108.2022 WHEN destination LIKE '%Hải Phòng%'  THEN 106.6881
        WHEN destination LIKE '%Cần Thơ%'       THEN 105.6361 WHEN destination LIKE '%Nha Trang%'  THEN 109.1967
        WHEN destination LIKE '%Huế%'           THEN 107.5909 WHEN destination LIKE '%Vinh%'        THEN 105.6813
        WHEN destination LIKE '%Đà Lạt%'        THEN 108.4583 WHEN destination LIKE '%Vũng Tàu%'   THEN 107.0843
        WHEN destination LIKE '%Quảng Ngãi%'    THEN 108.7947 WHEN destination LIKE '%Quy Nhơn%'   THEN 109.2197
        WHEN destination LIKE '%Phan Thiết%'    THEN 108.1009 WHEN destination LIKE '%Buôn Ma Thuột%' THEN 108.0500
        WHEN destination LIKE '%Pleiku%'        THEN 108.0000 WHEN destination LIKE '%Kon Tum%'     THEN 108.0000
        WHEN destination LIKE '%Quảng Bình%'    THEN 106.6036 WHEN destination LIKE '%Hội An%'      THEN 108.3380
        WHEN destination LIKE '%Thanh Hóa%'     THEN 105.7769 WHEN destination LIKE '%Nghệ An%'     THEN 105.6813
        WHEN destination LIKE '%Hà Tĩnh%'       THEN 105.9063 WHEN destination LIKE '%Long Xuyên%'  THEN 105.4355
        WHEN destination LIKE '%Rạch Giá%'      THEN 105.0809 WHEN destination LIKE '%Bạc Liêu%'    THEN 105.7278
        WHEN destination LIKE '%Cà Mau%'        THEN 105.1500 WHEN destination LIKE '%Sóc Trăng%'   THEN 105.9800
        WHEN destination LIKE '%Mỹ Tho%'        THEN 106.3600 WHEN destination LIKE '%Bến Tre%'     THEN 106.3750
        WHEN destination LIKE '%Vĩnh Long%'     THEN 105.9722 WHEN destination LIKE '%Trà Vinh%'    THEN 106.3453
        WHEN destination LIKE '%Đồng Tháp%'     THEN 105.6882 WHEN destination LIKE '%An Giang%'    THEN 105.1259
        WHEN destination LIKE '%Kiên Giang%'    THEN 105.0809 WHEN destination LIKE '%Hậu Giang%'   THEN 105.6412
        WHEN destination LIKE '%Tiền Giang%'    THEN 106.3600 WHEN destination LIKE '%Bình Dương%'  THEN 106.6774
        WHEN destination LIKE '%Đồng Nai%'      THEN 107.1886 WHEN destination LIKE '%Bình Phước%'  THEN 106.9234
        WHEN destination LIKE '%Tây Ninh%'      THEN 106.1098 WHEN destination LIKE '%Bà Rịa%'      THEN 107.2431
        WHEN destination LIKE '%Lâm Đồng%'      THEN 108.4583 WHEN destination LIKE '%Bình Thuận%'  THEN 108.1009
        WHEN destination LIKE '%Ninh Thuận%'    THEN 108.9880 WHEN destination LIKE '%Khánh Hòa%'   THEN 109.1967
        WHEN destination LIKE '%Phú Yên%'       THEN 109.3184 WHEN destination LIKE '%Gia Lai%'     THEN 108.0000
        WHEN destination LIKE '%Đắk Lắk%'       THEN 108.0500 WHEN destination LIKE '%Đắk Nông%'   THEN 107.6900
        WHEN destination LIKE '%Quảng Nam%'     THEN 108.0191 WHEN destination LIKE '%Quảng Trị%'   THEN 107.1900
        WHEN destination LIKE '%Quảng Ninh%'    THEN 107.2925 WHEN destination LIKE '%Hà Nam%'      THEN 105.9230
        WHEN destination LIKE '%Nam Định%'      THEN 106.1621 WHEN destination LIKE '%Thái Bình%'   THEN 106.3414
        WHEN destination LIKE '%Ninh Bình%'     THEN 105.9745 WHEN destination LIKE '%Hòa Bình%'    THEN 105.3383
        WHEN destination LIKE '%Sơn La%'        THEN 103.9188 WHEN destination LIKE '%Điện Biên%'   THEN 102.9979
        WHEN destination LIKE '%Lai Châu%'      THEN 103.4594 WHEN destination LIKE '%Lào Cai%'     THEN 103.9753
        WHEN destination LIKE '%Yên Bái%'       THEN 104.9055 WHEN destination LIKE '%Phú Thọ%'     THEN 105.2300
        WHEN destination LIKE '%Vĩnh Phúc%'    THEN 105.5969 WHEN destination LIKE '%Hà Giang%'    THEN 104.9836
        WHEN destination LIKE '%Cao Bằng%'      THEN 106.2569 WHEN destination LIKE '%Bắc Kạn%'     THEN 105.8346
        WHEN destination LIKE '%Tuyên Quang%'   THEN 105.2281 WHEN destination LIKE '%Lạng Sơn%'    THEN 106.7610
        WHEN destination LIKE '%Bắc Giang%'     THEN 106.1947 WHEN destination LIKE '%Bắc Ninh%'    THEN 106.0630
        WHEN destination LIKE '%Thái Nguyên%'   THEN 105.8342 WHEN destination LIKE '%Hưng Yên%'    THEN 106.0511
        WHEN destination LIKE '%Hải Dương%'     THEN 106.3309 WHEN destination LIKE '%Hà Tây%'      THEN 105.7800
        ELSE NULL
    END
WHERE dest_lat IS NULL OR dest_lat = 0;
