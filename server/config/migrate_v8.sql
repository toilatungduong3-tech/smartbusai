-- migrate_v8.sql
-- Phase 2I — canonical operator identity: users.operator_id -> bus_operator.operator_id
--
-- Root cause this addresses: operator identity was previously resolved by
-- matching users.email against bus_operator.email at request time
-- (server/middleware/operatorScope.js, server/controllers/authController.js
-- login()). That scheme is fragile — it silently fails whenever the two
-- emails legitimately differ (confirmed against real seed data: users 46
-- and 48 use staff-style addresses on the same domain as their operator's
-- contact email, and never match exactly) and has no database-level
-- integrity guarantee at all.
--
-- Additive only — no existing column is modified, no row is deleted, no
-- existing FK/index is touched. operator_id is nullable: an OPERATOR
-- account with no established mapping stays NULL and the application
-- fails closed (see operatorScope.js), it is never inferred or guessed.
--
-- Cardinality: nullable single-valued FK (users.operator_id -> one
-- bus_operator), no UNIQUE constraint — chosen because the current
-- codebase and data support at most one operator per user account (no
-- multi-operator-per-user usage anywhere), while still allowing more than
-- one user to eventually be linked to the same bus_operator if the
-- business ever needs multiple staff logins per company, without a
-- further schema change.
--
-- Phase 1 hardening: now part of server/config/migrate.js's auto-run
-- sequence (MIGRATION_FILES) instead of being applied manually, so a fresh
-- deployment actually gets this column instead of silently missing it.
-- Rewritten to be idempotent on re-run: the runner's naive statement
-- splitter executes each of the following as an independent db.query()
-- call, so this uses information_schema guards + PREPARE/EXECUTE dynamic
-- SQL (no DELIMITER/stored-routine wrapper needed) rather than relying on
-- ADD CONSTRAINT's lack of an "IF NOT EXISTS" clause in MariaDB 10.4.
-- Discovered live: re-running the original unconditional ADD CONSTRAINT
-- against an already-migrated DB threw errno 121 ("Duplicate key on write
-- or update") — not one of the runner's benign already-applied errnos —
-- which correctly (by design) aborted startup until fixed here.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS operator_id INT NULL DEFAULT NULL AFTER role;

SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'users' AND index_name = 'idx_users_operator_id'
);
SET @sql_idx = IF(@idx_exists = 0,
  'ALTER TABLE users ADD KEY idx_users_operator_id (operator_id)',
  'SELECT 1');
PREPARE stmt_idx FROM @sql_idx;
EXECUTE stmt_idx;
DEALLOCATE PREPARE stmt_idx;

SET @fk_exists = (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE table_schema = DATABASE() AND table_name = 'users' AND constraint_name = 'fk_users_operator'
);
SET @sql_fk = IF(@fk_exists = 0,
  'ALTER TABLE users ADD CONSTRAINT fk_users_operator FOREIGN KEY (operator_id) REFERENCES bus_operator(operator_id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE stmt_fk FROM @sql_fk;
EXECUTE stmt_fk;
DEALLOCATE PREPARE stmt_fk;
