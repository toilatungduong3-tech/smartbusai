'use strict';
/**
 * SmartBusAI — Sprint 7: shared password strength policy.
 * Matches the exact 4 criteria already shown to users client-side in
 * public/pages/auth/register.html's strength meter (len>=8, uppercase,
 * digit, symbol — no lowercase requirement) — enforcing anything stricter
 * here would silently reject a password the UI just told the user was
 * 100% strong. Used everywhere a password is ever set: register, the new
 * change-password endpoint, and reset-password (all previously only
 * checked length, or nothing at all).
 */
function validatePasswordStrength(password) {
    const p = String(password || '');
    if (p.length < 8) return { valid: false, message: 'Mật khẩu phải có ít nhất 8 ký tự' };
    if (!/[A-Z]/.test(p)) return { valid: false, message: 'Mật khẩu phải có ít nhất 1 chữ hoa' };
    if (!/[0-9]/.test(p)) return { valid: false, message: 'Mật khẩu phải có ít nhất 1 chữ số' };
    if (!/[^A-Za-z0-9]/.test(p)) return { valid: false, message: 'Mật khẩu phải có ít nhất 1 ký tự đặc biệt' };
    return { valid: true, message: null };
}

module.exports = { validatePasswordStrength };
