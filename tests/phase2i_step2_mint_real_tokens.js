'use strict';
/**
 * Phase 2I Step 2 — mint valid access tokens for the REAL pre-existing
 * seed accounts 46/47/48, using the app's own signing key (same mechanism
 * generateTokens() in authController.js uses). This verifies the actual
 * production data fix without touching these accounts' passwords or any
 * other data — no mutation performed here.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const JWT_SECRET = require('../server/config/jwtSecret');

const users = [
    { user_id: 46, role: 'OPERATOR', email: 'tuan.op@phuongtrang.com.vn', label: 'user46_linked_to_op1' },
    { user_id: 47, role: 'OPERATOR', email: 'operator@gmail.com', label: 'user47_unlinked' },
    { user_id: 48, role: 'OPERATOR', email: 'phuc.op@hoanglongasia.com', label: 'user48_linked_to_op3' },
];

const tokens = {};
for (const u of users) {
    tokens[u.label] = {
        user_id: u.user_id,
        token: jwt.sign({ user_id: u.user_id, role: u.role, email: u.email }, JWT_SECRET, { expiresIn: '15m' }),
    };
}
fs.writeFileSync(path.join(__dirname, 'phase2i_step2_real_tokens.json'), JSON.stringify(tokens, null, 2));
console.log(JSON.stringify(Object.keys(tokens), null, 2));
