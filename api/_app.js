'use strict';
/* =====================================================================
   Zajednička logika Vercel funkcija (API rute): stanje u KV/Redis,
   polling transport, lijeni tajmer i botovi.
   ===================================================================== */

const engine = require('../server.js');
const store = require('./_store.js');

const CACHE_TTL = Number(process.env.TZU_CACHE_MS || 600);   // ms keširanja stanja u memoriji instance
const POLL_MS = Number(process.env.TZU_POLL_MS || 800);     // koliko često klijent pita za stanje

let cache = { state: null, at: 0 };
let queue = Promise.resolve();

/* Invokacije unutar iste instance dijele globalni engine — serijalizuj ih. */
function serial(fn) {
  const run = queue.then(fn, fn);
  queue = run.then(() => { }, () => { });
  return run;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function readJson(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => {
      data += c;
      if (data.length > 128 * 1024) req.destroy();
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function hostOf(req) {
  const h = req.headers['x-forwarded-host'] || req.headers.host || '';
  return String(h).split(',')[0].trim();
}
function protoOf(req) {
  const p = req.headers['x-forwarded-proto'] || 'https';
  return String(p).split(',')[0].trim();
}

function importState(s) { engine.importState(s || {}); }

function needsUpdate(ts) {
  const g = engine.game;
  if (g.paused) return false;
  if (g.phase === 'round' && g.endsAt && ts >= g.endsAt) return true;
  if (g.phase === 'results' && g.endsAt && ts >= g.endsAt) return true;
  if (g.phase === 'round' && ts - (g.lastTickAt || 0) >= 600) return true;
  return false;
}

async function loadState(force) {
  const t = Date.now();
  if (!force && cache.state && t - cache.at < CACHE_TTL) {
    importState(cache.state);
    return true;
  }
  const { data } = await store.read();
  importState(data || {});
  return false;
}

/* Optimistički CAS: read -> izmijeni -> upiši samo ako verzija nije promijenjena.
   Vraća null ako se stanje previše puta promijenilo u međuvremenu. */
async function withState(fn) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data, version } = await store.read();
    importState(data || {});
    const out = await fn();
    const snap = engine.exportState();
    if (await store.write(snap, version)) {
      cache = { state: snap, at: Date.now() };
      return out === undefined ? true : out;
    }
    await sleep(25 + Math.random() * 60);
  }
  return null;
}

/* ------------------------------- RUTE ------------------------------------- */
async function getState(res, url) {
  const ts = Date.now();
  const fresh = url.searchParams.get('fresh') === '1';
  await loadState(fresh);
  if (needsUpdate(ts)) {
    const done = await withState(() => engine.serverlessTick(ts));
    if (done === null) { /* lock zauzet — posluži postojeće stanje */ }
  }
  const token = url.searchParams.get('token');
  if (token) {
    const p = engine.findPlayerByToken(token);
    if (!p) return json(res, 404, { error: 'igrač ne postoji' });
    p.lastActiveAt = ts;
    return json(res, 200, engine.playerState(p, true));
  }
  return json(res, 200, engine.commonState(true));
}

async function postJoin(req, res) {
  const body = await readJson(req);
  const out = await withState(() => engine.doJoin(body.name,body.firstName,body.lastName));
  if (!out) return json(res, 409, { error: 'Server je zauzet, pokušaj ponovo.' });
  return json(res, out.status, out.body);
}

async function postAct(req, res) {
  const body = await readJson(req);
  const out = await withState(() => {
    const ts = Date.now();
    engine.serverlessTick(ts);
    const p = engine.findPlayerByToken(body.token);
    if (!p) return { status: 401, body: { error: 'nepoznat igrač' } };
    p.lastActiveAt = ts;
    return { status: 200, body: engine.handleAction(p, body) };
  });
  if (!out) return json(res, 409, { error: 'Server je zauzet, pokušaj ponovo.' });
  const payload = out.body || { ok: true };
  // Odmah vrati svježe stanje igrača (klijent ga primijeni bez čekanja na polling)
  if (payload.ok && body.type !== 'tap') {
    const p = engine.findPlayerByToken(body.token);
    if (p) payload.state = engine.playerState(p, true);
  }
  return json(res, out.status || 200, payload);
}

async function postAdmin(req, res, url) {
  const body = await readJson(req);
  if (!engine.checkAdminPin(body, url)) {
    return json(res, 403, { error: 'Pogrešan admin PIN.', pinRequired: true });
  }
  const out = await withState(() => engine.doAdmin(body));
  if (!out) return json(res, 409, { error: 'Server je zauzet, pokušaj ponovo.' });
  const payload = out.body || { ok: true };
  if (payload.ok) payload.state = engine.commonState(true);
  return json(res, out.status, payload);
}

async function postPing(req, res) {
  await loadState();
  return json(res, 200, { ok: true, phase: engine.game.phase, round: engine.game.round });
}

/* ------------------------------ DISPEČER --------------------------------- */
async function handle(kind, req, res) {
  engine.setJoinHost(hostOf(req), protoOf(req));
  const url = new URL(req.url || '/', (protoOf(req) || 'https') + '://' + (hostOf(req) || 'localhost'));
  try {
    if (kind === 'qr') return await require('../qr-code')(res, engine.lanUrl());
    if (kind === 'info') {
      return json(res, 200, {
        joinUrl: engine.lanUrl(),
        hosted: true,
        serverless: true,
        local: false,
        pinRequired: !!engine.ADMIN_PIN,
        pollMs: POLL_MS,
      });
    }
    if (kind === 'events') return json(res, 200, { transport: 'poll', pollMs: POLL_MS });
    if (!store.available()) {
      return json(res, 503, {
        error: 'Baza nije povezana. Poveži Vercel KV (ili Upstash) — trebaju KV_REST_API_URL i KV_REST_API_TOKEN.',
      });
    }
    if (kind === 'state') {
      if (req.method !== 'GET') return json(res, 405, { error: 'method' });
      return await serial(() => getState(res, url));
    }
    if (kind === 'join') return await serial(() => postJoin(req, res));
    if (kind === 'act') return await serial(() => postAct(req, res));
    if (kind === 'admin') return await serial(() => postAdmin(req, res, url));
    if (kind === 'ping') return await serial(() => postPing(req, res));
    return json(res, 404, { error: 'nepoznata ruta' });
  } catch (e) {
    console.error('[api]', e);
    return json(res, 500, { error: 'server' });
  }
}

module.exports = {
  handler: kind => (req, res) => handle(kind, req, res),
};
