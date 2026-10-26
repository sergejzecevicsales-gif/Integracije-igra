'use strict';
/* End-to-end test bez browsera: 12 botova + 2 "telefona", sve 5 rundi.
   Pokretanje:  node tools/test-flow.js  (server mora raditi na PORTU, default 3000) */

const PORT = process.env.PORT || 4000;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let failures = 0;
function check(cond, label, extra) {
  if (cond) console.log('  âœ” ' + label);
  else { failures++; console.log('  âœ˜ ' + label + (extra ? '  â†’ ' + JSON.stringify(extra) : '')); }
}

async function api(pathname, body, method) {
  const res = await fetch(BASE + pathname, {
    method: method || (body ? 'POST' : 'GET'),
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
  return { status: res.status, json };
}

const admin = (action, extra) => api('/api/admin', Object.assign({ action }, extra || {}));
const state = async () => (await api('/api/state')).json;
const playerState = async token => (await api('/api/state?token=' + token)).json;
const act = (token, payload) => api('/api/act', { token, ...payload });

async function waitFor(fn, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const st = await state();
    if (fn(st)) return st;
    await sleep(150);
  }
  throw new Error('timeout: ' + label);
}

(async () => {
  console.log('\n=== TRÅ½IÅ TE UÅ½IVO â€” E2E test ===\n');

  // 0) server Å¾iv?
  const info = await api('/api/info');
  check(info.status === 200 && info.json.joinUrl, 'server odgovara, joinUrl = ' + (info.json.joinUrl || '?'));

  // 1) svjeÅ¾ poÄetak
  await admin('reset', { clear: true });
  let st = await state();
  check(st.phase === 'lobby', 'na startu je lobi');

  // 2) botovi
  let r = await admin('bots');
  check(r.status === 200, 'dodavanje botova');
  await admin('bots');
  st = await state();
  check(st.players.length === 16, 'dodato 16 botova', st.players.length);

  // 3) dva "telefona"
  const a = (await api('/api/join', { name: 'Test Jedan' })).json;
  const b = (await api('/api/join', { name: 'Test Dva' })).json;
  const c = (await api('/api/join', { name: 'Test Tri' })).json;
  check(a.token && b.token && c.token, 'igraÄi se mogu prijaviti');
  check(a.name === 'Test Jedan', 'ime firme = uneseno ime', a.name);

  // 4) SSE radi
  const controller = new AbortController();
  const sse = await fetch(BASE + '/api/events?token=' + a.token, { signal: controller.signal });
  check(sse.status === 200 && (sse.headers.get('content-type') || '').includes('text/event-stream'), 'SSE stream za igraÄa');
  const reader = sse.body.getReader();
  const first = await reader.read();
  const chunk = new TextDecoder().decode(first.value || new Uint8Array());
  check(chunk.includes('"me"'), 'SSE Å¡alje stanje igraÄa');
  controller.abort();

  // 5) ne moÅ¾e akcija van runde
  const early = await act(a.token, { type: 'price', value: 'low' });
  check(early.json.ok === false, 'akcija van runde se odbija');

  // 6) start
  await admin('start');
  st = await waitFor(s => s.phase === 'round' && s.round === 1, 4000, 'runda 1');
  check(st.roundInfo.key === 'tap', 'runda 1 = tapkanje');

  // rundu 1: tapkamo (poÅ¡tujuÄ‡i server limit ~25 tapkanja/s)
  for (let i = 0; i < 10; i++) { await act(a.token, { type: 'tap', n: 6 }); await sleep(120); }
  st = await playerState(a.token);
  check(st.me.taps >= 30, 'tapkanje se registruje', st.me.taps);
  check(st.totals.customers === 10000, 'kupci se dijele tokom runde 1', st.totals.customers);
  check(st.me.customers > 0, 'igraÄ dobija kupce', st.me.customers);

  // prekid runde 1
  await admin('next');
  st = await waitFor(s => s.phase === 'results' && s.round === 1, 4000, 'rezultati 1');
  check(st.results && st.results.lines.length > 0, 'rezultati runde 1 postoje');
  check(st.totals.customers === 10000, 'poslije runde 1 ukupno 10.000 kupaca', st.totals.customers);
  check(st.hhiHistory.length === 1, 'HHI istorija ima 1 zapis');
  check(st.hhi < 1000, 'HHI na startu je u zelenom', st.hhi);

  // 7) runda 2 â€” cijene
  await admin('next');
  st = await waitFor(s => s.phase === 'round' && s.round === 2, 4000, 'runda 2');
  r = await act(a.token, { type: 'price', value: 'low' });
  check(r.json.ok, 'izbor niske cijene');
  await act(b.token, { type: 'price', value: 'high' });
  check((await playerState(a.token)).me.price === 'low', 'cijena saÄuvana');
  const capitalBefore = (await playerState(a.token)).me.capital;
  await admin('next');
  st = await waitFor(s => s.phase === 'results' && s.round === 2, 4000, 'rezultati 2');
  check(st.results.lines.some(l => l.includes('Niska')), 'rezultati prikazuju izbore cijena');
  check((await playerState(a.token)).me.capital !== capitalBefore, 'kapital se promijenio poslije cjenovnog rata');
  check(st.hhiHistory.length === 2, 'HHI istorija ima 2 zapisa');

  // 8) runda 3 â€” investicije
  await admin('next');
  st = await waitFor(s => s.phase === 'round' && s.round === 3, 4000, 'runda 3');
  const capBeforeInvest = (await playerState(a.token)).me.capital;
  r = await act(a.token, { type: 'invest', value: 'innov' });
  check(r.json.ok, 'investicija prihvaÄ‡ena');
  const cheap = await act(b.token, { type: 'invest', value: 'save' });
  check(cheap.json.ok, 'Å¡tednja prihvaÄ‡ena');
  const meNow = (await playerState(a.token)).me;
  check(Math.abs(meNow.capital - (capBeforeInvest - 20)) < 0.2, 'troÅ¡ak inovacije je skinut (-20)', [capBeforeInvest, meNow.capital]);
  await admin('next');
  st = await waitFor(s => s.phase === 'results' && s.round === 3, 4000, 'rezultati 3');
  check(st.results.reveal && st.results.reveal.length >= 1, 'otkrivene inovacije');
  check(st.hhiHistory.length === 3, 'HHI istorija ima 3 zapisa');

  // 9) runda 4 â€” spajanja
  await admin('next');
  st = await waitFor(s => s.phase === 'round' && s.round === 4, 4000, 'runda 4');
  st = await state();
  const bMe = await playerState(b.token);
  const bGroup = st.groups.find(g => g.id === bMe.me.groupId);
  r = await act(a.token, { type: 'offer', value: bGroup.id });
  check(r.json.ok, 'ponuda za spajanje poslata', r.json);
  const firstOffer = r.json.offer && r.json.offer.id;
  r = await act(b.token, { type: 'respond', offerId: firstOffer, accept: false });
  check(r.json.ok && r.json.accepted === false, 'ponuda se moÅ¾e odbiti');
  r = await act(b.token, { type: 'offer', value: (await playerState(a.token)).me.groupId });
  check(r.json.ok, 'druga strana Å¡alje svoju ponudu');
  r = await act(a.token, { type: 'respond', offerId: r.json.offer.id, accept: true });
  check(r.json.ok && r.json.accepted === true, 'ponuda se prihvata');
  st = await state();
  const mergedGroup = st.groups.find(g => g.memberIds.includes(a.id) && g.memberIds.includes(b.id));
  check(mergedGroup && mergedGroup.members === 2, 'dvije firme su sada jedna grupa', mergedGroup && mergedGroup.members);

  // javni poziv na spajanje: C poziva sve, B kao lider prihvata
  r = await act(c.token, { type: 'offer', value: '__open__' });
  check(r.json.ok, 'javni poziv na spajanje poslat', r.json);
  const openOffer = r.json.offer;
  st = await state();
  check(st.offers.some(o => o.open), 'javni poziv je vidljiv na trÅ¾iÅ¡tu');
  const bMeNow = (await playerState(b.token)).me;
  check(bMeNow.group && bMeNow.group.isLeader, 'B je lider svoje grupe');
  r = await act(b.token, { type: 'respond', offerId: openOffer && openOffer.id, accept: true });
  check(r.json.ok && r.json.accepted === true, 'javni poziv se prihvata', r.json);
  st = await state();
  const trio = st.groups.find(g => g.memberIds.includes(a.id) && g.memberIds.includes(b.id) && g.memberIds.includes(c.id));
  check(trio && trio.members === 3, 'tri firme u jednoj grupi preko javnog poziva', trio && trio.members);

  const before4 = st.hhi;
  const t4 = Date.now();
  while (Date.now() - t4 < 22000) {
    st = await state();
    if (st.groups.length <= st.players.length - 4) break;
    await sleep(250);
  }
  check(st.groups.length <= st.players.length - 4, 'botovi su se spajali tokom runde 4', { groups: st.groups.length, players: st.players.length });
  await admin('next');
  st = await waitFor(s => s.phase === 'results' && s.round === 4, 6000, 'rezultati 4');
  check(st.results.lines.some(l => l.includes('Spajanja')), 'rezultati spajanja');
  check(st.hhiHistory.length === 4, 'HHI istorija ima 4 zapisa');
  check(st.hhi > before4, 'HHI je porastao poslije spajanja', [before4, st.hhi]);

  // 10) runda 5 â€” glasanje
  await admin('next');
  st = await waitFor(s => s.phase === 'round' && s.round === 5, 4000, 'runda 5');
  check(st.voteCandidates.length >= 2 && st.voteCandidates.length <= 4, 'kandidati za zabranu (2-4)', st.voteCandidates.length);
  const meVote = await playerState(a.token);
  const myCand = st.voteCandidates.find(c => c.groupId === meVote.me.groupId);
  const ownVote = myCand ? await act(a.token, { type: 'vote', value: myCand.groupId }) : { json: { ok: false } };
  check(ownVote.json.ok === false, 'ne moÅ¾e se glasati za svoju grupu');
  const other = st.voteCandidates.find(c => c.groupId !== meVote.me.groupId);
  if (other) {
    r = await act(a.token, { type: 'vote', value: other.groupId });
    check(r.json.ok, 'glas prihvaÄ‡en');
  }
  await admin('next');
  st = await waitFor(s => s.phase === 'results' && s.round === 5, 5000, 'rezultati 5');
  check(st.results.lines.some(l => l.includes('Glasalo')), 'rezultati glasanja');
  check(st.hhiHistory.length === 5, 'HHI istorija ima 5 zapisa');

  // 11) finale
  await admin('next');
  st = await waitFor(s => s.phase === 'final', 4000, 'finale');
  check(st.final && st.final.winner, 'postoji pobjednik', st.final && st.final.winner);
  check(st.final.ranking.length > 0, 'rang lista na kraju');
  check(st.final.hhiHistory.length === 5, 'grafikon ima 5 taÄaka');
  check(st.final.maxHhi >= st.hhiHistory[0].hhi, 'maksimalni HHI >= poÄetni');
  check(st.totals.customers === 10000, 'na kraju ukupno 10.000 kupaca', st.totals.customers);
  const bad = st.players.filter(p => !isFinite(p.capital) || !isFinite(p.customers) || p.capital < 0);
  check(bad.length === 0, 'nema negativnih/NaN vrijednosti', bad.slice(0, 3));

  console.log('\n--- HHI kroz igru ---');
  for (const h of st.hhiHistory) console.log(`  ${h.label}: HHI ${h.hhi} (${h.groups} grupa)`);
  console.log('\n--- Pobjednik ---');
  console.log('  ' + (st.final.winner ? `${st.final.winner.name}: ${st.final.winner.capital} mil + ${st.final.winner.customers} kupaca` : 'â€”'));
  console.log('\n--- Rang lista (top 5) ---');
  for (const row of st.final.ranking.slice(0, 5)) {
    console.log(`  ${row.place}. ${row.name} â€” ${row.score.toFixed(1)} mil (kapital ${row.capital.toFixed(1)} + kupci ${row.customers})`);
  }

  // 12) reset
  await admin('reset');
  st = await state();
  check(st.phase === 'lobby' && st.players.length >= 18, 'reset vraÄ‡a u lobi i zadrÅ¾ava firme', [st.phase, st.players.length]);

  console.log(`\n=== ${failures === 0 ? 'SVI TESTOVI PROÅ LI âœ”' : failures + ' TEST(OVA) PALO âœ˜'} ===\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => {
  console.error('\nTEST PAO:', e);
  process.exit(1);
});


