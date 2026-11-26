const zlib=require('zlib'),fs=require('fs');
const [file,...syms]=process.argv.slice(2);
const L=zlib.gunzipSync(fs.readFileSync(file)).toString().trim().split(/\r?\n/);const H=L[0].split(',');const ix=k=>H.indexOf(k);
const want=new Set(syms),agg={};
for(const l of L.slice(1)){const p=l.split(',');const s=p[ix('stockSymbol')];if(!want.has(s))continue;const q=+p[ix('contractQuantity')];const b=p[ix('buyerMemberId')],se=p[ix('sellerMemberId')];agg[s]??={tot:0,buy:{},sell:{}};agg[s].tot+=q;agg[s].buy[b]=(agg[s].buy[b]||0)+q;agg[s].sell[se]=(agg[s].sell[se]||0)+q}
const top=o=>Object.entries(o).sort((x,y)=>y[1]-x[1]).slice(0,3);
for(const s of syms){const a=agg[s];if(!a){console.log(s+' | floorsheet मा छैन');continue}const tb=top(a.buy),ts=top(a.sell);const sh=x=>Math.round(x.reduce((u,v)=>u+v[1],0)/a.tot*100);
console.log(`${s} | कुल ${a.tot} कित्ता | शीर्ष ३ खरिद ब्रोकर ${tb.map(x=>x[0]).join(',')} = ${sh(tb)}% | शीर्ष ३ बिक्री ब्रोकर ${ts.map(x=>x[0]).join(',')} = ${sh(ts)}%${sh(tb)>=50?' ⚠️ खरिद केन्द्रित':''}`)}
