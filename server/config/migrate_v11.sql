-- migrate_v11.sql
-- Sprint 3 — MASTER_COMPLETION_MATRIX.md blocker: userController.deleteUser's
-- soft-delete path writes status='INACTIVE', but users.status was only
-- ever enum('ACTIVE','BLOCKED') — 'INACTIVE' is not a member, so under
-- this DB's non-strict sql_mode (confirmed in a prior phase — no
-- STRICT_TRANS_TABLES) the write silently truncates to '' instead of
-- erroring or storing the intended value. A soft-deleted user with
-- booking history ended up with status='', which the auth-status
-- enforcement added this sprint (authController.login /
-- authMiddleware.authenticate) would still correctly block (anything
-- !== 'ACTIVE' is rejected) — but the admin user list's status filter and
-- KPI counts never recognized '' as a real state, and the intent behind
-- the soft-delete ("distinguish an admin-blocked account from one with no
-- reason to exist anymore") was lost.
--
-- Widened the enum (additive, matches the exact pattern already used by
-- migrate_v6.sql for trip.status) rather than reusing 'BLOCKED' for this
-- path — a soft-deleted account (has historical bookings, no longer
-- usable) and an admin-blocked account (still exists, punitive action) are
-- different states an admin/thesis-defense reviewer would reasonably want
-- to tell apart in the user list.

ALTER TABLE users
  MODIFY COLUMN status ENUM('ACTIVE','BLOCKED','INACTIVE') DEFAULT 'ACTIVE';
