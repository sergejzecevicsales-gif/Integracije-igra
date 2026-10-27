'use strict';
const crypto=require('crypto');
const PRICES=[30,40,50,60,80,100];
const BUDGETS=[[30,1000],[40,1500],[50,1500],[60,2000],[80,2500],[100,1500]];
const ROLES=[
 {key:'audience',name:'Kupci',cost:26,reach:3,color:'#2863cc',strength:'Kupci već poznaju tvoju firmu.',problem:'Usluga ti je skupa. Treba ti jeftinija infrastruktura.'},
 {key:'infrastructure',name:'Infrastruktura',cost:14,reach:1,color:'#bb502d',strength:'Imaš vlastitu, jeftinu mrežu.',problem:'Nemaš mnogo kupaca. Možeš iznajmiti mrežu ili pronaći partnera.'},
 {key:'capital',name:'Kapital',cost:22,reach:1,color:'#57804a',strength:'Imaš tri puta više početnog novca.',problem:'Novac ne donosi kupce sam od sebe. Procijeni u šta vrijedi ulagati.'}
];
const STEPS=[
 {key:'strategy',kind:'strategy',title:'Svako ima nešto. Niko nema sve.',stage:'Početni potez',seconds:45,instruction:'Uloži u niži trošak ili sačuvaj novac za kupovinu drugih firmi.',question:'Ko može zaraditi više povezivanjem s tobom?'},
 {key:'negotiate1',kind:'negotiate',title:'Ponudi dogovor koji se isplati.',stage:'Prvi pregovori',seconds:120,instruction:'Pregovarajte o gotovini, udjelu i kontroli. Svaka ponuda pokazuje procjenu tvog ličnog dobitka.',question:'Koliko moraš ponuditi da druga strana pristane?'},
 {key:'price1',kind:'price',title:'Prva zarada.',stage:'Prvi poslovni mjesec',seconds:30,instruction:'Vlasnici biraju cijenu. Profit se isplaćuje članovima prema udjelima.',question:'Ko je zaradio i koliko novca sada ima za preuzimanja?'},
 {key:'ask',kind:'ask',title:'Koliko tražiš za dogovor?',stage:'Objavi svoje uslove',seconds:40,instruction:'Nezavisni vlasnici objavljuju koliko udjela i gotovine traže. To je početna pozicija za nove pregovore.',question:'Koju bi ponudu prihvatio zbog vlastite zarade?'},
 {key:'negotiate2',kind:'negotiate',title:'Još jedan rival. Još jedan dogovor.',stage:'Završni pregovori',seconds:120,instruction:'Zarađeni novac sada možeš koristiti za nove ponude. Provjeri ličnu računicu prije prihvatanja.',question:'Može li posljednji dogovor povećati zaradu obje strane?'},
 {key:'price2',kind:'price',title:'Ista usluga. Manje rivala.',stage:'Drugi poslovni mjesec',seconds:30,instruction:'Preostali vlasnici određuju cijenu. Pratite ličnu zaradu i broj nezavisnih konkurenata.',question:'Kako su pojedinačni isplativi dogovori promijenili cijelo tržište?'},
 {key:'entry',kind:'entry',title:'Tržište se otvara.',stage:'Novi strani operater',seconds:20,instruction:'Strani operater ulazi s istim paketom za 40 KM. Pogledaj šta se mijenja za domaće firme i kupce.',question:'Kako ulazak strane konkurencije mijenja profit domaćih firmi?'}
];
const game={players:new Map()};
let projectionRevision=-1;const projectionCache=new Map();
let getJoinUrl=()=>'/';
const people=()=>[...game.players.values()];
const step=()=>STEPS[game.round-1];
const round2=n=>Math.round(n*100)/100;
const ok=body=>({status:200,body:{ok:true,...body}});
const fail=(error,status=409)=>({status,body:{ok:false,error}});
const role=p=>ROLES[p.roleIndex];
const groups=()=>Object.values(game.owners);
const groupOf=p=>game.owners[p.groupId];
const leader=g=>game.players.get(g.leaderId);
const hasInfra=g=>g.members.some(id=>role(game.players.get(id)).key==='infrastructure');
function groupCost(g){
 const costs=g.members.map(id=>{const p=game.players.get(id);return role(p).cost-(p.strategy==='invest'?6:0);});
 const keys=new Set(g.members.map(id=>role(game.players.get(id)).key));
 const synergy=keys.has('audience')&&keys.has('infrastructure')?4:0;
 // A combined network can serve everyone using its cheapest available infrastructure.
 return round2(Math.max(8,Math.min(...costs)-synergy));
}
function accessFor(g){return game.contracts.find(c=>c.tenantId===g.id&&c.landlordId!==g.id&&game.owners[c.landlordId]);}
function offersForMarket(ownerGroups=groups(),contracts=game.contracts){return ownerGroups.map(g=>{
 const access=contracts.find(c=>c.tenantId===g.id&&c.landlordId!==g.id&&ownerGroups.some(x=>x.id===c.landlordId)),base=groupCost(g);
 return {id:g.id,name:g.name,color:g.color,price:g.price??40,cost:Math.max(8,base-(access?8:0)),fee:access?.fee||0,landlordId:access?.landlordId||null,reach:g.members.reduce((s,id)=>s+role(game.players.get(id)).reach,0),members:g.members.length};
});}
function mergedContracts(fromId,toId){
 const contracts=game.contracts.map(c=>({...c,landlordId:c.landlordId===toId?fromId:c.landlordId,tenantId:c.tenantId===toId?fromId:c.tenantId})).filter(c=>c.landlordId!==c.tenantId).sort((a,b)=>a.fee-b.fee);
 const seen=new Set();return contracts.filter(c=>{if(seen.has(c.tenantId))return false;seen.add(c.tenantId);return true;});
}
function projectionBase(){
 if(projectionRevision!==game.revision){projectionCache.clear();projectionRevision=game.revision;}
 if(!projectionCache.has('base'))projectionCache.set('base',marketFor(offersForMarket()));
 return projectionCache.get('base');
}
function payoffForecast(o,terms){
 projectionBase();if(projectionCache.has(o.id))return projectionCache.get(o.id);
 const a=game.owners[o.fromId],b=game.owners[o.toId],combined={...a,members:[...a.members,...b.members],shares:terms.shares};
 const ownerGroups=groups().filter(g=>g.id!==b.id).map(g=>g.id===a.id?combined:g),contracts=mergedContracts(a.id,b.id);
 let best=null;
 for(const price of PRICES){const offers=offersForMarket(ownerGroups,contracts).map(g=>g.id===a.id?{...g,price}:g),market=marketFor(offers),profit=market.suppliers.find(g=>g.id===a.id).profit;if(!best||profit>best.profit)best={price,profit,market};}
 const before={};for(const g of [a,b])Object.assign(before,distribute(projectionBase().suppliers.find(x=>x.id===g.id).profit,g.shares));
 const monthlyAfter=distribute(best.profit,terms.shares),after={},delta={};
 for(const id of combined.members){after[id]=round2(monthlyAfter[id]+(terms.cashPayouts[id]||0)-(id===a.leaderId?terms.cash:0));delta[id]=round2(after[id]-before[id]);}
 const forecast={before,after,delta,monthlyAfter,price:best.price,profit:best.profit,remainingOwners:ownerGroups.length,fromGain:delta[a.leaderId],toGain:delta[b.leaderId],losers:combined.members.filter(id=>delta[id]<0).length};
 projectionCache.set(o.id,forecast);return forecast;
}
function knownMarket(){
 projectionBase();if(projectionCache.has('known'))return projectionCache.get('known');
 const offers=offersForMarket().map(g=>({...g,price:game.phase==='round'&&step()?.kind==='price'?(game.market?.suppliers.find(old=>old.id===g.id)?.price??40):g.price}));
 const market=marketFor(offers);projectionCache.set('known',market);return market;
}
function estimatedIncome(p,market=knownMarket()){
 const g=groupOf(p),row=g&&market.suppliers.find(x=>x.id===g.id);return row?distribute(row.profit,g.shares)[p.id]:0;
}
function effectSnapshot(){const market=knownMarket();return people().map(p=>({id:p.id,cash:p.cash,share:(groupOf(p)?.shares[p.id]||0)/100,monthly:estimatedIncome(p,market)}));}
function recordEffects(before,label,kind,forceId){
 const market=knownMarket();for(const old of before){const p=game.players.get(old.id),monthly=estimatedIncome(p,market),share=(groupOf(p)?.shares[p.id]||0)/100;
 if(old.cash!==p.cash||old.monthly!==monthly||old.share!==share||p.id===forceId)p.lastEffect={round:game.round,kind,label,cashChange:round2(p.cash-old.cash),monthlyBefore:old.monthly,monthlyAfter:monthly,monthlyDelta:round2(monthly-old.monthly),shareBefore:old.share,shareAfter:share};}
}
function personalImpact(p){
 const g=groupOf(p),kind=step()?.kind;
 if(!g)return null;
 const reference=knownMarket(),base=estimatedIncome(p,reference),impact={estimate:base,referenceIncome:base,lastEffect:p.lastEffect?.round===game.round?p.lastEffect:null,prices:[]};
 if(kind==='strategy'){
  const offers=offersForMarket().map(x=>({...x,price:40}));
  const calculate=cost=>estimatedIncome(p,marketFor(offers.map(x=>x.id===g.id?{...x,cost}:x)));
  impact.invest={before:calculate(role(p).cost),after:calculate(Math.max(8,role(p).cost-6)),cashCost:p.investCost};
 }
 if(kind==='price'&&game.phase==='round'&&g.leaderId===p.id){
  const offers=reference.suppliers.map(x=>({...x}));
  impact.prices=PRICES.map(price=>({price,income:estimatedIncome(p,marketFor(offers.map(x=>x.id===g.id?{...x,price}:x)))}));
  const selected=impact.prices.find(x=>x.price===g.price);if(selected)impact.estimate=selected.income;
 }
 if(game.entry){const after=game.entry.market.suppliers.find(x=>x.id===g.id);impact.entry={before:p.lastProfit,after:after?distribute(after.profit,g.shares)[p.id]:0};}
 return impact;
}
function scoreboard(){
 const rows=people().map(p=>({id:p.id,name:p.name,fullName:p.fullName,gain:round2(p.cash-p.initialCash),monthlyIncome:game.periods?round2(p.earnings/game.periods):0,controls:groupOf(p)?.leaderId===p.id})).sort((a,b)=>b.gain-a.gain);
 return {rows,periods:game.periods,averageMonthly:rows.length?round2(rows.reduce((s,p)=>s+p.monthlyIncome,0)/rows.length):0};
}
function marketFor(offers){
 const rows=offers.map(g=>({...g,customers:0,profit:0}));let served=0,spending=0;
 for(const [budget,count] of BUDGETS){
  const eligible=rows.filter(g=>g.price<=budget);if(!eligible.length)continue;
  const min=Math.min(...eligible.map(g=>g.price)),winners=eligible.filter(g=>g.price===min),weight=winners.reduce((s,g)=>s+(g.reach||1),0);
  const allocation=winners.map(g=>({g,exact:count*(g.reach||1)/weight}));let used=0;
  for(const a of allocation){a.amount=Math.floor(a.exact);used+=a.amount;}
  allocation.sort((a,b)=>(b.exact-b.amount)-(a.exact-a.amount));
  for(let i=0;i<count-used;i++)allocation[i].amount++;
  for(const a of allocation)a.g.customers+=a.amount;
  served+=count;spending+=count*min;
 }
 for(const g of rows)g.profit=Math.round((g.price-(g.cost??20)-(g.fee||0))*g.customers*100)/100;
 for(const g of rows){if(g.landlordId){const landlord=rows.find(x=>x.id===g.landlordId);if(landlord)landlord.profit=round2(landlord.profit+g.fee*g.customers);}g.share=served?g.customers/served:0;}
 return {suppliers:rows,independent:rows.length,served,excluded:10000-served,averagePrice:served?round2(spending/served):0,profit:round2(rows.reduce((s,g)=>s+g.profit,0)),hhi:Math.round(rows.reduce((s,g)=>s+(g.share*100)**2,0))};
}
function distribute(total,weights){
 const ids=Object.keys(weights),cents=Math.round(total*100),sign=cents<0?-1:1,abs=Math.abs(cents),sum=ids.reduce((s,id)=>s+weights[id],0);
 const out={},remainders=[];let used=0;
 for(const id of ids){const exact=abs*weights[id]/sum,n=Math.floor(exact);out[id]=n;used+=n;remainders.push({id,r:exact-n});}
 remainders.sort((a,b)=>b.r-a.r);
 for(let i=0;i<abs-used;i++)out[remainders[i].id]++;
 for(const id of ids)out[id]=sign*out[id]/100;
 return out;
}
function resetGame(clear=false){
 projectionRevision=-1;projectionCache.clear();
 if(clear)game.players.clear();
 Object.assign(game,{version:7,phase:'lobby',round:0,paused:false,pausedAt:0,endsAt:0,roundStartedAt:0,startedAt:0,lastTickAt:0,seq:clear?0:game.seq||0,owners:{},offers:[],offerSeq:0,contracts:[],events:[],revision:0,baseline:null,market:null,markets:[],periods:0,results:null,entry:null,final:null});
 people().forEach((p,i)=>Object.assign(p,{roleIndex:i%3,groupId:p.id,cash:0,initialCash:0,earnings:0,lastProfit:0,previousProfit:0,lastEffect:null,negotiationNote:null,botNextAt:0,strategy:null,purchase:null,pressure:false,budget:null,investCost:0}));
}
resetGame();
function addPlayer(rawName,isBot=false,identity={}){
 const id='p'+(++game.seq);let name=String(rawName||`Mreža ${game.seq}`).trim().slice(0,24)||`Mreža ${game.seq}`;
 const base=name;let n=2;while(people().some(p=>p.name===name))name=base.slice(0,20)+' '+n++;
 const firstName=identity.firstName||(isBot?'Demo':'Učesnik'),lastName=identity.lastName||String(game.seq),fullName=firstName+' '+lastName;
 const p={id,name,firstName,lastName,fullName,token:crypto.randomBytes(24).toString('hex'),isBot,roleIndex:people().length%3,color:ROLES[people().length%3].color,groupId:id,cash:0,initialCash:0,earnings:0,lastProfit:0,previousProfit:0,lastEffect:null,negotiationNote:null,botNextAt:0,strategy:null,purchase:null,pressure:false,connections:0,lastActiveAt:Date.now()};game.players.set(id,p);return p;
}
function doJoin(name,firstName,lastName){
 if(game.phase!=='lobby')return fail('Pregovori su počeli. Sačekaj novu igru.');
 if(game.players.size>=60)return fail('Sala je puna (60 firmi).');
 const clean=value=>typeof value==='string'?value.trim().replace(/\s+/g,' '):'';
 firstName=clean(firstName);lastName=clean(lastName);
 if(!firstName||!lastName||firstName.length>40||lastName.length>40||/[\x00-\x1f\x7f]/.test(firstName+lastName))return fail('Unesi ime i prezime (najviše 40 znakova za svako).',400);
 const p=addPlayer(name,false,{firstName,lastName});return ok({id:p.id,name:p.name,fullName:p.fullName,color:p.color,token:p.token});
}
function findPlayerByToken(token){return people().find(p=>p.token===token);}
function event(text){game.events.unshift(text);game.events=game.events.slice(0,20);game.revision++;}
function initialise(){
 const unit=Math.round(180000/game.players.size);
 people().forEach((p,i)=>{
  p.roleIndex=i%3;p.color=role(p).color;p.cash=unit*(role(p).key==='capital'?3:1);p.initialCash=p.cash;p.investCost=Math.round(90000/game.players.size);p.budget=[40,60,80][i%3];
  game.owners[p.id]={id:p.id,name:p.name,color:p.color,leaderId:p.id,members:[p.id],shares:{[p.id]:10000},revision:0,price:null,ask:null};
 });
 game.baseline=marketFor(offersForMarket().map(g=>({...g,price:40})));
}
function startRound(n){game.round=n;game.phase='round';game.paused=false;game.results=null;game.roundStartedAt=Date.now();if(step().kind==='price')for(const g of groups())g.price=null;for(const p of people()){p.lastEffect=null;p.negotiationNote=null;p.botNextAt=game.roundStartedAt+2200+(Number(p.id.slice(1))%7)*350;}game.revision++;}
function finishRound(){
 const kind=step().kind;
 if(kind==='strategy'){
  for(const p of people())if(!p.strategy)p.strategy='reserve';
  game.results={kind,title:'Upoznaj firmu koja ima ono što ti nedostaje.',invested:people().filter(p=>p.strategy==='invest').length};
 }else if(kind==='negotiate'){
  for(const o of game.offers)if(o.status==='pending')o.status='expired';
  game.results={kind,title:groups().length===1?'Jedan vlasnik je preuzeo sve odluke.':`${groups().length} nezavisnih vlasnika ostalo je za stolom.`,owners:groups().length,mergers:game.offers.filter(o=>o.kind==='merge'&&o.status==='accepted').length,contracts:game.contracts.length};
 }else if(kind==='ask'){
  game.results={kind,title:'Uslovi su javni. Sada dogovorite stvarnu ponudu.'};
 }else if(kind==='price'){
  const missing=groups().filter(g=>g.price===null).length;
  game.market=marketFor(offersForMarket().map(g=>({...g,price:game.owners[g.id].price??50})));
  game.markets.push(game.market);game.periods++;
  for(const p of people()){p.previousProfit=p.lastProfit;p.lastProfit=0;}
  for(const g of game.market.suppliers){
   const owner=game.owners[g.id],allocation=distribute(g.profit,owner.shares);
   for(const [id,amount]of Object.entries(allocation)){const p=game.players.get(id);p.lastProfit=amount;p.earnings=round2(p.earnings+amount);p.cash=round2(p.cash+amount);}
  }
  for(const p of people())p.lastEffect={round:game.round,kind:'payment',label:'Mjesečna isplata',cashChange:p.lastProfit,monthlyBefore:p.previousProfit,monthlyAfter:p.lastProfit,monthlyDelta:round2(p.lastProfit-p.previousProfit),incomePaid:p.lastProfit};
  game.results={kind,title:game.market.excluded?`${game.market.excluded.toLocaleString('sr-RS')} domaćinstava bez interneta.`:'Internet je dostupan svim domaćinstvima.',missing};
 } else if(kind==='entry'){
  const offers=game.market.suppliers.map(g=>({...g}));
  offers.push({id:'new',name:'Novi strani operater',color:'#713f8f',price:40,cost:20,reach:1});
  game.entry={market:marketFor(offers)};
  game.results={kind,title:'Tržište se otvorilo. Novi operater nudi paket za 40 KM.'};
 }

 game.phase='results';game.paused=false;game.revision++;
}
function finalize(){game.phase='final';game.final={owners:groups().length,mergers:game.offers.filter(o=>o.status==='accepted'&&o.kind==='merge').length,contracts:game.contracts.length,ranking:scoreboard().rows};game.revision++;}
function doAdmin(body={}){
 switch(body.action){
 case 'start':if(game.phase!=='lobby')return fail('Igra je počela.');if(game.players.size<3)return fail('Potrebne su najmanje 3 firme. Dodaj demo firme.');initialise();game.startedAt=Date.now();startRound(1);break;
 case 'next':if(game.paused)return fail('Prvo nastavi igru.');if(game.phase==='round')finishRound();else if(game.phase==='results')game.round<STEPS.length?startRound(game.round+1):finalize();else return fail('Ova faza nema sljedeći korak.');break;
 case 'pause':if(game.phase==='round'){game.paused=true;game.pausedAt=Date.now();}break;
 case 'resume':if(game.paused){game.roundStartedAt+=Date.now()-game.pausedAt;game.paused=false;}break;
 case 'reset':resetGame(!!body.clear);break;
 case 'bots':if(game.phase!=='lobby')return fail('Demo firme se dodaju prije početka.');for(let i=0,count=Math.max(1,Math.min(40,Number(body.count)||8));i<count&&game.players.size<60;i++)addPlayer(null,true);break;
 case 'removeBots':if(game.phase!=='lobby')return fail('Demo firme se uklanjaju prije početka.');for(const p of people())if(p.isBot)game.players.delete(p.id);break;
 default:return fail('Nepoznata komanda.',400);
 }
 return ok({phase:game.phase,round:game.round});
}
function preview(o){
 const a=game.owners[o.fromId],b=game.owners[o.toId];if(!a||!b)return null;
 if(o.kind==='access'){const base=groupCost(game.owners[o.tenantId]),beforeMarket=projectionBase(),afterMarket=marketFor(offersForMarket(groups(),[...game.contracts.filter(c=>c.tenantId!==o.tenantId),{landlordId:o.landlordId,tenantId:o.tenantId,fee:o.fee}])),before={},after={},delta={};for(const g of [a,b]){Object.assign(before,distribute(beforeMarket.suppliers.find(x=>x.id===g.id).profit,g.shares));Object.assign(after,distribute(afterMarket.suppliers.find(x=>x.id===g.id).profit,g.shares));}for(const id of Object.keys(before))delta[id]=round2(after[id]-before[id]);return {kind:'access',landlord:game.owners[o.landlordId].name,tenant:game.owners[o.tenantId].name,fee:o.fee,saving:round2(base-Math.max(8,base-8)-o.fee),forecast:{before,after,monthlyAfter:after,delta,remainingOwners:groups().length,losers:Object.values(delta).filter(x=>x<0).length}};}
 const shares={};
 for(const [id,value]of Object.entries(a.shares))shares[id]=value*(100-o.share)/100;
 for(const [id,value]of Object.entries(b.shares))shares[id]=value*o.share/100;
 // Shares are integer basis points; largest remainders preserve exactly 100%.
 const allocation=distribute(100,shares);
 const bp=Object.fromEntries(Object.entries(allocation).map(([id,value])=>[id,Math.round(value*100)]));
 const combined={...a,members:[...a.members,...b.members]};
 const terms={kind:'merge',controller:leader(a).fullName,controllerId:a.leaderId,shares:bp,cost:groupCost(combined),fromCost:groupCost(a),toCost:groupCost(b),fromShare:100-o.share,toShare:o.share,cash:o.cash||0,cashPayouts:distribute(o.cash||0,b.shares)};terms.forecast=payoffForecast(o,terms);return terms;
}
function stale(o){return !game.owners[o.fromId]||!game.owners[o.toId]||game.owners[o.fromId].revision!==o.fromRevision||game.owners[o.toId].revision!==o.toRevision;}
function accept(o){
 const before=effectSnapshot();
 const a=game.owners[o.fromId],b=game.owners[o.toId],acceptedTerms=preview(o);
 if(o.kind==='merge'){
  const terms=acceptedTerms;
  leader(a).cash=round2(leader(a).cash-terms.cash);
  for(const [id,amount]of Object.entries(terms.cashPayouts))game.players.get(id).cash=round2(game.players.get(id).cash+amount);
  a.shares=terms.shares;a.members=[...a.members,...b.members];a.revision++;
  for(const id of b.members)game.players.get(id).groupId=a.id;
  delete game.owners[b.id];
  game.contracts=mergedContracts(a.id,b.id);a.ask=null;
  event(`${b.name} prihvata spajanje. Kontrolu zadržava ${leader(a).fullName}.`);
 }else{
  game.contracts=game.contracts.filter(c=>c.tenantId!==o.tenantId);
  game.contracts.push({landlordId:o.landlordId,tenantId:o.tenantId,fee:o.fee});
  event(`${game.owners[o.tenantId].name} ugovara infrastrukturu: ${o.fee} KM po kupcu. Samostalnost ostaje.`);
 }
 recordEffects(before,o.kind==='merge'?'Spajanje je prihvaćeno':'Ugovor o infrastrukturi','deal');
 if(acceptedTerms.forecast)for(const id of Object.keys(acceptedTerms.forecast.before)){const p=game.players.get(id);if(p.lastEffect){p.lastEffect.monthlyBefore=acceptedTerms.forecast.before[id];p.lastEffect.monthlyAfter=acceptedTerms.forecast.monthlyAfter[id];p.lastEffect.monthlyDelta=round2(p.lastEffect.monthlyAfter-p.lastEffect.monthlyBefore);p.lastEffect.plannedPrice=acceptedTerms.forecast.price||null;}}
 o.status='accepted';
 for(const other of game.offers)if(other.status==='pending'&&stale(other))other.status='stale';
}
function handleAction(p,body={}){
 const reject=error=>({ok:false,error});
 if(game.phase!=='round'||game.paused)return reject(game.paused?'Igra je pauzirana.':'Sačekaj sljedeći korak.');
 if(Number(body.round)!==game.round)return reject('Ova odluka je završena. Osvježi ekran.');
 const kind=step().kind,g=groupOf(p),controls=g.leaderId===p.id;
 if(body.type==='preview'&&body.offerId&&kind==='negotiate'){
  const original=game.offers.find(o=>o.id===body.offerId);if(!original||original.status!=='pending'||stale(original)||!controls||original.awaitingId!==g.id)return reject('Ova ponuda više nije na tvom potezu.');
  const candidate={...original,id:'preview:'+original.id+':'+body.share+':'+body.cash+':'+body.fee};
  if(candidate.kind==='merge'){if(!Number.isInteger(body.share)||body.share<10||body.share>70||body.share%5!==0)return reject('Udio mora biti 10–70%.');if(!Number.isInteger(body.cash)||body.cash<0||body.cash>leader(game.owners[candidate.fromId]).cash)return reject('Ponuđač nema toliko novca.');candidate.share=body.share;candidate.cash=body.cash;}else{if(![2,4,6].includes(body.fee))return reject('Odaberi naknadu 2, 4 ili 6 KM.');candidate.fee=body.fee;}
  return {ok:true,preview:offerState(candidate,p)};
 }
 if(body.type==='strategy'&&kind==='strategy'){
  const before=effectSnapshot();
  if(p.strategy)return reject('Odluka o ulaganju je zaključena.');
  if(!['invest','reserve'].includes(body.value))return reject('Odaberi ulaganje ili rezervu.');
  if(body.value==='invest'){if(p.cash<p.investCost)return reject('Nemaš dovoljno novca.');p.cash-=p.investCost;}
  p.strategy=body.value;game.revision++;recordEffects(before,body.value==='invest'?'Uložio si u efikasnost':'Novac ostaje u rezervi','strategy',p.id);
 }else if(body.type==='ask'&&kind==='ask'){
  if(!controls)return reject('Uslove objavljuje osoba koja ima kontrolu.');
  if(!Number.isInteger(body.share)||body.share<10||body.share>70||body.share%5!==0)return reject('Traži udio 10–70%, u koracima od 5.');
  if(!Number.isSafeInteger(body.cash)||body.cash<0||body.cash>1000000)return reject('Traženi iznos mora biti između 0 i 1.000.000 KM.');
  g.ask={share:body.share,cash:body.cash};game.revision++;
 }else if(['offer','preview'].includes(body.type)&&kind==='negotiate'){
  if(!controls)return reject('Prodao si kontrolu. Samo vlasnik šalje ponude.');
  const target=game.owners[body.target];if(!target||target.id===g.id)return reject('Odaberi drugu nezavisnu firmu.');
  if(body.type==='offer'&&game.offers.filter(o=>o.status==='pending'&&o.fromId===g.id).length>=3)return reject('Tri ponude su već u toku. Sačekaj odgovor prije nove ponude.');
  if(body.type==='offer'&&game.offers.some(o=>o.status==='pending'&&((o.fromId===g.id&&o.toId===target.id)||(o.fromId===target.id&&o.toId===g.id))))return reject('Već pregovarate. Odgovori na postojeću ponudu.');
  if(!['merge','access'].includes(body.kind))return reject('Odaberi vrstu dogovora.');
  const o={id:body.type==='preview'?'preview:'+g.id+':'+target.id+':'+body.kind+':'+body.share+':'+body.cash+':'+body.fee:'o'+(++game.offerSeq),createdAt:Date.now(),kind:body.kind,fromId:g.id,toId:target.id,fromRevision:g.revision,toRevision:target.revision,awaitingId:target.id,status:'pending',counters:0};
  if(body.kind==='merge'){if(!Number.isInteger(body.share)||body.share<10||body.share>70||body.share%5!==0)return reject('Udio mora biti 10–70%, u koracima od 5.');const cash=body.cash??0;if(!Number.isInteger(cash)||cash<0||cash>p.cash)return reject('Gotovinska ponuda mora stati u novac tvoje firme.');o.share=body.share;o.cash=cash;}
  else{if(![2,4,6].includes(body.fee))return reject('Naknada mora biti 2, 4 ili 6 KM.');if(!hasInfra(g)&&!hasInfra(target))return reject('Za ugovor jedna firma mora imati infrastrukturu.');o.landlordId=hasInfra(target)?target.id:g.id;o.tenantId=o.landlordId===target.id?g.id:target.id;o.fee=body.fee;}
  if(body.type==='preview')return {ok:true,preview:offerState(o,p)};
  if(p.isBot&&body.botNote)o.botNote=String(body.botNote).slice(0,200);
  game.offers.push(o);game.revision++;
 }else if(body.type==='respond'&&kind==='negotiate'){
  const o=game.offers.find(o=>o.id===body.offerId);
  if(!o||o.status!=='pending'||stale(o))return reject('Ponuda više nije važeća.');
  if(!controls||o.awaitingId!==g.id)return reject('Na potezu je vlasnik druge firme.');
  if(p.isBot&&body.botNote){o.botNote=String(body.botNote).slice(0,200);for(const groupId of [o.fromId,o.toId])for(const id of game.owners[groupId].members)game.players.get(id).negotiationNote=p.fullName+': '+o.botNote;}
  if(body.decision==='reject'){o.status='rejected';game.revision++;}
  else if(body.decision==='accept'){if(o.kind==='merge'&&leader(game.owners[o.fromId]).cash<(o.cash||0))return reject('Ponuđač više nema dovoljno gotovine. Traži druge uslove.');accept(o);}
  else if(body.decision==='counter'){
   if(o.kind==='merge'){if(!Number.isInteger(body.share)||body.share<10||body.share>70||body.share%5!==0)return reject('Udio mora biti 10–70%, u koracima od 5.');const cash=body.cash??o.cash??0;if(!Number.isInteger(cash)||cash<0||cash>leader(game.owners[o.fromId]).cash)return reject('Traženi novac prelazi gotovinu ponuđača.');o.share=body.share;o.cash=cash;}
   else{if(![2,4,6].includes(body.fee))return reject('Odaberi naknadu 2, 4 ili 6 KM.');o.fee=body.fee;}
   o.awaitingId=g.id===o.fromId?o.toId:o.fromId;o.counters++;game.revision++;
  }else return reject('Odaberi odgovor.');
 }else if(body.type==='price'&&kind==='price'){
  if(!controls)return reject('Tvoj udio donosi profit, ali ne i pravo postavljanja cijene.');
  if(!PRICES.includes(body.value))return reject('Odaberi ponuđenu cijenu.');g.price=body.value;game.revision++;
 }else return reject('Ova odluka nije dostupna sada.');
 return {ok:true};
}
function publicGroup(g){const access=accessFor(g);return {id:g.id,name:g.name,color:g.color,leaderId:g.leaderId,leaderName:leader(g).fullName,leaderCompany:leader(g).name,members:g.members.length,memberNames:g.members.map(id=>game.players.get(id).fullName),cost:groupCost(g),ask:g.ask||null,access:access?{fee:access.fee,landlord:game.owners[access.landlordId].name}:null,price:game.phase==='round'&&step()?.kind==='price'?(game.market?.suppliers.find(x=>x.id===g.id)?.price??null):g.price,priced:g.price!==null,pressure:g.members.filter(id=>game.players.get(id).pressure).length,roles:[...new Set(g.members.map(id=>role(game.players.get(id)).key))]};}
function offerState(o,p){const a=game.owners[o.fromId],b=game.owners[o.toId];if(!a||!b)return null;const terms=preview(o);return {...o,fromName:leader(a).fullName+' · '+a.name,toName:leader(b).fullName+' · '+b.name,awaitingName:game.owners[o.awaitingId]?leader(game.owners[o.awaitingId]).fullName:null,terms,payerCash:leader(a).cash,myShare:terms?.shares?.[p.id]/100||0,canRespond:o.status==='pending'&&o.awaitingId===p.groupId&&groupOf(p).leaderId===p.id};}
function commonState(){
 const kind=step()?.kind;
 const owners=groups();let acted=0,total=game.players.size;
 if(kind==='strategy')acted=people().filter(p=>p.strategy).length;
 if(kind==='negotiate'){acted=game.offers.filter(o=>o.status==='accepted').length;total=0;}
 if(kind==='price'){acted=owners.filter(g=>g.price!==null).length;total=owners.length;}
 if(kind==='ask'){acted=owners.filter(g=>g.ask).length;total=owners.length;}
 if(kind==='entry')total=0;
 return {version:7,revision:game.revision,serverNow:Date.now(),phase:game.phase,round:game.round,roundInfo:step()||null,paused:game.paused,elapsed:game.phase==='round'?Math.max(0,Math.floor(((game.paused?game.pausedAt:Date.now())-game.roundStartedAt)/1000)):0,joinUrl:getJoinUrl(),totals:{players:game.players.size},players:people().map(p=>({id:p.id,name:p.name,fullName:p.fullName,color:p.color,isBot:p.isBot})),groups:owners.map(publicGroup),events:game.events.slice(0,4),progress:{acted,total},baseline:game.baseline,market:game.market,markets:game.markets,scoreboard:scoreboard(),results:game.results,entry:game.entry,final:game.final,meta:{prices:PRICES,budgets:BUDGETS,households:10000,roles:ROLES,steps:STEPS,entryPrice:40}};
}
function playerState(p){
 const s=commonState(),g=groupOf(p);
 s.me={personalIncome:p.earnings,negotiationNote:p.negotiationNote||null,impact:personalImpact(p),id:p.id,name:p.name,fullName:p.fullName,color:p.color,role:role(p),cash:p.cash,initialCash:p.initialCash,gain:round2(p.cash-p.initialCash),monthlyIncome:game.periods?round2(p.earnings/game.periods):0,earnings:p.earnings,lastProfit:p.lastProfit,strategy:p.strategy,investCost:p.investCost,purchase:p.purchase,pressure:p.pressure,group:g?publicGroup(g):null,controls:g?.leaderId===p.id,share:g?(g.shares[p.id]||0)/100:100,price:g?.leaderId===p.id?g.price:null};
 if(game.entry&&g){const after=game.entry.market.suppliers.find(x=>x.id===g.id);s.me.profitAfterEntry=after?distribute(after.profit,g.shares)[p.id]:0;}
 // Contract terms are private to the two parties; personal cash, budgets and tokens never enter public state.
 s.offers=g?game.offers.filter(o=>(o.fromId===g.id||o.toId===g.id)&&o.status==='pending').map(o=>offerState(o,p)).filter(Boolean):[];
 return s;
}
function fairBotTerms(a,b){
 const f=preview({id:'bot-plan:'+a.id+':'+b.id,kind:'merge',fromId:a.id,toId:b.id,share:35,cash:0}).forecast;
 const wa=a.shares[a.leaderId]/10000,wb=b.shares[b.leaderId]/10000;
 if(!wa||!wb)return null;
 const buffer=Math.max(1,Math.min(500,(f.before[a.leaderId]+f.before[b.leaderId])*.02));
 let best=null;
 for(let share=10;share<=70;share+=5){
  const gainA=f.profit*wa*(1-share/100)-f.before[a.leaderId],gainB=f.profit*wb*share/100-f.before[b.leaderId];
  const low=Math.max(0,Math.ceil((buffer-gainB)/wb)),high=Math.min(Math.floor(leader(a).cash),Math.floor(gainA-buffer));
  if(low>high)continue;
  const cash=Math.max(low,Math.min(high,Math.round((gainA-gainB)/(1+wb)))),own=gainA-cash,other=gainB+cash*wb;
  const score=Math.min(own,other)+.05*(own+other);
  if(!best||score>best.score)best={share,cash,own:round2(own),other:round2(other),score};
 }
 return best;
}
function serverlessTick(t=Date.now()){
 game.lastTickAt=t;if(game.paused||game.phase!=='round'||t-game.roundStartedAt<1800)return;
 const kind=step().kind;
 for(const p of people().filter(p=>p.isBot)){
  if(t<(p.botNextAt||0))continue;
  const g=groupOf(p),controls=g.leaderId===p.id;
  p.botNextAt=t+3200+(Number(p.id.slice(1))%4)*500;
  if(kind==='strategy'&&!p.strategy){
   const impact=personalImpact(p).invest;handleAction(p,{type:'strategy',value:(impact.after-impact.before)*2>p.investCost?'invest':'reserve',round:game.round});
  }
  if(kind==='negotiate'&&controls){
   const incoming=game.offers.find(o=>o.status==='pending'&&o.awaitingId===g.id&&!stale(o));
   if(incoming){
    if(t-(incoming.createdAt||game.roundStartedAt)<1800)continue;
    if(incoming.kind==='access'){const saving=preview(incoming).saving;handleAction(p,{type:'respond',offerId:incoming.id,decision:saving>=0?'accept':'counter',fee:2,botNote:saving>=0?'Ugovor mi čuva kontrolu i donosi uštedu.':'Tražim nižu naknadu za infrastrukturu.',round:game.round});continue;}
    const f=preview(incoming).forecast,myGain=f.delta[p.id],a=game.owners[incoming.fromId],b=game.owners[incoming.toId];
    if(myGain>=0&&leader(a).cash>=(incoming.cash||0))handleAction(p,{type:'respond',offerId:incoming.id,decision:'accept',botNote:'Prihvatam: moj procijenjeni lični dobitak je +'+Math.round(myGain)+' KM.',round:game.round});
    else{const proposal=fairBotTerms(a,b);handleAction(p,{type:'respond',offerId:incoming.id,decision:proposal?'counter':'reject',...proposal,botNote:proposal?'Tražim ove uslove jer prethodna ponuda smanjuje moju zaradu.':'Ovaj dogovor mi se ne isplati uz raspoloživi novac.',round:game.round});}
    continue;
   }
   if(t-game.roundStartedAt<6500||game.offers.some(o=>o.status==='pending'&&(o.fromId===g.id||o.toId===g.id)))continue;
   const candidates=groups().filter(x=>x.id!==g.id&&!game.offers.some(o=>o.status==='pending'&&(o.fromId===x.id||o.toId===x.id))).sort((a,b)=>Number(hasInfra(b)!==hasInfra(g))-Number(hasInfra(a)!==hasInfra(g))).slice(0,8);
   const deals=candidates.map(target=>({target,terms:fairBotTerms(g,target)})).filter(x=>x.terms).sort((a,b)=>b.terms.score-a.terms.score);
   if(deals.length){const {target,terms}=deals[0];handleAction(p,{type:'offer',kind:'merge',target:target.id,share:terms.share,cash:terms.cash,botNote:'Predlažem dogovor: meni procijenjeno +'+Math.round(terms.own)+' KM, vama +'+Math.round(terms.other)+' KM uz sadašnje cijene.',round:game.round});}
  }
  if(kind==='price'&&controls&&g.price===null){let best=null;const offers=offersForMarket().map(x=>({...x,price:game.market?.suppliers.find(old=>old.id===x.id)?.price??40}));for(const price of PRICES){const m=marketFor(offers.map(x=>x.id===g.id?{...x,price}:x)),profit=m.suppliers.find(x=>x.id===g.id).profit;if(!best||profit>best.profit)best={price,profit};}handleAction(p,{type:'price',value:best.price,round:game.round});}
  if(kind==='ask'&&controls&&!g.ask)handleAction(p,{type:'ask',share:35,cash:Math.floor(p.cash*.15),round:game.round});
 }
}

function exportState(){return {...game,players:people()};}
function importState(s){if(!s||s.version!==7){resetGame(true);return false;}projectionRevision=-1;projectionCache.clear();Object.assign(game,s,{players:new Map((s.players||[]).map(p=>[p.id,p]))});return true;}
module.exports={game,doJoin,addPlayer,findPlayerByToken,doAdmin,handleAction,commonState,playerState,resetGame,exportState,importState,serverlessTick,configure:options=>{getJoinUrl=options.joinUrl;},marketFor,groupCost,constants:{PRICES,BUDGETS,STEPS,ROLES}};
