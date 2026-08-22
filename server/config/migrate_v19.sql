-- migrate_v19.sql
-- Sprint 11 — Real Behavioral AI, Preference Learning & Booking Intent
-- Prediction.
--
-- user_behavior already existed (schema_base.sql) but only as a generic
-- action log: behavior_id, user_id, action varchar(255), action_time.
-- No structured event payload — aiUserProfilingService.js needs the
-- specific trip_id/route_id/price/seat_type/departure_time an event was
-- about, not a free-text label, so ADD (never DROP/replace) the columns
-- this sprint's write paths use. `action`/`action_time` are left
-- untouched — adminController.js's getUserBehavior/getUserBehaviorHours/
-- getAIStats (lines ~362-409) already query them and must keep working
-- unmodified.
ALTER TABLE user_behavior
  ADD COLUMN event_type ENUM('SEARCH','VIEW_TRIP','SELECT_SEAT','START_PAYMENT','COMPLETE_BOOKING','CANCEL') NULL AFTER user_id,
  ADD COLUMN event_data JSON NULL AFTER event_type,
  ADD COLUMN created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP AFTER event_data;

ALTER TABLE user_behavior
  ADD INDEX idx_user_behavior_profiling (user_id, event_type, created_at);

-- Cached user preference vector (aiUserProfilingService.js) — recomputed
-- on demand from user_behavior/search_log/booking when stale (see the
-- service's own TTL check), not trusted blindly forever. One row per
-- user; NULL fields mean "not enough history yet" (never a fabricated
-- default — see the service's own comments).
CREATE TABLE IF NOT EXISTS user_profiles_ai (
  user_id           INT NOT NULL PRIMARY KEY,
  price_min         DECIMAL(12,2) NULL,
  price_max         DECIMAL(12,2) NULL,
  price_avg         DECIMAL(12,2) NULL,
  weight_morning    DECIMAL(5,4) NULL,
  weight_afternoon  DECIMAL(5,4) NULL,
  weight_evening    DECIMAL(5,4) NULL,
  weight_night      DECIMAL(5,4) NULL,
  time_counts       JSON NULL,
  vehicle_pref      JSON NULL,
  vehicle_counts    JSON NULL,
  frequent_routes   JSON NULL,
  sample_size       INT NOT NULL DEFAULT 0,
  computed_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT user_profiles_ai_ibfk_1 FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Persisted log for aiIntentPredictor.js — the admin dashboard's
-- "Real-time Log của AI Intent Predictor" (brief section 5) reads this
-- table; a real log of real requests, not synthesized rows.
CREATE TABLE IF NOT EXISTS ai_intent_log (
  intent_log_id      INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id             INT NULL,
  session_id          VARCHAR(100) NULL,
  intent_score        DECIMAL(5,2) NOT NULL,
  intent_level         ENUM('LOW','MEDIUM','HIGH') NOT NULL,
  dropoff_risk         ENUM('LOW','MEDIUM','HIGH') NOT NULL,
  recommended_action   VARCHAR(60) NOT NULL,
  event_count          INT NOT NULL DEFAULT 0,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ai_intent_log_created (created_at),
  CONSTRAINT ai_intent_log_ibfk_1 FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cached output for aiDemandForecaster.js's GET /api/ai/demand-forecast
-- (admin/operator "Demand Forecast Heatmap") — computed periodically
-- rather than re-run on every dashboard page load.
CREATE TABLE IF NOT EXISTS ai_demand_forecast (
  forecast_id         INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  route_id             INT NOT NULL,
  forecast_date         DATE NOT NULL,
  demand_change_pct     DECIMAL(6,2) NOT NULL,
  sellout_risk_pct       DECIMAL(5,2) NOT NULL,
  message               VARCHAR(255) NULL,
  computed_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_route_date (route_id, forecast_date),
  CONSTRAINT ai_demand_forecast_ibfk_1 FOREIGN KEY (route_id) REFERENCES route(route_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
