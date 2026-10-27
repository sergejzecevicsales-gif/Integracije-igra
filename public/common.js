'use strict';
/* ===================== TRŽIŠTE UŽIVO — zajednički JS ===================== */

const F0 = new Intl.NumberFormat('sr-RS');
const F1 = new Intl.NumberFormat('sr-RS', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const fmt0 = n => F0.format(Math.round(Number(n) || 0));
const fmt1 = n => F1.format(Number(n) || 0);
const pct = n => fmt1((Number(n) || 0) * 100) + '%';
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

/* "snap" mod: samo za snimke ekrana (bez SSE, stanje se čita sinhrono) */
const SNAP = new URLSearchParams(location.search).has('snap');
function syncGet(path) {
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', path, false);
    xhr.send(null);
    return xhr.status === 200 ? JSON.parse(xhr.responseText) : null;
  } catch (e) { return null; }
}

/* Mali DOM helper: h('div', {class:'x', onclick:fn}, 'tekst', dijete) */
function h(tag, props, ...children) {
  const n = document.createElement(tag);
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (v === null || v === undefined) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
      else n.setAttribute(k, v);
    }
  }
  for (const c of children.flat(3)) {
    if (c === null || c === undefined || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

/* HHI zone */
function zoneKey(hhi, meta) {
  const low = (meta && meta.hhiLow) || 1000;
  const high = (meta && meta.hhiHigh) || 2000;
  if (hhi < low) return 'green';
  if (hhi <= high) return 'yellow';
  return 'red';
}
function zoneName(hhi, meta) {
  const k = zoneKey(hhi, meta);
  return k === 'green' ? 'niska koncentracija' : k === 'yellow' ? 'umjerena koncentracija' : 'visoka koncentracija';
}
function zoneHint(hhi, meta) {
  const k = zoneKey(hhi, meta);
  return k === 'green'
    ? 'konkurencija — mnogo malih firmi'
    : k === 'yellow' ? 'umjereno koncentrisano tržište'
      : 'visoka koncentracija — provjeri broj nezavisnih ponuđača';
}

/* HTTP */
async function api(path, body) {
  const opt = body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : { method: 'GET' };
  try {
    const res = await fetch(path, opt);
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: e };
  }
}

/* SSE sa automatskim ponovnim spajanjem (lokalno) ili polling (Vercel/serverless) */
let TRANSPORT = 'sse';
function isPolling() { return TRANSPORT === 'poll'; }

function pollStream(url, onState, onStatus, interval) {
  const stateUrl = url.replace('/api/events', '/api/state');
  let alive = true;
  let timer = null;
  const tick = async () => {
    if (!alive) return;
    const t0 = Date.now();
    const res = await api(stateUrl);
    if (!alive) return;
    if (res.status === 404 && stateUrl.includes('token=')) {
      alive = false;
      onState({ removed: true });
      return;
    }
    if (res.ok && res.data) {
      if (onStatus) onStatus('online');
      onState(res.data);
    } else if (onStatus) {
      onStatus('offline');
    }
    // Kad je tab sakriven, pregledač usporava tajmere — zato brže provjeravamo
    // da se na povratak na ekran (projektor/telefon) stanje odmah osvježi.
    const hidden = typeof document !== 'undefined' && document.hidden;
    const wait = hidden ? 400 : Math.max(150, (interval || 800) - (Date.now() - t0));
    timer = setTimeout(tick, wait);
  };
  const onVisible = () => { if (alive && !document.hidden) tick(); };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  tick();
  return {
    close() {
      alive = false;
      clearTimeout(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    },
  };
}

async function startStream(url, onState, onStatus) {
  if (SNAP) {
    const st = syncGet(url.replace('/api/events', '/api/state'));
    // odloži prvi render da se modul u potpunosti učita (izbjegava TDZ)
    setTimeout(() => {
      if (st) { if (onStatus) onStatus('online'); onState(st); }
      else if (onStatus) onStatus('offline');
    }, 0);
    return { close() { } };
  }
  // Provjeri da li server radi kao serverless (Vercel) — tada nema SSE.
  const info = await api('/api/info');
  if (info.ok && info.data && info.data.serverless) {
    TRANSPORT = 'poll';
    return pollStream(url, onState, onStatus, info.data.pollMs || 800);
  }
  let es = null;
  let closed = false;
  let retryTimer = null;
  const connect = () => {
    if (closed) return;
    es = new EventSource(url);
    es.onopen = () => { if (onStatus) onStatus('online'); };
    es.onmessage = e => {
      try { onState(JSON.parse(e.data)); } catch (err) { console.error(err); }
    };
    es.onerror = () => {
      if (onStatus) onStatus('offline');
      // EventSource se sam reconnectuje; ovo je samo fallback
      if (es && es.readyState === 2) {
        clearTimeout(retryTimer);
        retryTimer = setTimeout(connect, 1200);
      }
    };
  };
  connect();
  return {
    close() { closed = true; clearTimeout(retryTimer); if (es) es.close(); },
  };
}

function vibrate(ms) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ }
}

function timeLeftMs(S) {
  if (!S) return 0;
  if (!S.endsAt) return S.timerLeft || 0;
  const offset = S.serverNow - Date.now();
  return Math.max(0, S.endsAt - (Date.now() + offset));
}

function secondsText(ms) {
  const s = Math.ceil(ms / 1000);
  return s >= 60 ? Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : String(s);
}

/* Boja firme sa transparentnošću */
function withAlpha(color, a) {
  if (!color) return `rgba(255,255,255,${a})`;
  if (color.startsWith('hsl')) return color.replace('hsl(', 'hsla(').replace(')', ` / ${a})`);
  return color;
}
