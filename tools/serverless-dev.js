'use strict';
/* Lokalni "serverless" režim: isti handler kao na Vercelu, ali sa
   memorijskim skladištem (bez Redisa). Služi za testiranje polling varijante
   i statičnih stranica bez Vercel naloga.
   Pokretanje:  node tools/serverless-dev.js   (default port 4200)  */
process.env.TZU_MEMORY_KV = '1';
process.env.HOSTED = '1';
process.env.TRANSPORT = 'poll';

const http = require('http');
const fs = require('fs');
const path = require('path');
const app = require('../api/_app.js');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const ROUTES = {
  '/api/state': 'state',
  '/api/join': 'join',
  '/api/act': 'act',
  '/api/admin': 'admin',
  '/api/ping': 'ping',
  '/api/info': 'info',
  '/api/events': 'events',
};

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (!rel) rel = 'index.html';
  if (rel === 'screen' || rel === 'screen/') rel = 'screen.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) { res.statusCode = 403; return res.end('forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.statusCode = 404; return res.end('not found'); }
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(buf);
  });
}

const PORT = Number(process.env.PORT || 4200);
http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  const kind = ROUTES[url.pathname];
  if (!kind) return serveStatic(req, res, url);
  // lokalni "vercel" nema proxy headere — dodaj ih da join URL bude http
  req.headers['x-forwarded-host'] = req.headers.host || `127.0.0.1:${PORT}`;
  req.headers['x-forwarded-proto'] = 'http';
  app.handler(kind)(req, res).catch(e => {
    console.error('[dev]', e);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end('{"error":"server"}');
    }
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`serverless dev: http://127.0.0.1:${PORT}  (memorijsko skladište, polling)`);
});
