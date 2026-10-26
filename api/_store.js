'use strict';
/* =====================================================================
   Skladište stanja za serverless (Vercel) varijantu.

   Podržava, po prioritetu:
     1. Neon / Postgres  -> DATABASE_URL (Vercel Neon integration)
     2. Vercel KV / Upstash Redis -> KV_REST_API_URL + KV_REST_API_TOKEN
     3. memoriju (TZU_MEMORY_KV=1) — za lokalni razvoj i testove

   Interfejs je optimistički CAS (read -> mutate -> write(data, version)),
   pa nema dugotrajnih lockova i radi sa serverless invokacijama.
   ===================================================================== */

const crypto = require('crypto');

const STATE_KEY = 'tzu:state:v2';
const VER_KEY = 'tzu:ver:v2';

const MEMORY = process.env.TZU_MEMORY_KV === '1' || process.env.TZU_STORE === 'memory';
const PG_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const memory = new Map();
let sql = null;
let redis = null;
let pgReady = false;

if (!MEMORY) {
  if (PG_URL) {
    try {
      const { neon } = require('@neondatabase/serverless');
      sql = neon(PG_URL);
    } catch (e) {
      console.error('[store] Neon driver nije dostupan:', e && e.message);
    }
  } else if (REDIS_URL && REDIS_TOKEN) {
    try {
      const { Redis } = require('@upstash/redis');
      redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
    } catch (e) {
      console.error('[store] Upstash driver nije dostupan:', e && e.message);
    }
  }
}

function available() {
  return MEMORY || !!sql || !!redis;
}

async function ensurePg() {
  if (pgReady) return;
  await sql`CREATE TABLE IF NOT EXISTS tzu_state (
    id text PRIMARY KEY,
    data jsonb,
    version integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`INSERT INTO tzu_state (id, data, version) VALUES ('main', '{}'::jsonb, 0)
            ON CONFLICT (id) DO NOTHING`;
  pgReady = true;
}

async function read() {
  if (MEMORY) {
    const cur = memory.get(STATE_KEY);
    return cur ? { data: JSON.parse(cur.data), version: cur.version } : { data: null, version: 0 };
  }
  if (sql) {
    await ensurePg();
    const rows = await sql`SELECT data, version FROM tzu_state WHERE id = 'main' LIMIT 1`;
    const row = rows[0];
    if (!row) return { data: null, version: 0 };
    const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    return { data, version: Number(row.version) || 0 };
  }
  const [data, ver] = await Promise.all([redis.get(STATE_KEY), redis.get(VER_KEY)]);
  return { data: data || null, version: Number(ver) || 0 };
}

async function write(data, expectedVersion) {
  if (MEMORY) {
    const cur = memory.get(STATE_KEY);
    const curVer = cur ? cur.version : 0;
    if (curVer !== expectedVersion) return false;
    memory.set(STATE_KEY, { data: JSON.stringify(data), version: curVer + 1 });
    return true;
  }
  if (sql) {
    await ensurePg();
    const rows = await sql`UPDATE tzu_state
      SET data = ${JSON.stringify(data)}::jsonb, version = version + 1, updated_at = now()
      WHERE id = 'main' AND version = ${expectedVersion}
      RETURNING version`;
    return rows.length > 0;
  }
  const script = `
    local v = redis.call('get', KEYS[2])
    if not v then v = '0' end
    if v ~= ARGV[1] then return 0 end
    redis.call('set', KEYS[1], ARGV[2])
    redis.call('set', KEYS[2], tostring(tonumber(v) + 1))
    return 1`;
  const res = await redis.eval(script, [STATE_KEY, VER_KEY], [String(expectedVersion), JSON.stringify(data)]);
  return Number(res) === 1;
}

module.exports = {
  available,
  read,
  write,
  kind: MEMORY ? 'memory' : sql ? 'postgres' : redis ? 'redis' : 'none',
  newToken: () => crypto.randomUUID(),
};
