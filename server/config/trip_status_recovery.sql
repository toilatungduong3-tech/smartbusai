-- trip_status_recovery.sql
-- F-24/F-25: data recovery for the 48 explicitly-verified Group-A trip rows.
--
-- Must be run AFTER migrate_v6.sql has been applied and verified — the UPDATE
-- below writes 'COMPLETED', which does not exist in the pre-migrate_v6 ENUM.
--
-- NOT auto-run by server/config/migrate.js (hardcoded filename list only).
-- This file is applied manually, once, under supervision.
--
-- Scope is restricted to an explicit, hardcoded list of 48 trip_ids identified
-- during the Phase 1/2 audit as safe to repair (booking_count > 0, arrival_time
-- in the past, and a future clone trip already exists for the same bus/route —
-- proof this row's only inconsistency is the truncated status value).
--
-- trip_id 4, 12, 15 are intentionally NEVER referenced anywhere in this file.
-- Their status is unknown and excluded from automated recovery by design.

-- ─────────────────────────────────────────────────────────────────
-- Step 1: full-row backup of the 48 target rows, before any mutation.
-- CREATE TABLE fails loudly (ER_TABLE_EXISTS_ERROR) if a table with this name
-- already exists — intentional, so an existing backup is never silently
-- overwritten. Rename/adjust the suffix if this script is ever re-run on a
-- different date.
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE trip_status_recovery_backup_20260815 AS
SELECT * FROM trip WHERE trip_id IN (
  1,2,3,5,6,7,8,9,10,11,13,14,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,
  31,32,33,34,35,36,37,40,41,42,43,44,45,46,47,48,49,50,237,629,8961
);

-- ─────────────────────────────────────────────────────────────────
-- Step 2: repair — status='' -> status='COMPLETED', for exactly the 48 IDs.
-- The "AND status=''" predicate makes this idempotent and safe to re-run:
-- a row already repaired (or whose state changed unexpectedly) is skipped,
-- never overwritten based on stale assumptions.
-- ─────────────────────────────────────────────────────────────────
UPDATE trip
SET status = 'COMPLETED'
WHERE trip_id IN (
  1,2,3,5,6,7,8,9,10,11,13,14,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,
  31,32,33,34,35,36,37,40,41,42,43,44,45,46,47,48,49,50,237,629,8961
)
AND status = '';
