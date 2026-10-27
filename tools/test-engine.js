'use strict';
const assert=require('node:assert/strict');const test=require('node:test');const e=require('../market-engine');
const act=(p,payload)=>e.handleAction(p,{round:e.game.round,...payload});
const next=()=>assert.equal(e.doAdmin({action:'next'}).status,200);
const advance=()=>{next();next();};
function fresh(n=6){e.resetGame(true);const p=Array.from({length:n},(_,i)=>e.addPlayer('Firma '+i));e.doAdmin({action:'start'});return p;}
function negotiate(p){for(const x of p)act(x,{type:'strategy',value:'reserve'});advance();}
function offer(p,target,share=30){assert.equal(act(p,{type:'offer',kind:'merge',target:target.groupId,share}).ok,true);return e.game.offers[e.game.offers.length-1];}
function accept(p,o){return act(p,{type:'respond',offerId:o.id,decision:'accept'});}
function merge(a,b,share=30){const o=offer(a,b,share);assert.equal(accept(b,o).ok,true);return o;}
function getGroup(p){return e.game.owners[p.groupId];}
test('different assets, meaningful locked investment, no repeat deduction',()=>{
 const p=fresh();assert.equal(p[2].cash,p[0].cash*3);assert.equal(e.groupCost(getGroup(p[0])),26);
 const cash=p[0].cash;assert.equal(act(p[0],{type:'strategy',value:'invest'}).ok,true);
 assert.equal(p[0].cash,cash-p[0].investCost);assert.equal(e.groupCost(getGroup(p[0])),20);
 assert.equal(act(p[0],{type:'strategy',value:'invest'}).ok,false);assert.equal(p[0].cash,cash-p[0].investCost);
});
test('negotiated counteroffer transfers control and exact equity, later mergers dilute everyone',()=>{
 const p=fresh();negotiate(p);const o=offer(p[0],p[1],30);
 assert.equal(act(p[1],{type:'respond',offerId:o.id,decision:'counter',share:40}).ok,true);
 assert.equal(accept(p[1],o).ok,false);assert.equal(accept(p[0],o).ok,true);
 assert.deepEqual(getGroup(p[0]).shares,{p1:6000,p2:4000});assert.equal(e.playerState(p[1]).me.controls,false);
 assert.equal(act(p[1],{type:'offer',kind:'merge',target:p[3].groupId,share:30}).ok,false);
 merge(p[0],p[2],30);assert.deepEqual(getGroup(p[0]).shares,{p1:4200,p2:2800,p3:3000});
 assert.equal(e.groupCost(getGroup(p[0])),10);assert.equal(Object.keys(e.game.owners).length,4);
});
test('simultaneous competing offers cannot sell the same firm twice',()=>{
 const p=fresh();negotiate(p);const first=offer(p[0],p[1]),second=offer(p[2],p[1]);
 assert.equal(accept(p[1],first).ok,true);assert.equal(second.status,'stale');assert.equal(accept(p[1],second).ok,false);
 assert.equal(Object.keys(e.game.owners).length,5);
 const saved=JSON.parse(JSON.stringify(e.exportState()));e.resetGame(true);e.importState(saved);assert.equal(e.game.players.size,6);assert.equal(e.playerState(e.findPlayerByToken(p[1].token)).me.share,30);
});
test('capital can fund an immediate buyout, cash is conserved, and unfunded offers cannot settle',()=>{
 const p=fresh();negotiate(p);const before=p.reduce((s,x)=>s+x.cash,0),buyerCash=p[2].cash,sellerCash=p[0].cash;
 assert.equal(act(p[2],{type:'offer',kind:'merge',target:p[0].id,share:30,cash:20000}).ok,true);
 const o=e.game.offers.at(-1);assert.equal(e.playerState(p[0]).offers[0].terms.cashPayouts[p[0].id],20000);
 assert.equal(accept(p[0],o).ok,true);assert.equal(p[2].cash,buyerCash-20000);assert.equal(p[0].cash,sellerCash+20000);
 assert.equal(p.reduce((s,x)=>s+x.cash,0),before);
 assert.equal(act(p[3],{type:'offer',kind:'merge',target:p[4].id,share:30,cash:p[3].cash+1}).ok,false);
 assert.equal(act(p[3],{type:'offer',kind:'merge',target:p[4].id,share:30,cash:10000}).ok,true);
 const pending=e.game.offers.at(-1);p[3].cash=0;assert.equal(accept(p[4],pending).ok,false);assert.equal(p[4].groupId,p[4].id);
});
test('infrastructure agreement retains separate control and transfers rent without creating money',()=>{
 const p=fresh();negotiate(p);
 assert.equal(act(p[0],{type:'offer',kind:'access',target:p[1].groupId,fee:4}).ok,true);
 const o=e.game.offers.at(-1);assert.equal(accept(p[1],o).ok,true);
 assert.equal(Object.keys(e.game.owners).length,6);assert.equal(e.playerState(p[0]).me.controls,true);assert.equal(e.playerState(p[1]).me.controls,true);
 advance();for(const x of p)act(x,{type:'price',value:x.id===p[0].id?50:80});next();
 const tenant=e.game.market.suppliers.find(g=>g.id===p[0].groupId),landlord=e.game.market.suppliers.find(g=>g.id===p[1].groupId);
 assert.equal(tenant.customers,7500);assert.equal(tenant.cost,18);assert.equal(tenant.fee,4);assert.equal(landlord.profit,30000);
 assert.equal(e.game.market.profit,240000);assert.ok(Math.abs(p.reduce((s,x)=>s+x.lastProfit,0)-240000)<.01);
});
test('two negotiations and two business months pay only actual settlements; salary is the mean of dividends',()=>{
 const p=fresh();negotiate(p);merge(p[0],p[1]);advance();
 assert.equal(Object.keys(e.game.owners).length,5);assert.equal(act(p[1],{type:'price',value:30}).ok,false);
 for(const g of Object.values(e.game.owners))act(e.game.players.get(g.leaderId),{type:'price',value:40});
 advance();assert.equal(e.game.round,4);assert.equal(e.game.periods,1);
 assert.equal(e.playerState(p[0]).me.monthlyIncome,p[0].earnings);
 assert.equal(act(p[1],{type:'ask',share:40,cash:0}).ok,false);
 for(const g of Object.values(e.game.owners))assert.equal(act(e.game.players.get(g.leaderId),{type:'ask',share:40,cash:1000}).ok,true);
 advance();assert.equal(e.game.round,5);assert.equal(e.commonState().groups.find(g=>g.id===p[2].id).ask.cash,1000);
 merge(p[0],p[2],35);advance();assert.equal(e.game.round,6);
 assert.ok(e.commonState().groups.every(g=>g.price!==80));
 for(const g of Object.values(e.game.owners))act(e.game.players.get(g.leaderId),{type:'price',value:80});
 next();assert.equal(e.game.periods,2);assert.equal(e.game.markets.length,2);
 assert.equal(e.playerState(p[0]).me.monthlyIncome,Math.round(p[0].earnings/2*100)/100);
 assert.equal(e.commonState().scoreboard.rows.find(x=>x.id===p[0].id).gain,Math.round((p[0].cash-p[0].initialCash)*100)/100);
});
test('foreign entry remains unconditional and does not charge firms after both months',()=>{
 const p=fresh();negotiate(p);for(const x of p.slice(1))merge(p[0],x,30);advance();
 act(p[0],{type:'price',value:40});advance();advance();advance();
 assert.equal(e.game.round,6);act(p[0],{type:'price',value:80});advance();
 const cash=p.map(x=>x.cash),before=e.game.market;assert.equal(e.game.round,7);
 next();assert.equal(e.game.entry.market.independent,2);assert.equal(e.game.entry.market.averagePrice,40);assert.equal(e.game.entry.market.served,9000);
 assert.deepEqual(p.map(x=>x.cash),cash);assert.deepEqual(e.game.market,before);assert.equal(e.playerState(p[0]).me.profitAfterEntry,0);
 next();assert.equal(e.game.phase,'final');
});
test('offer forecasts show both personal payoffs without paying projected money',()=>{
 const p=fresh();negotiate(p);const cash=p.map(x=>x.cash),o=offer(p[0],p[1],40),f=e.playerState(p[1]).offers[0].terms.forecast;
 assert.ok(Number.isFinite(f.before[p[1].id]));assert.ok(Number.isFinite(f.after[p[1].id]));
 assert.equal(f.delta[p[1].id],Math.round((f.after[p[1].id]-f.before[p[1].id])*100)/100);
 assert.deepEqual(p.map(x=>x.cash),cash);assert.equal(e.game.periods,0);
 assert.equal(act(p[1],{type:'respond',offerId:o.id,decision:'counter',share:70,cash:1e12}).ok,false);
 assert.equal(o.share,40);assert.equal(o.cash,0);
});
test('cash and equity limits reject negative, fractional, non-finite and excessive offers without mutating balances',()=>{
 const p=fresh();negotiate(p);const before=p.map(x=>x.cash);
 for(const cash of [-1,.1,Infinity,NaN,'1000',p[0].cash+1])assert.equal(act(p[0],{type:'offer',kind:'merge',target:p[1].id,share:30,cash}).ok,false);
 for(const share of [-5,0,100,110,30.5,'30'])assert.equal(act(p[0],{type:'offer',kind:'merge',target:p[1].id,share,cash:0}).ok,false);
 assert.deepEqual(p.map(x=>x.cash),before);assert.equal(e.game.offers.length,0);
 const o=offer(p[0],p[1],30);assert.equal(act(p[1],{type:'respond',offerId:o.id,decision:'counter',share:100,cash:0}).ok,false);
 assert.equal(o.share,30);assert.equal(o.awaitingId,p[1].id);
});
test('join requires first and last names and preserves real identities through ownership and saves',()=>{
 e.resetGame(true);assert.equal(e.doJoin('Alfa').status,400);assert.equal(e.doJoin('Alfa','Amra','').status,400);
 const joined=e.doJoin('Alfa','  Amra  ','  Hadžić  ');assert.equal(joined.status,200);assert.equal(joined.body.fullName,'Amra Hadžić');
 const b=e.doJoin('Beta','Tarik','Džafić');e.doJoin('Gama','Lejla','Čengić');e.doAdmin({action:'start'});
 const a=e.findPlayerByToken(joined.body.token),p=e.findPlayerByToken(b.body.token);negotiate([a,p,...[...e.game.players.values()].filter(x=>x.id!==a.id&&x.id!==p.id)]);
 assert.equal(e.commonState().players[0].fullName,'Amra Hadžić');assert.equal(e.playerState(p).me.group.leaderName,'Tarik Džafić');
 merge(a,p);assert.equal(e.playerState(p).me.group.leaderName,'Amra Hadžić');assert.equal(e.playerState(p).me.fullName,'Tarik Džafić');
 const save=JSON.parse(JSON.stringify(e.exportState()));e.resetGame(true);e.importState(save);assert.equal(e.findPlayerByToken(b.body.token).fullName,'Tarik Džafić');
 e.doAdmin({action:'reset'});assert.equal(e.findPlayerByToken(b.body.token).fullName,'Tarik Džafić');
});
test('pause, stale rounds, private information, no automatic merging, reset and save version',()=>{
 const p=fresh();e.doAdmin({action:'pause'});assert.equal(act(p[0],{type:'strategy',value:'invest'}).ok,false);assert.equal(e.doAdmin({action:'next'}).status,409);e.doAdmin({action:'resume'});
 assert.equal(e.handleAction(p[0],{round:99,type:'strategy',value:'reserve'}).ok,false);
 const publicState=JSON.stringify(e.commonState());assert.ok(!publicState.includes(p[0].token));assert.ok(!('token' in e.commonState().players[0]));
 negotiate(p);advance();assert.equal(Object.keys(e.game.owners).length,6);
 e.doAdmin({action:'reset'});assert.equal(e.game.players.size,6);assert.equal(e.findPlayerByToken(p[0].token).cash,0);assert.equal(e.game.contracts.length,0);assert.equal(e.game.offers.length,0);
 e.importState({version:3,phase:'round'});assert.equal(e.game.phase,'lobby');assert.equal(e.game.players.size,0);
});
test('affordability, ownership-independent sales concentration and balanced money',()=>{
 for(const price of e.constants.PRICES){const m=e.marketFor([{id:'a',price,cost:20},{id:'b',price,cost:20,reach:3}]);assert.equal(m.served+m.excluded,10000);assert.equal(m.suppliers.reduce((s,g)=>s+g.customers,0),m.served);assert.equal(m.profit,(price-20)*m.served);}
 const m=e.marketFor([{id:'a',price:30,cost:20},{id:'b',price:80,cost:14}]);assert.equal(m.independent,2);assert.equal(m.hhi,10000);assert.equal(m.excluded,0);
});
test('demo bots play voluntary offers and complete all seven steps',()=>{
 e.resetGame(true);e.doAdmin({action:'bots',count:8});e.doAdmin({action:'start'});
 for(let round=1;round<=7;round++){
  for(let i=1;i<8;i++)e.serverlessTick(e.game.roundStartedAt+2000+i*1000);
  next();next();
 }
 assert.equal(e.game.phase,'final');assert.ok(e.game.final.mergers>0);assert.equal(e.game.players.size,8);
});
test('personal income remains real while strategy, deals and prices expose separate estimates',()=>{
 const p=fresh();let me=e.playerState(p[0]).me;
 assert.equal(me.personalIncome,0);assert.ok(me.impact.invest.after>me.impact.invest.before);
 act(p[0],{type:'strategy',value:'invest'});me=e.playerState(p[0]).me;
 assert.equal(me.personalIncome,0);assert.equal(me.impact.lastEffect.cashChange,-p[0].investCost);
 assert.ok(me.impact.lastEffect.monthlyDelta>0);
 for(const x of p.slice(1))act(x,{type:'strategy',value:'reserve'});advance();
 const o=offer(p[0],p[1],40),quoted=e.playerState(p[1]).offers[0].terms.forecast;accept(p[1],o);me=e.playerState(p[1]).me;
 assert.equal(me.personalIncome,0);assert.equal(me.impact.lastEffect.shareAfter,40);
 assert.equal(me.impact.lastEffect.monthlyAfter,quoted.monthlyAfter[p[1].id]);assert.equal(me.impact.lastEffect.plannedPrice,quoted.price);
 advance();for(const g of Object.values(e.game.owners))act(e.game.players.get(g.leaderId),{type:'price',value:40});next();
 me=e.playerState(p[0]).me;assert.equal(me.personalIncome,p[0].lastProfit);assert.equal(me.impact.lastEffect.incomePaid,p[0].lastProfit);
});
test('draft and counteroffer previews neither send offers nor move money',()=>{
 const p=fresh();negotiate(p);const before=JSON.stringify(e.exportState());
 const draft=act(p[0],{type:'preview',kind:'merge',target:p[1].id,share:40,cash:1000});
 assert.equal(draft.ok,true);assert.ok(draft.preview.terms.forecast.monthlyAfter[p[0].id]>=0);
 assert.equal(JSON.stringify(e.exportState()),before);
 const o=offer(p[0],p[1],30),snapshot=JSON.stringify(e.exportState());
 const counter=act(p[1],{type:'preview',offerId:o.id,share:50,cash:5000});assert.equal(counter.ok,true);assert.equal(counter.preview.share,50);
 assert.equal(JSON.stringify(e.exportState()),snapshot);
 assert.equal(act(p[1],{type:'preview',offerId:o.id,share:50,cash:p[0].cash+1}).ok,false);
});
test('price estimates cannot reveal a rival secret choice',()=>{
 const p=fresh();negotiate(p);advance();
 const before=e.playerState(p[1]).me.impact;
 act(p[0],{type:'price',value:100});const after=e.playerState(p[1]).me.impact;
 assert.deepEqual(after.prices,before.prices);assert.equal(after.estimate,before.estimate);
 act(p[1],{type:'price',value:30});assert.equal(e.playerState(p[1]).me.impact.estimate,after.prices.find(x=>x.price===30).income);
});
test('bots approach humans with affordable explained offers and wait for their answer',()=>{
 e.resetGame(true);const human=e.addPlayer('Ljudska firma'),bot=e.addPlayer('Demo mreža',true),other=e.addPlayer('Druga firma');e.doAdmin({action:'start'});
 for(const p of [human,bot,other])act(p,{type:'strategy',value:'reserve'});advance();
 for(let i=1;i<=20;i++)e.serverlessTick(e.game.roundStartedAt+i*1000);
 const incoming=e.playerState(human).offers;assert.equal(incoming.length,1);assert.equal(incoming[0].fromId,bot.id);assert.ok(incoming[0].botNote);
 assert.ok(incoming[0].cash<=bot.cash);assert.equal(incoming[0].status,'pending');assert.equal(human.groupId,human.id);
});
test('a bot counters a harmful offer once, with clear reasoning, without a counter loop',()=>{
 const p=fresh(3);p[1].isBot=true;negotiate(p);const o=offer(p[0],p[1],10);
 e.serverlessTick(e.game.roundStartedAt+1000);assert.equal(o.counters,0);
 e.serverlessTick(e.game.roundStartedAt+10000);assert.equal(o.counters,1);assert.equal(o.awaitingId,p[0].id);assert.ok(o.botNote);
 for(let i=11;i<30;i++)e.serverlessTick(e.game.roundStartedAt+i*1000);
 assert.equal(o.counters,1);assert.equal(o.status,'pending');assert.ok(e.playerState(p[0]).me.negotiationNote);
});
