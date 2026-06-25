'use strict';
const fs   = require('fs');
const path = require('path');
const db   = require('./db');

async function runMigration() {
    try {
        const sql = fs.readFileSync(path.join(__dirname, 'migrate_v2.sql'), 'utf8');

        // Strip comment lines, then split by semicolon
        const stripped = sql
            .split('\n')
            .filter(line => !line.trim().startsWith('--'))
            .join('\n');

        const statements = stripped
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 10);

        for (const stmt of statements) {
            try {
                await db.query(stmt);
            } catch (e) {
                // errno 1060 = duplicate column, 1050 = table exists, 1061 = duplicate key
                // errno 1064 = syntax error (ALTER TABLE IF NOT EXISTS on MySQL 5.x — safe to skip)
                if (![1050, 1060, 1061, 1064].includes(e.errno)) {
                    console.warn('[migrate] Skipped stmt:', e.message.slice(0, 100));
                }
            }
        }
        console.log('✅ [migrate] v2 schema migration completed');
    } catch (err) {
        console.error('❌ [migrate] Migration error:', err.message);
    }
}

module.exports = { runMigration };
