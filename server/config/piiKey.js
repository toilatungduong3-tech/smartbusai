'use strict';
/**
 * Centralized PII-at-rest encryption key resolution — single source of
 * truth, same fallback pattern as jwtSecret.js / qrSecret.js: a fixed
 * literal fallback would recreate the exact vulnerability this exists to
 * close (CCCD/ID-number stored in plaintext), so a random per-process key
 * is generated instead when unset, with a loud warning. Any PII encrypted
 * under that random key stops decrypting after a restart — acceptable for
 * local/demo use, never for a real deployment.
 */
const crypto = require('crypto');

let key;
if (process.env.PII_ENCRYPTION_KEY) {
    // Accept any passphrase string — hash it down to exactly 32 bytes for AES-256.
    key = crypto.createHash('sha256').update(process.env.PII_ENCRYPTION_KEY).digest();
} else {
    key = crypto.randomBytes(32);
    console.warn(
        '⚠️  PII_ENCRYPTION_KEY không được cấu hình trong .env — đang dùng khoá mã hoá ngẫu nhiên chỉ tồn tại trong phiên chạy này. ' +
        'Dữ liệu CCCD/số định danh đã mã hoá trước đó sẽ không giải mã được sau khi restart. Đặt PII_ENCRYPTION_KEY trong .env để khắc phục.'
    );
}

module.exports = key;
