// Historical effect of each scan indicator (same code as the daily scan, via lib_scan.js).
// Usage: node scripts/backtest_components.js <nepse-data/data/company-wise> <out.json>
// Every 5th trading day since 2018 each stock is scored on its trailing 300 days. Forward return: buy at next close,
// hold 20 trading days; excess = vs equal-weight average of all stocks scored that day.
// ex = average over dates of the day's mean excess (matches t); exPooled = plain average over all observations. Train 2018-2023, test 2024+.
const fs=require('fs');
const {DEF,analyze,loadAll}=require('./lib_scan.js');
const [dir,out]=process.argv.slice(2);
const {groups}=loadAll(dir,null,Infinity);
const H=20,STEP=5,START='2018-01-01';
const allDates=[...new Set(Object.values(groups).flatMap(r=>r.map(x=>x.ds)))].filter(d=>d>=START).sort();
const sample=new Set(allDates.filter((d,i)=>i%STEP===0));
const obs=[]; // {ds, fwd, sc, sig, comps:{k:pts}}
for(const sym in groups){
  const rows=groups[sym];
  for(let i=210;i<rows.length-H-1;i++){
    if(!sample.has(rows[i].ds))continue;
    const a=analyze(sym,rows.slice(Math.max(0,i-299),i+1),DEF,null);
    if(a.err)continue;
    const comps={};for(const r of a.reasons){if(r.k)comps[r.k]=(comps[r.k]||0)+r.pts}
    obs.push({ds:rows[i].ds,fwd:(rows[i+1+H].c/rows[i+1].c-1)*100,sc:a.sc,sig:a.sig,comps});
  }
}
const byDate={};for(const o of obs)(byDate[o.ds]??=[]).push(o.fwd);
const mkt={};for(const d in byDate){const a=byDate[d];mkt[d]=a.reduce((x,y)=>x+y,0)/a.length}
for(const o of obs)o.ex=o.fwd-mkt[o.ds];
function stat(list){
  // pooled mean excess per trade; t uses date-clustered standard error (sum of each date's total)
  if(list.length<30)return {n:list.length};
  const dS={};for(const o of list)dS[o.ds]=(dS[o.ds]||0)+o.ex;
  const S=Object.values(dS);const tot=S.reduce((x,y)=>x+y,0);const se=Math.sqrt(S.reduce((x,y)=>x+y*y,0));
  const r=x=>Math.round(x*100)/100;
  return {n:list.length,ex:r(tot/list.length),hit:r(list.filter(o=>o.ex>0).length/list.length*100),t:r(tot/se)};
}
const per=p=>p==='train'?o=>o.ds<='2023-12-31':o=>o.ds>='2024-01-01';
const res={generated:new Date().toISOString(),horizon:H,step:STEP,nObs:obs.length,components:{},score:{},signal:{}};
const keys=[...new Set(obs.flatMap(o=>Object.keys(o.comps)))];
for(const k of keys){res.components[k]={};
  for(const side of ['pos','neg','zero']){const f=side==='pos'?o=>o.comps[k]>0:side==='neg'?o=>o.comps[k]<0:o=>k in o.comps&&o.comps[k]===0;
    res.components[k][side]={train:stat(obs.filter(o=>f(o)&&per('train')(o))),test:stat(obs.filter(o=>f(o)&&per('test')(o)))}}}
const buckets=[['≥7',o=>o.sc>=7],['3–6',o=>o.sc>=3&&o.sc<7],['−2–2',o=>o.sc>-3&&o.sc<3],['≤−3',o=>o.sc<=-3]];
for(const [b,f] of buckets)res.score[b]={train:stat(obs.filter(o=>f(o)&&per('train')(o))),test:stat(obs.filter(o=>f(o)&&per('test')(o)))};
fs.writeFileSync(out,JSON.stringify(res,null,1));
console.log('obs',obs.length);for(const b in res.score)console.log(b,JSON.stringify(res.score[b]));
for(const k of keys)console.log(k,'pos',JSON.stringify(res.components[k].pos),'neg',JSON.stringify(res.components[k].neg));
