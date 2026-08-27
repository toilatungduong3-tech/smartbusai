'use strict';
/**
 * AES-256-GCM encryption for personally-identifiable data at rest
 * (currently: users.id_number / saved_passenger.id_number — CCCD/CMND).
 *
 * Each value is encrypted with its own random 12-byte IV (AES-GCM must
 * never reuse an IV under the same key) and carries its own 16-byte auth
 * tag, so tampering with a stored value is detected on decrypt rather than
 * silently producing garbage. The "enc1:" prefix lets decryptPII()
 * recognize and pass through any pre-encryption plaintext row untouched
 * instead of throwing — defensive only; live check at migration time found
 * 0 such rows in this database.
 */
const crypto = require('crypto');
const KEY = require('../config/piiKey');

const PREFIX = 'enc1:';

function encryptPII(plaintext) {
    if (plaintext === null || plaintext === undefined || plaintext === '') return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
    const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

function decryptPII(stored) {
    if (!stored) return null;
    if (!stored.startsWith(PREFIX)) return stored; // legacy/plaintext row
    try {
        const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
        const iv = raw.subarray(0, 12);
        const tag = raw.subarray(12, 28);
        const ciphertext = raw.subarray(28);
        const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch (e) {
        return null; // wrong key or corrupted ciphertext — never throw into a response
    }
}

module.exports = { encryptPII, decryptPII };
