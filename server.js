'use strict';
/* =====================================================================
   TRŽIŠTE UŽIVO — igra za predavanje o tržišnim strukturama
   ---------------------------------------------------------------------
   Server bez ijedne vanjske zavisnosti (samo Node.js).
   Pokretanje:  node server.js          (ili start.bat)
   Projektor:   http://localhost:3000/screen
   Telefoni:    http://<lokalna-IP>:3000/
   ===================================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { exec } = require('child_process');

const PORT_START = Number(process.env.PORT || 4000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const OPEN_BROWSER = process.argv.includes('--open');

/* --------------------------- KONFIGURACIJA IGRE --------------------------- */
const TOTAL_CUSTOMERS = 10000;   // ukupno kupaca na tržištu
const START_CAPITAL = 50;        // mil. KM po firmi
const CUSTOMER_VALUE = 0.15;     // mil. KM vrijednosti po kupcu
const TAP_BASE = 30;             // "utočište" da niko ne ostane na nuli
const TAP_MAX = 400;             // maksimalan broj tapkanja u rundi 1
const TAP_RATE = 25;             // maksimalno tapkanja u sekundi (anti-cheat)
const HHI_LOW = 1000;
const HHI_HIGH = 2000;
const MAX_PLAYERS = 60;
const OFFER_TTL = 12000;         // ponuda za spajanje važi 12 s
const OFFER_COOLDOWN = 5000;     // pauza između ponuda iste firme

const ROUNDS = [
  null,
  { n: 1, key: 'tap',    title: 'Borba za kupce', sub: 'Svako tapkanje je kupac',            dur: 25, results: 11 },
  { n: 2, key: 'price',  title: 'Cjenovni rat',    sub: 'Niska, srednja ili visoka cijena?',  dur: 20, results: 13 },
  { n: 3, key: 'invest', title: 'Investicije',    sub: 'Reklama, inovacija ili štednja?',     dur: 20, results: 14 },
  { n: 4, key: 'merge',  title: 'Spajanja',       sub: 'Dogovaraj se — ili kupi konkurenciju',dur: 50, results: 13 },
  { n: 5, key: 'vote',   title: 'Komisija',       sub: 'Koga zabraniti?',                    dur: 25, results: 15 },
];

const PRICES = {
  low:  { key: 'low',  label: 'Niska',   sign: '▼', revenue: 0.008, weight: 1.7,  desc: 'Kradeš kupce drugima, ali zarađuješ malo.' },
  med:  { key: 'med',  label: 'Srednja', sign: '●', revenue: 0.020, weight: 1.0,  desc: 'Sigurna sredina — stabilna zarada.' },
  high: { key: 'high', label: 'Visoka',  sign: '▲', revenue: 0.055, weight: 0.62, desc: 'Velika zarada, ali gubiš kupce.' },
};
const PRICE_ORDER = ['low', 'med', 'high'];

const INVESTS = {
  ad:    { key: 'ad',    label: 'Reklama',   cost: 15, weight: 1.3, gain: 0,
           desc: 'Sigurno privlači +30% kupaca (na račun drugih).' },
  innov: { key: 'innov', label: 'Inovacija', cost: 20, weight: 2.0, chance: 0.4, gain: 0,
           desc: '40% šanse da udvostručiš kupce. Ako ne uspije, uloženih 20 mil je izgubljeno.' },
  save:  { key: 'save',  label: 'Štednja',   cost: 0,  weight: 1.0, gain: 8,
           desc: 'Bez rizika: +8 mil KM kapitala.' },
};
const INVEST_ORDER = ['ad', 'innov', 'save'];

const FIRM_NAMES = ['Alfa', 'Beta', 'Gama', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Teta', 'Jota', 'Kapa',
  'Lambda', 'Mi', 'Ni', 'Ksi', 'Omikron', 'Pi', 'Ro', 'Sigma', 'Tau', 'Ipsilon', 'Fi', 'Hi', 'Psi', 'Omega'];

const META = {
  totalCustomers: TOTAL_CUSTOMERS,
  startCapital: START_CAPITAL,
  customerValue: CUSTOMER_VALUE,
  hhiLow: HHI_LOW,
  hhiHigh: HHI_HIGH,
  maxTaps: TAP_MAX,
  offerTtl: OFFER_TTL,
  prices: PRICE_ORDER.map(k => ({ ...PRICES[k] })),
  investments: INVEST_ORDER.map(k => ({ ...INVESTS[k] })),
  rounds: ROUNDS.slice(1).map(r => ({ n: r.n, key: r.key, title: r.title, sub: r.sub, dur: r.dur })),
};

/* ------------------------------- UTILITETI -------------------------------- */
const NF0 = new Intl.NumberFormat('sr-RS');
const NF1 = new Intl.NumberFormat('sr-RS', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt0 = n => NF0.format(Math.round(Number(n) || 0));
const fmt1 = n => NF1.format(Number(n) || 0);
const pct = n => fmt1((Number(n) || 0) * 100) + '%';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const now = () => Date.now();
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function colorFor(i) {
  const h = Math.round((i * 137.508 + 12) % 360);
  return `hsl(${h} 85% 62%)`;
}

/* ------------------------------ STANJE IGRE ------------------------------- */
const game = {
  phase: 'lobby',         // lobby | round | results | final
  round: 0,
  endsAt: 0,
  paused: false,
  pausedAt: 0,
  players: new Map(),
  groupLeaders: new Map(), // groupId -> firmId
  news: [],
  newsSeq: 0,
  offers: [],
  offerSeq: 0,
  votes: new Map(),        // firmId -> groupId
  voteCandidates: [],
  results: null,
  hhiHistory: [],
  roundEvents: [],
  final: null,
  joinCounter: 0,
  seq: 0,
  startedAt: 0,
  lastTickAt: 0,
};


/* ------------------------------- FIRME ------------------------------------ */
function uniqueName(base) {
  const used = new Set([...game.players.values()].map(p => p.name));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(base + ' ' + n)) n++;
  return base + ' ' + n;
}

function nextFirmName() {
  const n = game.joinCounter++;
  let base;
  if (n < FIRM_NAMES.length) base = FIRM_NAMES[n];
  else base = FIRM_NAMES[(n - FIRM_NAMES.length) % FIRM_NAMES.length];
  return uniqueName(base);
}

function addPlayer(name, isBot) {
  const n = ++game.seq;
  const id = 'p' + n;
  const p = {
    id,
    token: crypto.randomBytes(12).toString('hex'),
    name: name || nextFirmName(),
    color: colorFor(n),
    capital: START_CAPITAL,
    customers: 0,
    taps: 0,
    price: null,
    invest: null,
    investPaid: 0,
    investSuccess: null,
    vote: null,
    groupId: 'g' + id,
    snapshot: null,
    prevCapital: START_CAPITAL,
    prevCustomers: 0,
    lastRevenue: 0,
    isBot: !!isBot,
    joinedAt: now(),
    lastActiveAt: now(),
    connections: 0,
    tapWindow: [],
    tapRate: 5 + Math.random() * 9,
    botRound: 0,
    botAt: 0,
    botMergeAt: 0,
    offerReadyAt: 0,
  };
  game.players.set(id, p);
  game.groupLeaders.set(p.groupId, p.id);
  return p;
}

function findPlayerByToken(token) {
  if (!token) return null;
  for (const p of game.players.values()) if (p.token === token) return p;
  return null;
}

function score(p) { return p.capital + p.customers * CUSTOMER_VALUE; }

/* ------------------------------- GRUPE ------------------------------------ */
function buildGroups() {
  const map = new Map();
  for (const p of game.players.values()) {
    let g = map.get(p.groupId);
    if (!g) { g = { id: p.groupId, members: [] }; map.set(p.groupId, g); }
    g.members.push(p);
  }
  const t = now();
  for (const g of map.values()) {
    let leader = null;
    const storedId = game.groupLeaders.get(g.id);
    const stored = g.members.find(m => m.id === storedId);
    if (stored) {
      const offline = !SERVERLESS && stored.connections <= 0 && (t - stored.lastActiveAt > 25000);
      if (!offline) leader = stored;
    }
    if (!leader) {
      leader = [...g.members].sort((a, b) =>
        (b.connections > 0) - (a.connections > 0) ||
        (b.lastActiveAt - a.lastActiveAt) ||
        (b.capital - a.capital))[0];
      game.groupLeaders.set(g.id, leader.id);
    }
    g.leader = leader;
    g.customers = g.members.reduce((s, m) => s + m.customers, 0);
    g.capital = g.members.reduce((s, m) => s + m.capital, 0);
    g.score = g.members.reduce((s, m) => s + score(m), 0);
    g.share = g.customers / TOTAL_CUSTOMERS;
    g.name = g.members.length > 1 ? leader.name + ' grupa' : leader.name;
    g.groupName = g.members.length > 1 ? leader.name + ' grupa' : leader.name;
    g.color = leader.color;
    g.memberCount = g.members.length;
    g.memberIds = g.members.map(m => m.id);
  }
  return map;
}

function groupList() {
  const g = buildGroups();
  return [...g.values()].sort((a, b) => b.score - a.score || b.customers - a.customers);
}

function computeHhi(groups) {
  const gs = groups || buildGroups();
  let s = 0;
  for (const g of gs.values()) {
    const sh = g.customers / TOTAL_CUSTOMERS;
    s += sh * sh;
  }
  return Math.round(s * 10000);
}

function hhiZone(hhi) {
  if (hhi < HHI_LOW) return 'konkurencija';
  if (hhi <= HHI_HIGH) return 'umjereno';
  return 'oligopol';
}

function totalCustomers() {
  let s = 0;
  for (const p of game.players.values()) s += p.customers;
  return s;
}

/* Živa podjela tržišta tokom runde 1 (kupci se "kuvaju" dok se tapka) */
let _liveTapAt = 0;
function maybeLiveTapCustomers() {
  if (game.phase !== 'round' || game.round !== 1) return;
  const t = now();
  if (t - _liveTapAt < 150) return;
  _liveTapAt = t;
  const players = [...game.players.values()];
  if (!players.length) return;
  const alloc = allocateCustomers(players.map(p => ({ id: p.id, w: p.taps + TAP_BASE })));
  for (const p of players) p.customers = alloc.get(p.id) || 0;
}

/* ------------------------ RASPODJELA KUPACA (INT) ------------------------- */
function allocateCustomers(entries) {
  // entries: [{ id, w }]  -> Map id -> integer, suma = TOTAL_CUSTOMERS
  const result = new Map();
  if (!entries.length) return result;
  const totalW = entries.reduce((s, e) => s + Math.max(0, e.w || 0), 0);
  if (totalW <= 0) {
    const each = Math.floor(TOTAL_CUSTOMERS / entries.length);
    let rem = TOTAL_CUSTOMERS - each * entries.length;
    for (const e of entries) { result.set(e.id, each + (rem > 0 ? 1 : 0)); if (rem > 0) rem--; }
    return result;
  }
  const raw = [];
  let assigned = 0;
  for (const e of entries) {
    const v = TOTAL_CUSTOMERS * Math.max(0, e.w || 0) / totalW;
    const base = Math.floor(v);
    assigned += base;
    raw.push({ id: e.id, base, frac: v - base });
    result.set(e.id, base);
  }
  let rem = TOTAL_CUSTOMERS - assigned;
  raw.sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < rem; i++) {
    const r = raw[i % raw.length];
    result.set(r.id, result.get(r.id) + 1);
  }
  return result;
}

/* --------------------------------- VIJESTI -------------------------------- */
function newNews(text, type) {
  const item = { id: 'n' + (++game.newsSeq), text, type: type || 'info', at: now() };
  game.news.push(item);
  if (game.news.length > 60) game.news.splice(0, game.news.length - 60);
  return item;
}

/* ------------------------------ TOK RUNDE --------------------------------- */
function startRound(n) {
  const r = ROUNDS[n];
  if (!r) return;
  game.round = n;
  game.phase = 'round';
  game.paused = false;
  // Tajmer ima samo runda tapkanja (1); ostale runde profesor otvara/zatvara ručno.
  game.endsAt = n === 1 ? now() + r.dur * 1000 : 0;
  game.results = null;
  game.roundEvents = [];
  game.startedAt = game.startedAt || now();
  for (const p of game.players.values()) {
    p.prevCapital = p.capital;
    p.prevCustomers = p.customers;
    p.price = null;
    p.invest = null;
    p.investPaid = 0;
    p.investSuccess = null;
    p.vote = null;
    p.offerReadyAt = 0;
    p.botRound = 0;
    p.botAt = 0;
    p.botMergeAt = n === 4 ? now() + rint(2500, 7000) : 0;
    p.tapWindow = [];
  }
  game.offers = [];
  game.votes.clear();
  game.voteCandidates = n === 5 ? prepareVoteCandidates() : [];
  if (n === 1) {
    // svi kreću od nule, kupci se dijele na kraju runde
    for (const p of game.players.values()) { p.customers = 0; p.taps = 0; }
  }
  newNews(`Runda ${n}: ${r.title}`, 'round');
  console.log(`[runda ${n}] ${r.title} — ${r.dur}s`);
}

function finishRound() {
  if (game.phase !== 'round') return;
  const n = game.round;
  const before = buildGroups();
  const beforeHhi = computeHhi(before);
  let res;
  if (n === 1) res = finishTap();
  else if (n === 2) res = finishPrice();
  else if (n === 3) res = finishInvest();
  else if (n === 4) res = finishMerge();
  else res = finishVote();
  const after = buildGroups();
  const hhi = computeHhi(after);
  const beforeGroups = [...before.values()].length;
  const afterGroups = [...after.values()].length;

  game.hhiHistory.push({
    round: n, label: 'R' + n, hhi, groups: afterGroups,
    players: game.players.size, at: now(),
  });

  res = res || {};
  res.round = n;
  res.key = ROUNDS[n].key;
  res.title = ROUNDS[n].title;
  res.hhi = hhi;
  res.hhiBefore = beforeHhi;
  res.hhiZone = hhiZone(hhi);
  res.groupsBefore = beforeGroups;
  res.groupsAfter = afterGroups;
  res.players = game.players.size;
  res.news = game.roundEvents.slice(-6);

  game.results = res;
  game.phase = 'results';
  // Rezultati čekaju profesora — nema automatskog prelaska.
  game.endsAt = 0;
  game.offers = game.offers.filter(o => o.status === 'pending');
  for (const o of game.offers) if (o.status === 'pending') o.status = 'expired';
  game.offers = [];
  console.log(`[runda ${n}] gotova — HHI ${hhi} (${hhiZone(hhi)}), grupa: ${afterGroups}`);
}

function advance() {
  if (game.phase !== 'results') return;
  if (game.round >= 5) { finalize(); return; }
  startRound(game.round + 1);
}

function finalize() {
  const groups = groupList();
  const winner = groups[0] || null;
  const hs = game.hhiHistory;
  const maxHhi = hs.reduce((m, h) => Math.max(m, h.hhi), 0);
  game.final = {
    winner: winner ? {
      name: winner.name, color: winner.color, score: winner.score,
      capital: winner.capital, customers: winner.customers,
      share: winner.share, members: winner.memberCount,
    } : null,
    ranking: groups.slice(0, 10).map((g, i) => ({
      place: i + 1, name: g.name, color: g.color, score: g.score,
      capital: g.capital, customers: g.customers, share: g.share, members: g.memberCount,
    })),
    hhiHistory: hs.slice(),
    maxHhi,
    story: hs.length
      ? `Za ${Math.round((now() - (game.startedAt || now())) / 1000)} s tržište je otišlo od konkurencije do oligopola i nazad.`
      : '',
  };
  game.phase = 'final';
  game.endsAt = 0;
  game.results = null;
  newNews(`Kraj igre! Pobjednik: ${winner ? winner.name : '—'}`, 'round');
  console.log('[kraj] pobjednik:', winner && winner.name, 'HHI max:', maxHhi);
}


/* --------------------------- ZAVRŠETAK PO RUNDAMA ------------------------- */
function topRows(list, valueFn, subFn, n) {
  return list.slice(0, n || 5).map(p => ({
    name: p.name, color: p.color,
    main: valueFn(p), sub: subFn(p),
  }));
}

function finishTap() {
  const players = [...game.players.values()];
  const entries = players.map(p => ({ id: p.id, w: p.taps + TAP_BASE }));
  const alloc = allocateCustomers(entries);
  let totalTaps = 0;
  for (const p of players) {
    p.customers = alloc.get(p.id) || 0;
    totalTaps += p.taps;
  }
  const sorted = [...players].sort((a, b) => b.customers - a.customers);
  const top = sorted[0];
  const lines = [];
  if (top) {
    lines.push(`Najviše kupaca: ${top.name} — ${fmt0(top.customers)} (${pct(top.customers / TOTAL_CUSTOMERS)})`);
  }
  lines.push(`Ukupno tapkanja: ${fmt0(totalTaps)} · prosječno ${fmt0(totalTaps / Math.max(1, players.length))} po firmi`);
  lines.push(`Tržište je podijeljeno na ${players.length} firmi — HHI ${computeHhi()} (konkurencija)`);
  lines.push('Kupci su raspoređeni srazmjerno tapkanju. Tržište je rasparčano — svako ima mali dio.');
  newNews(`Runda 1: ${top ? top.name : '—'} je pokupila najviše kupaca (${pct(top ? top.customers / TOTAL_CUSTOMERS : 0)}).`, 'info');
  return {
    headline: `${top ? top.name : '—'} vodi na startu`,
    lines,
    table: topRows(sorted, p => `${fmt0(p.customers)} kupaca`, p => `${pct(p.customers / TOTAL_CUSTOMERS)} tržišta`),
  };
}

function finishPrice() {
  const players = [...game.players.values()];
  const counts = { low: 0, med: 0, high: 0 };
  let totalRevenue = 0;
  for (const p of players) {
    const key = p.price && PRICES[p.price] ? p.price : 'med';
    p.price = key;
    counts[key]++;
  }
  const entries = players.map(p => ({ id: p.id, w: p.customers * PRICES[p.price].weight }));
  const alloc = allocateCustomers(entries);
  for (const p of players) {
    const opt = PRICES[p.price];
    p.customers = alloc.get(p.id) || 0;
    p.lastRevenue = Math.round(p.customers * opt.revenue * 10) / 10;
    p.capital = Math.round((p.capital + p.lastRevenue) * 10) / 10;
    totalRevenue += p.lastRevenue;
  }
  const sorted = [...players].sort((a, b) => b.lastRevenue - a.lastRevenue);
  const top = sorted[0];
  const n = players.length;
  const allSame = counts.low === n || counts.med === n || counts.high === n;
  const majorityLow = counts.low > n / 2;

  const lines = [];
  lines.push(`Niska: ${counts.low} · Srednja: ${counts.med} · Visoka: ${counts.high}`);
  lines.push(`Ukupna zarada sale: +${fmt1(totalRevenue)} mil KM · prosječno +${fmt1(totalRevenue / Math.max(1, n))} mil po firmi`);
  if (top) lines.push(`Najviše je zaradila ${top.name}: +${fmt1(top.lastRevenue)} mil KM`);
  if (allSame && counts.low === n) {
    lines.push('⚠ Svi su oborili cijenu. Kupci se nisu preselili — niko nije dobio tržišni udio, a svi su zaradili manje.');
  } else if (allSame && counts.high === n) {
    lines.push('Svi su zadržali visoku cijenu — tržište je zaradilo najviše. (Ali ovo je krhko: svako ima motiv da obori cijenu.)');
  } else if (majorityLow) {
    lines.push('⚠ Cjenovni rat: više od polovine firmi je oborilo cijenu. Kupci su se preselili onima sa niskom cijenom, ali je zarada pala.');
  } else {
    lines.push('Cijene su raznolike — dio firmi je kupovao tržišni udio niskom cijenom, dio je živeo od visoke marže.');
  }
  lines.push('Zamka: niska cijena je uvijek isplativa pojedincu — dok je svi ne izaberu. Tada niko ne dobija kupce, a svi zarađuju manje.');

  newNews(`Runda 2: niska ${counts.low} · srednja ${counts.med} · visoka ${counts.high}. Ukupna zarada +${fmt1(totalRevenue)} mil.`, 'info');
  const headline = allSame
    ? (counts.low === n ? 'Svi su oborili cijenu — niko nije dobio kupce' : 'Svi su zadržali visoku cijenu')
    : (majorityLow ? 'Cjenovni rat je počeo' : 'Cijene su se razišle');
  return {
    headline,
    lines,
    table: sorted.slice(0, 5).map(p => ({
      name: p.name, color: p.color,
      main: `+${fmt1(p.lastRevenue)} mil`,
      sub: `${PRICES[p.price].label} cijena · ${fmt0(p.customers)} kupaca`,
    })),
  };
}

function finishInvest() {
  const players = [...game.players.values()];
  let spent = 0;
  const innovations = [];
  for (const p of players) {
    p.investSuccess = null;
    p.lastRevenue = 0;
    if (!p.invest || !INVESTS[p.invest]) continue;
    if (p.invest === 'save') {
      p.capital = Math.round((p.capital + INVESTS.save.gain) * 10) / 10;
      continue;
    }
    spent += INVESTS[p.invest].cost;
    if (p.invest === 'innov') {
      const ok = Math.random() < INVESTS.innov.chance;
      p.investSuccess = ok;
      innovations.push({ id: p.id, name: p.name, color: p.color, success: ok });
    }
  }
  // ponderisana preraspodjela kupaca
  const entries = players.map(p => {
    let w = 1;
    if (p.invest === 'ad') w = INVESTS.ad.weight;
    else if (p.invest === 'innov') w = p.investSuccess ? INVESTS.innov.weight : 1;
    return { id: p.id, w: Math.max(0, p.customers) * w };
  });
  const alloc = allocateCustomers(entries);
  const gains = [];
  for (const p of players) {
    const prev = p.customers;
    p.customers = alloc.get(p.id) || 0;
    gains.push({ p, delta: p.customers - prev });
  }
  gains.sort((a, b) => b.delta - a.delta);

  const successes = innovations.filter(i => i.success);
  const failures = innovations.filter(i => !i.success);
  const lines = [];
  lines.push(`Ulaganja: reklama ${players.filter(p => p.invest === 'ad').length} · inovacija ${innovations.length} · štednja ${players.filter(p => p.invest === 'save').length}`);
  lines.push(`Ukupno uloženo u reklame i inovacije: ${fmt1(spent)} mil KM`);
  if (innovations.length) {
    lines.push(`Inovacije: ${successes.length} uspješnih, ${failures.length} neuspješnih.`);
    if (successes.length) lines.push(`Uspjele: ${successes.slice(0, 5).map(i => i.name).join(', ')} — kupci su udvostručeni!`);
    if (failures.length) lines.push(`Propalе: ${failures.slice(0, 5).map(i => i.name).join(', ')} — ulaganje je izgubljeno.`);
  } else {
    lines.push('Niko nije ulagao u inovacije — tržište se nije mijenjalo.');
  }
  lines.push('Inovacija je rizik: 40% šanse da udvostručiš kupce, a uloženo se ne vraća ako ne uspije. Reklama je sigurna, ali skuplja po kupcu.');

  const top = gains[0];
  if (top && top.delta > 0) lines.push(`Najviše je dobila ${top.p.name}: +${fmt0(top.delta)} kupaca.`);
  newNews(`Runda 3: ${successes.length} uspješnih inovacija${successes.length ? ' (' + successes.slice(0, 3).map(i => i.name).join(', ') + ')' : ''}.`, 'invest');

  return {
    headline: successes.length ? `Inovacije: ${successes.length} uspješnih, ${failures.length} propalih` : 'Investicije bez iznenađenja',
    lines,
    table: gains.slice(0, 5).map(g => ({
      name: g.p.name, color: g.p.color,
      main: `${g.delta >= 0 ? '+' : ''}${fmt0(g.delta)} kupaca`,
      sub: g.p.invest === 'innov' ? (g.p.investSuccess ? 'inovacija uspjela' : 'inovacija propala')
        : g.p.invest === 'ad' ? 'reklama' : g.p.invest === 'save' ? 'štednja' : 'ništa',
    })),
    reveal: innovations,
  };
}

function finishMerge() {
  const groups = groupList();
  const merges = game.roundEvents.filter(e => e.type === 'merge');
  const invited = merges.filter(e => e.kind === 'join').length;
  const lines = [];
  lines.push(`Spajanja u ovoj rundi: ${merges.length}${invited ? ` (${invited} preko javnog poziva)` : ''}`);
  if (merges.length) {
    lines.push(merges.slice(-4).map(m => m.kind === 'join' ? `${m.to} se pridružila ${m.from}` : `${m.from} preuzima ${m.to}`).join(' · '));
  } else {
    lines.push('Nije bilo spajanja — tržište je ostalo rasparčano.');
  }
  const big = groups[0];
  if (big) lines.push(`Najveća grupa: ${big.name} — ${big.memberCount} firmi, ${pct(big.share)} tržišta, vrijednost ${fmt1(big.score)} mil KM`);
  lines.push(`Sa ${groups.reduce((s, g) => s + g.memberCount, 0)} firmi na ${groups.length} grupa.`);
  lines.push('Spajanje ne mijenja kupce — mijenja KONCENTRACIJU. Isti kupci, manje igrača koji odlučuju o cijeni.');
  newNews(`Runda 4: ${merges.length} spajanja · ${groups.length} grupa na tržištu`, 'merge');
  return {
    headline: merges.length ? `${merges.length} spajanja — tržište se skuplja` : 'Nema spajanja',
    lines,
    table: groups.slice(0, 5).map(g => ({
      name: g.name, color: g.color,
      main: pct(g.share) + ' tržišta',
      sub: `${g.memberCount} firmi · ${fmt0(g.customers)} kupaca`,
    })),
  };
}

function prepareVoteCandidates() {
  return groupList().slice(0, 4).map(g => ({
    groupId: g.id,
    name: g.name,
    color: g.color,
    members: g.memberCount,
    memberNames: g.members.map(m => m.name),
    customers: g.customers,
    share: g.share,
    score: g.score,
  }));
}

function finishVote() {
  const candidates = game.voteCandidates || [];
  const players = [...game.players.values()];
  const tally = new Map();
  for (const c of candidates) tally.set(c.groupId, 0);
  let votesCast = 0;
  for (const p of players) {
    const v = game.votes.get(p.id);
    if (v && tally.has(v)) { tally.set(v, tally.get(v) + 1); votesCast++; }
  }
  const preGroups = groupList();
  const lines = [];
  lines.push(`Glasalo je ${votesCast} od ${players.length} firmi.`);
  let banned = null;
  if (candidates.length >= 2) {
    const ranked = candidates.map(c => ({ ...c, votes: tally.get(c.groupId) || 0 }))
      .sort((a, b) => b.votes - a.votes || b.score - a.score);
    const voteWinner = ranked[0].votes > 0 ? ranked[0] : null;
    for (const c of ranked) lines.push(`${c.name}: ${c.votes} glasova — ${c.members} firmi, ${pct(c.share)} tržišta`);
    const tied = ranked.filter(c => c.votes === ranked[0].votes);
    if (voteWinner && tied.length > 1) {
      lines.push(`Neriješeno (${ranked[0].votes} glasova) — presuđuje veličina grupe.`);
    }
    const all = groupList();
    const dominant = all.find(g => g.memberCount > 1 && g.share > 0.6);
    if (dominant && (!voteWinner || voteWinner.groupId !== dominant.id)) {
      banned = {
        groupId: dominant.id, name: dominant.name, color: dominant.color,
        votes: tally.get(dominant.id) || 0, members: dominant.memberCount, auto: true,
      };
      lines.push(`${dominant.name} kontroliše ${pct(dominant.share)} tržišta — Komisija po službenoj dužnosti zabranjuje dominantnu grupu.`);
      newNews(`KOMISIJA: dominantna grupa ${dominant.name} (${pct(dominant.share)}) je raspuštena!`, 'ban');
      breakupGroup(dominant.id);
    } else if (voteWinner) {
      banned = voteWinner;
      breakupGroup(banned.groupId);
      lines.push(`Komisija je zabranila ${banned.name}. Grupa se raspada na firme kakve su bile prije spajanja, uz kaznu od 30% kapitala.`);
      newNews(`KOMISIJA: ${banned.name} je zabranjena! Grupa se raspada, kazna 30% kapitala.`, 'ban');
    } else {
      lines.push('Nije bilo dovoljno glasova — niko nije zabranjen.');
    }
  } else {
    const all = groupList();
    if (all.length === 1 && all[0].memberCount > 1) {
      const only = all[0];
      lines.push('Na tržištu je ostala samo jedna grupa — Komisija nema koga da bira, pa monopol raspada po službenoj dužnosti.');
      breakupGroup(only.id);
      lines.push(`${only.name} se raspada na firme kakve su bile prije spajanja, uz kaznu od 30% kapitala.`);
      newNews(`KOMISIJA: monopol ${only.name} je raspušten po službenoj dužnosti!`, 'ban');
      banned = { groupId: only.id, name: only.name, color: only.color, votes: 0, members: only.memberCount, auto: true };
    } else {
      lines.push('Nema dovoljno grupa za glasanje — Komisija nije nikoga zabranila.');
    }
  }
  if (banned && preGroups.length) {
    const top = preGroups[0];
    if (top.id !== banned.groupId && top.share > 0.25) {
      lines.push(`Najveća grupa ${top.name} (${pct(top.share)}) nije zabranjena — glasovi su se podijelili. To je regulatorni neuspjeh (ili uspješno lobiranje).`);
    }
  }
  if (banned) lines.push(`Za 25 sekundi rasprave tržište se vratilo na ${groupList().length} firmi. To je moć konkurencijske politike.`);
  const tableItems = candidates.map(c => ({
    groupId: c.groupId, name: c.name, color: c.color, members: c.members,
    share: c.share, votes: tally.get(c.groupId) || 0,
  }));
  if (banned && !tableItems.some(c => c.groupId === banned.groupId)) {
    tableItems.push({
      groupId: banned.groupId, name: banned.name, color: banned.color,
      members: banned.members || 1, share: 0, votes: banned.votes || 0,
    });
  }
  tableItems.sort((a, b) => b.votes - a.votes);
  const table = tableItems.map(c => ({
    name: c.name,
    color: c.color,
    main: `${c.votes} glasova`,
    sub: banned && c.groupId === banned.groupId
      ? 'ZABRANJENA · raspuštena'
      : `${c.members} firmi · ${pct(c.share)} tržišta`,
  }));
  return {
    headline: banned ? `${banned.name} je zabranjena` : 'Komisija nije nikoga zabranila',
    lines,
    table,
    reveal: candidates.map(c => ({ name: c.name, color: c.color, votes: tally.get(c.groupId) || 0, banned: !!banned && banned.groupId === c.groupId })),
  };
}

function breakupGroup(groupId) {
  const members = [...game.players.values()].filter(p => p.groupId === groupId);
  for (const p of members) {
    if (p.snapshot) {
      p.capital = p.snapshot.capital;
      p.customers = p.snapshot.customers;
    }
    p.capital = Math.max(0, Math.round(p.capital * 0.7 * 10) / 10);
    p.groupId = 'g' + p.id;
    p.snapshot = null;
    game.groupLeaders.set(p.groupId, p.id);
  }
  game.groupLeaders.delete(groupId);
  // sigurnosna normalizacija (ukupno uvijek 10.000)
  const total = totalCustomers();
  if (total > 0 && total !== TOTAL_CUSTOMERS) {
    const players = [...game.players.values()];
    const alloc = allocateCustomers(players.map(p => ({ id: p.id, w: p.customers })));
    for (const p of players) p.customers = alloc.get(p.id) || 0;
  }
}

/* --------------------------- PONUDE / SPAJANJA ---------------------------- */
function publicOffer(o) {
  return {
    id: o.id,
    open: !!o.open,
    fromGroupId: o.fromGroupId,
    toGroupId: o.toGroupId,
    fromGroupName: o.fromGroupName,
    toGroupName: o.toGroupName,
    fromColor: o.fromColor,
    toColor: o.toColor,
    createdAt: o.createdAt,
    expiresAt: o.expiresAt,
    status: o.status,
    joined: (o.acceptedGroups || []).length,
  };
}

function createOffer(fromPlayer, toGroupId, byBot) {
  if (game.phase !== 'round' || game.round !== 4) return { ok: false, error: 'Spajanja su samo u rundi 4.' };
  const groups = buildGroups();
  const fromGroup = groups.get(fromPlayer.groupId);
  if (!fromGroup) return { ok: false, error: 'Grupa ne postoji.' };
  if (fromGroup.leader.id !== fromPlayer.id) return { ok: false, error: 'Samo lider grupe šalje ponude.' };
  if (now() < fromPlayer.offerReadyAt) return { ok: false, error: 'Sačekaj nekoliko sekundi prije nove ponude.' };
  const out = game.offers.find(o => o.status === 'pending' && o.fromGroupId === fromGroup.id);
  if (out) return { ok: false, error: 'Već imaš ponudu u toku — sačekaj odgovor ili istek.' };
  const open = !toGroupId;
  let toGroup = null;
  if (!open) {
    toGroup = groups.get(toGroupId);
    if (!toGroup) return { ok: false, error: 'Grupa ne postoji.' };
    if (toGroup.id === fromGroup.id) return { ok: false, error: 'Ne možeš se spojiti sa samim sobom.' };
  }
  const o = {
    id: 'o' + (++game.offerSeq),
    open,
    fromFirmId: fromPlayer.id,
    fromGroupId: fromGroup.id,
    toGroupId: open ? null : toGroup.id,
    fromGroupName: fromGroup.name,
    toGroupName: open ? 'sve firme' : toGroup.name,
    fromColor: fromGroup.color,
    toColor: open ? '#6ee7ff' : toGroup.color,
    createdAt: now(),
    expiresAt: now() + (open ? 20000 : OFFER_TTL),
    status: 'pending',
    acceptedGroups: [],
    botDecisions: {},
  };
  game.offers.push(o);
  fromPlayer.offerReadyAt = now() + (open ? 8000 : OFFER_COOLDOWN);
  if (!byBot) {
    newNews(open
      ? `${fromGroup.name} poziva sve firme na spajanje!`
      : `${fromGroup.name} je poslala ponudu za spajanje: ${toGroup.name}`, 'merge');
  }
  return { ok: true, offer: o };
}

function respondOffer(p, offerId, accept) {
  if (game.phase !== 'round' || game.round !== 4) return { ok: false, error: 'Spajanja su samo u rundi 4.' };
  const o = game.offers.find(x => x.id === offerId);
  if (!o || o.status !== 'pending') return { ok: false, error: 'Ponuda više nije aktivna.' };
  if (now() > o.expiresAt) { o.status = 'expired'; return { ok: false, error: 'Ponuda je istekla.' }; }
  const groups = buildGroups();
  const fromGroup = groups.get(o.fromGroupId);
  const myGroup = groups.get(p.groupId);
  if (!fromGroup || !myGroup) { o.status = 'expired'; return { ok: false, error: 'Grupa više ne postoji.' }; }
  if (myGroup.leader.id !== p.id) return { ok: false, error: 'Samo lider grupe odgovara na ponudu.' };
  if (o.open) {
    if (myGroup.id === fromGroup.id) return { ok: false, error: 'To je tvoja grupa.' };
    if (!accept) {
      o.rejectedBy = o.rejectedBy || [];
      o.rejectedBy.push(myGroup.id);
      newNews(`${myGroup.name} je odbila javni poziv ${fromGroup.name}`, 'merge');
      return { ok: true, accepted: false };
    }
    mergeGroups(o, fromGroup, myGroup, 'join');
    o.acceptedGroups.push(myGroup.id);
    return { ok: true, accepted: true, open: true };
  }
  if (o.toGroupId !== myGroup.id) return { ok: false, error: 'Ponuda nije za tvoju grupu.' };
  o.status = accept ? 'accepted' : 'rejected';
  if (accept) {
    mergeGroups(o, fromGroup, myGroup, 'takeover');
  } else {
    newNews(`${myGroup.name} je odbila ponudu ${fromGroup.name}`, 'merge');
  }
  return { ok: true, accepted: !!accept };
}

function mergeGroups(o, fromGroup, toGroup, kind) {
  const t = now();
  const all = [...fromGroup.members, ...toGroup.members];
  for (const p of all) {
    if (!p.snapshot) p.snapshot = { capital: p.capital, customers: p.customers, at: t };
  }
  const newLeaderId = fromGroup.leader.id;
  for (const p of toGroup.members) p.groupId = fromGroup.id;
  game.groupLeaders.set(fromGroup.id, newLeaderId);
  for (const off of game.offers) {
    if (off.status !== 'pending' || off.id === o.id) continue;
    if (off.toGroupId === toGroup.id || off.fromGroupId === toGroup.id) off.status = 'expired';
  }
  const nh = buildGroups();
  const g = nh.get(fromGroup.id);
  const share = g ? g.customers / TOTAL_CUSTOMERS : 0;
  const ev = { type: 'merge', kind, from: fromGroup.name, to: toGroup.name, members: g ? g.memberCount : all.length, at: t };
  game.roundEvents.push(ev);
  const text = kind === 'join'
    ? `${toGroup.name} se pridružuje ${fromGroup.name}`
    : `${fromGroup.name} preuzima ${toGroup.name}`;
  newNews(`${text} — ${ev.members} firmi, ${pct(share)} tržišta`, 'merge');
  console.log(`[spajanje] ${fromGroup.name} + ${toGroup.name} -> ${ev.members} firmi (${pct(share)})`);
}

function expireOffers() {
  if (game.phase !== 'round' || game.round !== 4) return;
  const t = now();
  for (const o of game.offers) {
    if (o.status !== 'pending' || t <= o.expiresAt) continue;
    o.status = 'expired';
    if (o.open) newNews(`Javni poziv ${o.fromGroupName} je istekao`, 'merge');
    else newNews(`Ponuda ${o.fromGroupName} → ${o.toGroupName} je istekla`, 'merge');
  }
}

/* --------------------------------- AKCIJE -------------------------------- */
function canAct() { return game.phase === 'round' && !game.paused; }

function doTap(p, n) {
  if (!canAct() || game.round !== 1) return { ok: false, error: 'Tapkanje je samo u rundi 1.' };
  n = clamp(Math.floor(Number(n) || 1), 1, 30);
  const t = now();
  p.tapWindow = p.tapWindow.filter(x => t - x < 1000);
  const allowed = Math.max(0, TAP_RATE - p.tapWindow.length);
  n = Math.min(n, allowed);
  if (n <= 0) return { ok: true, taps: Math.floor(p.taps), ignored: true };
  for (let i = 0; i < n; i++) p.tapWindow.push(t);
  p.taps = Math.min(TAP_MAX, p.taps + n);
  p.lastActiveAt = t;
  return { ok: true, taps: Math.floor(p.taps) };
}

function choosePrice(p, key) {
  if (!canAct() || game.round !== 2) return { ok: false, error: 'Cijena se bira u rundi 2.' };
  if (!PRICES[key]) return { ok: false, error: 'Nepoznata cijena.' };
  p.price = key;
  p.lastActiveAt = now();
  return { ok: true, price: key };
}

function chooseInvest(p, key) {
  if (!canAct() || game.round !== 3) return { ok: false, error: 'Investicije su u rundi 3.' };
  const opt = INVESTS[key];
  if (!opt) return { ok: false, error: 'Nepoznata investicija.' };
  if (p.invest === key) return { ok: true, invest: key };
  if (p.investPaid) p.capital += p.investPaid;
  p.investPaid = 0;
  p.invest = null;
  if (opt.cost > p.capital + 0.0001) return { ok: false, error: 'Nemaš dovoljno kapitala.' };
  p.capital = Math.round((p.capital - opt.cost) * 10) / 10;
  p.investPaid = opt.cost;
  p.invest = key;
  p.lastActiveAt = now();
  return { ok: true, invest: key, capital: p.capital };
}

function castVote(p, groupId) {
  if (!canAct() || game.round !== 5) return { ok: false, error: 'Glasanje je u rundi 5.' };
  const cand = game.voteCandidates.find(c => c.groupId === groupId);
  if (!cand) return { ok: false, error: 'Nepoznata grupa.' };
  if (groupId === p.groupId) return { ok: false, error: 'Ne možeš glasati za svoju grupu.' };
  game.votes.set(p.id, groupId);
  p.vote = groupId;
  p.lastActiveAt = now();
  return { ok: true, vote: groupId };
}

function handleAction(p, body) {
  const type = body.type;
  if (type === 'tap') return doTap(p, body.n);
  if (type === 'price') return choosePrice(p, body.value);
  if (type === 'invest') return chooseInvest(p, body.value);
  if (type === 'offer') return createOffer(p, body.value === '__open__' ? null : body.value, false);
  if (type === 'respond') return respondOffer(p, body.offerId, !!body.accept);
  if (type === 'vote') return castVote(p, body.value);
  return { ok: false, error: 'Nepoznata akcija.' };
}

/* --------------------------------- BOTOVI --------------------------------- */
function randPrice() {
  const r = Math.random();
  if (r < 0.5) return 'low';
  if (r < 0.85) return 'med';
  return 'high';
}

function botPickInvest(p) {
  const r = Math.random();
  if (r < 0.32 && p.capital >= INVESTS.ad.cost) return 'ad';
  if (r < 0.68 && p.capital >= INVESTS.innov.cost) return 'innov';
  if (r < 0.93) return 'save';
  return null;
}

function runBots(t, dtMs) {
  const bots = [...game.players.values()].filter(p => p.isBot);
  if (!bots.length) return;

  // botovi odgovaraju na ponude
  if (game.phase === 'round' && game.round === 4) {
    for (const o of [...game.offers]) {
      if (o.status !== 'pending') continue;
      if (t > o.expiresAt) { o.status = 'expired'; continue; }
      const groups = buildGroups();
      const from = groups.get(o.fromGroupId);
      if (!from) { o.status = 'expired'; continue; }
      if (o.open) {
        for (const g of [...groups.values()]) {
          if (g.id === from.id) continue;
          const leader = g.leader;
          if (!leader || !leader.isBot) continue;
          if (o.botDecisions[g.id] === undefined) o.botDecisions[g.id] = t + rint(1500, 6000);
          if (o.botDecisions[g.id] === -1) continue;      // već je odlučio
          if (t < o.botDecisions[g.id]) continue;
          o.botDecisions[g.id] = -1;                     // jedna odluka po ponudi
          if (Math.random() < 0.55) respondOffer(leader, o.id, true);
        }
      } else {
        const to = groups.get(o.toGroupId);
        if (!to || !to.leader || !to.leader.isBot) continue;
        if (o.botDecideAt === undefined) o.botDecideAt = t + rint(1200, 3500);
        if (t < o.botDecideAt) continue;
        const willAccept = Math.random() < 0.7;
        o.status = willAccept ? 'accepted' : 'rejected';
        if (willAccept) mergeGroups(o, from, to, 'takeover');
        else newNews(`${to.name} je odbila ponudu ${from.name}`, 'merge');
      }
    }
  }

  for (const p of bots) {
    p.lastActiveAt = t;
    if (!canAct()) continue;
    const r = game.round;
    if (r === 1) {
      p.taps = Math.min(TAP_MAX, p.taps + p.tapRate * ((dtMs || 200) / 1000));
      continue;
    }
    if (p.botRound !== r) { p.botRound = r; p.botAt = t + rint(1200, 5000); }
    if (r === 4) {
      if (t < p.botMergeAt) continue;
      p.botMergeAt = t + rint(6000, 14000);
      const groups = groupList();
      const mine = groups.find(g => g.id === p.groupId);
      if (!mine || mine.leader.id !== p.id || groups.length < 2) continue;
      if (game.offers.some(o => o.status === 'pending' && o.fromGroupId === mine.id)) continue;
      const targets = groups.filter(g => g.id !== mine.id);
      const target = pick(targets);
      if (!target) continue;
      const res = createOffer(p, Math.random() < 0.3 ? null : target.id, true);
      if (!res.ok) { /* cooldown ili ponuda već postoji */ }
      continue;
    }
    if (t < p.botAt) continue;
    p.botAt = t + 1e9;
    if (r === 2) p.price = randPrice();
    else if (r === 3) {
      const key = botPickInvest(p);
      if (key) chooseInvest(p, key);
    } else if (r === 5) {
      const opts = (game.voteCandidates || []).filter(c => c.groupId !== p.groupId);
      if (opts.length) castVote(p, pick(opts).groupId);
    }
  }
}

/* ------------------------------ STANJE ZA KLIJENTE ------------------------ */
function baseGroupsState() {
  const groups = groupList();
  return groups;
}

function commonState(canAdmin) {
  maybeLiveTapCustomers();
  const groups = baseGroupsState();
  const players = [...game.players.values()];
  const round = game.round;
  const info = ROUNDS[round] || null;
  let progress = null;
  if (game.phase === 'round') {
    if (round === 1) progress = { label: 'Tapkalo', acted: players.filter(p => p.taps > 0).length, total: players.length };
    else if (round === 2) progress = { label: 'Odabralo cijenu', acted: players.filter(p => !!p.price).length, total: players.length };
    else if (round === 3) progress = { label: 'Odabralo ulaganje', acted: players.filter(p => !!p.invest).length, total: players.length };
    else if (round === 4) progress = { label: 'Spajanja', acted: game.roundEvents.filter(e => e.type === 'merge').length, total: null };
    else if (round === 5) progress = { label: 'Glasalo', acted: game.votes.size, total: players.length };
  }
  const endsAt = game.paused ? 0 : game.endsAt;
  const timerLeft = game.paused
    ? Math.max(0, game.endsAt - game.pausedAt)
    : (game.endsAt ? Math.max(0, game.endsAt - now()) : 0);
  return {
    serverNow: now(),
    phase: game.phase,
    round,
    paused: game.paused,
    endsAt,
    timerLeft,
    phaseDuration: game.phase === 'round' && round === 1 && ROUNDS[1] ? ROUNDS[1].dur * 1000 : 0,
    manual: !(game.phase === 'round' && round === 1),
    roundInfo: info ? { n: info.n, key: info.key, title: info.title, sub: info.sub, dur: info.dur } : null,
    canAdmin: !!canAdmin,
    joinUrl: lanUrl(),
    progress,
    meta: META,
    players: players.map(p => ({
      id: p.id, name: p.name, color: p.color, capital: p.capital,
      customers: p.customers, score: score(p), groupId: p.groupId,
      taps: Math.floor(p.taps), price: p.price, invest: p.invest,
      investSuccess: p.investSuccess, online: p.connections > 0,
    })),
    groups: groups.map(g => ({
      id: g.id, name: g.name, color: g.color, leaderId: g.leader.id,
      leaderName: g.leader.name, members: g.memberCount, memberIds: g.memberIds,
      customers: g.customers, capital: g.capital, score: g.score, share: g.share,
    })),
    leaderboard: groups.slice(0, 12).map((g, i) => ({
      place: i + 1, id: g.id, name: g.name, color: g.color,
      score: g.score, capital: g.capital, customers: g.customers,
      share: g.share, members: g.memberCount,
    })),
    hhi: computeHhi(),
    hhiZone: hhiZone(computeHhi()),
    hhiHistory: game.hhiHistory,
    news: game.news.slice(-12),
    results: game.results,
    final: game.final,
    voteCandidates: game.voteCandidates.map(c => ({
      groupId: c.groupId, name: c.name, color: c.color,
      members: c.members, share: c.share, customers: c.customers, score: c.score,
    })),
    offers: game.offers.filter(o => o.status === 'pending').map(publicOffer),
    votesCast: game.votes.size,
    totals: { players: players.length, groups: groups.length, customers: totalCustomers() },
    roundEvents: game.roundEvents.slice(-8),
  };
}

function playerState(p, canAdmin) {
  const base = commonState(canAdmin);
  const groups = baseGroupsState();
  const mine = groups.find(g => g.id === p.groupId);
  const sortedGroups = [...groups].sort((a, b) => b.score - a.score);
  const groupRank = sortedGroups.findIndex(g => g.id === p.groupId) + 1;
  const firms = [...game.players.values()].sort((a, b) => score(b) - score(a));
  const rank = firms.findIndex(x => x.id === p.id) + 1;
  const incoming = game.offers
    .filter(o => o.status === 'pending' && (o.open ? o.fromGroupId !== p.groupId : o.toGroupId === p.groupId))
    .map(o => ({
      ...publicOffer(o),
      canRespond: !!mine && mine.leader.id === p.id && (o.open ? o.fromGroupId !== mine.id : true),
      isMine: o.fromGroupId === p.groupId,
      msLeft: Math.max(0, o.expiresAt - now()),
    }));
  const outgoing = game.offers.find(o => o.status === 'pending' && o.fromGroupId === p.groupId);
  return {
    ...base,
    me: {
      id: p.id, name: p.name, color: p.color, capital: p.capital,
      customers: p.customers, score: score(p), rank, groupRank,
      share: p.customers / TOTAL_CUSTOMERS,
      taps: Math.floor(p.taps),
      price: p.price, invest: p.invest, investSuccess: p.investSuccess,
      investPaid: p.investPaid,
      groupId: p.groupId,
      groupName: mine ? mine.name : p.name,
      group: mine ? {
        id: mine.id, name: mine.name, color: mine.color, members: mine.memberCount,
        customers: mine.customers, capital: mine.capital, score: mine.score,
        share: mine.share, leaderId: mine.leader.id, leaderName: mine.leader.name,
        isLeader: p.id === mine.leader.id,
        memberNames: mine.members.map(m => m.name),
      } : null,
      vote: p.vote,
      cooldownMs: Math.max(0, (p.offerReadyAt || 0) - now()),
      canOffer: game.phase === 'round' && game.round === 4 && !!mine && mine.leader.id === p.id && now() >= (p.offerReadyAt || 0),
      incoming,
      outgoing: outgoing ? publicOffer(outgoing) : null,
      prevCapital: p.prevCapital,
      prevCustomers: p.prevCustomers,
      lastRevenue: p.lastRevenue,
    },
  };
}

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
      if (!p) { clients.delete(c); continue; }
      if (p.connections > 0) p.lastActiveAt = t;
      sseSend(c, playerState(p, c.canAdmin));
    }
  }
}

/* ------------------------------- RUTE ------------------------------------- */
async function handleApi(req, res, url) {
  const pathname = url.pathname;
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
    const r = doJoin(body.name);
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

/* ------------------------------ ADMIN AKCIJE ------------------------------ */
function doAdmin(body) {
  const action = body && body.action;
  if (action === 'start') {
    if (game.phase !== 'lobby') return { status: 409, body: { error: 'Igra je već počela.' } };
    if (game.players.size < 1) return { status: 409, body: { error: 'Nema igrača.' } };
    game.startedAt = now();
    startRound(1);
  } else if (action === 'next') {
    if (game.phase === 'round') finishRound();
    else if (game.phase === 'results') advance();
  } else if (action === 'pause') {
    if (!game.paused && (game.phase === 'round' || game.phase === 'results') && game.endsAt) {
      game.paused = true;
      game.pausedAt = now();
    }
  } else if (action === 'resume') {
    if (game.paused) {
      const delta = now() - game.pausedAt;
      game.endsAt += delta;
      game.paused = false;
    }
  } else if (action === 'bots') {
    if (game.phase !== 'lobby') return { status: 409, body: { error: 'Botovi se dodaju u lobiju.' } };
    const count = clamp(Number(body.count) || 8, 1, 40);
    for (let i = 0; i < count; i++) {
      if (game.players.size >= MAX_PLAYERS) break;
      const p = addPlayer(null, true);
      p.botMergeAt = 0;
      newNews(`Demo firma: ${p.name}`, 'join');
    }
  } else if (action === 'reset') {
    resetGame(!!body.clear);
  } else if (action === 'end') {
    if (game.phase === 'round' || game.phase === 'results') finalize();
  } else {
    return { status: 400, body: { error: 'Nepoznata admin akcija.' } };
  }
  return { status: 200, body: { ok: true, phase: game.phase, round: game.round } };
}

/* --------------------------------- JOIN ----------------------------------- */
function doJoin(rawName) {
  if (game.phase !== 'lobby') return { status: 409, body: { error: 'Igra je već počela. Sačekaj novu rundu.' } };
  if (game.players.size >= MAX_PLAYERS) return { status: 409, body: { error: 'Sala je puna (60 firmi).' } };
  const name = String(rawName || '').trim().slice(0, 24);
  const finalName = name ? uniqueName(name) : null;
  const p = addPlayer(finalName, false);
  p.lastActiveAt = now();
  game.groupLeaders.set(p.groupId, p.id);
  console.log(`[join] ${p.name} (${game.players.size} firmi)`);
  newNews(`Nova firma na tržištu: ${p.name}`, 'join');
  return { status: 200, body: { id: p.id, token: p.token, name: p.name, color: p.color } };
}

/* --------------------- SERVERLESS: SERIJALIZACIJA STANJA ------------------ */
function exportState() {
  const g = game;
  return {
    v: 1,
    phase: g.phase, round: g.round, endsAt: g.endsAt, paused: g.paused, pausedAt: g.pausedAt,
    players: [...g.players.values()],
    groupLeaders: [...g.groupLeaders.entries()],
    news: g.news, newsSeq: g.newsSeq,
    offers: g.offers, offerSeq: g.offerSeq,
    votes: [...g.votes.entries()],
    voteCandidates: g.voteCandidates, results: g.results,
    hhiHistory: g.hhiHistory, roundEvents: g.roundEvents, final: g.final,
    joinCounter: g.joinCounter, seq: g.seq, startedAt: g.startedAt, lastTickAt: g.lastTickAt,
  };
}

function importState(s) {
  if (!s || typeof s !== 'object') return false;
  const g = game;
  g.phase = s.phase || 'lobby';
  g.round = s.round || 0;
  g.endsAt = s.endsAt || 0;
  g.paused = !!s.paused;
  g.pausedAt = s.pausedAt || 0;
  g.players = new Map((s.players || []).map(p => [p.id, p]));
  g.groupLeaders = new Map(s.groupLeaders || []);
  g.news = s.news || [];
  g.newsSeq = s.newsSeq || 0;
  g.offers = s.offers || [];
  g.offerSeq = s.offerSeq || 0;
  g.votes = new Map(s.votes || []);
  g.voteCandidates = s.voteCandidates || [];
  g.results = s.results || null;
  g.hhiHistory = s.hhiHistory || [];
  g.roundEvents = s.roundEvents || [];
  g.final = s.final || null;
  g.joinCounter = s.joinCounter || 0;
  g.seq = s.seq || 0;
  g.startedAt = s.startedAt || 0;
  g.lastTickAt = s.lastTickAt || 0;
  return true;
}

/* Lijeni "tik": zamjena za setInterval petlju lokalnog servera. */
function serverlessTick(t) {
  const ts = t || now();
  const dt = Math.max(0, ts - (game.lastTickAt || ts));
  game.lastTickAt = ts;
  if (game.paused) return;
  if (game.phase === 'round') {
    let left = Math.min(dt, 5000);
    while (left > 0 && game.phase === 'round') {
      runBots(ts, Math.min(200, left));
      left -= 200;
    }
    expireOffers();
  }
  for (let i = 0; i < 3; i++) {
    if (game.phase === 'round' && game.endsAt && ts >= game.endsAt) finishRound();
    else if (game.phase === 'results' && game.endsAt && ts >= game.endsAt) advance();
    else break;
  }
}

/* ------------------------------- RESET ------------------------------------ */
function resetGame(clearPlayers) {
  if (clearPlayers) {
    game.players.clear();
    game.seq = 0;
    game.joinCounter = 0;
    game.offerSeq = 0;
    game.newsSeq = 0;
  }
  game.phase = 'lobby';
  game.round = 0;
  game.endsAt = 0;
  game.paused = false;
  game.pausedAt = 0;
  game.results = null;
  game.hhiHistory = [];
  game.news = [];
  game.offers = [];
  game.votes.clear();
  game.voteCandidates = [];
  game.roundEvents = [];
  game.final = null;
  game.startedAt = 0;
  game.groupLeaders.clear();
  for (const p of game.players.values()) {
    p.capital = START_CAPITAL;
    p.customers = 0;
    p.taps = 0;
    p.price = null;
    p.invest = null;
    p.investPaid = 0;
    p.investSuccess = null;
    p.vote = null;
    p.groupId = 'g' + p.id;
    p.snapshot = null;
    p.prevCapital = START_CAPITAL;
    p.prevCustomers = 0;
    p.lastRevenue = 0;
    p.offerReadyAt = 0;
    p.botRound = 0;
    p.botAt = 0;
    p.botMergeAt = 0;
    game.groupLeaders.set(p.groupId, p.id);
  }
  newNews('Nova igra — firme se osnivaju iznova.', 'round');
  console.log('[reset] nova igra');
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
    if (game.phase === 'round' && game.endsAt && t >= game.endsAt) {
      finishRound();
    } else if (game.phase === 'results' && game.endsAt && t >= game.endsAt) {
      advance();
    }
    expireOffers();
    runBots(t);
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

/* ------------------------------- EXPORT ZA VERCEL -------------------------- */
module.exports = {
  game,
  commonState,
  playerState,
  handleAction,
  doAdmin,
  doJoin,
  resetGame,
  exportState,
  importState,
  serverlessTick,
  setJoinHost,
  findPlayerByToken,
  addPlayer,
  newNews,
  lanUrl,
  adminAllowed,
  checkAdminPin,
  adminAllowedHosted: adminAllowed,
  HOSTED,
  SERVERLESS,
  ADMIN_PIN,
};
