// Daily NEPSE technical scan. Usage: node scripts/scan_daily.js <nepse-data/data/company-wise>
const DEF = {emaS:20, maM:50, maL:200, rsiN:14, rsiLo:30, rsiHi:70, volMult:1.5, brkN:20, atrMult:2, minVol:2000, buyAt:7, sellAt:-3};

function sma(a,n){const o=new Array(a.length).fill(null);let s=0;for(let i=0;i<a.length;i++){s+=a[i];if(i>=n)s-=a[i-n];if(i>=n-1)o[i]=s/n}return o}
function ema(a,n){const o=new Array(a.length).fill(null);if(a.length<n)return o;let s=0;for(let i=0;i<n;i++)s+=a[i];let e=s/n;o[n-1]=e;const k=2/(n+1);for(let i=n;i<a.length;i++){e=a[i]*k+e*(1-k);o[i]=e}return o}
function emaN(a,n){const st=a.findIndex(x=>x!=null);const o=new Array(a.length).fill(null);if(st<0)return o;const sub=ema(a.slice(st),n);for(let i=0;i<sub.length;i++)o[st+i]=sub[i];return o}
function rsi(c,n){const o=new Array(c.length).fill(null);if(c.length<=n)return o;let g=0,l=0;for(let i=1;i<=n;i++){const d=c[i]-c[i-1];if(d>0)g+=d;else l-=d}g/=n;l/=n;o[n]=l===0?100:100-100/(1+g/l);for(let i=n+1;i<c.length;i++){const d=c[i]-c[i-1];g=(g*(n-1)+(d>0?d:0))/n;l=(l*(n-1)+(d<0?-d:0))/n;o[i]=l===0?100:100-100/(1+g/l)}return o}
function atr(h,l,c,n){const tr=c.map((x,i)=>i===0?h[i]-l[i]:Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1])));const o=new Array(c.length).fill(null);if(c.length<n)return o;let s=0;for(let i=0;i<n;i++)s+=tr[i];let a=s/n;o[n-1]=a;for(let i=n;i<c.length;i++){a=(a*(n-1)+tr[i])/n;o[i]=a}return o}
function stdev(a,n){const o=new Array(a.length).fill(null);for(let i=n-1;i<a.length;i++){let m=0;for(let j=i-n+1;j<=i;j++)m+=a[j];m/=n;let v=0;for(let j=i-n+1;j<=i;j++)v+=(a[j]-m)**2;o[i]=Math.sqrt(v/n)}return o}
const maxOf=(a,f,t)=>{let m=-Infinity;for(let i=f;i<=t;i++)if(a[i]!=null&&a[i]>m)m=a[i];return m};
const minOf=(a,f,t)=>{let m=Infinity;for(let i=f;i<=t;i++)if(a[i]!=null&&a[i]<m)m=a[i];return m};

function breadth(groups,cfg){
  let up=0,tot=0;for(const s in groups){const c=groups[s].map(r=>r.c);if(c.length<cfg.maM)continue;const m=sma(c,cfg.maM);tot++;if(c[c.length-1]>m[c.length-1])up++}
  if(tot<20)return null;const p=up/tot;
  return {breadth:p,weak:p<0.4,strong:p>=0.55,txt:(p>=0.55?'बलियो':p<0.4?'कमजोर':'मिश्रित')+' — '+Math.round(p*100)+'% कम्पनी '+cfg.maM+' MA माथि ('+tot+' मध्ये '+up+')'};
}
function analyze(sym,rows,cfg,mkt){
  const n=rows.length;const need=Math.max(cfg.maM,35)+5;
  if(n<need)return {sym,err:'कम्तीमा '+need+' दिनको डाटा चाहिन्छ ('+n+' मात्र)',n};
  const C=rows.map(r=>r.c),H=rows.map(r=>r.h),L=rows.map(r=>r.l),V=rows.map(r=>isNaN(r.v)?0:r.v);const hasV=rows.some(r=>r.v>0);
  const eS=ema(C,cfg.emaS),mM=sma(C,cfg.maM),mL=sma(C,cfg.maL),R=rsi(C,cfg.rsiN);
  const e12=ema(C,12),e26=ema(C,26);const M=C.map((x,i)=>e12[i]!=null&&e26[i]!=null?e12[i]-e26[i]:null);const S=emaN(M,9);
  const A=atr(H,L,C,14);const vA=sma(V,20);
  const ob=[0];for(let i=1;i<n;i++)ob.push(ob[i-1]+(C[i]>C[i-1]?V[i]:C[i]<C[i-1]?-V[i]:0));const obA=sma(ob,20);
  const sd=stdev(C,20),bm=sma(C,20);const bw=C.map((x,i)=>sd[i]!=null?4*sd[i]/bm[i]:null);
  const i=n-1,p=i-1,c=C[i];const R_=[];let sc=0;const add=(pts,t)=>{sc+=pts;R_.push({pts,t})};
  const volR=hasV&&vA[p]>0?V[i]/vA[p]:null;
  const chg=(c/C[p]-1)*100;
  if(mL[i]!=null){c>mL[i]?add(2,'मूल्य '+cfg.maL+' MA माथि — लामो अपट्रेन्ड'):add(-2,'मूल्य '+cfg.maL+' MA तल — लामो डाउनट्रेन्ड');
    mM[i]>mL[i]?add(1,cfg.maM+' MA, '+cfg.maL+' MA माथि'):add(-1,cfg.maM+' MA, '+cfg.maL+' MA तल');
    for(let k=i;k>i-5&&k>0;k--){if(mM[k-1]!=null&&mL[k-1]!=null){if(mM[k]>mL[k]&&mM[k-1]<=mL[k-1])add(1,'हालै Golden Cross');if(mM[k]<mL[k]&&mM[k-1]>=mL[k-1])add(-1,'हालै Death Cross')}}
  } else { c>mM[i]?add(1,'मूल्य '+cfg.maM+' MA माथि ('+cfg.maL+' MA को डाटा पुगेन)'):add(-1,'मूल्य '+cfg.maM+' MA तल ('+cfg.maL+' MA को डाटा पुगेन)') }
  c>eS[i]?add(1,'मूल्य '+cfg.emaS+' EMA माथि'):add(-1,'मूल्य '+cfg.emaS+' EMA तल');
  eS[i]>eS[i-5]?add(1,cfg.emaS+' EMA उक्लँदै'):add(-1,cfg.emaS+' EMA ओर्लँदै');
  M[i]>S[i]?add(1,'MACD सिग्नल लाइन माथि'):add(-1,'MACD सिग्नल लाइन तल');
  for(let k=i;k>i-3;k--){if(M[k]>S[k]&&M[k-1]<=S[k-1]){add(1,'हालै MACD bullish crossover');break}if(M[k]<S[k]&&M[k-1]>=S[k-1]){add(-1,'हालै MACD bearish crossover');break}}
  const r=R[i];
  if(r>cfg.rsiHi)add(-1,'RSI '+r.toFixed(0)+' — overbought, नयाँ खरिदमा जोखिम');
  else if(r>=50)add(1,'RSI '+r.toFixed(0)+' — सकारात्मक गति');
  else if(r<cfg.rsiLo)add(0,'RSI '+r.toFixed(0)+' — oversold (उल्टिने पुष्टि पर्खनुहोस्)');
  else if(r<40)add(-1,'RSI '+r.toFixed(0)+' — कमजोर गति');
  const lb=20;const rMax=maxOf(R,i-lb,p),rMin=minOf(R,i-lb,p);
  if(c>=maxOf(C,i-lb,p)&&r<rMax-5)add(-1,'Bearish divergence: मूल्य नयाँ उच्चमा, RSI पछि परेको');
  if(c<=minOf(C,i-lb,p)&&r>rMin+5)add(1,'Bullish divergence: मूल्य नयाँ न्यूनमा, RSI माथि');
  const res=maxOf(H,i-cfg.brkN,p),sup=minOf(L,i-cfg.brkN,p);
  let brk=false;
  if(c>res){if(volR==null||volR>=cfg.volMult){add(2,cfg.brkN+' दिने resistance '+res.toFixed(1)+' volume सहित तोड्यो');brk=true}else add(0,'resistance तोड्यो तर volume कम — पुष्टि बाँकी')}
  if(c<sup)add(-2,cfg.brkN+' दिने support '+sup.toFixed(1)+' तल झर्यो');
  if(volR!=null){
    if(!brk&&chg>0&&volR>=cfg.volMult)add(1,'मूल्य बढ्दा volume '+volR.toFixed(1)+'× औसत');
    if(chg<0&&volR>=cfg.volMult)add(-1,'मूल्य घट्दा volume '+volR.toFixed(1)+'× औसत — बिक्री दबाब');
    ob[i]>obA[i]?add(1,'OBV आफ्नो औसत माथि — पैसा भित्रिँदै'):add(-1,'OBV आफ्नो औसत तल — पैसा बाहिरिँदै');
  }
  const bwWin=bw.slice(Math.max(0,i-120),i+1).filter(x=>x!=null);if(bwWin.length>40){const s=[...bwWin].sort((a,b)=>a-b);if(bw[i]<=s[Math.floor(s.length*0.1)])add(0,'Bollinger squeeze — ठूलो चाल आउन सक्छ')}
  const avgV=hasV?vA[i]:null;const illiq=avgV!=null&&avgV<cfg.minVol;
  if(illiq)add(-1,'औसत कारोबार '+Math.round(avgV)+' कित्ता मात्र — सूचक कम भरपर्दो');
  let sig=sc>=cfg.buyAt?'buy':sc>=3?'watch':sc<=cfg.sellAt?'sell':'hold';
  if(sig==='buy'&&mkt&&mkt.weak){sig='watch';R_.push({pts:0,t:'बजार कमजोर भएकाले "किन्न योग्य" बाट "निगरानी" मा झारियो'})}
  if(sig==='buy'&&illiq)sig='watch';
  const stop=Math.max(c-cfg.atrMult*A[i],0);
  return {sym,n,c,chg,sc,sig,rsi:r,volR,stop,risk:(c-stop)/c*100,sup,res,illiq,reasons:R_,date:rows[i].ds};
}

const fs=require('fs'),path=require('path');
const dir=process.argv[2]||'nepse-data/data/company-wise';
const groups={};let latest='';
for(const f of fs.readdirSync(dir).filter(x=>x.endsWith('.csv'))){
  const sym=f.slice(0,-4);
  if(/(BD|D)\d{2,}$/.test(sym)||/D\d{4}/.test(sym))continue;
  const L=fs.readFileSync(path.join(dir,f),'utf8').trim().split(/\r?\n/);const H=L[0].split(',');const ix=k=>H.indexOf(k);
  let rows=[];for(const l of L.slice(1)){const p=l.split(',');const r={ds:p[ix('published_date')],o:+p[ix('open')],h:+p[ix('high')],l:+p[ix('low')],c:+p[ix('close')],v:+p[ix('traded_quantity')]||0,pc:parseFloat(p[ix('per_change')])};if(r.c>0)rows.push(r)}
  if(rows.length<60)continue;
  let f_=1;const fac=new Array(rows.length).fill(1);
  for(let i=rows.length-1;i>0;i--){fac[i]=f_;const pc=rows[i].pc;if(!isFinite(pc)||pc<=-100)continue;const prev=rows[i-1].c;
    if(Math.abs(rows[i].c/prev-1-pc/100)>0.03){const k=rows[i].c/(1+pc/100)/prev;if(k>0.3&&k<0.98)f_*=k}}
  fac[0]=f_;
  rows=rows.map((r,i)=>{const k=fac[i];let o=r.o>0?r.o*k:r.c*k,c=r.c*k;return {ds:r.ds,t:Date.parse(r.ds),o,h:Math.max(r.h*k,o,c),l:r.l>0?Math.min(r.l*k,o,c):Math.min(o,c),c,v:r.v/k}}).slice(-300);
  const s=rows.slice(-60).map(r=>r.c).sort((a,b)=>a-b);if(s[30]<25)continue;
  groups[sym]=rows;if(rows.at(-1).ds>latest)latest=rows.at(-1).ds;
}
const cut=new Date(Date.parse(latest)-5*864e5).toISOString().slice(0,10);
for(const s in groups)if(groups[s].at(-1).ds<cut)delete groups[s];
const run=(G)=>{const mk=breadth(G,DEF);const out={};for(const s in G){const a=analyze(s,G[s],DEF,mk);if(!a.err)out[s]=a}return {mk,out}};
const today=run(groups);
const prevG={};for(const s in groups){const r=groups[s].at(-1).ds===latest?groups[s].slice(0,-1):groups[s];prevG[s]=r}
const prev=run(prevG);
const f=(x,d=1)=>x==null?'-':x.toFixed(d);
const cnt={buy:0,watch:0,hold:0,sell:0};Object.values(today.out).forEach(a=>cnt[a.sig]++);
const row=a=>`${a.sym} | अङ्क ${a.sc>0?'+':''}${a.sc} | LTP ${f(a.c)} | RSI ${f(a.rsi,0)} | Vol ${f(a.volR,2)}x | SL ${f(a.stop)} | ${a.reasons.filter(r=>/तोड्यो|Cross|crossover|divergence|overbought/.test(r.t)).map(r=>r.t).join('; ')}`;
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
