-- migrate_v7.sql
-- F-16: password reset token table.
-- Additive only — no existing table/column is modified.
-- NOT auto-run by server/config/migrate.js (hardcoded filename list only);
-- applied manually once, under supervision, same as migrate_v6.sql.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          INT NOT NULL AUTO_INCREMENT,
  user_id     INT NOT NULL,
  token_hash  VARCHAR(64) NOT NULL,
  expires_at  DATETIME NOT NULL,
  used_at     DATETIME NULL DEFAULT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_token_hash (token_hash),
  KEY idx_user_id (user_id),
  CONSTRAINT fk_prt_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
