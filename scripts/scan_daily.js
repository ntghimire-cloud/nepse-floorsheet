// Daily NEPSE technical scan. Usage: node scripts/scan_daily.js <nepse-data/data/company-wise> [nepse-floorsheet/data]
// With the 2nd arg, days missing from nepse-data are filled from data/prices (close, % change) + data/floorsheet (open/high/low/volume).
const fs=require('fs'),path=require('path');
const {DEF,breadth,analyze,loadAll}=require('./lib_scan.js');
const dir=process.argv[2]||'nepse-data/data/company-wise';
const {groups,latest}=loadAll(dir,process.argv[3]);
const cut=new Date(Date.parse(latest)-5*864e5).toISOString().slice(0,10);
for(const s in groups)if(groups[s].at(-1).ds<cut)delete groups[s];
const run=(G)=>{const mk=breadth(G,DEF);const out={};for(const s in G){const a=analyze(s,G[s],DEF,mk);if(!a.err)out[s]=a}return {mk,out}};
const today=run(groups);
const prevG={};for(const s in groups){const r=groups[s].at(-1).ds===latest?groups[s].slice(0,-1):groups[s];prevG[s]=r}
const prev=run(prevG);
const f=(x,d=1)=>x==null?'-':x.toFixed(d);
const cnt={buy:0,watch:0,hold:0,sell:0};Object.values(today.out).forEach(a=>cnt[a.sig]++);
const row=a=>`${a.sym} | अङ्क ${a.sc>0?'+':''}${a.sc} | LTP ${f(a.c)} | RSI ${f(a.rsi,0)} | Vol ${f(a.volR,2)}x | SL ${f(a.stop)} | ${a.reasons.filter(r=>/तोड्यो|Cross|divergence|overbought/.test(r.t)).map(r=>r.t).join('; ')}`;
const all=Object.values(today.out);
const newBuy=all.filter(a=>a.sig==='buy'&&prev.out[a.sym]?.sig!=='buy').sort((a,b)=>b.sc-a.sc);
const newSell=all.filter(a=>a.sig==='sell'&&prev.out[a.sym]?.sig!=='sell').sort((a,b)=>a.sc-b.sc);
const lostBuy=all.filter(a=>a.sig!=='buy'&&prev.out[a.sym]?.sig==='buy');
const buys=all.filter(a=>a.sig==='buy').sort((a,b)=>b.sc-a.sc);
console.log("prev market:",prev.mk?.txt);console.log(JSON.stringify({date:latest,companies:all.length,market:today.mk?.txt,counts:cnt},null,0));
console.log('\n## नयाँ किन्न योग्य ('+newBuy.length+')');newBuy.forEach(a=>console.log(row(a)));
console.log('\n## नयाँ बिक्री/सावधान ('+newSell.length+')');newSell.forEach(a=>console.log(row(a)));
console.log('\n## किन्न योग्यबाट झरेका ('+lostBuy.length+')');lostBuy.forEach(a=>console.log(a.sym+' → '+a.sig+' (अङ्क '+a.sc+')'));
console.log('\n## आजका सबै किन्न योग्य ('+buys.length+')');buys.forEach(a=>console.log(row(a)));
console.log('\nBUY_SYMBOLS: '+buys.map(a=>a.sym).join(' '));

// Optional: full JSON for the dashboard. Usage: REPORT_OUT=path node scripts/scan_daily.js ...
if(process.env.REPORT_OUT){
  const r2=x=>x==null||!isFinite(x)?null:Math.round(x*100)/100;
  const stocks=all.map(a=>({sym:a.sym,date:a.date,c:r2(a.c),chg:r2(a.chg),sc:a.sc,sig:a.sig,prevSig:prev.out[a.sym]?.sig||null,prevSc:prev.out[a.sym]?.sc??null,
    rsi:r2(a.rsi),volR:r2(a.volR),stop:r2(a.stop),risk:r2(a.risk),sup:r2(a.sup),res:r2(a.res),illiq:a.illiq,
    reasons:a.reasons.map(x=>({k:x.k,pts:x.pts,t:x.t})),m:Object.fromEntries(Object.entries(a.m).map(([k,v])=>[k,r2(v)])),
    hist:groups[a.sym].map(r=>[r.ds,r2(r.o),r2(r.h),r2(r.l),r2(r.c),Math.round(r.v)])}));
  // score history (last 60 sessions, market filter not applied) and floorsheet broker split for the scan date
  for(const st of stocks){const rows=groups[st.sym];const h=[];for(let j=Math.max(0,rows.length-60);j<rows.length;j++){const x=analyze(st.sym,rows.slice(0,j+1),DEF,null);if(!x.err)h.push([rows[j].ds,x.sc])}st.scoreHist=h}
  const fsFile=process.argv[3]?path.join(process.argv[3],'floorsheet',latest+'.csv.gz'):null;
  if(fsFile&&fs.existsSync(fsFile)){
    const L=require('zlib').gunzipSync(fs.readFileSync(fsFile)).toString().trim().split(/\r?\n/);const Hh=L[0].split(',');const ix=k=>Hh.indexOf(k);const agg={};
    for(const l of L.slice(1)){const q=l.split(',');const sy=q[ix('stockSymbol')];const n=+q[ix('contractQuantity')];const g=agg[sy]??={tot:0,trades:0,buy:{},sell:{}};g.tot+=n;g.trades++;g.buy[q[ix('buyerMemberId')]]=(g.buy[q[ix('buyerMemberId')]]||0)+n;g.sell[q[ix('sellerMemberId')]]=(g.sell[q[ix('sellerMemberId')]]||0)+n}
    const top=(o,t)=>Object.entries(o).sort((x,y)=>y[1]-x[1]).slice(0,5).map(([b,q])=>[b,q,r2(q/t*100)]);
    for(const st of stocks){const g=agg[st.sym];if(g)st.broker={qty:g.tot,trades:g.trades,nBuyers:Object.keys(g.buy).length,nSellers:Object.keys(g.sell).length,buy:top(g.buy,g.tot),sell:top(g.sell,g.tot),top3Buy:r2(top(g.buy,g.tot).slice(0,3).reduce((x,y)=>x+y[2],0)),top3Sell:r2(top(g.sell,g.tot).slice(0,3).reduce((x,y)=>x+y[2],0))}}
  }
  fs.writeFileSync(process.env.REPORT_OUT,JSON.stringify({date:latest,generated:new Date().toISOString(),market:today.mk?.txt,breadth:today.mk?.breadth,prevMarket:prev.mk?.txt,counts:cnt,cfg:DEF,stocks}));
  console.log('report -> '+process.env.REPORT_OUT+' ('+stocks.length+' stocks)');
}
