// Backtest of the dashboard's Murphy (Ten Laws) technical stance — runs the exact stockTech() from scripts/build_reviews.js.
// Usage: node research/backtest_murphy.js <nepse-data/data/company-wise> <out.json>
// Every 5th trading day since 2018, each stock is reviewed on its trailing 300 days (scan analyze() + AVWAP/VP levels + 5-day flows,
// no broker or divergence data). Forward return: buy at next close, hold 20 / 60 trading days; excess = vs the average of all stocks
// sampled that day. Train 2018-2023, test 2024+. t is date-clustered.
const fs = require('fs');
const { DEF, analyze, loadAll } = require('../scripts/lib_scan.js');
const { stockTech, setFlow } = require('../scripts/build_reviews.js');
const [dir, out] = process.argv.slice(2);
const { groups } = loadAll(dir, null, Infinity);
const STEP = 5, START = '2018-01-01', HS = [20, 60];
const r2 = x => x == null || !isFinite(x) ? null : Math.round(x * 100) / 100;
const sum = a => a.reduce((x, y) => x + y, 0);
const allDates = [...new Set(Object.values(groups).flatMap(r => r.map(x => x.ds)))].filter(d => d >= START).sort();
const sample = new Set(allDates.filter((d, i) => i % STEP === 0));

// same as scan_daily.js REPORT_OUT block
const lvl = H => { const n = H.length, i = n - 1; if (n < 70) return null;
  const a0 = Math.max(0, n - 252); let iLo = a0, iHi = a0; for (let k = a0; k < n; k++) { if (H[k][3] < H[iLo][3]) iLo = k; if (H[k][2] > H[iHi][2]) iHi = k }
  const av = a => { let pv = 0, vv = 0; for (let k = a; k < n; k++) { const tp = (H[k][2] + H[k][3] + H[k][4]) / 3; pv += tp * H[k][5]; vv += H[k][5] } return vv > 0 ? pv / vv : null };
  const W = H.slice(n - 61, n - 1); const lo = Math.min(...W.map(r => r[3])), hi = Math.max(...W.map(r => r[2])); let poc = null, vah = null, val = null;
  if (hi > lo) { const B = 24, prof = new Array(B).fill(0); for (const r of W) { if (!(r[5] > 0)) continue; const i0 = Math.min(Math.floor((r[3] - lo) / (hi - lo) * B), B - 1), i1 = Math.min(Math.floor((r[2] - lo) / (hi - lo) * B), B - 1); for (let k = i0; k <= i1; k++) prof[k] += r[5] / (i1 - i0 + 1) }
    let k = prof.indexOf(Math.max(...prof)); const e = j => lo + (hi - lo) * j / B; poc = (e(k) + e(k + 1)) / 2; let L = k, U = k, tot = prof[k]; const tgt = 0.7 * sum(prof);
    while (tot < tgt) { const up = U + 1 < B ? prof[U + 1] : -1, dn = L > 0 ? prof[L - 1] : -1; if (up >= dn) { U++; tot += up } else { L--; tot += dn } } vah = e(U + 1); val = e(L) }
  const c = H[i][4], aLo = av(iLo), aHi = av(iHi);
  return { avwapLo: aLo, avwapLoFrom: H[iLo][0], avwapHi: aHi, poc, vah, val, warnAvwapLo: aLo != null && c < aLo, warnVal: val != null && c < val } };
// same rules as build_market.js flows
const flow = H => { const C = H.map(r => r[4]), Hi = H.map(r => r[2]), Lo = H.map(r => r[3]), V = H.map(r => r[5]); const n = C.length, i = n - 1; if (n < 25) return null;
  const avg20 = sum(V.slice(i - 20, i)) / 20, loc = k => Hi[k] > Lo[k] ? (C[k] - Lo[k]) / (Hi[k] - Lo[k]) : 0.5, mfm = k => Hi[k] > Lo[k] ? ((C[k] - Lo[k]) - (Hi[k] - C[k])) / (Hi[k] - Lo[k]) : 0;
  const w5 = [i - 4, i - 3, i - 2, i - 1, i], v5 = sum(w5.map(k => V[k])), cmf5 = v5 > 0 ? sum(w5.map(k => mfm(k) * V[k])) / v5 : 0;
  const upV = sum(w5.filter(k => C[k] > C[k - 1]).map(k => V[k])), dnV = sum(w5.filter(k => C[k] < C[k - 1]).map(k => V[k])), upRatio = upV + dnV > 0 ? upV / (upV + dnV) : 0.5;
  const r5 = (C[i] / C[i - 5] - 1) * 100, chg = (C[i] / C[i - 1] - 1) * 100, volR = avg20 > 0 ? V[i] / avg20 : 0, vol5R = avg20 > 0 ? v5 / 5 / avg20 : 0, liquid = avg20 * C[i] >= 2e5;
  let pp = null, ad = null;
  if (liquid && volR >= 1.5 && chg >= 2 && loc(i) >= 0.7) pp = 'pull'; if (liquid && volR >= 1.5 && chg <= -2 && loc(i) <= 0.3) pp = 'push';
  if (liquid && vol5R >= 1.0 && cmf5 >= 0.25 && upRatio >= 0.65 && r5 > -3) ad = 'acc'; if (liquid && vol5R >= 1.0 && cmf5 <= -0.25 && upRatio <= 0.35 && r5 < 3) ad = 'dist';
  return { cmf5, upRatio, vol5R, pp, ad } };

const obs = [];
let done = 0; const syms = Object.keys(groups);
for (const sym of syms) {
  const rows = groups[sym];
  for (let i = 260; i < rows.length - 61; i++) {
    if (!sample.has(rows[i].ds)) continue;
    const sl = rows.slice(Math.max(0, i - 299), i + 1);
    const a = analyze(sym, sl, DEF, null); if (a.err) continue;
    const H = sl.map(r => [r.ds, r.o, r.h, r.l, r.c, r.v]);
    setFlow(sym, flow(H));
    let t; try { t = stockTech({ ...a, hist: H, lv: lvl(H) }) } catch (e) { continue }
    const e = rows[i + 1].c; const fw = {}; for (const h of HS) fw[h] = (rows[i + 1 + h].c / e - 1) * 100;
    obs.push({ ds: rows[i].ds, stance: t.stance, net: t.ev.bull - t.ev.bear, warn: t.ev.warn, sig: a.sig, f20: fw[20], f60: fw[60] });
  }
  if (++done % 50 === 0) console.error(done, '/', syms.length, 'stocks,', obs.length, 'obs');
}
for (const h of HS) { const by = {}; for (const o of obs) (by[o.ds] ??= []).push(o['f' + h]); const mk = {}; for (const d in by) mk[d] = sum(by[d]) / by[d].length; for (const o of obs) o['x' + h] = o['f' + h] - mk[o.ds] }
const stat = (list, h) => { if (list.length < 30) return { n: list.length }; const dS = {}; for (const o of list) dS[o.ds] = (dS[o.ds] || 0) + o['x' + h]; const S = Object.values(dS), tot = sum(S);
  return { n: list.length, ex: r2(tot / list.length), t: r2(tot / Math.sqrt(sum(S.map(x => x * x)))), hit: r2(list.filter(o => o['x' + h] > 0).length / list.length * 100), raw: r2(sum(list.map(o => o['f' + h])) / list.length) } };
const per = { train: o => o.ds <= '2023-12-31', test: o => o.ds >= '2024-01-01' };
const res = { generated: new Date().toISOString(), nObs: obs.length, stance: {}, net: {}, combo: {} };
const groupsOf = { stance: o => o.stance, net: o => o.net >= 5 ? '≥5' : o.net <= -5 ? '≤−5' : String(o.net), combo: o => `${o.stance}|${o.sig}` };
for (const [g, key] of Object.entries(groupsOf)) { const keys = [...new Set(obs.map(key))];
  for (const k of keys) { res[g][k] = {}; for (const h of HS) for (const [pn, pf] of Object.entries(per)) res[g][k][`${pn}${h}`] = stat(obs.filter(o => key(o) === k && pf(o)), h) } }
fs.writeFileSync(out, JSON.stringify(res, null, 1));
console.log('obs', obs.length);
for (const g of ['stance', 'net']) { console.log('==', g); for (const [k, v] of Object.entries(res[g]).sort()) console.log(k.padEnd(10), ['train20', 'test20', 'train60', 'test60'].map(x => `${x} n${v[x].n} ex ${v[x].ex} t ${v[x].t}`).join(' | ')) }
