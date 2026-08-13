-- SmartBusAI Migration v3
-- Thêm: location table (US-201), route.status column (US-101)
-- Tương thích ngược — không xóa dữ liệu cũ

-- ─────────────────────────────────────────
-- 1. CỘT STATUS CHO BẢNG ROUTE (US-101)
-- Idempotent: ALTER TABLE IF NOT EXISTS column sẽ skip nếu đã có (errno 1060)
-- ─────────────────────────────────────────
ALTER TABLE route ADD COLUMN status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE';

-- ─────────────────────────────────────────
-- 2. BẢNG LOCATION (US-201)
-- Quản lý địa điểm, tỉnh thành, tọa độ GPS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS location (
    location_id   INT AUTO_INCREMENT PRIMARY KEY,
    name          VARCHAR(200) NOT NULL,
    type          VARCHAR(50)  DEFAULT 'PROVINCE',
    province      VARCHAR(200),
    address       VARCHAR(500),
    latitude      DECIMAL(10, 7),
    longitude     DECIMAL(10, 7),
    status        ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_name   (name),
    INDEX idx_status (status),
    INDEX idx_type   (type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- 3. SEED DỮ LIỆU ĐỊA ĐIỂM TỪ ROUTE (idempotent)
-- Lấy danh sách tỉnh thành từ route.origin + route.destination
-- Không tạo trùng (INSERT IGNORE)
-- ─────────────────────────────────────────
INSERT IGNORE INTO location (name, type, latitude, longitude, status)
SELECT DISTINCT
    origin AS name,
    'PROVINCE' AS type,
    origin_lat AS latitude,
    origin_lng AS longitude,
    'ACTIVE' AS status
FROM route
WHERE origin IS NOT NULL AND origin != ''
  AND NOT EXISTS (SELECT 1 FROM location WHERE LOWER(name) = LOWER(origin));

INSERT IGNORE INTO location (name, type, latitude, longitude, status)
SELECT DISTINCT
    destination AS name,
    'PROVINCE' AS type,
    dest_lat AS latitude,
    dest_lng AS longitude,
    'ACTIVE' AS status
FROM route
WHERE destination IS NOT NULL AND destination != ''
  AND NOT EXISTS (SELECT 1 FROM location WHERE LOWER(name) = LOWER(destination));
