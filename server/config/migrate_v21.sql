-- migrate_v21.sql
-- Enterprise Hardening Pass — Code Quality & Cleanup (Pillar 4).
--
-- Drops two backup tables left over from a past data-repair operation
-- (trip_orphan_cleanup_backup_20260815, trip_status_recovery_backup_20260815
-- — flagged in the technical audit as production-DB clutter, phát hiện #7).
-- Both are static snapshots (no FK pointing INTO them, no application code
-- reads from them — confirmed via grep across server/ before writing this
-- migration) taken on 2026-08-15, well before this pass; the incident they
-- backed up is long resolved. Not silently discarded: this migration only
-- runs after the operator has exported them if the data is still wanted —
-- see the exported .sql dump this pass also produces alongside this file
-- (trip_backup_tables_export_20260815.sql) as the durable record.

DROP TABLE IF EXISTS trip_orphan_cleanup_backup_20260815;
DROP TABLE IF EXISTS trip_status_recovery_backup_20260815;
