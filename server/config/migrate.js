'use strict';
const fs   = require('fs');
const path = require('path');
const db   = require('./db');
const logger = require('../utils/logger');

/* ═══════════════════════════════════════════════════════════
   Phase 1 hardening (TRUTHNODE — Section F: migration failure handling)

   BEFORE: any error thrown by a migration statement — including a real
   infrastructure failure like "connect ETIMEDOUT" — was caught, logged as
   "[migrate] Skipped: <message>", and swallowed. The caller went on to log
   "✅ [migrate] vN completed" regardless of whether anything actually ran.
   server.js never awaited runMigration() and server.listen() had zero
   dependency on it, so the server could report "🚀 SmartBus Server
   Running" and start serving traffic against an unmigrated / partially
   migrated schema, with no visible indication anything was wrong.

   Also discovered during this audit: migrate_v6.sql, migrate_v7.sql, and
   migrate_v8.sql all existed on disk, self-documented as "NOT auto-run by
   server/config/migrate.js ... applied manually once, under supervision" —
   yet safety-critical application code (server/middleware/operatorScope.js,
   the entire operator-tenant-isolation RBAC layer) hard-depends on
   migrate_v8.sql's users.operator_id column existing. A fresh deployment
   that only ran the hardcoded v2/v3/v4 list would silently start with
   broken/absent operator authorization and no error at all.

   AFTER:
     1. Only a specific, known-benign class of error (the change already
        exists — duplicate column/table/key) is treated as "skip this one
        statement, continue". Every other error (ETIMEDOUT, a permission
        error, a genuine SQL bug) is FATAL — it aborts the file and
        propagates, so the caller (server.js) can fail loudly instead of
        silently continuing.
     2. migrate_v6/v7/v8.sql are now part of the auto-run sequence (each is
        idempotent — IF NOT EXISTS / benign-errno-skip on re-run).
     3. After all files run, verifySchema() independently confirms the
        specific objects safety-critical code assumes exist — this catches
        both a failed migration AND a future migrate_vN.sql that exists on
        disk but was never added to MIGRATION_FILES.
     4. runMigration() throws (does not swallow) on any failure. server.js
        awaits it before server.listen() and fails fast — see server.js's
        "TIME CONTRACT" / startup section.
═══════════════════════════════════════════════════════════ */

// 1050 = table already exists, 1060 = duplicate column, 1061 = duplicate key
// — these three mean "this specific change was already applied", not a
// failure. (1064 syntax-error was previously also ignored here — removed:
// a syntax error is a real bug in the migration file, never benign.)
const BENIGN_ALREADY_APPLIED_ERRNOS = new Set([1050, 1060, 1061]);

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
            if (BENIGN_ALREADY_APPLIED_ERRNOS.has(e.errno)) {
                continue; // this specific change already exists — not an error
            }
            logger.error(`❌ [migrate] FATAL in ${path.basename(filePath)}:`, e.code || e.errno, '-', e.message);
            throw e; // never silently continue past an unexpected failure
        }
    }
}

const MIGRATION_FILES = [
    'migrate_v2.sql',
    'migrate_v3.sql',
    'migrate_v4.sql',
    'migrate_v6.sql',
    'migrate_v7.sql',
    'migrate_v8.sql',
    'migrate_v9.sql',
    'migrate_v10.sql',
    'migrate_v11.sql',
    'migrate_v12.sql',
    'migrate_v13.sql',
    'migrate_v14.sql',
    'migrate_v15.sql',
    'migrate_v16.sql',
    'migrate_v17.sql',
    'migrate_v18.sql',
    'migrate_v19.sql',
    'migrate_v20.sql',
    'migrate_v21.sql',
    'migrate_v22.sql',
];

/** Independently verify the specific schema objects safety-critical
 *  application code assumes exist — does not trust "no error was thrown"
 *  alone as proof the schema is actually correct. */
async function verifySchema() {
    const missing = [];

    const [[usersOperatorId]] = await db.query(
        `SELECT COUNT(*) AS c FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'operator_id'`
    );
    if (!usersOperatorId.c) missing.push('users.operator_id column (migrate_v8.sql — operator identity FK; operatorScope.js RBAC depends on this)');

    const [[prTable]] = await db.query(
        `SELECT COUNT(*) AS c FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name = 'password_reset_tokens'`
    );
    if (!prTable.c) missing.push('password_reset_tokens table (migrate_v7.sql)');

    const [[tripStatusCol]] = await db.query(
        `SELECT COLUMN_TYPE AS t FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'trip' AND column_name = 'status'`
    );
    if (!tripStatusCol || !/RUNNING/.test(tripStatusCol.t) || !/COMPLETED/.test(tripStatusCol.t)) {
        missing.push("trip.status ENUM missing RUNNING/COMPLETED (migrate_v6.sql)");
    }

    const [[holdTable]] = await db.query(
        `SELECT COUNT(*) AS c FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name = 'trip_seat_hold'`
    );
    if (!holdTable.c) missing.push('trip_seat_hold table (migrate_v9.sql — DB-level seat-uniqueness backstop; bookingController.createBooking depends on this)');

    const [[tripIdx]] = await db.query(
        `SELECT COUNT(*) AS c FROM information_schema.statistics
         WHERE table_schema = DATABASE() AND table_name = 'trip' AND index_name = 'idx_trip_status_departure'`
    );
    if (!tripIdx.c) missing.push('trip(status, departure_time) index (migrate_v10.sql — search/list performance)');

    const [[usersStatusCol]] = await db.query(
        `SELECT COLUMN_TYPE AS t FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'status'`
    );
    if (!usersStatusCol || !/INACTIVE/.test(usersStatusCol.t)) {
        missing.push("users.status ENUM missing INACTIVE (migrate_v11.sql — deleteUser soft-delete depends on this)");
    }

    const [[bookingIdx]] = await db.query(
        `SELECT COUNT(*) AS c FROM information_schema.statistics
         WHERE table_schema = DATABASE() AND table_name = 'booking' AND index_name = 'idx_booking_status_time'`
    );
    if (!bookingIdx.c) missing.push('booking(status, booking_time) index (migrate_v12.sql — bookingCleanup.js abandoned-PENDING scan depends on this at scale)');

    const [[tripRouteIdx]] = await db.query(
        `SELECT COUNT(*) AS c FROM information_schema.statistics
         WHERE table_schema = DATABASE() AND table_name = 'trip' AND index_name = 'idx_trip_route_departure'`
    );
    if (!tripRouteIdx.c) missing.push('trip(route_id, departure_time) index (migrate_v12.sql — search/concierge/transit query performance at scale)');

    const [[stopEstCol]] = await db.query(
        `SELECT COUNT(*) AS c FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'route_stop' AND column_name = 'estimated_min_from_origin'`
    );
    if (!stopEstCol.c) missing.push('route_stop.estimated_min_from_origin column (migrate_v13.sql — Sprint 6 route_stop coverage backfill depends on this)');

    const [[seatLayoutCol]] = await db.query(
        `SELECT COUNT(*) AS c FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'bus' AND column_name = 'seat_layout_config'`
    );
    if (!seatLayoutCol.c) missing.push('bus.seat_layout_config column (migrate_v14.sql — Dynamic Seat Layout Engine depends on this)');

    const [[savedPassengerTable]] = await db.query(
        `SELECT COUNT(*) AS c FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name = 'saved_passenger'`
    );
    if (!savedPassengerTable.c) missing.push('saved_passenger table (migrate_v15.sql — Sprint 6 companion-list feature depends on this)');

    const [[tokenVersionCol]] = await db.query(
        `SELECT COUNT(*) AS c FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'token_version'`
    );
    if (!tokenVersionCol.c) missing.push('users.token_version column (migrate_v16.sql — Sprint 7 real server-side logout depends on this)');

    const [[avatarUrlCol]] = await db.query(
        `SELECT COUNT(*) AS c FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'avatar_url'`
    );
    if (!avatarUrlCol.c) missing.push('users.avatar_url column (migrate_v17.sql — Sprint 8 Avatar Sync Engine depends on this)');

    const [[stopTypeCol]] = await db.query(
        `SELECT COLUMN_TYPE AS t FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'route_stop' AND column_name = 'stop_type'`
    );
    if (!stopTypeCol || !/WAYPOINT/.test(stopTypeCol.t)) {
        missing.push("route_stop.stop_type ENUM missing WAYPOINT (migrate_v18.sql — Sprint 10 real-route seeding depends on this)");
    }

    const [[eventTypeCol]] = await db.query(
        `SELECT COUNT(*) AS c FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'user_behavior' AND column_name = 'event_type'`
    );
    if (!eventTypeCol.c) missing.push('user_behavior.event_type column (migrate_v19.sql — Sprint 11 aiUserProfilingService depends on this)');

    const [[userProfilesAiTable]] = await db.query(
        `SELECT COUNT(*) AS c FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name = 'user_profiles_ai'`
    );
    if (!userProfilesAiTable.c) missing.push('user_profiles_ai table (migrate_v19.sql — Sprint 11 preference-vector cache depends on this)');

    const [[bookingUserStatusIdx]] = await db.query(
        `SELECT COUNT(*) AS c FROM information_schema.statistics
         WHERE table_schema = DATABASE() AND table_name = 'booking' AND index_name = 'idx_booking_user_status_time'`
    );
    if (!bookingUserStatusIdx.c) missing.push('booking(user_id, status, booking_time) index (migrate_v20.sql — Sprint 12 query performance depends on this)');

    /* Inverse check — the only one in this function: migrate_v21.sql DROPS
       these two stale backup tables (Enterprise Hardening Pass), so their
       continued presence means the cleanup migration failed to apply, not
       that something is merely missing. */
    const [[staleBackupTables]] = await db.query(
        `SELECT COUNT(*) AS c FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name IN ('trip_orphan_cleanup_backup_20260815', 'trip_status_recovery_backup_20260815')`
    );
    if (staleBackupTables.c > 0) missing.push('stale backup table(s) still present — migrate_v21.sql cleanup did not apply');

    /* Inverse check: migrate_v22.sql normalizes bad bus.status='' rows to
       'AVAILABLE' — their continued presence means that fix did not apply,
       not that something is merely missing. */
    const [[invalidBusStatus]] = await db.query(
        `SELECT COUNT(*) AS c FROM bus WHERE status = '' OR status IS NULL`
    );
    if (invalidBusStatus.c > 0) missing.push(`${invalidBusStatus.c} bus row(s) with invalid/blank status — migrate_v22.sql cleanup did not apply`);

    return missing;
}

async function runMigration() {
    for (const file of MIGRATION_FILES) {
        await runSqlFile(path.join(__dirname, file));
        logger.info(`✅ [migrate] ${file} completed`);
    }

    const missing = await verifySchema();
    if (missing.length) {
        const err = new Error(
            `Schema verification FAILED — required object(s) missing:\n  - ${missing.join('\n  - ')}`
        );
        err.isMigrationDegraded = true;
        logger.error(`❌ [migrate] DEGRADED STATE:\n${err.message}`);
        throw err;
    }
    logger.info('✅ [migrate] schema verified — all required objects present');
}

module.exports = { runMigration, verifySchema, _runSqlFile: runSqlFile };
