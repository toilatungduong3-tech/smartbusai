-- SmartBusAI Loyalty Points Schema
-- Run this once against the smartbusai database to enable the loyalty system.
-- All statements are idempotent (safe to re-run).

-- Add loyalty columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS loyalty_points INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS loyalty_tier ENUM('BRONZE','SILVER','GOLD','DIAMOND') DEFAULT 'BRONZE';

-- Loyalty points transaction history
CREATE TABLE IF NOT EXISTS loyalty_transactions (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    user_id      INT NOT NULL,
    booking_id   INT NULL,
    type         ENUM('EARN','REDEEM','BONUS','EXPIRE') NOT NULL,
    points       INT NOT NULL,
    balance_after INT NOT NULL,
    description  VARCHAR(255),
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
