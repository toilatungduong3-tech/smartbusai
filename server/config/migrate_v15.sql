-- migrate_v15.sql
-- Sprint 6 — User Profile & Personalization Data.
--
-- users had no fields for default passenger info (ID number, favorite
-- pickup/dropoff) to auto-fill a booking, and no companion/"saved
-- passengers" list existed at all — booking_detail only ever stored
-- seat_id/price, never a passenger name or ID number per seat.
--
-- id_number/default_pickup/default_dropoff are additive, nullable columns
-- on users — auto-fill is optional, not required to use the account.
-- saved_passenger is a new table (one user -> many saved companions),
-- intentionally separate from users/booking_detail rather than another
-- JSON blob — it's a genuine one-to-many relation, not a per-bus template.

ALTER TABLE users
  ADD COLUMN id_number VARCHAR(20) NULL COMMENT 'CCCD/CMND — optional, for booking auto-fill only',
  ADD COLUMN default_pickup VARCHAR(200) NULL COMMENT 'Favorite pickup point label — optional, for booking auto-fill only',
  ADD COLUMN default_dropoff VARCHAR(200) NULL COMMENT 'Favorite dropoff point label — optional, for booking auto-fill only';

CREATE TABLE IF NOT EXISTS saved_passenger (
  saved_passenger_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  phone VARCHAR(20) NULL,
  email VARCHAR(100) NULL,
  id_number VARCHAR(20) NULL,
  relationship VARCHAR(50) NULL COMMENT 'e.g. "Gia đình", "Đồng nghiệp" — free text, operator-facing label only',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_saved_passenger_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_saved_passenger_user (user_id)
);
