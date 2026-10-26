'use strict';
/* ===================== TRŽIŠTE UŽIVO — TELEFON (IGRAČ) ===================== */

const $ = id => document.getElementById(id);
const QS = new URLSearchParams(location.search);

let token = QS.get('token') || localStorage.getItem('tzu_token') || null;
if (QS.get('token')) localStorage.setItem('tzu_token', QS.get('token'));

let S = null;
let offset = 0;
let stream = null;
let stageKey = '';
let stageRoot = null;
let stageUpdate = null;
let displayTaps = 0;
let lastRoundSeen = -1;
let toastTimer = null;
let tapFlushFn = null;

/* --------------------------------- START --------------------------------- */
boot();

async function boot() {
  if (!token) { showJoin(); return; }
  if (SNAP) { showApp(); connect(); return; }
  $('splash').classList.remove('hidden');
  const res = await api('/api/state?token=' + encodeURIComponent(token));
  if (!res.ok) {
    token = null;
    localStorage.removeItem('tzu_token');
    $('splash').classList.add('hidden');
    showJoin();
    return;
  }
  showApp();
  connect();
  $('splash').classList.add('hidden');
}

function showJoin(msg) {
  $('joinScreen').classList.remove('hidden');
  $('app').classList.add('hidden');
  if (msg) {
    const st = $('joinStatus');
    st.textContent = msg;
    st.classList.remove('ok');
  }
}

function showApp() {
  $('joinScreen').classList.add('hidden');
  $('app').classList.remove('hidden');
}

function connect() {
  if (stream) return;
  stream = startStream(
    '/api/events?token=' + encodeURIComponent(token),
    st => { S = st; offset = st.serverNow - Date.now(); onState(); },
    status => {
      const c = $('connDot');
      c.classList.toggle('offline', status !== 'online');
      c.title = status === 'online' ? 'veza radi' : 'veza prekinuta';
    }
  );
}

/* --------------------------------- PRIJAVA -------------------------------- */
$('joinForm').addEventListener('submit', async e => {
  e.preventDefault();
  const input = $('nameInput');
  const btn = $('joinBtn');
  const status = $('joinStatus');
  const name = input.value.trim();
  btn.disabled = true;
  btn.textContent = 'OSNIVAM…';
  status.textContent = '';
  const res = await api('/api/join', { name });
  btn.disabled = false;
  btn.textContent = 'OSNUJ FIRMU';
  if (!res.ok) {
    status.textContent = (res.data && res.data.error) || 'Ne mogu da se prijavim. Pokušaj ponovo.';
    status.classList.remove('ok');
    return;
  }
  token = res.data.token;
  localStorage.setItem('tzu_token', token);
  status.textContent = 'Firma ' + res.data.name + ' je osnovana!';
  status.classList.add('ok');
  showApp();
  $('splash').classList.remove('hidden');
  setTimeout(() => {
    connect();
    $('splash').classList.add('hidden');
  }, 250);
});

/* ------------------------------- STANJE ----------------------------------- */
function onState() {
  if (!S) return;
  if (S.round !== lastRoundSeen) {
    lastRoundSeen = S.round;
    displayTaps = 0;
  }
  render();
}

function render() {
  updateHeader();
  updateStats();
  renderStage();
}

function updateHeader() {
  const me = S.me;
  $('myDot').style.background = '#f4f4f4';
  $('myName').textContent = me.group && me.group.members > 1 ? me.group.name : me.name;
  const badge = $('leaderBadge');
  const isLeader = me.group && me.group.isLeader && me.group.members > 1;
  badge.classList.toggle('hidden', !isLeader);
  $('roundChip').textContent = S.phase === 'lobby' ? 'LOBI'
    : S.phase === 'round' ? 'RUNDA ' + S.round + '/5'
      : S.phase === 'results' ? 'REZULTATI' : 'KRAJ';
  $('hint').textContent = hintText();
}

function hintText() {
  const me = S.me;
  if (S.paused) return 'Profesor je pauzirao igru.';
  if (S.phase === 'lobby') return 'Sačekaj da profesor pokrene igru.';
  if (S.phase === 'results') return 'Pogledaj rezultate na projektoru.';
  if (S.phase === 'final') return 'Kraj igre — hvala na učešću!';
  if (S.round === 1) return 'Tapkanje se šalje automatski.';
  if (S.round === 2) return 'Kada svi odaberu, profesor zatvara rundu.';
  if (S.round === 3) return 'Kada svi ulože, profesor zatvara rundu.';
  if (S.round === 4) return me.group && me.group.isLeader ? 'Ti si lider — ti odgovaraš na ponude.' : 'Samo lider grupe šalje i prihvata ponude.';
  if (S.round === 5) return 'Kada svi glasaju, profesor zatvara rundu.';
  return '';
}

function updateStats() {
  const me = S.me;
  const inGroup = me.group && me.group.members > 1;
  const rank = (inGroup && me.groupRank) ? me.groupRank : me.rank;
  $('statCapital').textContent = fmt1(me.capital);
  $('statCustomers').textContent = fmt0(me.customers);
  $('statValue').textContent = fmt1(inGroup ? me.group.score : me.score);
  $('statRank').textContent = rank ? '#' + rank : '—';
}

/* -------------------------------- STAGE ----------------------------------- */
function stageKeyOf() {
  if (S.phase === 'lobby') return 'lobby';
  if (S.phase === 'results') return 'results:' + S.round;
  if (S.phase === 'final') return 'final';
  return 'r' + S.round;
}

function renderStage() {
  const key = stageKeyOf();
  if (key !== stageKey) {
    stageKey = key;
    tapFlushFn = null;
    const built = buildStage(key);
    stageRoot = built.root;
    stageUpdate = built.update;
    $('stage').innerHTML = '';
    $('stage').append(stageRoot);
    $('stage').scrollTop = 0;
  }
  if (stageUpdate) stageUpdate(S);
}

function buildStage(key) {
  if (key === 'lobby') return buildLobby();
  if (key === 'r1') return buildTap();
  if (key === 'r2') return buildPrice();
  if (key === 'r3') return buildInvest();
  if (key === 'r4') return buildMerge();
  if (key === 'r5') return buildVote();
  if (key.startsWith('results:')) return buildResults();
  return buildFinal();
}

/* --------------------------------- LOBI ----------------------------------- */
function buildLobby() {
  const root = h('div', { class: 'lobby-wait' },
    h('div', { class: 'lobby-mark' }),
    h('h2', {}, 'Firma je osnovana'),
    h('div', { class: 'firm-name-big', id: 'lobbyFirm' }, S.me.name),
    h('p', {}, 'Dobio si 50 miliona KM kapitala. Na tržištu je 10.000 kupaca i svi se bore za njih. Igra ima 5 rundi.'),
    h('div', { class: 'live-count', id: 'lobbyCount' }, ''),
    h('div', { class: 'note' }, 'Kada se svi prijave, profesor pokreće igru.')
  );
  const update = st => {
    $('lobbyFirm').textContent = st.me.name;
    const n = st.totals.players;
    $('lobbyCount').innerHTML = '<b>' + fmt0(n) + '</b> ' + (n === 1 ? 'firma u sali' : 'firmi u sali');
  };
  return { root, update };
}

/* -------------------------------- RUNDA 1 --------------------------------- */
function buildTap() {
  const numEl = h('span', { class: 'tap-num', id: 'tapNum' }, '0');
  const shareEl = h('b', { id: 'tapShare' }, '0%');
  const custEl = h('b', { id: 'tapCust' }, '0');
  const btn = h('button', { class: 'tap-btn', id: 'tapBtn', type: 'button', 'aria-label': 'Tapni' },
    numEl, h('span', { class: 'tap-label' }, 'tapkanja'));
  const root = h('div', { class: 'tap-zone' },
    h('div', { class: 'round-head' },
      h('h2', {}, 'Borba za kupce'),
      h('p', {}, 'Tapkanjem osvajaš dio tržišta od 10.000 kupaca. Ko brže tapka — više kupaca.')
    ),
    btn,
    h('div', { class: 'tap-share' }, 'Tvoj udio: ', shareEl, ' · kupci: ', custEl),
    h('div', { class: 'tap-sub' }, 'Ne moraš ništa da potvrđuješ — tapkanje ide odmah.')
  );

  let pending = 0;
  let flushing = false;
  let lastSend = 0;

  const flush = async () => {
    if (!pending || flushing) return;
    if (isPolling() && Date.now() - lastSend < 450) return;
    lastSend = Date.now();
    const n = Math.min(30, pending);
    pending -= n;
    flushing = true;
    await act({ type: 'tap', n });
    flushing = false;
    if (pending > 0) setTimeout(flush, 60);
  };

  const onTap = ev => {
    if (ev) ev.preventDefault();
    if (!S || S.phase !== 'round' || S.round !== 1 || S.paused) return;
    displayTaps++;
    pending++;
    numEl.textContent = fmt0(displayTaps);
    vibrate(8);
    btn.classList.remove('pulse');
    void btn.offsetWidth;
    btn.classList.add('pulse');
    flush();
  };

  btn.addEventListener('pointerdown', onTap);
  btn.addEventListener('contextmenu', e => e.preventDefault());
  tapFlushFn = () => { if (pending > 0) flush(); };

  const update = st => {
    const me = st.me;
    displayTaps = Math.max(displayTaps, me.taps);
    numEl.textContent = fmt0(displayTaps);
    shareEl.textContent = pct(me.share);
    custEl.textContent = fmt0(me.customers);
    btn.style.opacity = st.paused ? .5 : 1;
  };
  return { root, update };
}

/* -------------------------------- RUNDA 2 --------------------------------- */
function buildPrice() {
  const list = h('div', { class: 'choice-list' });
  const cards = new Map();
  const prices = S.meta.prices;
  for (const p of prices) {
    const revK = p.revenue * 1000000;
    const attract = Math.round((p.weight - 1) * 100);
    const tags = [];
    tags.push(h('span', { class: 'pill' }, fmt0(revK) + ' KM / kupcu'));
    if (attract > 0) tags.push(h('span', { class: 'pill good' }, '+' + attract + '% privlačnost'));
    else if (attract < 0) tags.push(h('span', { class: 'pill bad' }, attract + '% privlačnost'));
    else tags.push(h('span', { class: 'pill' }, 'bez promjene udjela'));
    tags.push(h('span', { class: 'pill ' + (p.key === 'low' ? 'warn' : '') }, p.key === 'low' ? 'kradeš kupce' : p.key === 'high' ? 'gubiš kupce' : 'sigurna sredina'));
    const check = h('span', { class: 'choice-check hidden' }, '✓');
    const card = h('button', { class: 'choice-card', type: 'button', 'data-price': p.key },
      h('div', { class: 'choice-top' },
        h('span', { class: 'choice-sign' }, p.sign),
        h('span', { class: 'choice-name' }, p.label),
        check
      ),
      h('div', { class: 'choice-desc' }, p.desc),
      h('div', { class: 'choice-tags' }, tags)
    );
    card.addEventListener('click', () => {
      if (!S || S.paused) return;
      select(p.key);
      act({ type: 'price', value: p.key });
    });
    cards.set(p.key, { card, check });
    list.append(card);
  }
  const status = h('div', { class: 'note', id: 'priceStatus' }, 'Odaberi cijenu. Možeš je mijenjati do kraja runde.');
  const root = h('div', {},
    h('div', { class: 'round-head' },
      h('h2', {}, 'Cjenovni rat'),
      h('p', {}, 'Cijena određuje i tvoju zaradu i tvoje kupce. Šta biraš?')
    ),
    list,
    status
  );
  function select(key) {
    for (const [k, v] of cards) {
      v.card.classList.toggle('selected', k === key);
      v.check.classList.toggle('hidden', k !== key);
    }
  }
  const update = st => {
    select(st.me.price);
    $('priceStatus').textContent = st.me.price
      ? 'Tvoj izbor: ' + (prices.find(p => p.key === st.me.price) || {}).label + '. Možeš promijeniti do kraja runde.'
      : 'Odaberi cijenu. Možeš je mijenjati do kraja runde.';
    for (const [k, v] of cards) v.card.classList.toggle('disabled', !!st.paused);
  };
  return { root, update };
}

/* -------------------------------- RUNDA 3 --------------------------------- */
function buildInvest() {
  const list = h('div', { class: 'choice-list' });
  const cards = new Map();
  const invs = S.meta.investments;
  let optimisticKey = null;
  let optimisticUntil = 0;
  for (const inv of invs) {
    const tags = [];
    if (inv.key === 'ad') {
      tags.push(h('span', { class: 'pill good' }, '+30% kupaca'));
      tags.push(h('span', { class: 'pill' }, 'bez rizika'));
    } else if (inv.key === 'innov') {
      tags.push(h('span', { class: 'pill warn' }, '40% šansa'));
      tags.push(h('span', { class: 'pill bad' }, 'rizik gubitka uloženog'));
    } else {
      tags.push(h('span', { class: 'pill good' }, '+8 mil kapitala'));
      tags.push(h('span', { class: 'pill' }, 'bez rizika'));
    }
    const check = h('span', { class: 'choice-check hidden' }, '✓');
    const cost = inv.cost > 0 ? '−' + fmt1(inv.cost) + ' mil' : '+8 mil';
    const card = h('button', { class: 'choice-card', type: 'button' },
      h('div', { class: 'choice-top' },
        h('span', { class: 'choice-name' }, inv.label),
        check,
        h('span', { class: 'choice-cost' }, cost)
      ),
      h('div', { class: 'choice-desc' }, inv.desc),
      h('div', { class: 'choice-tags' }, tags)
    );
    card.addEventListener('click', () => {
      if (!S || S.paused) return;
      optimisticKey = inv.key;
      optimisticUntil = Date.now() + 2200;
      for (const [k, v] of cards) {
        v.card.classList.toggle('selected', k === inv.key);
        v.check.classList.toggle('hidden', k !== inv.key);
      }
      act({ type: 'invest', value: inv.key });
    });
    cards.set(inv.key, { card, check, inv });
    list.append(card);
  }
  const root = h('div', {},
    h('div', { class: 'round-head' },
      h('h2', {}, 'Investicije'),
      h('p', {}, 'Ulažeš svoj kapital. Reklama je sigurna, inovacija je rizična, štednja je dosadna ali pouzdana.')
    ),
    list,
    h('div', { class: 'note' }, 'Trošak se odbija odmah. Možeš promijeniti izbor dok je runda aktivna.')
  );
  const update = st => {
    if (optimisticKey && Date.now() > optimisticUntil) optimisticKey = null;
    const shown = optimisticKey || st.me.invest;
    for (const [k, v] of cards) {
      v.card.classList.toggle('selected', shown === k);
      v.check.classList.toggle('hidden', shown !== k);
      const tooExpensive = v.inv.cost > st.me.capital + 0.001;
      v.card.classList.toggle('disabled', tooExpensive || !!st.paused);
      v.card.title = tooExpensive ? 'Nemaš dovoljno kapitala' : '';
    }
  };
  return { root, update };
}

/* -------------------------------- RUNDA 4 --------------------------------- */
function buildMerge() {
  const root = h('div', {});
  let sig = '';
  let refs = {};

  function incText(o) {
    const sec = Math.max(0, Math.ceil(o.msLeft / 1000));
    return o.open
      ? 'Javni poziv · još ' + sec + ' s' + (o.joined ? ' · pridružilo se: ' + o.joined : '')
      : 'Ponuda ističe za ' + sec + ' s';
  }
  function outText(o, st) {
    const sec = Math.max(0, Math.ceil((o.expiresAt - st.serverNow) / 1000));
    return o.open
      ? 'Pridružilo se: ' + o.joined + ' firmi · ističe za ' + sec + ' s'
      : 'Čeka odgovor · ističe za ' + sec + ' s';
  }

  function structureChanged(st) {
    const me = st.me;
    const inc = (me.incoming || []).filter(o => !o.isMine);
    return [
      st.me.groupId, me.canOffer ? 1 : 0, me.group ? me.group.members : 1,
      st.groups.map(g => g.id + ':' + g.members).sort().join(','),
      inc.map(o => o.id + ':' + (o.canRespond ? 1 : 0)).join(','),
      me.outgoing ? me.outgoing.id + ':' + me.outgoing.joined : '',
    ].join('|');
  }

  function build(st) {
    root.innerHTML = '';
    const me = st.me;
    const g = me.group;
    const inc = (me.incoming || []).filter(o => !o.isMine);
    refs = {};
    const mp = S.meta.mergePower || 0.12;
    const cv = S.meta.customerValue || 0.15;
    const gainC = Math.round(me.customers * mp);
    const gainV = gainC * cv;
    const gainText = gainC > 0
      ? '+' + Math.round(mp * 100) + '% kupaca (≈ +' + fmt0(gainC) + ') · +' + fmt1(gainV) + ' mil KM'
      : 'spajanje donosi +' + Math.round(mp * 100) + '% kupaca';

    root.append(h('div', { class: 'round-head' },
      h('h2', {}, 'Spajanja'),
      h('p', {}, 'Pregovarajte, pa pošaljite ponudu. Svako spajanje grupi donosi +' + Math.round((S.meta.mergePower || 0.12) * 100) + '% kupaca od rivala — veći rast znači više kupaca.')
    ));

    // grupa
    root.append(h('div', { class: 'section-label' }, 'Tvoja grupa'));
    const gp = h('div', { class: 'group-panel' });
    if (g && g.members > 1) {
      gp.append(
        h('div', { class: 'gp-name' }, g.name),
        h('div', { class: 'gp-meta' }, g.members + ' firmi: ' + (g.memberNames || []).join(', ')),
        h('div', { class: 'gp-meta' }, 'Lider: ' + g.leaderName + (g.isLeader ? ' (ti)' : '') + ' · udio ' + pct(g.share) + ' · vrijednost ' + fmt1(g.score) + ' mil'),
        h('div', { class: 'gp-meta' }, 'Zajedno imate ' + fmt0(g.customers) + ' kupaca i ' + fmt1(g.capital) + ' mil kapitala.'),
        h('div', { class: 'gp-meta' }, 'Svako novo spajanje: ' + gainText + ' svakom članu.')
      );
    } else {
      gp.append(
        h('div', { class: 'gp-name' }, me.name),
        h('div', { class: 'gp-meta' }, 'Samostalna firma · ' + fmt0(me.customers) + ' kupaca · ' + fmt1(me.capital) + ' mil kapitala'),
        h('div', { class: 'gp-meta' }, 'Ako prihvatiš spajanje: ' + gainText + '. Zato se isplati biti u većoj grupi.')
      );
    }
    root.append(gp);

    // dolazne ponude
    if (inc.length) {
      root.append(h('div', { class: 'section-label' }, 'Ponude za tebe'));
      for (const o of inc) {
        const card = h('div', { class: 'offer-card' + (o.open ? ' open-offer' : '') });
        const metaEl = h('div', { class: 'offer-meta' }, incText(o));
        refs.offerMeta = refs.offerMeta || [];
        refs.offerMeta.push({ el: metaEl, id: o.id });
        card.append(
          h('div', { class: 'offer-title' }, o.open
            ? o.fromGroupName + ' poziva sve firme na spajanje'
            : o.fromGroupName + ' želi da se spoji s tobom'),
          metaEl
        );
        if (o.canRespond) {
          const afterValue = (o.fromGroupScore || 0) + me.score;
          const dv = afterValue - me.score;
          card.append(h('div', { class: 'note merge-gain' },
            'Nakon spajanja: kompanija ≈ ' + fmt1(afterValue) + ' mil (' +
            (dv >= 0 ? '+' : '') + fmt1(dv) + ' mil) · +' + fmt0(gainC) + ' kupaca'));
          const acts = h('div', { class: 'offer-actions' });
          const acc = h('button', { class: 'btn btn-accept', type: 'button' }, 'PRIHVATI');
          const rej = h('button', { class: 'btn btn-reject', type: 'button' }, 'ODBIJ');
          acc.onclick = () => { acc.disabled = true; act({ type: 'respond', offerId: o.id, accept: true }); };
          rej.onclick = () => { rej.disabled = true; act({ type: 'respond', offerId: o.id, accept: false }); };
          acts.append(acc, rej);
          card.append(acts);
        } else {
          card.append(h('div', { class: 'offer-meta' }, 'Samo lider tvoje grupe odgovara na ponude.'));
        }
        root.append(card);
      }
    }

    // odlazna ponuda
    if (me.outgoing) {
      root.append(h('div', { class: 'section-label' }, 'Tvoja ponuda'));
      refs.outMeta = h('div', { class: 'offer-meta' }, outText(me.outgoing, st));
      root.append(h('div', { class: 'offer-card' },
        h('div', { class: 'offer-title' }, me.outgoing.open
          ? 'Tvoj javni poziv je otvoren'
          : 'Ponuda poslata: ' + me.outgoing.toGroupName),
        refs.outMeta
      ));
      if (me.outgoing.open) {
        root.append(h('div', { class: 'note' }, 'Svako prihvatanje: ' + gainText + ' tebi'));
      }
    }

    // akcije lidera
    if (me.canOffer || (g && g.isLeader)) {
      root.append(h('div', { class: 'section-label' }, 'Pošalji ponudu'));
      const openBtn = h('button', { class: 'btn-open-offer', type: 'button' },
        'POZOVI SVE FIRME NA SPAJANJE'
      );
      openBtn.onclick = () => act({ type: 'offer', value: '__open__' });
      refs.openBtn = openBtn;
      root.append(openBtn);
      if (me.cooldownMs > 0) {
        refs.cool = h('div', { class: 'cooldown', id: 'mergeCool' }, '');
        root.append(refs.cool);
      }
      const others = st.groups.filter(x => x.id !== me.groupId);
      root.append(h('div', { class: 'section-label' }, 'Ili pošalji ponudu jednoj grupi'));
      for (const o of others) {
        const row = h('div', { class: 'merge-row' },
          h('span', { class: 'mr-dot' }),
          h('div', { class: 'mr-main' },
            h('div', { class: 'mr-name' }, o.name),
            h('div', { class: 'mr-meta' }, o.members + ' firmi · ' + pct(o.share) + ' tržišta · ' + fmt1(o.score) + ' mil')
          )
        );
        const b = h('button', { class: 'btn', type: 'button' }, 'PONUDI');
        b.onclick = () => act({ type: 'offer', value: o.id });
        row.append(b);
        root.append(row);
      }
      root.append(h('div', { class: 'note' }, 'Ako oni prihvate, njihova grupa se pridružuje tvojoj. Ti ostaješ lider.'));
    } else {
      root.append(h('div', { class: 'section-label' }, 'Ti nisi lider'));
      root.append(h('div', { class: 'offer-card ' },
        h('div', { class: 'offer-title' }, 'Lider tvoje grupe je ' + (g ? g.leaderName : '—')),
        h('div', { class: 'offer-meta' }, 'Samo lider odgovara na ponude i šalje nove. Lobiraj kod njega — ili izdaj grupu glasom u rundi 5.')
      ));
    }
    refs.me = me;
  }

  const update = st => {
    if (structureChanged(st) !== sig) {
      sig = structureChanged(st);
      build(st);
    }
    const me = st.me;
    if (refs.openBtn) refs.openBtn.disabled = !!me.outgoing || me.cooldownMs > 0 || st.paused;
    if (refs.cool) {
      refs.cool.textContent = me.cooldownMs > 0
        ? 'Sačekaj ' + Math.ceil(me.cooldownMs / 1000) + ' s prije nove ponude.'
        : 'Ponuda je poslata — sačekaj odgovor.';
    }
    if (refs.offerMeta) {
      for (const item of refs.offerMeta) {
        const o = (me.incoming || []).find(x => x.id === item.id);
        if (o) item.el.textContent = incText(o);
      }
    }
    if (refs.outMeta && me.outgoing) refs.outMeta.textContent = outText(me.outgoing, st);
  };
  return { root, update };
}

/* -------------------------------- RUNDA 5 --------------------------------- */
function buildVote() {
  const root = h('div', {});
  root.append(h('div', { class: 'round-head' },
    h('h2', {}, 'Komisija'),
    h('p', {}, 'Cijela sala glasa koju od najvećih grupa treba zabraniti. Glasaju i članovi grupa — pa ima lobiranja i izdaja.')
  ));
  const list = h('div', {});
  const cards = new Map();
  const mine = S.me.groupId;
  const cands = (S.voteCandidates || []).filter(c => c.groupId !== mine);
  if (!cands.length) {
    root.append(h('div', { class: 'note' }, 'Nema kandidata za glasanje.'));
  }
  for (const c of cands) {
    const check = h('span', { class: 'vc-check hidden' }, '✓');
    const card = h('button', { class: 'vote-card', type: 'button' },
      h('span', { class: 'vc-dot', style: { background: c.color } }),
      h('div', { class: 'vc-main' },
        h('div', { class: 'vc-name' }, c.name),
        h('div', { class: 'vc-meta' }, c.members + ' firmi · ' + pct(c.share) + ' tržišta · ' + fmt1(c.score) + ' mil')
      ),
      check
    );
    card.onclick = () => { if (!S || S.paused) return; select(c.groupId); act({ type: 'vote', value: c.groupId }); };
    cards.set(c.groupId, { card, check });
    list.append(card);
  }
  const status = h('div', { class: 'vote-status', id: 'voteStatus' }, '');
  root.append(list, status);
  root.append(h('div', { class: 'note' }, 'Zabranjena grupa se raspada na firme kakve su bile prije spajanja i plaća kaznu od 30% kapitala.'));
  function select(id) {
    for (const [k, v] of cards) {
      v.card.classList.toggle('voted', k === id);
      v.check.classList.toggle('hidden', k !== id);
    }
  }
  const update = st => {
    select(st.me.vote);
    const total = st.totals.players;
    $('voteStatus').textContent = st.me.vote
      ? 'Glasao si: ' + ((st.voteCandidates.find(c => c.groupId === st.me.vote) || {}).name || '—') + ' · glasalo ' + st.votesCast + '/' + total
      : 'Još nisi glasao · glasalo ' + st.votesCast + '/' + total;
    for (const [, v] of cards) v.card.classList.toggle('disabled', !!st.paused);
  };
  return { root, update };
}

/* ------------------------------- REZULTATI -------------------------------- */
function buildResults() {
  const root = h('div', { class: 'result-box' });
  const me = S.me;
  const dCap = me.capital - me.prevCapital;
  const dCust = me.customers - me.prevCustomers;
  let big, bigClass, sub;
  if (Math.abs(dCust) >= 1 || Math.abs(dCap) < 0.05) {
    big = (dCust >= 0 ? '+' : '') + fmt0(dCust) + ' kupaca';
    bigClass = dCust > 0 ? 'up' : dCust < 0 ? 'down' : 'flat';
    sub = 'kapital ' + (dCap >= 0 ? '+' : '') + fmt1(dCap) + ' mil · sada ' + fmt1(me.capital) + ' mil';
  } else {
    big = (dCap >= 0 ? '+' : '') + fmt1(dCap) + ' mil';
    bigClass = dCap > 0 ? 'up' : dCap < 0 ? 'down' : 'flat';
    sub = 'kupci ' + (dCust >= 0 ? '+' : '') + fmt0(dCust) + ' · sada ' + fmt0(me.customers) + ' kupaca';
  }
  const r = S.results || {};
  const lines = [];
  if (r.headline) lines.push(r.headline);
  for (const l of (r.lines || [])) {
    if (lines.length >= 3) break;
    lines.push(l);
  }
  const cv = S.meta.customerValue || 0.15;
  const value = me.capital + me.customers * cv;
  const prevValue = (me.prevCapital != null ? me.prevCapital : me.capital) +
    (me.prevCustomers != null ? me.prevCustomers : me.customers) * cv;
  const dVal = value - prevValue;

  root.append(
    h('div', { class: 'result-kicker' }, 'RUNDA ' + S.round + ' · ' + ((r.title || '').toUpperCase())),
    h('div', { class: 'result-big ' + bigClass }, big),
    h('div', { class: 'result-sub' }, sub),
    h('div', { class: 'rank-line' },
      h('span', {}, 'Tvoj plasman'),
      h('b', {}, '#' + me.rank + ' / ' + S.totals.players)
    ),
    h('div', { class: 'result-lines' },
      h('li', {}, 'Vrijednost firme: ' + (dVal >= 0 ? '+' : '') + fmt1(dVal) + ' mil · sada ' + fmt1(value) + ' mil')
    )
  );

  if (S.round === 3 && me.invest === 'innov') {
    const ok = me.investSuccess === true;
    root.append(h('div', { class: 'result-lines' },
      h('li', { style: { borderLeftColor: ok ? 'var(--green)' : 'var(--red)' } },
        ok ? '✓ Tvoja inovacija je USPJELA — kupci su udvostručeni.' : '✗ Tvoja inovacija nije uspjela — uloženih 20 mil je izgubljeno.')
    ));
  }
  if (S.round === 4 && me.group) {
    root.append(h('div', { class: 'result-lines' },
      h('li', {}, me.group.members > 1
        ? 'Tvoja grupa: ' + me.group.name + ' (' + me.group.members + ' firmi) · ' + pct(me.group.share) + ' tržišta · vrijednost ' + fmt1(me.group.score) + ' mil KM'
        : 'Ostao si samostalna firma. U sljedećoj rundi Komisija glasa.')
    ));
  }
  if (S.round === 5 && r.headline) {
    root.append(h('div', { class: 'result-lines' }, h('li', {}, r.headline)));
  }
  if (lines.length) {
    root.append(h('div', { class: 'result-lines' }, lines.map(t => h('li', {}, t))));
  }
  root.append(h('div', { class: 'note' }, 'Kompletni rezultati su na projektoru. Profesor pokreće sljedeću rundu.'));
  return { root, update: () => { } };
}

/* --------------------------------- FINALE --------------------------------- */
function buildFinal() {
  const me = S.me;
  const place = me.groupRank || me.rank;
  const winner = S.final && S.final.winner;
  const inGroup = me.group && me.group.members > 1;
  const value = inGroup ? me.group.score : me.score;
  const note = inGroup
    ? 'Vrijednost kompanije = sve firme u grupi (' + me.group.members + '). Tvoja firma: ' +
      fmt0(me.customers) + ' kupaca i ' + fmt1(me.capital) + ' mil kapitala — kupci su rasli sa grupom.'
    : 'Vrijednost = kapital + kupci × 100.000 KM. Završio si sa ' + fmt0(me.customers) +
      ' kupaca i ' + fmt1(me.capital) + ' mil kapitala.';
  const root = h('div', { class: 'final-box' },
    h('div', { class: 'final-place-num' }, '#' + place),
    h('div', { class: 'final-place' }, place + '. mjesto'),
    h('div', { class: 'final-label' }, inGroup ? 'vrijednost kompanije' : 'vrijednost firme'),
    h('div', { class: 'final-value' }, fmt1(value) + ' mil'),
    h('div', { class: 'final-note' }, note),
    h('div', { class: 'final-winner' }, winner ? ['Pobjednik: ', h('b', {}, winner.name + ' (' + fmt1(winner.score) + ' mil)')] : ''),
    h('div', { class: 'note' }, 'Profesor na projektoru otvara analizu: zašto je rast vodio u monopol.')
  );
  return { root, update: () => { } };
}

/* ---------------------------------- AKCIJE -------------------------------- */
async function act(payload) {
  if (!token) return null;
  const beforeCustomers = S && S.me ? S.me.customers : 0;
  const res = await api('/api/act', Object.assign({ token }, payload));
  const data = res.data;
  if (data && data.state) {
    const gained = (data.state.me ? data.state.me.customers : 0) - beforeCustomers;
    S = data.state;
    offset = S.serverNow - Date.now();
    render();
    if (payload.type === 'respond' && gained > 0 && S.round === 4) {
      const cv = S.meta.customerValue || 0.15;
      toast('+' + fmt0(gained) + ' kupaca · +' + fmt1(gained * cv) + ' mil KM');
    }
  } else if (data && data.ok === false && data.error) {
    toast(data.error);
  }
  return data;
}

function toast(msg) {
  let el = $('toast');
  if (!el) {
    el = h('div', { id: 'toast' });
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

/* ---------------------------------- TIMER --------------------------------- */
setInterval(() => {
  if (!S) return;
  const el = $('myTimer');
  const visible = S.phase === 'round' && !S.manual;
  el.style.display = visible ? '' : 'none';
  el.classList.remove('low', 'paused', 'manual');
  if (!visible) return;
  const ms = S.paused
    ? S.timerLeft
    : (S.endsAt ? Math.max(0, S.endsAt - (Date.now() + offset)) : 0);
  el.textContent = S.paused ? '⏸' : secondsText(ms);
  el.classList.toggle('low', !S.paused && ms <= 5000);
  el.classList.toggle('paused', S.paused);
}, 150);
/* Tapkanje se šalje u paketima (max ~25/s, koliko server dozvoljava) */
setInterval(() => { if (tapFlushFn) tapFlushFn(); }, 140);

/* Spreči slučajno zatvaranje / osvježavanje tokom igre */
window.addEventListener('beforeunload', e => {
  if (S && (S.phase === 'round' || S.phase === 'results')) {
    e.preventDefault();
    e.returnValue = '';
  }
});
