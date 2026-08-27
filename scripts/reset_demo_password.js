'use strict';
/**
 * Small utility for local/demo use: set a KNOWN password on an existing
 * account by email (or create it, if it doesn't exist and --create is
 * passed with a role). Exists because the seeded admin/operator accounts
 * in this DB have real bcrypt hashes with no recoverable plaintext — this
 * is the honest way to get a working login for a local demo/defense
 * without guessing at a password that was never documented anywhere.
 *
 * Usage:
 *   node scripts/reset_demo_password.js <email> <newPassword>
 *   node scripts/reset_demo_password.js <email> <newPassword> --create <ROLE>
 *     (ROLE = ADMIN | OPERATOR | PASSENGER; only used if the email doesn't exist yet)
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../server/config/db');

(async () => {
    const [, , email, newPassword, flag, role] = process.argv;
    if (!email || !newPassword) {
        console.log('Usage: node scripts/reset_demo_password.js <email> <newPassword> [--create <ADMIN|OPERATOR|PASSENGER>]');
        process.exit(1);
    }

    const hash = await bcrypt.hash(newPassword, 10);
    const [[user]] = await db.query('SELECT user_id, role FROM users WHERE email=?', [email]);

    if (user) {
        await db.query('UPDATE users SET password_hash=? WHERE user_id=?', [hash, user.user_id]);
        console.log(`✅ Password reset for ${email} (role=${user.role}, user_id=${user.user_id})`);
    } else if (flag === '--create' && role) {
        const validRoles = ['ADMIN', 'OPERATOR', 'PASSENGER'];
        if (!validRoles.includes(role.toUpperCase())) {
            console.error(`❌ role must be one of ${validRoles.join(', ')}`);
            process.exit(1);
        }
        const [result] = await db.query(
            `INSERT INTO users (username, full_name, email, password_hash, role, status, created_at)
             VALUES (?,?,?,?,?, 'ACTIVE', NOW())`,
            [email.split('@')[0], 'Demo ' + role.toUpperCase(), email, hash, role.toUpperCase()]
        );
        console.log(`✅ Created new ${role.toUpperCase()} account: ${email} (user_id=${result.insertId})`);
    } else {
        console.error(`❌ No account with email ${email}. Add "--create ADMIN" (or OPERATOR/PASSENGER) to create one.`);
        process.exit(1);
    }
    process.exit(0);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
