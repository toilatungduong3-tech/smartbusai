-- migrate_v6.sql
-- F-24/F-25: widen trip.status ENUM to include RUNNING and COMPLETED.
--
-- Schema-only. Does not modify any existing row data or any other column.
-- Precondition:  trip.status is ENUM('OPEN','FULL','CANCELED')
-- Postcondition: trip.status is ENUM('OPEN','FULL','RUNNING','COMPLETED','CANCELED')
--
-- MySQL ENUM-widening (adding values) only changes the column's allowed value
-- list; it does not rewrite existing row values. Rows currently holding
-- 'OPEN', 'FULL', 'CANCELED', '', or NULL are left exactly as they are.
--
-- NOT auto-run by server/config/migrate.js (that runner only loads
-- migrate_v2.sql / migrate_v3.sql / migrate_v4.sql by hardcoded filename).
-- This file is applied manually, once, under supervision.

ALTER TABLE trip
  MODIFY COLUMN status ENUM('OPEN','FULL','RUNNING','COMPLETED','CANCELED') DEFAULT NULL;
