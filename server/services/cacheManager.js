'use strict';

/* ═══════════════════════════════════════════════════════════
   cacheManager.js — Enterprise Hardening Pass (Pillar 3).

   Redis-backed Cache-Aside layer (ioredis), with a transparent in-memory
   fallback when Redis is unreachable. The public API (get/set/getOrSet/
   invalidate/invalidatePrefix/clear/stats) is unchanged from the
   single-process in-memory version this replaces — every existing
   caller (statsController, recommendationRoutes, tripController's
   invalidateTripCaches, adminController's resetDemoData) keeps working
   with zero changes, because the backend choice is made internally,
   per-call, not by the caller.

   Why the fallback matters for real production behavior: a cache is
   supposed to make the app FASTER, never a single point of failure that
   makes it stop working. If Redis is down (network blip, container not
   started yet, wrong REDIS_HOST), every cache operation here catches the
   error and transparently serves from the same in-memory Map the old
   implementation used — a cache miss becomes "slightly slower", never
   "500 error" or "app won't start". Verified explicitly by a dedicated
   test that kills the Redis connection mid-test and asserts getOrSet
   still returns the correct value (see tests/... Pillar 3 section).
═══════════════════════════════════════════════════════════ */
const Redis = require('ioredis');
const logger = require('../utils/logger');

const REDIS_URL = process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || 6379}`;

// In-memory fallback store — identical semantics to the pre-Redis
// implementation (Map + expiresAt), used whenever Redis is not ready.
const memoryStore = new Map();

function memGet(key) {
    const entry = memoryStore.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) { memoryStore.delete(key); return undefined; }
    return entry.value;
}
function memSet(key, value, ttlMs) {
    memoryStore.set(key, { value, expiresAt: Date.now() + ttlMs });
}

let redisReady = false;
let redis = null;

/* Only actually connect when a real app process needs it — Jest unit
   tests mock this whole module or never call connect(), so the test
   suite never opens a real socket (matches this repo's own "no live
   server/connection inside Jest" convention). */
function connect() {
    if (redis) return redis;
    redis = new Redis(REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,        // fail fast to the memory fallback rather than queueing/blocking a request
        retryStrategy: (times) => Math.min(times * 500, 5000), // background reconnect attempts, capped backoff
        reconnectOnError: () => true,
    });
    redis.on('ready', () => { redisReady = true; logger.info('[cacheManager] Redis connected — cache is now Redis-backed'); });
    redis.on('error', (err) => { if (redisReady) logger.warn('[cacheManager] Redis error, falling back to in-memory cache:', err.message); redisReady = false; });
    redis.on('close', () => { redisReady = false; });
    redis.connect().catch((err) => { logger.warn('[cacheManager] Redis initial connection failed, using in-memory cache:', err.message); });
    return redis;
}

// Connect eagerly on module load in a real running process, but never in
// Jest (NODE_ENV=test) — a unit test that requires this module should
// never open a real socket just by requiring it.
if (process.env.NODE_ENV !== 'test') connect();

async function get(key) {
    if (redisReady) {
        try {
            const raw = await redis.get(key);
            return raw === null ? undefined : JSON.parse(raw);
        } catch (e) { /* fall through to memory */ }
    }
    return memGet(key);
}

async function set(key, value, ttlMs) {
    memSet(key, value, ttlMs); // always mirror to memory too — an in-flight Redis blip mid-request must not lose the value
    if (redisReady) {
        try {
            await redis.set(key, JSON.stringify(value), 'PX', ttlMs);
        } catch (e) { /* memory copy above already covers this */ }
    }
}

async function getOrSet(key, ttlMs, loader) {
    const cached = await get(key);
    if (cached !== undefined) return cached;
    const value = await loader();
    await set(key, value, ttlMs);
    return value;
}

async function invalidate(key) {
    memoryStore.delete(key);
    if (redisReady) {
        try { await redis.del(key); } catch (e) { /* best-effort */ }
    }
}

async function invalidatePrefix(prefix) {
    for (const key of memoryStore.keys()) {
        if (key.startsWith(prefix)) memoryStore.delete(key);
    }
    if (redisReady) {
        try {
            const keys = await redis.keys(`${prefix}*`);
            if (keys.length) await redis.del(...keys);
        } catch (e) { /* best-effort */ }
    }
}

async function clear() {
    memoryStore.clear();
    if (redisReady) {
        try { await redis.flushdb(); } catch (e) { /* best-effort */ }
    }
}

function stats() {
    let live = 0, expired = 0;
    const now = Date.now();
    for (const entry of memoryStore.values()) { if (now > entry.expiresAt) expired++; else live++; }
    return { backend: redisReady ? 'redis' : 'memory', memoryFallback: { total: memoryStore.size, live, expired } };
}

module.exports = { get, set, getOrSet, invalidate, invalidatePrefix, clear, stats, _connect: connect, _isRedisReady: () => redisReady };
