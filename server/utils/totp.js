'use strict';
/**
 * Server-side TOTP (RFC 6238), HMAC-SHA1, 30s step, 6 digits.
 *
 * Port of the exact algorithm public/pages/passenger/profile.html used to
 * run entirely client-side (Web Crypto's crypto.subtle) — same base32
 * alphabet, same secret length (20 bytes), same ±1 window tolerance — so a
 * previously-generated QR/secret and an authenticator app the user already
 * scanned keep working unchanged. The only thing that moves is WHERE the
 * secret is generated and verified: here, not in the browser, so a secret
 * an attacker can read from localStorage or DevTools no longer defeats the
 * whole point of having 2FA.
 */
const crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function b32Encode(buf) {
    let bits = 0, val = 0, out = '';
    for (const b of buf) {
        val = (val << 8) | b;
        bits += 8;
        while (bits >= 5) {
            out += B32[(val >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) out += B32[(val << (5 - bits)) & 31];
    return out;
}

function b32Decode(s) {
    s = String(s || '').toUpperCase().replace(/=+$/, '');
    let bits = 0, val = 0;
    const out = [];
    for (const c of s) {
        const idx = B32.indexOf(c);
        if (idx < 0) continue;
        val = (val << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            out.push((val >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(out);
}

function generateSecret() {
    return b32Encode(crypto.randomBytes(20));
}

function totpAt(secret, counter) {
    const key = b32Decode(secret);
    const buf = Buffer.alloc(8);
    buf.writeUInt32BE(0, 0);
    buf.writeUInt32BE(counter >>> 0, 4);
    const hmac = crypto.createHmac('sha1', key).update(buf).digest();
    const off = hmac[19] & 0x0f;
    const code = ((hmac[off] & 0x7f) << 24 | (hmac[off + 1] & 0xff) << 16 |
        (hmac[off + 2] & 0xff) << 8 | (hmac[off + 3] & 0xff)) % 1000000;
    return String(code).padStart(6, '0');
}

function verifyTotp(secret, entered) {
    if (!secret) return false;
    const code = String(entered || '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(code)) return false;
    const counter = Math.floor(Date.now() / 1000 / 30);
    for (const w of [-1, 0, 1]) {
        if (totpAt(secret, counter + w) === code) return true;
    }
    return false;
}

function buildOtpauthUrl(secret, email, issuer = 'SmartBusAI') {
    return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}` +
        `?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

function generateBackupCodes(count = 8) {
    return Array.from({ length: count }, () => {
        const n = crypto.randomInt(0, 100000000);
        return String(n).padStart(8, '0');
    });
}

module.exports = { generateSecret, verifyTotp, buildOtpauthUrl, generateBackupCodes, b32Encode, b32Decode };
