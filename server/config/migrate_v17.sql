-- migrate_v17.sql
-- Sprint 8 — Avatar Sync Engine.
--
-- users had no place to store a profile picture: Google/Facebook OAuth
-- already receives one (payload.picture / picture.data.url) but discarded
-- it, and there was no way for a user to set a custom avatar either. This
-- column is the single source of truth the topbar dropdown (initProfileDropdown
-- in /js/api.js) reads via the logged-in user object, and that
-- POST /api/users/:id/avatar writes to.

ALTER TABLE users
  ADD COLUMN avatar_url VARCHAR(500) NULL
    COMMENT 'Profile picture — either a Google/Facebook provider URL captured at first OAuth signup, or a /uploads/avatars/... path from a manual upload.';
