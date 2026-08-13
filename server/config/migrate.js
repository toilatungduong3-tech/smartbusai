'use strict';
const fs   = require('fs');
const path = require('path');
const db   = require('./db');

async function runSqlFile(filePath) {
    const sql = fs.readFileSync(filePath, 'utf8');
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
            // 1060 = duplicate column, 1050 = table exists, 1061 = duplicate key, 1064 = syntax
            if (![1050, 1060, 1061, 1064].includes(e.errno)) {
                console.warn('[migrate] Skipped:', e.message.slice(0, 120));
            }
        }
    }
}

async function runMigration() {
    try {
        await runSqlFile(path.join(__dirname, 'migrate_v2.sql'));
        console.log('✅ [migrate] v2 completed');
        await runSqlFile(path.join(__dirname, 'migrate_v3.sql'));
        console.log('✅ [migrate] v3 completed');
        await runSqlFile(path.join(__dirname, 'migrate_v4.sql'));
        console.log('✅ [migrate] v4 (payment gateway) completed');
    } catch (err) {
        console.error('❌ [migrate] Error:', err.message);
    }
}

module.exports = { runMigration };
