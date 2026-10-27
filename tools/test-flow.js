'use strict';
const assert=require('node:assert/strict');const BASE=process.env.BASE_URL||'http://127.0.0.1:'+(process.env.PORT||4000);
async function req(path,body){const r=await fetch(BASE+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
const admin=(action,extra={})=>req('/api/admin',{action,...extra});
const state=async token=>(await req('/api/state?fresh=1'+(token?'&token='+token:''))).data;
async function main(){
 await admin('reset',{clear:true});const p=[];
 for(let i=0;i<6;i++)p.push((await req('/api/join',{name:'Test '+i,firstName:'Učesnik',lastName:'Prezime '+i})).data);
 const info=(await req('/api/info')).data,qr=await fetch(BASE+'/api/qr');assert.equal(qr.status,200);assert.ok((await qr.text()).includes('<svg'));
 if(!info.serverless){const ctl=new AbortController();const r=await fetch(BASE+'/api/events?token='+p[0].token,{signal:ctl.signal});assert.ok(r.headers.get('content-type').includes('event-stream'));assert.ok(new TextDecoder().decode((await r.body.getReader().read()).value).includes('"me"'));ctl.abort();}
 else assert.equal((await req('/api/events')).data.transport,'poll');
 await admin('start');
 const act=async(i,payload)=>{const st=await state();const r=await req('/api/act',{token:p[i].token,round:st.round,...payload});assert.equal(r.data.ok,true,JSON.stringify(r.data));return r.data;};
 for(let i=0;i<6;i++)await act(i,{type:'strategy',value:'reserve'});await admin('next');await admin('next');
 // Negotiate and counter: the buyer remains the controller even after a counteroffer.
 await act(0,{type:'offer',kind:'merge',target:p[1].id,share:30});
 let offer=(await state(p[1].token)).offers[0];assert.equal(offer.canRespond,true);
 await act(1,{type:'respond',offerId:offer.id,decision:'counter',share:40});await act(0,{type:'respond',offerId:offer.id,decision:'accept'});
 let buyer=await state(p[0].token),seller=await state(p[1].token);assert.equal(buyer.me.controls,true);assert.equal(seller.me.controls,false);assert.equal(seller.me.share,40);assert.equal(seller.me.fullName,'Učesnik Prezime 1');assert.equal(seller.me.group.leaderName,'Učesnik Prezime 0');
 // A contract keeps two other firms independent.
 await act(2,{type:'offer',kind:'access',target:p[4].id,fee:4});offer=(await state(p[4].token)).offers[0];await act(4,{type:'respond',offerId:offer.id,decision:'accept'});
 await admin('next');await admin('next');
 for(let i=0;i<6;i++){const ps=await state(p[i].token);if(ps.me.controls)await act(i,{type:'price',value:80});}
 await admin('next');let st=await state();assert.equal(st.market.excluded,6000);assert.equal(st.groups.length,5);await admin('next');
 for(let i=0;i<6;i++){const ps=await state(p[i].token);if(ps.me.controls)await act(i,{type:'ask',share:35,cash:5000});}await admin('next');await admin('next');
 await act(0,{type:'offer',kind:'merge',target:p[2].id,share:40,cash:1000});offer=(await state(p[2].token)).offers[0];assert.ok(offer.terms.forecast);await act(2,{type:'respond',offerId:offer.id,decision:'accept'});await admin('next');await admin('next');
 for(let i=0;i<6;i++){const ps=await state(p[i].token);if(ps.me.controls)await act(i,{type:'price',value:80});}await admin('next');await admin('next');
 const balances=await Promise.all(p.map(async player=>(await state(player.token)).me.cash));
 await admin('next');st=await state();assert.equal(st.entry.market.independent,st.market.independent+1);assert.deepEqual(await Promise.all(p.map(async player=>(await state(player.token)).me.cash)),balances);assert.equal(st.entry.market.served,9000);await admin('next');st=await state();assert.equal(st.phase,'final');assert.equal(st.final.mergers,2);assert.equal(st.scoreboard.periods,2);assert.ok(st.scoreboard.rows.every(p=>Number.isFinite(p.monthlyIncome)));
 await admin('reset');seller=await state(p[1].token);assert.equal(seller.phase,'lobby');assert.equal(seller.me.cash,0);assert.equal(seller.me.fullName,'Učesnik Prezime 1');
 await admin('reset',{clear:true});assert.equal((await req('/api/state?token='+p[0].token)).status,404);
 console.log('PASS: negotiation, counteroffers, control, rent, two negotiation windows, asks, payoffs, monthly earnings, foreign entry, participant names, QR and resets ('+(info.serverless?'polling':'SSE')+').');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
