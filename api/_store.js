'use strict';
/* =====================================================================
   Skladište stanja za serverless (Vercel) varijantu.
   Radi sa Vercel KV ili Upstash Redis (REST), a za lokalni test postoji
   memorijski režim (TZU_MEMORY_KV=1).
   ===================================================================== */

const crypto = require('crypto');

const STATE_KEY = 'tzu:state:v2';
const LOCK_KEY = 'tzu:lock:v2';
const MEMORY = process.env.TZU_MEMORY_KV === '1';

const RELEASE_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

let redis = null;
const memory = new Map();

if (!MEMORY) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    const { Redis } = require('@upstash/redis');
    redis = new Redis({ url, token });
  }
}

function available() {
  return MEMORY || !!redis;
}

async function getState() {
  if (MEMORY) {
    const raw = memory.get(STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  }
  return await redis.get(STATE_KEY);
}

async function setState(state) {
  if (MEMORY) {
    memory.set(STATE_KEY, JSON.stringify(state));
    return;
  }
  await redis.set(STATE_KEY, state, { ex: 60 * 60 * 24 * 30 });
}

async function acquireLock(token, ttlMs) {
  try {
    if (MEMORY) {
      const cur = memory.get(LOCK_KEY);
      if (cur && cur.exp > Date.now()) return false;
      memory.set(LOCK_KEY, { token, exp: Date.now() + ttlMs });
      return true;
    }
    const r = await redis.set(LOCK_KEY, token, { nx: true, px: ttlMs });
    return r === 'OK';
  } catch (e) {
    console.error('[lock]', e && e.message);
    return false;
  }
}

async function releaseLock(token) {
  try {
    if (MEMORY) {
      const cur = memory.get(LOCK_KEY);
      if (cur && cur.token === token) memory.delete(LOCK_KEY);
      return;
    }
    await redis.eval(RELEASE_SCRIPT, [LOCK_KEY], [token]);
  } catch (e) {
    /* istekao lock — ne smeta */
  }
}

module.exports = {
  available,
  getState,
  setState,
  acquireLock,
  releaseLock,
  newToken: () => crypto.randomUUID(),
};
