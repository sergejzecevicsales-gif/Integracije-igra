'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const engine = require('./market-engine');
const { game, commonState, playerState, handleAction, doAdmin, doJoin, resetGame,
  exportState, importState, serverlessTick, findPlayerByToken, addPlayer } = engine;
const now = () => Date.now();
const PORT_START = Number(process.env.PORT || 4000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const OPEN_BROWSER = process.argv.includes('--open');
/* -------------------------------- LAN URL --------------------------------- */
/* Na hosted platformama (Render i sl.) adresa dolazi iz env varijable. */
function withScheme(v) {
  if (!v) return '';
  return /^https?:\/\//.test(v) ? v : 'https://' + v;
}
const HOSTED_URL = withScheme(
  process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL ||
  process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL
).trim().replace(/\/+$/, '');
const HOSTED = !!HOSTED_URL || process.env.HOSTED === '1' || !!process.env.VERCEL;
const SERVERLESS = !!process.env.VERCEL || process.env.TRANSPORT === 'poll';
const ADMIN_PIN = (process.env.ADMIN_PIN || '').trim();
let _joinOverride = '';
function setJoinHost(host, proto) {
  if (!host || _joinOverride) return;
  _joinOverride = ((proto || 'https') + '://' + host).replace(/\/+$/, '') + '/';
}

let _lanCache = { at: 0, url: '' };
function lanUrl() {
  if (_joinOverride) return _joinOverride;
  if (HOSTED_URL) return HOSTED_URL + '/';
  if (now() - _lanCache.at < 5000 && _lanCache.url) return _lanCache.url;
  const pref = a => /^192\.168\./.test(a) ? 0 : /^10\./.test(a) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(a) ? 2 : 3;
  const cands = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || /^169\.254\./.test(a.address)) continue;
      cands.push(a.address);
    }
  }
  cands.sort((x, y) => pref(x) - pref(y) || x.localeCompare(y));
  const url = (cands.length ? `http://${cands[0]}:${actualPort}/` : `http://localhost:${actualPort}/`);
  _lanCache = { at: now(), url };
  return url;
}

let _localCache = { at: 0, set: new Set() };
function localAddresses() {
  if (now() - _localCache.at < 5000 && _localCache.set.size) return _localCache.set;
  const set = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' || a.family === 4) set.add(a.address);
    }
  }
  _localCache = { at: now(), set };
  return set;
}
function isLocal(req) {
  let ra = req.socket.remoteAddress || '';
  ra = ra.replace(/^::ffff:/, '');
  return localAddresses().has(ra);
}
/* Na hostingu nema "računara domaćina" — admin je dozvoljen uz (opcioni) PIN. */
function adminAllowed(req) {
  if (HOSTED) return true;
  return isLocal(req);
}
function checkAdminPin(body, url) {
  if (!ADMIN_PIN) return true;
  const pin = String((body && body.pin) || url.searchParams.get('pin') || '');
  return pin === ADMIN_PIN;
}

/* -------------------------------- HTTP ------------------------------------ */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 64 * 1024) { reject(new Error('too large')); req.destroy(); return; }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function serveStatic(res, pathname) {
  let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  if (!rel) rel = 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, buf) => {
    if (err) {
      if (pathname === '/' || pathname === '') {
        return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, b2) => {
          if (e2) return json(res, 500, { error: 'no index' });
          res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
          res.end(b2);
        });
      }
      return json(res, 404, { error: 'not found' });
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(buf);
  });
}

/* --------------------------------- SSE ------------------------------------ */
const clients = new Set(); // { res, kind, playerId, canAdmin }

function sseSend(client, state) {
  try {
    client.res.write('data: ' + JSON.stringify(state) + '\n\n');
  } catch (e) {
    clients.delete(client);
  }
}

function sseHandler(req, res, url) {
  const role = url.searchParams.get('role');
  const token = url.searchParams.get('token');
  let player = null;
  let kind = 'screen';
  if (role === 'screen') {
    kind = 'screen';
  } else {
    player = findPlayerByToken(token);
    if (!player) return json(res, 401, { error: 'nepoznat igrač' });
    kind = 'player';
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (res.flushHeaders) res.flushHeaders();
  res.write('retry: 1500\n\n');
  const client = { res, kind, playerId: player ? player.id : null, canAdmin: adminAllowed(req) };
  clients.add(client);
  if (player) {
    player.connections++;
    player.lastActiveAt = now();
    sseSend(client, playerState(player, client.canAdmin));
  } else {
    sseSend(client, commonState(client.canAdmin));
  }
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (e) { /* ignore */ }
  }, 15000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(client);
    if (player) player.connections = Math.max(0, player.connections - 1);
  });
}

function broadcast() {
  const t = now();
  let screenState = null;
  for (const c of [...clients]) {
    if (c.kind === 'screen') {
      if (!screenState) screenState = commonState(c.canAdmin);
      sseSend(c, screenState);
    } else {
      const p = game.players.get(c.playerId);
      if (!p) { sseSend(c, { removed: true }); c.res.end(); clients.delete(c); continue; }
      if (p.connections > 0) p.lastActiveAt = t;
      sseSend(c, playerState(p, c.canAdmin));
    }
  }
}

/* ------------------------------- RUTE ------------------------------------- */
async function handleApi(req, res, url) {
  const pathname = url.pathname;
  if (req.method === 'GET' && pathname === '/api/qr') {
    return require('./qr-code')(res, lanUrl());
  }
  if (req.method === 'GET' && pathname === '/api/state') {
    const token = url.searchParams.get('token');
    if (token) {
      const p = findPlayerByToken(token);
      if (!p) return json(res, 404, { error: 'igrač ne postoji' });
      p.lastActiveAt = now();
      return json(res, 200, playerState(p, adminAllowed(req)));
    }
    return json(res, 200, commonState(adminAllowed(req)));
  }

  if (req.method === 'GET' && pathname === '/api/info') {
    return json(res, 200, { joinUrl: lanUrl(), port: actualPort, local: adminAllowed(req), hosted: HOSTED, pinRequired: !!ADMIN_PIN });
  }

  if (req.method === 'POST' && pathname === '/api/join') {
    const body = await readBody(req);
    const r = doJoin(body.name,body.firstName,body.lastName);
    return json(res, r.status, r.body);
  }

  if (req.method === 'POST' && pathname === '/api/act') {
    const body = await readBody(req);
    const p = findPlayerByToken(body.token);
    if (!p) return json(res, 401, { error: 'nepoznat igrač' });
    p.lastActiveAt = now();
    const result = handleAction(p, body);
    return json(res, 200, result);
  }

  if (req.method === 'POST' && pathname === '/api/ping') {
    const body = await readBody(req);
    const p = findPlayerByToken(body.token);
    if (p) p.lastActiveAt = now();
    return json(res, 200, { ok: true, phase: game.phase, round: game.round });
  }

  if (req.method === 'POST' && pathname === '/api/admin') {
    if (!adminAllowed(req)) return json(res, 403, { error: 'Admin je dozvoljen samo sa računara domaćina.' });
    const body = await readBody(req);
    if (!checkAdminPin(body, url)) return json(res, 403, { error: 'Pogrešan admin PIN.', pinRequired: true });
    const r = doAdmin(body);
    return json(res, r.status, r.body);
  }

  return json(res, 404, { error: 'nepoznata ruta' });
}

/* --------------------------------- START ---------------------------------- */
let actualPort = PORT_START;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/screen' || url.pathname === '/screen/') {
      return serveStatic(res, '/screen.html');
    }
    if (url.pathname === '/api/events') return sseHandler(req, res, url);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(res, url.pathname);
  } catch (e) {
    console.error('[greska]', e);
    if (!res.headersSent) json(res, 500, { error: 'server' });
    else { try { res.end(); } catch (_) { /* ignore */ } }
  }
});

/* -------------------------------- TIKOVI ---------------------------------- */
if (require.main === module) {
  setInterval(() => {
    const t = now();
    if (game.paused) return;
    serverlessTick(t);
  }, 200);

  setInterval(broadcast, 300);
}

function listen(port, attempt) {
  attempt = attempt || 0;
  server.once('error', err => {
    if ((err.code === 'EADDRINUSE' || err.code === 'EACCES') && attempt < 12) {
      console.log(`Port ${port} je zauzet (${err.code}), pokušavam ${port + 1}...`);
      listen(port + 1, attempt + 1);
    } else {
      console.error(err);
      process.exit(1);
    }
  });
  server.listen(port, '0.0.0.0', () => {
    actualPort = port;
    const url = lanUrl();
    console.log('');
    console.log('  ╔════════════════════════════════════════════════════════╗');
    console.log('  ║             TRŽIŠTE UŽIVO  —  server radi              ║');
    console.log('  ╚════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`  Projektor (admin):  http://localhost:${port}/screen`);
    console.log(`  Telefoni:           ${url}`);
    console.log('');
    console.log('  Admin komande na ekranu: Space = dalje, P = pauza, R = reset, B = botovi');
    console.log('');
    if (OPEN_BROWSER) {
      const cmd = process.platform === 'win32'
        ? `start "" "http://localhost:${port}/screen"`
        : process.platform === 'darwin' ? `open "http://localhost:${port}/screen"` : `xdg-open "http://localhost:${port}/screen"`;
      exec(cmd, () => { });
    }
  });
}
if (require.main === module) {
  listen(PORT_START);
  process.on('uncaughtException', e => console.error('[uncaught]', e));
  process.on('unhandledRejection', e => console.error('[unhandled]', e));
}


engine.configure({ joinUrl: lanUrl });
module.exports = { ...engine, setJoinHost, lanUrl, adminAllowed, checkAdminPin,
  adminAllowedHosted: adminAllowed, HOSTED, SERVERLESS, ADMIN_PIN };
