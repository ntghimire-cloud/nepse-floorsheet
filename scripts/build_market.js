// Market, sector, broker and flow analysis for the dashboard.
// Usage: node scripts/build_market.js <repo data dir> <docs/data/latest.json> <out dir>
// Reads data/companies.csv, data/prices_full/*.csv.gz, data/index/*.json, data/floorsheet/*.csv.gz,
// data/fundamentals.csv and the scan report; writes market.json and brokers.json into <out dir>.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const [DATA, REPORT, OUT] = process.argv.slice(2);
const r2 = x => x == null || !isFinite(x) ? null : Math.round(x * 100) / 100;
const csv = (txt) => { const L = txt.trim().split(/\r?\n/); const H = L[0].split(','); return L.slice(1).map(l => { const p = l.split(','); const o = {}; H.forEach((k, j) => o[k] = p[j]); return o }) };
const gz = f => zlib.gunzipSync(fs.readFileSync(f)).toString();
const listDates = d => fs.existsSync(d) ? fs.readdirSync(d).map(f => f.slice(0, 10)).filter(x => /^\d{4}-\d\d-\d\d$/.test(x)).sort() : [];
const sum = a => a.reduce((x, y) => x + y, 0);
const rep = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
const scanBy = Object.fromEntries(rep.stocks.map(s => [s.sym, s]));

// ---------- companies / sectors ----------
const comp = fs.existsSync(path.join(DATA, 'companies.csv')) ? csv(fs.readFileSync(path.join(DATA, 'companies.csv'), 'utf8')) : [];
const sectorOf = {};
for (const c of comp) if (c.instrumentType === 'Equity' && c.status === 'A' && c.sectorName && c.sectorName !== 'Mutual Fund') sectorOf[c.symbol] = c.sectorName;
const nameOf = Object.fromEntries(comp.map(c => [c.symbol, c.companyName]));

// ---------- full day prices -> cap-weighted market and sector indices ----------
const pdir = path.join(DATA, 'prices_full');
const pdates = listDates(pdir).slice(-400);
const days = []; // {date, rows: {sym: {...}}}
for (const d of pdates) {
  const rows = {};
  for (const r of csv(gz(path.join(pdir, d + '.csv.gz')))) {
    if (!sectorOf[r.symbol]) continue;
    const c = +r.closePrice, pc = +r.previousDayClosePrice, cap = +r.marketCapitalization;
    if (!(c > 0)) continue;
    rows[r.symbol] = { o: +r.openPrice, h: +r.highPrice, l: +r.lowPrice, c, pc, v: +r.totalTradedQuantity, amt: +r.totalTradedValue, tr: +r.totalTrades, cap, hi52: +r.fiftyTwoWeekHigh, lo52: +r.fiftyTwoWeekLow };
  }
  if (Object.keys(rows).length > 50) days.push({ date: d, rows });
}
const sectors = [...new Set(Object.values(sectorOf))].sort();
function capIndex(filter) {
  // chain-linked: each day's return = sum(cap_t)/sum(cap_{t-1}) over symbols present both days
  const out = []; let lvl = 1000;
  for (let i = 0; i < days.length; i++) {
    if (i > 0) {
      let a = 0, b = 0; const P = days[i - 1].rows, T = days[i].rows;
      for (const s in T) if (filter(s) && P[s] && T[s].cap > 0 && P[s].cap > 0) {
        // use price change for the return (cap jumps on bonus/right listing day otherwise)
        const prevClose = T[s].pc > 0 ? T[s].pc : P[s].c;
        a += P[s].cap * (T[s].c / prevClose); b += P[s].cap;
      }
      if (b > 0) lvl *= a / b;
    }
    out.push([days[i].date, r2(lvl)]);
  }
  return out;
}
const ret = (ser, k) => ser.length > k ? r2((ser[ser.length - 1][1] / ser[ser.length - 1 - k][1] - 1) * 100) : null;
const retY = ser => ser.length > 120 ? ret(ser, Math.min(250, ser.length - 1)) : null; // ~1 year, or all available history
const smaLast = (ser, n) => ser.length >= n ? sum(ser.slice(-n).map(x => x[1])) / n : null;
const mktSeries = capIndex(s => true);

// ---------- official indices ----------
const idir = path.join(DATA, 'index');
const idates = listDates(idir);
const official = idates.length ? JSON.parse(fs.readFileSync(path.join(idir, idates.at(-1) + '.json'), 'utf8')) : null;
const officialHist = idates.map(d => { const j = JSON.parse(fs.readFileSync(path.join(idir, d + '.json'), 'utf8')); const n = (j.indices || []).find(x => /nepse/i.test(x.index) && !/sensitive|float/i.test(x.index)); return [d, n ? r2(n.close ?? n.currentValue) : null] });
const SUBMAP = [['Commercial Banks', /bank/i, /develop/i], ['Development Banks', /develop/i], ['Finance', /finance/i, /micro/i], ['Hotels And Tourism', /hotel/i], ['Hydro Power', /hydro/i], ['Investment', /invest/i], ['Life Insurance', /^life/i], ['Manufacturing And Processing', /manuf/i], ['Microfinance', /micro/i], ['Non Life Insurance', /non ?life/i], ['Others', /other/i], ['Tradings', /trad/i]];
const subFor = sec => { if (!official) return null; const m = SUBMAP.find(x => x[0] === sec); if (!m) return null; return (official.sub || []).find(x => m[1].test(x.index) && !(m[2] && m[2].test(x.index))) || null };

// ---------- per-stock metrics from the scan report (adjusted history) ----------
const today = rep.date;
const flows = [];
for (const s of rep.stocks) {
  const H = s.hist; const n = H.length; if (n < 25) continue;
  const C = H.map(r => r[4]), Hi = H.map(r => r[2]), Lo = H.map(r => r[3]), V = H.map(r => r[5]);
  const i = n - 1, avg20 = sum(V.slice(i - 20, i)) / 20;
  const loc = k => Hi[k] > Lo[k] ? (C[k] - Lo[k]) / (Hi[k] - Lo[k]) : 0.5;
  const mfm = k => Hi[k] > Lo[k] ? ((C[k] - Lo[k]) - (Hi[k] - C[k])) / (Hi[k] - Lo[k]) : 0;
  const w5 = [i - 4, i - 3, i - 2, i - 1, i];
  const v5 = sum(w5.map(k => V[k]));
  const cmf5 = v5 > 0 ? sum(w5.map(k => mfm(k) * V[k])) / v5 : 0;
  const upV = sum(w5.filter(k => C[k] > C[k - 1]).map(k => V[k])), dnV = sum(w5.filter(k => C[k] < C[k - 1]).map(k => V[k]));
  const upRatio = upV + dnV > 0 ? upV / (upV + dnV) : 0.5;
  const obv5 = avg20 > 0 ? sum(w5.map(k => Math.sign(C[k] - C[k - 1]) * V[k])) / (5 * avg20) : 0;
  const r5 = (C[i] / C[i - 5] - 1) * 100, chg = (C[i] / C[i - 1] - 1) * 100, volR = avg20 > 0 ? V[i] / avg20 : null, vol5R = avg20 > 0 ? v5 / 5 / avg20 : null;
  const liquid = avg20 * C[i] >= 2e5; // ~Rs 2 lakh/day
  let pp = null;
  if (liquid && volR >= 1.5 && chg >= 2 && loc(i) >= 0.7) pp = 'pull';
  if (liquid && volR >= 1.5 && chg <= -2 && loc(i) <= 0.3) pp = 'push';
  let ad = null;
  if (liquid && vol5R >= 1.0 && cmf5 >= 0.25 && upRatio >= 0.65 && r5 > -3) ad = 'acc';
  if (liquid && vol5R >= 1.0 && cmf5 <= -0.25 && upRatio <= 0.35 && r5 < 3) ad = 'dist';
  flows.push({ sym: s.sym, sector: sectorOf[s.sym] || null, c: s.c, chg: r2(chg), loc: r2(loc(i)), volR: r2(volR), vol5R: r2(vol5R), r5: r2(r5), cmf5: r2(cmf5), upRatio: r2(upRatio), obv5: r2(obv5), pp, ad, liquid, sc: s.sc, sig: s.sig });
}

// breadth history: % of scanned stocks above their 50-day average close (adjusted)
const bh = {};
for (const s of rep.stocks) { const C = s.hist.map(r => r[4]); for (let i = Math.max(50, C.length - 120); i < C.length; i++) { const m = sum(C.slice(i - 49, i + 1)) / 50; const d = s.hist[i][0]; (bh[d] ??= [0, 0]); bh[d][1]++; if (C[i] > m) bh[d][0]++ } }
const breadthHist = Object.keys(bh).sort().filter(d => bh[d][1] > 100).map(d => [d, r2(bh[d][0] / bh[d][1] * 100)]);

// ---------- floorsheet: brokers ----------
const fdir = path.join(DATA, 'floorsheet');
const fdates = listDates(fdir);
const weekStart = d => { const t = new Date(d + 'T00:00:00Z'); return new Date(t - t.getUTCDay() * 864e5).toISOString().slice(0, 10) }; // NEPSE week starts Sunday
const lastF = fdates.at(-1);
const thisW = lastF ? weekStart(lastF) : null;
const prevW = thisW ? new Date(Date.parse(thisW) - 7 * 864e5).toISOString().slice(0, 10) : null;
const periodsOf = d => { const p = []; if (d === lastF) p.push('today'); const w = weekStart(d); if (w === thisW) p.push('thisWeek'); if (w === prevW) p.push('lastWeek'); if (fdates.slice(-5).includes(d)) p.push('last5'); return p };
const PER = ['today', 'thisWeek', 'lastWeek', 'last5'];
const B = {}; // broker -> period -> {bq,ba,sq,sa,trades, stocks:{sym:[netQ,netA,bq,sq]}}
const S = {}; // sym -> period -> {tot, brokers:{id:[bq,sq,ba,sa]}}
const usedDates = {}; PER.forEach(p => usedDates[p] = []);
for (const d of fdates) {
  const ps = periodsOf(d); if (!ps.length) continue; ps.forEach(p => usedDates[p].push(d));
  const L = gz(path.join(fdir, d + '.csv.gz')).trim().split(/\r?\n/); const Hh = L[0].split(','); const ix = k => Hh.indexOf(k);
  const iS = ix('stockSymbol'), iB = ix('buyerMemberId'), iSe = ix('sellerMemberId'), iQ = ix('contractQuantity'), iA = ix('contractAmount');
  for (let j = 1; j < L.length; j++) {
    const q = L[j].split(','); const sym = q[iS], b = q[iB], se = q[iSe], Q = +q[iQ], A = +q[iA];
    for (const p of ps) {
      const bb = ((B[b] ??= {})[p] ??= { bq: 0, ba: 0, sq: 0, sa: 0, t: 0, st: {} }); bb.bq += Q; bb.ba += A; bb.t++; const x = (bb.st[sym] ??= [0, 0]); x[0] += Q; x[1] += A;
      const ss = ((B[se] ??= {})[p] ??= { bq: 0, ba: 0, sq: 0, sa: 0, t: 0, st: {} }); ss.sq += Q; ss.sa += A; ss.t++; const y = (ss.st[sym] ??= [0, 0]); y[0] -= Q; y[1] -= A;
      const sp = ((S[sym] ??= {})[p] ??= { tot: 0, amt: 0, br: {} }); sp.tot += Q; sp.amt += A;
      const bs = (sp.br[b] ??= [0, 0, 0, 0]); bs[0] += Q; bs[2] += A; const ssx = (sp.br[se] ??= [0, 0, 0, 0]); ssx[1] += Q; ssx[3] += A;
    }
  }
}
const brokers = Object.entries(B).map(([id, per]) => {
  const o = { id };
  for (const p of PER) { const x = per[p]; if (!x) continue;
    const st = Object.entries(x.st).map(([s, [nq, na]]) => [s, nq, Math.round(na)]);
    o[p] = { bq: x.bq, ba: Math.round(x.ba), sq: x.sq, sa: Math.round(x.sa), nq: x.bq - x.sq, na: Math.round(x.ba - x.sa), t: x.t,
      topBuy: st.filter(z => z[2] > 0).sort((a, b) => b[2] - a[2]).slice(0, 10), topSell: st.filter(z => z[2] < 0).sort((a, b) => a[2] - b[2]).slice(0, 10) } }
  return o;
}).sort((a, b) => (+a.id) - (+b.id));
const stockBrokers = {};
for (const [sym, per] of Object.entries(S)) {
  const o = {};
  for (const p of PER) { const x = per[p]; if (!x) continue;
    const net = Object.entries(x.br).map(([id, [bq, sq, ba, sa]]) => [id, bq - sq, Math.round(ba - sa), bq, sq]);
    const nb = net.filter(z => z[1] > 0).sort((a, b) => b[1] - a[1]), ns = net.filter(z => z[1] < 0).sort((a, b) => a[1] - b[1]);
    const top5b = sum(nb.slice(0, 5).map(z => z[1])), top5s = -sum(ns.slice(0, 5).map(z => z[1]));
    o[p] = { tot: x.tot, amt: Math.round(x.amt), nBuy: Object.values(x.br).filter(z => z[0] > 0).length, nSell: Object.values(x.br).filter(z => z[1] > 0).length,
      netBuyers: nb.slice(0, 5), netSellers: ns.slice(0, 5), conc: r2((top5b - top5s) / x.tot * 100), top5b: r2(top5b / x.tot * 100), top5s: r2(top5s / x.tot * 100),
      // broker asymmetry (information only, not yet backtested): Herfindahl concentration of buying vs selling; >0 = buying more concentrated
      hhiB: r2(sum(Object.values(x.br).map(z => (z[0] / x.tot) ** 2)) * 100), hhiS: r2(sum(Object.values(x.br).map(z => (z[1] / x.tot) ** 2)) * 100) };
    o[p].asym = r2(o[p].hhiB - o[p].hhiS); o[p].ratio = o[p].nBuy ? r2(o[p].nSell / o[p].nBuy) : null;
  }
  stockBrokers[sym] = o;
}
// broker-based accumulation (last 5 floorsheet days): top-5 net buyers' net minus top-5 net sellers' net, as % of volume
for (const f of flows) { const x = stockBrokers[f.sym]?.last5; if (x) { f.bconc = x.conc; f.bdays = usedDates.last5.length } }

// ---------- sectors ----------
const secRows = sectors.map(sec => {
  const syms = Object.keys(sectorOf).filter(s => sectorOf[s] === sec);
  const ser = capIndex(s => sectorOf[s] === sec);
  const T = days.at(-1)?.rows || {};
  const inT = syms.filter(s => T[s]);
  const adv = inT.filter(s => T[s].c > T[s].pc).length, dec = inT.filter(s => T[s].c < T[s].pc).length;
  const turn = sum(inT.map(s => T[s].amt || 0));
  const turn20 = days.length > 21 ? sum(days.slice(-21, -1).map(d => sum(syms.map(s => d.rows[s]?.amt || 0)))) / 20 : null;
  const turn5 = days.length > 5 ? sum(days.slice(-5).map(d => sum(syms.map(s => d.rows[s]?.amt || 0)))) / 5 : null;
  const sc = syms.map(s => scanBy[s]).filter(Boolean);
  const cnt = { buy: 0, watch: 0, hold: 0, sell: 0 }; sc.forEach(x => cnt[x.sig]++);
  const above50 = sc.filter(x => x.m.ma50 != null && x.c > x.m.ma50).length;
  const movers = inT.map(s => [s, r2((T[s].c / T[s].pc - 1) * 100)]).filter(x => isFinite(x[1])).sort((a, b) => b[1] - a[1]);
  const fl = flows.filter(f => f.sector === sec);
  const sub = subFor(sec);
  const m50 = smaLast(ser, 50);
  return { sector: sec, n: syms.length, scanned: sc.length, sub: sub ? { index: sub.index, value: r2(sub.currentValue), chg: r2(sub.perChange) } : null,
    r1: ret(ser, 1), r5: ret(ser, 5), r20: ret(ser, 20), r60: ret(ser, 60), r120: ret(ser, 120), r250: retY(ser), aboveIdx50: m50 ? ser.at(-1)[1] > m50 : null,
    adv, dec, turnover: Math.round(turn), turn5vs20: turn20 ? r2(turn5 / turn20) : null, avgScore: sc.length ? r2(sum(sc.map(x => x.sc)) / sc.length) : null, cnt,
    pctAbove50: sc.length ? r2(above50 / sc.length * 100) : null, top: movers.slice(0, 3), bottom: movers.slice(-3).reverse(),
    acc: fl.filter(f => f.ad === 'acc').map(f => f.sym), dist: fl.filter(f => f.ad === 'dist').map(f => f.sym), series: ser.slice(-250) };
});

// ---------- market summary ----------
const T = days.at(-1);
let mkt = null;
if (T) {
  const syms = Object.keys(T.rows);
  const turnover = sum(syms.map(s => T.rows[s].amt || 0)), trades = sum(syms.map(s => T.rows[s].tr || 0)), vol = sum(syms.map(s => T.rows[s].v || 0));
  const turn20 = days.length > 21 ? sum(days.slice(-21, -1).map(d => sum(Object.values(d.rows).map(r => r.amt || 0)))) / 20 : null;
  const ch = s => (T.rows[s].c / T.rows[s].pc - 1) * 100;
  const valid = syms.filter(s => T.rows[s].pc > 0);
  mkt = { date: T.date, adv: valid.filter(s => ch(s) > 0).length, dec: valid.filter(s => ch(s) < 0).length, unch: valid.filter(s => ch(s) === 0).length,
    turnover: Math.round(turnover), trades, volume: vol, turnVs20: turn20 ? r2(turnover / turn20) : null,
    gainers: valid.map(s => [s, r2(ch(s)), T.rows[s].c]).sort((a, b) => b[1] - a[1]).slice(0, 10),
    losers: valid.map(s => [s, r2(ch(s)), T.rows[s].c]).sort((a, b) => a[1] - b[1]).slice(0, 10),
    topTurnover: syms.map(s => [s, Math.round(T.rows[s].amt), r2(ch(s))]).sort((a, b) => b[1] - a[1]).slice(0, 10),
    turnHist: days.slice(-120).map(d => [d.date, Math.round(sum(Object.values(d.rows).map(r => r.amt || 0)))]),
    r1: ret(mktSeries, 1), r5: ret(mktSeries, 5), r20: ret(mktSeries, 20), r60: ret(mktSeries, 60), r250: retY(mktSeries) };
}

// ---------- RSI divergence (regular, pivot-based; same rules as research/walkforward_div.py) ----------
function rsiW(C, n = 14) { const o = new Array(C.length).fill(null); if (C.length <= n) return o; let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = C[i] - C[i - 1]; if (d > 0) g += d; else l -= d } g /= n; l /= n; o[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < C.length; i++) { const d = C[i] - C[i - 1]; g = (g * (n - 1) + (d > 0 ? d : 0)) / n; l = (l * (n - 1) + (d < 0 ? -d : 0)) / n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l) } return o }
function divergence(D, C, k = 3, lookback = 60, gap = 5) {
  // D dates, C closes. Pivot at p is confirmed k bars later. Signal active if the 2nd pivot was within the last 10 days (+k).
  const n = C.length; if (n < 40) return null; const R = rsiW(C), t = n - 1; const ph = [], pl = [];
  for (let p = Math.max(k, t - lookback); p <= t - k; p++) { const w = C.slice(p - k, p + k + 1); if (C[p] === Math.max(...w)) ph.push(p); if (C[p] === Math.min(...w)) pl.push(p) }
  const pt = i => ({ d: D[i], c: r2(C[i]), r: r2(R[i]) });
  if (ph.length >= 2) { const a = ph.at(-2), b = ph.at(-1); if (b - a >= gap && t - b <= 10 + k && C[b] > C[a] && R[b] < R[a] - 2 && R[a] >= 55) return { type: 'bear', a: pt(a), b: pt(b), ago: t - b, rsi: r2(R[t]) } }
  if (pl.length >= 2) { const a = pl.at(-2), b = pl.at(-1); if (b - a >= gap && t - b <= 10 + k && C[b] < C[a] && R[b] > R[a] + 2 && R[a] <= 45) return { type: 'bull', a: pt(a), b: pt(b), ago: t - b, rsi: r2(R[t]) } }
  return null;
}
const div = { market: divergence(mktSeries.map(x => x[0]), mktSeries.map(x => x[1])), sectors: {}, stocks: {} };
for (const sr of secRows) { const d = divergence(sr.series.map(x => x[0]), sr.series.map(x => x[1])); if (d) div.sectors[sr.sector] = d; sr.div = d ? d.type : null }
for (const s of rep.stocks) { const d = divergence(s.hist.map(r => r[0]), s.hist.map(r => r[4])); if (d) div.stocks[s.sym] = d }

// ---------- fundamentals ----------
const fpath = path.join(DATA, 'fundamentals.csv');
const fund = fs.existsSync(fpath) ? Object.fromEntries(csv(fs.readFileSync(fpath, 'utf8')).map(f => [f.symbol, f])) : {};

const market = { date: today, generated: new Date().toISOString(), priceDays: days.length, priceFrom: days[0]?.date || null,
  official, officialHist, capIndex: mktSeries.slice(-250), breadthHist, market: mkt, sectors: secRows, sectorOf, nameOf,
  flows, fundamentals: fund, div, caps: T ? Object.fromEntries(Object.entries(T.rows).map(([k, r]) => [k, Math.round(r.cap)])) : {} };
const brokersOut = { date: lastF, dates: usedDates, thisWeekStart: thisW, lastWeekStart: prevW, brokers, stocks: stockBrokers };
fs.writeFileSync(path.join(OUT, 'market.json'), JSON.stringify(market));
fs.writeFileSync(path.join(OUT, 'brokers.json'), JSON.stringify(brokersOut));
console.log(`RSI divergence: market ${div.market?.type || '-'}, sectors ${JSON.stringify(Object.fromEntries(Object.entries(div.sectors).map(([k, v]) => [k, v.type])))}, stocks bear ${Object.values(div.stocks).filter(x => x.type === 'bear').length} bull ${Object.values(div.stocks).filter(x => x.type === 'bull').length}`);
console.log(`market.json: ${days.length} price days, ${sectors.length} sectors, ${flows.length} flows (pull ${flows.filter(f => f.pp === 'pull').length}, push ${flows.filter(f => f.pp === 'push').length}, acc ${flows.filter(f => f.ad === 'acc').length}, dist ${flows.filter(f => f.ad === 'dist').length})`);
console.log(`brokers.json: ${brokers.length} brokers, floorsheet days ${fdates.length}, periods ${JSON.stringify(usedDates)}`);
