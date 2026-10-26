'use strict';
/* ===================== TRŽIŠTE UŽIVO — EKRAN (PROJEKTOR) ===================== */

const $ = id => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';
const QS = new URLSearchParams(location.search);
const PIN_KEY = 'tzu_admin_pin';
if (QS.get('pin')) localStorage.setItem(PIN_KEY, QS.get('pin'));

let S = null;
let offset = 0;
let overlayKey = '';
let boardKey = '';
let boardRows = new Map();
let newsKey = '';

/* ------------------------------- STREAM ---------------------------------- */
startStream(
  '/api/events?role=screen',
  st => { S = st; offset = st.serverNow - Date.now(); render(); },
  status => { $('connBadge').classList.toggle('hidden', status === 'online'); }
);

/* ------------------------------- RENDER ---------------------------------- */
function render() {
  if (!S) return;
  renderHeader();
  renderPie();
  renderGauge();
  renderBoard();
  renderNews();
  renderOverlay();
  renderAdmin();
  updateTimer();
}

function renderHeader() {
  const phase = S.phase;
  const title = S.roundInfo && phase === 'round' ? S.roundInfo.title.toUpperCase()
    : phase === 'results' ? 'REZULTATI'
      : phase === 'final' ? 'POBJEDNIK' : 'LOBI';
  $('roundTitle').textContent = title;
  $('roundSub').textContent = phase === 'round' && S.roundInfo ? S.roundInfo.sub
    : phase === 'lobby' ? 'Pridružite se sa telefona'
      : phase === 'results' ? 'Šta se desilo na tržištu'
        : 'Kraj igre';
  const tag = $('phaseTag');
  if (phase === 'lobby') { tag.textContent = 'PRIPREMA'; tag.className = 'phase-tag'; }
  else if (phase === 'round') { tag.textContent = 'RUNDA ' + S.round + ' / 5'; tag.className = 'phase-tag live'; }
  else if (phase === 'results') { tag.textContent = 'REZULTATI · RUNDA ' + S.round; tag.className = 'phase-tag break'; }
  else { tag.textContent = 'KRAJ IGRE'; tag.className = 'phase-tag danger'; }

  $('statPlayers').textContent = fmt0(S.totals.players);
  $('statGroups').textContent = fmt0(S.totals.groups);
  $('statHhi').textContent = fmt0(S.hhi);
  $('joinHint').textContent = 'Telefoni: ' + S.joinUrl;
  const pr = S.progress;
  $('progressHint').textContent = pr
    ? (pr.total ? `${pr.label}: ${pr.acted}/${pr.total}` : `${pr.label}: ${pr.acted}`)
    : '';
  document.title = 'TRŽIŠTE UŽIVO — ' + title;
}

/* --------------------------------- PIE ----------------------------------- */
function polar(cx, cy, r, a) {
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
function donutPath(cx, cy, rOut, rIn, a0, a1) {
  const large = (a1 - a0) > Math.PI ? 1 : 0;
  const [x0, y0] = polar(cx, cy, rOut, a0);
  const [x1, y1] = polar(cx, cy, rOut, a1);
  const [x2, y2] = polar(cx, cy, rIn, a1);
  const [x3, y3] = polar(cx, cy, rIn, a0);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${rOut} ${rOut} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} ` +
    `L${x2.toFixed(2)} ${y2.toFixed(2)} A${rIn} ${rIn} 0 ${large} 0 ${x3.toFixed(2)} ${y3.toFixed(2)} Z`;
}

function renderPie() {
  const svg = $('pie');
  const total = S.meta.totalCustomers;
  const cx = 280, cy = 280, rOut = 252, rIn = 146;
  const gap = 0.011;
  let parts = [];

  if (S.phase === 'lobby') {
    const slots = 30;
    for (let i = 0; i < slots; i++) {
      const p = S.players[i];
      parts.push({
        share: 1 / slots,
        color: p ? p.color : 'rgba(255,255,255,0.05)',
        name: p ? p.name : '',
        empty: !p,
      });
    }
  } else {
    const groups = S.groups.filter(g => g.customers > 0);
    if (!groups.length) {
      parts = [{ share: 1, color: 'rgba(255,255,255,0.05)', name: '', empty: true }];
    } else {
      parts = groups.map(g => ({ share: g.customers / total, color: g.color, name: g.name, members: g.members, sharePct: g.share }));
    }
  }

  const out = [];
  if (parts.length === 1) {
    out.push(`<circle cx="${cx}" cy="${cy}" r="${(rOut + rIn) / 2}" fill="none" stroke="${parts[0].color}" stroke-width="${rOut - rIn}"></circle>`);
  } else {
    let a = -Math.PI / 2;
    for (const part of parts) {
      const span = part.share * Math.PI * 2;
      const a0 = a + gap / 2;
      const a1 = a + span - gap / 2;
      if (a1 > a0) {
        out.push(`<path class="slice" d="${donutPath(cx, cy, rOut, rIn, a0, a1)}" fill="${part.color}" opacity="${part.empty ? 0.55 : 1}"></path>`);
      }
      // ime unutar velikih komada
      if (!part.empty && part.share >= 0.05) {
        const mid = a + span / 2;
        const [tx, ty] = polar(cx, cy, (rOut + rIn) / 2, mid);
        const nm = part.name.length > 13 ? part.name.slice(0, 12) + '…' : part.name;
        out.push(`<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" fill="#08101f" font-size="15" font-weight="800" text-anchor="middle" dominant-baseline="middle" style="paint-order:stroke" stroke="rgba(255,255,255,.22)" stroke-width="2">${escapeXml(nm)}</text>`);
        if (part.share >= 0.09 && part.share <= 0.45) {
          out.push(`<text x="${tx.toFixed(1)}" y="${(ty + 17).toFixed(1)}" fill="rgba(8,16,31,.72)" font-size="12" font-weight="700" text-anchor="middle">${pct(part.share)}</text>`);
        }
      }
      a += span;
    }
  }
  svg.innerHTML = out.join('');

  const shownCustomers = S.phase === 'lobby' ? total : S.totals.customers;
  $('pieBig').textContent = fmt0(shownCustomers);
  const nGroups = S.phase === 'lobby' ? S.totals.players : S.totals.groups;
  const nPlayers = S.totals.players;
  $('pieSub').innerHTML = S.phase === 'lobby' || nGroups === nPlayers
    ? `<b>${fmt0(nPlayers)}</b> ${nPlayers === 1 ? 'firma' : 'firmi'}`
    : `<b>${fmt0(nGroups)}</b> ${nGroups === 1 ? 'grupa' : 'grupe'} · <b>${fmt0(nPlayers)}</b> firmi`;
  $('marketCaption').textContent = '10.000 kupaca';
}

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
}

/* --------------------------------- HHI ----------------------------------- */
function gaugePos(hhi) {
  const low = S.meta.hhiLow, high = S.meta.hhiHigh;
  if (hhi <= low) return (hhi / low) * 33.333;
  if (hhi <= high) return 33.333 + ((hhi - low) / (high - low)) * 33.333;
  return 66.666 + Math.min(1, Math.log(hhi / high) / Math.log(5)) * 33.334;
}
function renderGauge() {
  const zone = S.hhiZone;
  const mark = $('gaugeMark');
  mark.style.left = gaugePos(S.hhi) + '%';
  $('hhiValue').textContent = fmt0(S.hhi);
  const z = $('hhiZone');
  z.textContent = zone;
  z.className = 'zone zone-' + zoneKey(S.hhi, S.meta);
  $('hhiHint').textContent = zoneHint(S.hhi, S.meta);
}

/* --------------------------------- BOARD --------------------------------- */
function makeRow() {
  const root = h('div', { class: 'brow' },
    h('div', { class: 'brank' }, ''),
    h('div', { class: 'bname-wrap' },
      h('div', { class: 'bname' }),
      h('div', { class: 'bsharebar' }, h('i'))
    ),
    h('div', { class: 'bcust' }, h('b'), h('span', { text: 'KUPACA' })),
    h('div', { class: 'bvalue' }, h('b'), h('span', { text: 'MIL KM' }))
  );
  return {
    root,
    rank: root.querySelector('.brank'),
    name: root.querySelector('.bname'),
    members: null,
    bar: root.querySelector('.bsharebar i'),
    cust: root.querySelector('.bcust b'),
    val: root.querySelector('.bvalue b'),
  };
}

function renderBoard() {
  const rows = S.leaderboard.slice(0, 10);
  const key = rows.length ? rows.map(r => r.id).join('|') : '__empty';
  const box = $('board');
  if (key !== boardKey) {
    boardKey = key;
    boardRows = new Map();
    box.innerHTML = '';
    if (!rows.length) {
      box.append(h('div', { class: 'bempty', text: 'Nema firmi na tržištu. Pridružite se sa telefona.' }));
      return;
    }
    for (const r of rows) {
      const row = makeRow();
      row.el = r;
      boardRows.set(r.id, row);
      box.append(row.root);
    }
  }
  if (!rows.length) return;
  for (const r of rows) {
    const row = boardRows.get(r.id);
    if (!row) continue;
    row.root.classList.toggle('top1', r.place === 1);
    row.rank.textContent = r.place;
    row.name.textContent = r.name;
    row.name.title = r.name;
    if (r.members > 1) {
      row.name.append(h('span', { class: 'bmembers', text: r.members + ' firmi' }));
    }
    row.bar.style.width = Math.max(2, r.share * 100).toFixed(2) + '%';
    row.bar.style.background = r.color;
    row.cust.textContent = fmt0(r.customers);
    row.val.textContent = fmt1(r.score);
  }
}

/* --------------------------------- NEWS ---------------------------------- */
function renderNews() {
  const items = S.news.slice(-6).reverse();
  const key = items.map(i => i.id).join('|');
  if (key === newsKey) return;
  newsKey = key;
  const box = $('news');
  box.innerHTML = '';
  if (!items.length) {
    box.append(h('div', { class: 'bempty', text: 'Vijesti će se pojavljivati ovdje.' }));
    return;
  }
  for (const it of items) {
    box.append(h('div', { class: 'nitem ' + (it.type || 'info') },
      h('span', { class: 'ndot' }),
      h('span', { text: it.text })
    ));
  }
}

/* -------------------------------- TIMER ---------------------------------- */
function updateTimer() {
  if (!S) return;
  const phase = S.phase;
  const timerEl = $('timer');
  const fill = $('timerFill');
  const inPhase = phase === 'round' || phase === 'results';
  if (!inPhase) {
    timerEl.textContent = phase === 'final' ? '★' : '—';
    timerEl.classList.remove('low');
    fill.style.width = phase === 'lobby' ? '100%' : '0%';
    fill.classList.remove('low');
    return;
  }
  let ms;
  if (S.paused) ms = S.timerLeft;
  else ms = S.endsAt ? Math.max(0, S.endsAt - (Date.now() + offset)) : S.timerLeft;
  timerEl.textContent = S.paused ? '⏸' : secondsText(ms);
  const low = ms <= 5000 && phase === 'round' && !S.paused;
  timerEl.classList.toggle('low', low);
  fill.classList.toggle('low', low);
  const dur = S.phaseDuration || 1;
  fill.style.width = clampN((ms / dur) * 100, 0, 100).toFixed(1) + '%';
  const resSec = document.getElementById('resSec');
  if (resSec) resSec.textContent = secondsText(ms);
}

/* -------------------------------- OVERLAY -------------------------------- */
function renderOverlay() {
  const phase = S.phase;
  const key = phase === 'lobby' ? 'lobby'
    : phase === 'results' ? 'results:' + S.round
      : phase === 'final' ? 'final' : 'none';
  const ov = $('overlay');
  if (key === 'none') {
    ov.classList.add('hidden');
    ov.innerHTML = '';
    overlayKey = 'none';
    return;
  }
  ov.classList.remove('hidden');
  if (key === overlayKey) { updateOverlay(); return; }
  overlayKey = key;
  if (key === 'lobby') ov.innerHTML = lobbyHTML();
  else if (key === 'final') ov.innerHTML = finalHTML();
  else ov.innerHTML = resultsHTML();
  wireOverlay();
  updateOverlay();
}

function lobbyHTML() {
  return `
  <div class="ov-card">
    <div class="lobby-grid">
      <div class="lobby-left">
        <div class="kicker">Pridružite se sa telefona</div>
        <h2>Osnujte firmu za 10 sekundi</h2>
        <div class="join-label">Upišite ovu adresu u browser na telefonu</div>
        <div class="join-url" id="joinUrlBig">${S.joinUrl}</div>
        <div class="join-note">Svako dobija <b>50 miliona KM</b> kapitala i svoju firmu na tržištu od <b>10.000 kupaca</b>.
        Ime firme birate sami. Kada se svi prijave, pokrećemo igru.</div>
        <div class="lobby-actions">
          <button class="btn btn-primary btn-xl" id="ovStart">POKRENI IGRU</button>
          <button class="btn" id="ovBots">+ 10 DEMO FIRMI</button>
          <span class="lobby-hint">5 rundi · 6–7 minuta</span>
        </div>
      </div>
      <div class="lobby-right">
        <div class="qr-wrap" id="qrWrap">
          <img id="qrImg" alt="QR kod za pristup" src="">
        </div>
        <div class="qr-note" id="qrNote">ili skenirajte QR kod telefonom</div>
        <div class="lobby-count" id="lobbyCount">0 firmi</div>
        <div class="firms-grid" id="firmsGrid"></div>
      </div>
    </div>
  </div>`;
}

function resultsHTML() {
  const r = S.results;
  if (!r) return '';
  const lines = (r.lines || []).map(t => `<li>${escapeXml(t)}</li>`).join('');
  const rows = (r.table || []).map(row => `
    <div class="res-row">
      <i style="background:${row.color}"></i>
      <div><div class="rn">${escapeXml(row.name)}</div><div class="rs">${escapeXml(row.sub || '')}</div></div>
      <div class="rm">${escapeXml(row.main || '')}</div>
    </div>`).join('');
  const prev = S.hhiHistory.length > 1 ? S.hhiHistory[S.hhiHistory.length - 2] : null;
  const showDelta = !!prev && r.round > 1;
  const delta = prev ? r.hhi - prev.hhi : 0;
  const arrow = delta === 0 ? '▬' : delta > 0 ? '▲' : '▼';
  const cls = delta === 0 ? '' : delta > 0 ? 'up' : 'down';
  const groupInfo = (r.groupsBefore && r.groupsAfter && r.groupsBefore !== r.groupsAfter)
    ? `grupa: ${r.groupsBefore} → ${r.groupsAfter}`
    : `${fmt0(r.players || 0)} firmi`;
  return `
  <div class="ov-card res-card">
    <div class="res-top">
      <div class="res-kicker">Runda ${r.round} · ${escapeXml(r.title || '')}</div>
      <div class="res-countdown">Dalje za <b id="resSec">10</b> s</div>
    </div>
    <h2 class="res-headline">${escapeXml(r.headline || '')}</h2>
    <div class="res-body">
      <ul class="res-lines">${lines}</ul>
      <div class="res-table">${rows}</div>
    </div>
    <div class="res-foot">
      <div class="hhi-chip">HHI <b>${fmt0(r.hhi)}</b>
        ${showDelta ? `<span class="arrow ${cls}">${arrow} ${fmt0(Math.abs(delta))}</span>` : ''}
        <span class="zone zone-${zoneKey(r.hhi, S.meta)}">${r.hhiZone || zoneName(r.hhi, S.meta)}</span>
      </div>
      <div class="res-note">${groupInfo}</div>
      <div class="res-note">Space = dalje</div>
    </div>
  </div>`;
}

function finalHTML() {
  const f = S.final;
  if (!f) return '';
  const rank = f.ranking || [];
  const podItems = [];
  if (rank[1]) podItems.push({ p: rank[1], cls: 'second', h: '13.5vh' });
  if (rank[0]) podItems.push({ p: rank[0], cls: 'first', h: '18.5vh' });
  if (rank[2]) podItems.push({ p: rank[2], cls: 'third', h: '10.5vh' });
  const podHTML = podItems.map(({ p, cls, h }) => `
    <div class="pod ${cls}">
      <div class="pod-name" style="color:${p.color}">${escapeXml(p.name)}</div>
      <div class="pod-value">${fmt1(p.score)} mil KM</div>
      <div class="pod-col" style="height:${h}">${p.place}</div>
    </div>`).join('');
  const hs = f.hhiHistory || [];
  const first = hs.length ? hs[0].hhi : 0;
  const last = hs.length ? hs[hs.length - 1].hhi : 0;
  return `
  <div class="ov-card final-card">
    <div class="final-head">
      <div>
        <div class="res-kicker">Kraj igre · 5 rundi</div>
        <div class="final-title"><span>${escapeXml(f.winner ? f.winner.name : '—')}</span> pobjeđuje</div>
        <div class="final-sub">vrijednost = kapital + kupci × 100.000 KM</div>
      </div>
      <button class="btn btn-primary" id="ovAgain">NOVA IGRA</button>
    </div>
    <div class="podium">${podHTML}</div>
    <div class="chart-wrap"><svg id="finalChart" viewBox="0 0 1000 260" preserveAspectRatio="xMidYMid meet"></svg></div>
    <div class="final-story" id="finalStory"></div>
    <div class="final-actions">
      <div class="final-hint">R = nova igra · F = cijeli ekran</div>
      <div class="final-hint">${fmt0(S.totals.players)} firmi · ${fmt0(S.totals.customers)} kupaca na kraju</div>
    </div>
  </div>`;
}

function updateOverlay() {
  if (overlayKey === 'lobby') {
    const qr = document.getElementById('qrImg');
    if (qr && !qr.dataset.set) {
      qr.dataset.set = '1';
      const url = 'https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=0&bgcolor=0c1426&color=ffffff&data=' + encodeURIComponent(S.joinUrl);
      qr.onerror = () => { const w = document.getElementById('qrWrap'); if (w) w.classList.add('failed'); const n = document.getElementById('qrNote'); if (n) n.textContent = 'Bez interneta — upišite adresu ručno.'; };
      qr.src = url;
    }
    const count = document.getElementById('lobbyCount');
    if (count) count.textContent = fmt0(S.totals.players) + ' ' + (S.totals.players === 1 ? 'firma' : 'firmi');
    const grid = document.getElementById('firmsGrid');
    if (grid) {
      const key = S.players.map(p => p.id + p.name).join('|');
      if (grid.dataset.key !== key) {
        grid.dataset.key = key;
        grid.innerHTML = S.players.length
          ? S.players.map(p => `<span class="firm-chip"><i style="background:${p.color}"></i>${escapeXml(p.name)}</span>`).join('')
          : '<div class="firms-empty">Još nema firmi — pridružite se sa telefona.</div>';
      }
    }
    const start = document.getElementById('ovStart');
    if (start) start.disabled = S.totals.players === 0;
  } else if (overlayKey === 'final') {
    const svg = document.getElementById('finalChart');
    if (svg && !svg.dataset.drawn) {
      svg.dataset.drawn = '1';
      drawChart(svg, S.final.hhiHistory || [], S.meta);
    }
    const story = document.getElementById('finalStory');
    if (story) {
      const hs = (S.final && S.final.hhiHistory) || [];
      const first = hs.length ? hs[0].hhi : 0;
      const last = hs.length ? hs[hs.length - 1].hhi : 0;
      const maxH = S.final.maxHhi || 0;
      story.innerHTML = `Vi ste za 6 minuta napravili tržište od konkurencije (HHI <b>${fmt0(first)}</b>) ` +
        `do oligopola (HHI <b>${fmt0(maxH)}</b>) — i nazad na HHI <b>${fmt0(last)}</b>. ` +
        `Isti pragovi kao na slajdu: <b>1.000</b> i <b>2.000</b>.`;
    }
  }
}

function wireOverlay() {
  const start = document.getElementById('ovStart');
  if (start) start.onclick = () => admin('start');
  const bots = document.getElementById('ovBots');
  if (bots) bots.onclick = () => admin('bots', { count: 10 });
  const again = document.getElementById('ovAgain');
  if (again) again.onclick = () => admin('reset');
}

/* ------------------------------- GRAFIKON -------------------------------- */
function drawChart(svg, history, meta) {
  const W = 1000, H = 260;
  const padL = 58, padR = 26, padT = 18, padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxVal = Math.max(2400, ...history.map(h => h.hhi)) * 1.1;
  const x = i => history.length === 1 ? padL + plotW / 2 : padL + (i / (history.length - 1)) * plotW;
  const y = v => H - padB - (v / maxVal) * plotH;
  const ns = (tag, attrs) => {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };
  svg.innerHTML = '';
  const defs = ns('defs', {});
  const grad = ns('linearGradient', { id: 'areaGrad', x1: '0', y1: '0', x2: '0', y2: '1' });
  grad.append(ns('stop', { offset: '0%', 'stop-color': '#6ee7ff', 'stop-opacity': '.35' }));
  grad.append(ns('stop', { offset: '100%', 'stop-color': '#6ee7ff', 'stop-opacity': '0' }));
  defs.append(grad);
  svg.append(defs);

  // zone trake
  const zones = [
    { from: 0, to: meta.hhiLow, fill: 'rgba(53,224,161,.10)' },
    { from: meta.hhiLow, to: meta.hhiHigh, fill: 'rgba(255,209,102,.10)' },
    { from: meta.hhiHigh, to: maxVal, fill: 'rgba(255,93,115,.10)' },
  ];
  for (const z of zones) {
    svg.append(ns('rect', {
      x: padL, y: y(Math.min(z.to, maxVal)), width: plotW,
      height: Math.max(0, y(z.from) - y(Math.min(z.to, maxVal))),
      fill: z.fill,
    }));
  }
  // mreža
  for (let v = 0; v <= maxVal; v += 1000) {
    const yy = y(v);
    if (yy < padT - 1) continue;
    svg.append(ns('line', { x1: padL, y1: yy, x2: W - padR, y2: yy, stroke: 'rgba(255,255,255,.07)', 'stroke-width': 1 }));
    const t = ns('text', { x: padL - 12, y: yy + 4, 'text-anchor': 'end', fill: '#6f7fa3', 'font-size': 11, 'font-weight': 700 });
    t.textContent = fmt0(v);
    svg.append(t);
  }
  // pragovi
  for (const [val, color, label] of [[meta.hhiLow, '#ffd166', '1.000'], [meta.hhiHigh, '#ff5d73', '2.000']]) {
    const yy = y(val);
    svg.append(ns('line', { x1: padL, y1: yy, x2: W - padR, y2: yy, stroke: color, 'stroke-width': 1.5, 'stroke-dasharray': '6 6', opacity: .8 }));
    const t = ns('text', { x: W - padR, y: yy - 7, 'text-anchor': 'end', fill: color, 'font-size': 10, 'font-weight': 800, 'letter-spacing': '1' });
    t.textContent = 'PRAG ' + label;
    svg.append(t);
  }
  // površina + linija
  if (history.length) {
    const pts = history.map((h, i) => [x(i), y(h.hhi)]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const area = line + ` L${pts[pts.length - 1][0].toFixed(1)} ${H - padB} L${pts[0][0].toFixed(1)} ${H - padB} Z`;
    svg.append(ns('path', { d: area, fill: 'url(#areaGrad)' }));
    svg.append(ns('path', { d: line, fill: 'none', stroke: '#6ee7ff', 'stroke-width': 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    history.forEach((h, i) => {
      const [px, py] = pts[i];
      const color = h.hhi < meta.hhiLow ? '#35e0a1' : h.hhi <= meta.hhiHigh ? '#ffd166' : '#ff5d73';
      svg.append(ns('circle', { cx: px, cy: py, r: 5.5, fill: color, stroke: '#060a14', 'stroke-width': 3 }));
      const lx = ns('text', { x: px, y: H - padB + 20, 'text-anchor': 'middle', fill: '#93a2c4', 'font-size': 11, 'font-weight': 700 });
      lx.textContent = 'R' + (h.round || i + 1);
      svg.append(lx);
      const isLast = i === history.length - 1;
      const vx = ns('text', {
        x: isLast ? px - 8 : px, y: py - 13,
        'text-anchor': isLast ? 'end' : 'middle',
        fill: '#eef3ff', 'font-size': 11.5, 'font-weight': 800,
      });
      vx.textContent = fmt0(h.hhi);
      svg.append(vx);
    });
  }
}

/* -------------------------------- ADMIN ---------------------------------- */
async function admin(action, extra) {
  const body = Object.assign({ action }, extra || {});
  const pin = localStorage.getItem(PIN_KEY);
  if (pin) body.pin = pin;
  let res = await api('/api/admin', body);
  if (!res.ok && res.data && res.data.pinRequired) {
    const entered = prompt('Admin PIN:');
    if (entered) {
      localStorage.setItem(PIN_KEY, entered.trim());
      body.pin = entered.trim();
      res = await api('/api/admin', body);
    }
  }
  if (res.ok && res.data && res.data.state) {
    S = res.data.state;
    offset = S.serverNow - Date.now();
    render();
  } else if (!res.ok && res.data && res.data.error) {
    toast(res.data.error);
  }
}

let toastTimer = null;
function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast' });
    el.style.cssText = 'position:fixed;left:50%;bottom:70px;transform:translateX(-50%);z-index:95;background:rgba(255,93,115,.16);border:1px solid rgba(255,93,115,.5);color:#ffd2d9;padding:10px 18px;border-radius:12px;font-size:13px;font-weight:700;backdrop-filter:blur(8px);transition:opacity .2s';
    document.body.append(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 2600);
}

function renderAdmin() {
  const btnNext = $('btnNext');
  const btnPause = $('btnPause');
  const btnBots = $('btnBots');
  const phase = S.phase;
  if (phase === 'lobby') {
    btnNext.textContent = 'POKRENI';
    btnNext.disabled = S.totals.players === 0;
  } else if (phase === 'round') {
    btnNext.textContent = 'DALJE';
    btnNext.disabled = false;
  } else if (phase === 'results') {
    btnNext.textContent = 'DALJE';
    btnNext.disabled = false;
  } else {
    btnNext.textContent = 'NOVA IGRA';
    btnNext.disabled = false;
  }
  btnPause.textContent = S.paused ? 'NASTAVI' : 'PAUZA';
  btnPause.disabled = !(phase === 'round' || phase === 'results');
  btnBots.disabled = phase !== 'lobby';
}

$('btnNext').onclick = () => {
  if (!S) return;
  if (S.phase === 'lobby') admin('start');
  else if (S.phase === 'final') admin('reset');
  else admin('next');
};
$('btnPause').onclick = () => { if (S && (S.phase === 'round' || S.phase === 'results')) admin(S.paused ? 'resume' : 'pause'); };
$('btnBots').onclick = () => { if (S && S.phase === 'lobby') admin('bots', { count: 8 }); };
$('btnReset').onclick = () => { if (confirm('Nova igra? Firme ostaju, rezultati se brišu.')) admin('reset'); };
$('btnHide').onclick = () => $('adminbar').classList.toggle('hidden-bar');

document.addEventListener('keydown', e => {
  if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === ' ' || k === 'spacebar') {
    e.preventDefault();
    $('btnNext').click();
  } else if (k === 'p') $('btnPause').click();
  else if (k === 'r') { if (confirm('Nova igra? Firme ostaju, rezultati se brišu.')) admin('reset'); }
  else if (k === 'b') $('btnBots').click();
  else if (k === 'a') $('adminbar').classList.toggle('hidden-bar');
  else if (k === 'f') {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => { });
    else document.exitFullscreen().catch(() => { });
  }
});

/* --------------------------------- CLOCK --------------------------------- */
setInterval(updateTimer, 100);
