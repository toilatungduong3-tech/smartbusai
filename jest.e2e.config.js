/**
 * jest.e2e.config.js — Enterprise Hardening Pass (Pillar 6: E2E Integration Test).
 *
 * Deliberately separate from the default `npm test` config (see package.json's
 * "jest" key, which ignores tests/e2e/). The 740 tests under tests/*.test.js
 * mock the DB and run in milliseconds with no external dependencies — that
 * suite must keep working in any environment, including CI runners with no
 * MySQL/Redis/running server at all.
 *
 * The E2E suite here is the opposite on purpose: it makes real HTTP requests
 * (via supertest against a base URL, not an in-process app) to an already
 * running server instance, which itself talks to the real MySQL database —
 * no mocks anywhere in the path. That means it has real prerequisites:
 *
 *   1. The server must already be running (`npm start`, or the existing
 *      dev server) and reachable at E2E_BASE_URL (default http://localhost:2704).
 *   2. The database must be reachable and contain at least one OPEN trip
 *      with a free seat on one of the seeded major-city route pairs within
 *      the next 7 days (true on any freshly-seeded DB — server.js's AutoTrip
 *      scheduler keeps a rolling 7-day window of OPEN trips at all times).
 *
 * Run with:  npm run test:e2e
 */
module.exports = {
    testEnvironment: 'node',
    testMatch: ['<rootDir>/tests/e2e/**/*.e2e.test.js'],
    testTimeout: 30000,
};
