-- migrate_v16.sql
-- Sprint 7 — real server-side logout / token revocation.
--
-- POST /api/auth/logout was previously a pure no-op ("Server chỉ trả về
-- success, client tự xóa token") — a stolen access token stayed valid for
-- its remaining 15-minute lifetime, and a stolen refresh token stayed
-- valid for the full 7 days, REGARDLESS of the legitimate user clicking
-- "logout". Sprint 3's account-block re-check (authenticate/refreshToken
-- querying users.status on every request) only covers the "admin blocks a
-- bad actor" case, not "user logs out on a device they no longer trust".
--
-- token_version is embedded in every JWT (access + refresh) at mint time.
-- authenticate()/refreshToken() compare it against the current DB value on
-- every request (same query that already re-checks status — one extra
-- column, no new query). logout() increments it, which instantly
-- invalidates every access AND refresh token issued before that moment,
-- across every device — not just the one calling logout, matching a
-- standard "log out everywhere" semantic, appropriate since there is no
-- per-device session tracking in this stateless-JWT design.

ALTER TABLE users
  ADD COLUMN token_version INT NOT NULL DEFAULT 0
    COMMENT 'Incremented on logout — invalidates every previously-issued JWT for this user.';
