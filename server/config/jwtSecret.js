'use strict';
/**
 * Centralized JWT secret resolution — single source of truth.
 * Production/normal dev: set JWT_SECRET in .env (see .env.example).
 * Fallback: only used if JWT_SECRET is somehow missing at runtime (e.g. a
 * deployment that forgot to configure it). A fixed literal fallback is
 * itself a vulnerability if anyone forgets to set the real value, so this
 * generates a random secret instead — with a loud warning, since a random
 * per-process secret invalidates existing tokens on every restart and must
 * not be relied on outside local development.
 */
const crypto = require('crypto');

let secret = process.env.JWT_SECRET;
if (!secret) {
    secret = crypto.randomBytes(48).toString('hex');
    // Deliberately plain console.warn, not the structured logger: this fires
    // at module-require time, before Express/AsyncLocalStorage request
    // context exists, and is a startup/ops warning meant to be maximally
    // visible in a raw terminal — not JSON-formatted for a log aggregator.
    console.warn(
        '⚠️  JWT_SECRET không được cấu hình trong .env — đang dùng secret ngẫu nhiên chỉ tồn tại trong phiên chạy này. ' +
        'Mọi token đã cấp sẽ mất hiệu lực khi restart. Đặt JWT_SECRET trong .env để khắc phục.'
    );
}

module.exports = secret;
