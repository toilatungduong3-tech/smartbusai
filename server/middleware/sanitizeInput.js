'use strict';

/* ═══════════════════════════════════════════════════════════
   sanitizeInput.js — Sprint 12: request-body/query XSS hardening.

   Honest scope: this repo's controllers already use mysql2's `?`
   placeholders consistently (spot-checked across searchController,
   tripController, paymentRoutes, adminController — no raw string-concat
   SQL found), so real SQL-injection exposure here was already
   structurally close to zero before this file existed. What this
   actually closes is STORED XSS: a free-text field (review comment,
   support message, full_name, ...) containing a literal `<script>` tag
   that later gets rendered somewhere without the frontend re-escaping it.
   This is input-side defense-in-depth, not a replacement for
   render-time escaping — see SPRINT12_FINAL_REPORT.md for the scope
   note on why a full output-escaping audit of every frontend render site
   is out of this pass's budget.

   HTML-entity-escapes `<` and `>` in every string value of req.body and
   req.query, recursively (nested objects/arrays), EXCEPT for an explicit
   field-name exclude-list — passwords, tokens, signatures, and hashes
   must never be mutated, or a legitimate password containing `<`/`>`
   would silently fail to match on login, and a signature/HMAC would
   break payment-gateway verification. Escaping (not stripping) is used
   so the visible characters a user actually typed are preserved for
   every OTHER field — a review that says "5 < 10 phút" still reads
   correctly, it just can no longer be interpreted as a tag if ever
   rendered unescaped downstream.
═══════════════════════════════════════════════════════════ */

const EXCLUDED_FIELDS = new Set([
    'password', 'new_password', 'old_password', 'current_password', 'confirm_password',
    'token', 'accessToken', 'refreshToken', 'credential', 'session_id',
    'signature', 'mac', 'vnp_SecureHash', 'hash', 'qr_data', 'payUrl',
]);

function escapeValue(value) {
    if (typeof value !== 'string') return value;
    return value.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sanitizeDeep(obj, depth = 0) {
    if (obj == null || depth > 6) return obj; // depth guard — no legitimate request body nests this deep
    if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
            obj[i] = typeof obj[i] === 'object' ? sanitizeDeep(obj[i], depth + 1) : escapeValue(obj[i]);
        }
        return obj;
    }
    if (typeof obj === 'object') {
        for (const key of Object.keys(obj)) {
            if (EXCLUDED_FIELDS.has(key)) continue;
            const val = obj[key];
            obj[key] = typeof val === 'object' && val !== null ? sanitizeDeep(val, depth + 1) : escapeValue(val);
        }
        return obj;
    }
    return obj;
}

function sanitizeInput(req, res, next) {
    if (req.body && typeof req.body === 'object') sanitizeDeep(req.body);
    if (req.query && typeof req.query === 'object') sanitizeDeep(req.query);
    next();
}

module.exports = sanitizeInput;
module.exports.escapeValue = escapeValue;
module.exports.EXCLUDED_FIELDS = EXCLUDED_FIELDS;
