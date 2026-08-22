'use strict';
/**
 * Centralized QR checksum secret resolution — single source of truth.
 * Sprint 5 fix: server/services/qrService.js previously hardcoded this as
 * a literal string ('smartbusai_qr_secret_2024') directly in source —
 * anyone with repo/source access could compute a valid HMAC checksum for
 * any booking_id/user_id/amount, defeating the "tamper-proof" purpose the
 * checksum exists for. Same fallback pattern as server/config/jwtSecret.js:
 * a fixed literal fallback would just recreate the same vulnerability if
 * anyone forgets to set the real value, so a random per-process secret is
 * generated instead, with a loud warning.
 */
const crypto = require('crypto');

let secret = process.env.QR_SECRET;
if (!secret) {
    secret = crypto.randomBytes(48).toString('hex');
    // Deliberately plain console.warn — same rationale as jwtSecret.js.
    console.warn(
        '⚠️  QR_SECRET không được cấu hình trong .env — đang dùng secret ngẫu nhiên chỉ tồn tại trong phiên chạy này. ' +
        'Checksum QR đã tạo trước đó sẽ không còn xác thực được sau khi restart. Đặt QR_SECRET trong .env để khắc phục.'
    );
}

module.exports = secret;
