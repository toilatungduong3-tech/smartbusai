-- migrate_v24.sql
-- Real, server-persisted vouchers — replaces profile.html's/booking.html's
-- previous entirely-client-side "voucher wallet" (generated + stored in
-- localStorage['smartbus_vouchers'], redeemed points tracked separately in
-- localStorage['smartbus_redeemed_pts']). That design meant a voucher only
-- existed in one browser on one device, and the "points" it was redeemed
-- against were a second, parallel number computed from spend — not the
-- real users.loyalty_points balance the rest of the loyalty system
-- (loyaltyService.js, applyUserTierDiscount) actually uses.
CREATE TABLE IF NOT EXISTS voucher (
    voucher_id    INT AUTO_INCREMENT PRIMARY KEY,
    user_id       INT NOT NULL,
    code          VARCHAR(24) NOT NULL,
    reward_code   VARCHAR(20) NOT NULL,
    reward_name   VARCHAR(100) NOT NULL,
    free_seats    INT NOT NULL DEFAULT 0,
    points_spent  INT NOT NULL,
    is_used       TINYINT(1) NOT NULL DEFAULT 0,
    booking_id    INT NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    used_at       DATETIME NULL,
    UNIQUE KEY uq_voucher_code (code),
    KEY idx_voucher_user (user_id),
    CONSTRAINT fk_voucher_user FOREIGN KEY (user_id) REFERENCES users(user_id),
    CONSTRAINT fk_voucher_booking FOREIGN KEY (booking_id) REFERENCES booking(booking_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
