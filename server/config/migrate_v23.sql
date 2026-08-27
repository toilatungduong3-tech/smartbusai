-- migrate_v23.sql
-- Enterprise hardening pass, round 2: server-side 2FA (TOTP) + PII-at-rest
-- encryption for id_number (CCCD/CMND).
--
-- id_number widened from varchar(20) to varchar(255): the plaintext CCCD
-- was <=20 chars, but the AES-256-GCM ciphertext (12-byte IV + 16-byte auth
-- tag + ciphertext, base64-encoded, plus an "enc1:" prefix — see
-- server/utils/piiCrypto.js) runs well past 20 chars even for a short
-- input. Live check before this migration: 0 rows in either table had
-- id_number set, so there is no plaintext data to backfill/re-encrypt.
--
-- totp_secret_enc/totp_backup_codes replace what used to be entirely
-- client-side state (public/pages/passenger/profile.html's
-- localStorage['smartbus_2fa']) — a secret an attacker could read straight
-- out of localStorage/DevTools defeated the purpose of having 2FA at all.
ALTER TABLE users MODIFY COLUMN id_number VARCHAR(255) NULL;
ALTER TABLE saved_passenger MODIFY COLUMN id_number VARCHAR(255) NULL;

ALTER TABLE users ADD COLUMN totp_secret_enc VARCHAR(255) NULL;
ALTER TABLE users ADD COLUMN totp_enabled TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN totp_backup_codes TEXT NULL;
