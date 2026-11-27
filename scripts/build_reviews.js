// Written (Nepali) reviews for the market, each sector and each stock.
// Technical: organised by John J. Murphy's "Ten Laws of Technical Trading" (Technical Analysis of the Financial Markets).
// Fundamental: Benjamin Graham's criteria from "The Intelligent Investor" (defensive ch.14, enterprising ch.15,
// margin of safety ch.20, Mr. Market ch.8), adapted where NEPSE data differ (banks: CAR/NPL instead of current ratio).
// Rule-based: every sentence comes from the day's numbers. Usage: node scripts/build_reviews.js <repo data dir> <docs/data dir>
const fs = require('fs'), path = require('path');
const MAIN = require.main === module;
const [DATA, OUTD] = MAIN ? process.argv.slice(2) : ['.', '.'];
let L = MAIN ? JSON.parse(fs.readFileSync(path.join(OUTD, 'latest.json'), 'utf8')) : { stocks: [], counts: {} };
let M = MAIN ? JSON.parse(fs.readFileSync(path.join(OUTD, 'market.json'), 'utf8')) : { flows: [], sectors: [], div: { stocks: {}, sectors: {} } };
let BR = MAIN && fs.existsSync(path.join(OUTD, 'brokers.json')) ? JSON.parse(fs.readFileSync(path.join(OUTD, 'brokers.json'), 'utf8')) : null;
const csv = t => { const R = t.trim().split(/\r?\n/); const H = R[0].split(','); return R.slice(1).map(l => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = '' } else cur += ch } out.push(cur); const o = {}; H.forEach((k, j) => o[k] = out[j] ?? ''); return o }) };
const newsPath = path.join(DATA, 'news', 'announcements.csv');
const NEWS = MAIN && fs.existsSync(newsPath) ? csv(fs.readFileSync(newsPath, 'utf8')) : [];
// High-grade yield benchmark for Graham's earnings-yield comparison: average maximum individual fixed-deposit rate of
// commercial banks, Mangsir 2083 (ShareSansar, 2026-11-16). Update when rates change.
const FD_RATE = 3.906, FD_NOTE = 'वाणिज्य बैंकको व्यक्तिगत मुद्दती निक्षेपको औसत अधिकतम दर (मंसिर 2083)';

// ---------- helpers ----------
const n0 = x => x == null || !isFinite(x) ? '–' : Math.round(x).toLocaleString('en-IN');
const n1 = x => x == null || !isFinite(x) ? '–' : Number(x).toFixed(1);
const n2 = x => x == null || !isFinite(x) ? '–' : Number(x).toFixed(2);
const p = (x, d = 1) => x == null || !isFinite(x) ? '–' : (x > 0 ? '+' : '') + Number(x).toFixed(d) + '%';
const rs = x => x == null || !isFinite(x) ? '–' : 'रु. ' + Number(x).toFixed(x >= 1000 ? 0 : 1);
const crore = x => (x / 1e7).toFixed(2) + ' करोड';
const sum = a => a.reduce((x, y) => x + y, 0);
const median = a => { const b = a.filter(x => x != null && isFinite(x)).sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : null };
const smaAt = (a, n, i) => i + 1 >= n ? sum(a.slice(i - n + 1, i + 1)) / n : null;
const emaArr = (a, n) => { const o = new Array(a.length).fill(null); if (a.length < n) return o; let e = sum(a.slice(0, n)) / n; o[n - 1] = e; const k = 2 / (n + 1); for (let i = n; i < a.length; i++) { e = a[i] * k + e * (1 - k); o[i] = e } return o };
const rsiArr = (C, n = 14) => { const o = new Array(C.length).fill(null); if (C.length <= n) return o; let g = 0, l = 0; for (let i = 1; i <= n; i++) { const d = C[i] - C[i - 1]; if (d > 0) g += d; else l -= d } g /= n; l /= n; o[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l); for (let i = n + 1; i < C.length; i++) { const d = C[i] - C[i - 1]; g = (g * (n - 1) + (d > 0 ? d : 0)) / n; l = (l * (n - 1) + (d < 0 ? -d : 0)) / n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l) } return o };
const SECNP = { 'Commercial Banks': 'वाणिज्य बैंक', 'Development Banks': 'विकास बैंक', 'Finance': 'वित्त', 'Hotels And Tourism': 'होटल तथा पर्यटन', 'Hydro Power': 'जलविद्युत', 'Investment': 'लगानी', 'Life Insurance': 'जीवन बीमा', 'Manufacturing And Processing': 'उत्पादन तथा प्रशोधन', 'Microfinance': 'लघुवित्त', 'Non Life Insurance': 'निर्जीवन बीमा', 'Others': 'अन्य', 'Tradings': 'व्यापार' };
const secNp = s => SECNP[s] || s || 'अवर्गीकृत';
const SIG = { buy: 'किन्न योग्य', watch: 'निगरानी', hold: 'होल्ड', sell: 'बिक्री/सावधान' };
let flowsBy = Object.fromEntries((M.flows || []).map(f => [f.sym, f]));
const secRow = Object.fromEntries((M.sectors || []).map(s => [s.sector, s]));
const sectorOf = M.sectorOf || {};
const FUND = M.fundamentals || {};
let DIV = M.div || { stocks: {}, sectors: {} };
const CAPS = M.caps || {}; // NEPSE marketCapitalization is in Rs million
const DISC_T = 'John J. Murphy को "Technical Analysis of the Financial Markets" का Ten Laws को ढाँचामा नियमअनुसार स्वचालित रूपमा लेखिएको समीक्षा हो, लगानी सल्लाह होइन। यही समीक्षाको 2018–2026 backtest मा "अनुकूल" अवस्थाका शेयरले 20 दिनमा बजारलाई औसत 0.1–0.3% मात्र जिते (लागत करिब 1% भन्दा कम) र "कमजोर" ले लगातार हारे — त्यसैले यसलाई समय छान्न र कमजोर शेयरबाट टाढा रहन प्रयोग गर्नुहोस्।';
const DISC_F = 'Benjamin Graham को "The Intelligent Investor" का मापदण्डमा आधारित स्वचालित समीक्षा हो, लगानी सल्लाह होइन। NEPSE का लागि केही मापदण्ड अनुकूलन गरिएका छन् (जस्तै बैंकमा current ratio को सट्टा CAR र NPL)। उपलब्ध नभएका तथ्याङ्कको जाँच "डाटा छैन" भनी छाडिएको छ।';

// ---------- price-structure tools (Murphy) ----------
function pivots(V, k = 3, from = 0) { const hi = [], lo = []; for (let i = Math.max(k, from); i < V.length - k; i++) { const w = V.slice(i - k, i + k + 1); if (V[i] === Math.max(...w)) hi.push(i); if (V[i] === Math.min(...w)) lo.push(i) } return { hi, lo } }
function dowTrend(Hh, Ll, from) {
  const ph = pivots(Hh, 3, from).hi, pl = pivots(Ll, 3, from).lo;
  if (ph.length < 2 || pl.length < 2) return { t: 'अस्पष्ट', d: 0, txt: 'पर्याप्त swing high/low छैनन्' };
  const [h1, h2] = ph.slice(-2), [l1, l2] = pl.slice(-2);
  const hh = Hh[h2] > Hh[h1], hl = Ll[l2] > Ll[l1];
  const txt = `पछिल्ला शिखर ${n1(Hh[h1])} → ${n1(Hh[h2])}, पछिल्ला न्यून ${n1(Ll[l1])} → ${n1(Ll[l2])}`;
  if (hh && hl) return { t: 'उकालो (higher highs, higher lows)', d: 1, txt };
  if (!hh && !hl) return { t: 'ओरालो (lower highs, lower lows)', d: -1, txt };
  return { t: 'दायरा/सङ्क्रमण (शिखर र न्यून एउटै दिशामा छैनन्)', d: 0, txt };
}
function retracement(C, from) {
  const seg = C.slice(from); let iMax = 0, iMin = 0; seg.forEach((v, i) => { if (v > seg[iMax]) iMax = i; if (v < seg[iMin]) iMin = i });
  const hi = seg[iMax], lo = seg[iMin], c = C.at(-1); if (hi <= lo) return null;
  const up = iMax > iMin;
  const lv = r => up ? hi - (hi - lo) * r : lo + (hi - lo) * r;
  const pct = up ? (hi - c) / (hi - lo) * 100 : (c - lo) / (hi - lo) * 100;
  return { up, hi, lo, pct, l33: lv(1 / 3), l382: lv(0.382), l50: lv(0.5), l618: lv(0.618), l66: lv(2 / 3) };
}
function trendline(Hh, Ll, from, up, C) {
  // Murphy: a valid trendline touches at least two rising lows (or falling highs) and has not been broken since.
  // Try pairs among the last 6 pivots (>= 8 bars apart); keep only lines that no close crossed by more than 1% before today;
  // prefer the most recent second point.
  const n = Hh.length, P = (up ? pivots(Ll, 3, from).lo : pivots(Hh, 3, from).hi).slice(-6), V = up ? Ll : Hh;
  let best = null;
  for (let j = P.length - 1; j > 0; j--) for (let k = j - 1; k >= 0; k--) {
    const b = P[j], a = P[k]; if (b - a < 8) continue; if (up ? !(V[b] > V[a]) : !(V[b] < V[a])) continue;
    const slope = (V[b] - V[a]) / (b - a), line = t => V[b] + slope * (t - b);
    let ok = true; for (let t = a + 1; t < n - 1; t++) { if (up ? C[t] < line(t) * 0.99 : C[t] > line(t) * 1.01) { ok = false; break } }
    if (ok && (!best || b > best.b)) best = { a, b, va: V[a], vb: V[b], now: line(n - 1), slope };
  }
  return best;
}
function adx(Hh, Ll, C, n = 14) {
  const N = C.length; if (N < 2 * n + 2) return null; let tr = 0, pdm = 0, mdm = 0; const dx = [];
  let atr, pdi, mdi;
  for (let i = 1; i < N; i++) {
    const up = Hh[i] - Hh[i - 1], dn = Ll[i - 1] - Ll[i];
    const t = Math.max(Hh[i] - Ll[i], Math.abs(Hh[i] - C[i - 1]), Math.abs(Ll[i] - C[i - 1]));
    const pd = up > dn && up > 0 ? up : 0, md = dn > up && dn > 0 ? dn : 0;
    if (i <= n) { tr += t; pdm += pd; mdm += md; if (i === n) { atr = tr; pdi = pdm; mdi = mdm } continue }
    atr = atr - atr / n + t; pdi = pdi - pdi / n + pd; mdi = mdi - mdi / n + md;
    const P = atr > 0 ? 100 * pdi / atr : 0, Mn = atr > 0 ? 100 * mdi / atr : 0; dx.push({ dx: P + Mn > 0 ? 100 * Math.abs(P - Mn) / (P + Mn) : 0, P, Mn });
  }
  if (dx.length < n) return null; let a = sum(dx.slice(0, n).map(x => x.dx)) / n; const series = [a];
  for (let i = n; i < dx.length; i++) { a = (a * (n - 1) + dx[i].dx) / n; series.push(a) }
  return { adx: a, adxPrev: series.at(-6) ?? a, pdi: dx.at(-1).P, mdi: dx.at(-1).Mn };
}
function stoch(Hh, Ll, C, n = 14, s = 3) { const k = []; for (let i = n - 1; i < C.length; i++) { const hh = Math.max(...Hh.slice(i - n + 1, i + 1)), ll = Math.min(...Ll.slice(i - n + 1, i + 1)); k.push(hh > ll ? (C[i] - ll) / (hh - ll) * 100 : 50) } const K = smaAt(k, s, k.length - 1), D = (smaAt(k, s, k.length - 1) + smaAt(k, s, k.length - 2) + smaAt(k, s, k.length - 3)) / 3; return { K, D } }
function weeklyCloses(dates, C) { const W = []; let cur = null; for (let k = 0; k < C.length; k++) { const t = new Date(dates[k] + 'T00:00:00Z'), wk = new Date(t - t.getUTCDay() * 864e5).toISOString().slice(0, 10); if (cur !== wk) { W.push(C[k]); cur = wk } else W[W.length - 1] = C[k] } return W }
function divText(d, what) {
  if (!d) return null;
  return d.type === 'bear'
    ? `${what} ${d.a.d} मा ${n2(d.a.c)} को शिखरपछि ${d.b.d} मा झन् उच्च ${n2(d.b.c)} बनायो, तर RSI ${n1(d.a.r)} बाट ${n1(d.b.r)} मा झर्यो — Bearish divergence। Murphy अनुसार यो प्रवृत्ति कमजोर हुँदै गएको चेतावनी हो, तर पुष्टि (trendline वा support तोडिनु) चाहिन्छ। NEPSE जाँचमा यसपछि 20 दिनमा खास असर देखिएन।`
    : `${what} ${d.a.d} मा ${n2(d.a.c)} को न्यूनपछि ${d.b.d} मा झन् तल ${n2(d.b.c)} बनायो, तर RSI ${n1(d.a.r)} बाट ${n1(d.b.r)} मा उक्लियो — Bullish divergence। Murphy अनुसार यो तलको गति कमजोर भएको सङ्केत हो, तर पुष्टि चाहिन्छ। NEPSE जाँचमा यसपछि शेयर बजारभन्दा 1.2–1.4% कमजोर रहे, त्यसैले एक्लै खरिद सङ्केत होइन।`;
}

// ---------- stock technical review: Murphy's Ten Laws ----------
function stockTech(s) {
  const H = s.hist, C = H.map(r => r[4]), Hh = H.map(r => r[2]), Ll = H.map(r => r[3]), V = H.map(r => r[5]), n = C.length, i = n - 1, c = s.c, m = s.m, lv = s.lv || {};
  const f = flowsBy[s.sym];
  const P = [], ev = [];
  const from120 = Math.max(0, n - 120);
  // Law 1: map the trends (weekly / long-term)
  const W = weeklyCloses(H.map(r => r[0]), C), w10 = smaAt(W, 10, W.length - 1), w40 = smaAt(W, 40, W.length - 1), w40p = smaAt(W, 40, W.length - 5);
  let l1 = `साप्ताहिक chart: अन्तिम हप्ताको close ${rs(W.at(-1))}`;
  if (w40) { const up40 = w40 > w40p; l1 += `, 40 हप्ते औसत ${rs(w40)} (${up40 ? 'उक्लँदो' : 'ओर्लँदो'}) भन्दा ${W.at(-1) > w40 ? 'माथि' : 'तल'}`; ev.push(W.at(-1) > w40 && up40 ? 1 : W.at(-1) < w40 && !up40 ? -1 : 0) }
  if (w10) l1 += `, 10 हप्ते औसत ${rs(w10)} भन्दा ${W.at(-1) > w10 ? 'माथि' : 'तल'}`;
  l1 += `। 52 हप्ते दायरा ${rs(m.lo52)} – ${rs(m.hi52)}; मूल्य दायराको ${n0((c - m.lo52) / (m.hi52 - m.lo52) * 100)}% मा छ। Murphy ले दैनिक निर्णयअघि लामो अवधिको chart हेर्न भन्छन्।`;
  P.push({ h: '1. प्रवृत्तिको नक्सा (साप्ताहिक / लामो अवधि)', t: l1 });
  // Law 2: Dow theory
  const dt = dowTrend(Hh, Ll, from120); ev.push(dt.d);
  P.push({ h: '2. प्रवृत्ति पहिचान (Dow theory)', t: `पछिल्लो 120 दिनको swing संरचना: ${dt.t}। ${dt.txt}। Murphy को नियम: प्रवृत्ति पहिचान गरेर त्यसैको दिशामा जानुहोस् — उकालोमा तल झरेको बेला किन्ने, ओरालोमा माथि उक्लिएको बेला बेच्ने।` });
  // Law 3: support / resistance
  const lvls = []; const add = (v, nm) => { if (v != null && isFinite(v) && v > 0) lvls.push({ v, nm }) };
  add(s.sup, '20 दिने न्यून'); add(s.res, '20 दिने उच्च'); add(m.ma50, '50 दिने औसत'); add(m.ma200, '200 दिने औसत'); add(lv.avwapLo, '52 हप्ते न्यूनदेखिको AVWAP'); add(lv.poc, '60 दिने POC'); add(lv.vah, 'VAH'); add(lv.val, 'VAL'); add(m.hi52, '52 हप्ते उच्च'); add(m.lo52, '52 हप्ते न्यून');
  pivots(Hh, 3, from120).hi.slice(-3).forEach(k => add(Hh[k], `swing high ${H[k][0]}`)); pivots(Ll, 3, from120).lo.slice(-3).forEach(k => add(Ll[k], `swing low ${H[k][0]}`));
  const below = lvls.filter(x => x.v < c * 0.998).sort((a, b) => b.v - a.v).slice(0, 3), above = lvls.filter(x => x.v > c * 1.002).sort((a, b) => a.v - b.v).slice(0, 3);
  P.push({ h: '3. आधार र अवरोध (support / resistance)', t: (below.length ? `तल: ${below.map(x => `${rs(x.v)} (${x.nm}, ${p((x.v / c - 1) * 100)})`).join(', ')}। ` : 'नजिक तल प्रमुख आधार छैन। ') + (above.length ? `माथि: ${above.map(x => `${rs(x.v)} (${x.nm}, ${p((x.v / c - 1) * 100)})`).join(', ')}। ` : 'माथि नजिक प्रमुख अवरोध छैन। ') + 'Murphy अनुसार तोडिएको अवरोध पछि आधार बन्छ, र तोडिएको आधार अवरोध।' + (lv.warnAvwapLo ? ' ⚠️ मूल्य 52 हप्ते न्यूनदेखिको AVWAP तल छ (NEPSE जाँचमा कमजोर सङ्केत)।' : '') + (lv.warnVal ? ' ⚠️ मूल्य 60 दिने value area तल छ (NEPSE जाँचमा कमजोर सङ्केत)।' : '') });
  // Law 4: retracement
  const rt = retracement(C, from120);
  if (rt) P.push({ h: '4. Retracement (कति फर्कियो)', t: rt.up
    ? `पछिल्लो 120 दिनको मुख्य उकालो चाल ${rs(rt.lo)} → ${rs(rt.hi)}। मूल्यले त्यसको ${n0(rt.pct)}% फिर्ता गरेको छ। सामान्य सुधार क्षेत्र: 33–38% ${rs(rt.l33)}–${rs(rt.l382)}, 50% ${rs(rt.l50)}, 62–66% ${rs(rt.l618)}–${rs(rt.l66)}। ` + (rt.pct < 33 ? 'सुधार सानो छ — प्रवृत्ति बलियो।' : rt.pct <= 66 ? 'मूल्य सामान्य सुधार क्षेत्रमा छ — Murphy अनुसार उकालो प्रवृत्ति कायम रहे यही क्षेत्र किन्ने अवसर हो।' : '66% भन्दा बढी फिर्ता — उकालो प्रवृत्ति कमजोर हुँदै।')
    : `पछिल्लो 120 दिनको मुख्य ओरालो चाल ${rs(rt.hi)} → ${rs(rt.lo)}। मूल्य त्यसको ${n0(rt.pct)}% माथि फर्किएको छ। अवरोध क्षेत्र: 33–38% ${rs(rt.l33)}–${rs(rt.l382)}, 50% ${rs(rt.l50)}, 62–66% ${rs(rt.l618)}–${rs(rt.l66)}। ` + (rt.pct < 33 ? 'उछाल सानो — ओरालो प्रवृत्ति कायम।' : rt.pct <= 66 ? 'उछाल सामान्य क्षेत्रमा — यहाँ बिक्री दबाब आउन सक्छ।' : '66% भन्दा बढी फिर्ता — ओरालो प्रवृत्ति कमजोर हुँदै।') });
  // Law 5: trendline
  const upT = dt.d >= 0, tl = trendline(Hh, Ll, from120, upT, C);
  if (tl) { const abv = c > tl.now; ev.push(abv ? 1 : -1);
    P.push({ h: '5. Trendline', t: upT ? `${H[tl.a][0]} (${rs(tl.va)}) र ${H[tl.b][0]} (${rs(tl.vb)}) का उक्लँदा न्यून जोड्ने uptrend line आज करिब ${rs(tl.now)} मा छ; मूल्य त्यसभन्दा ${abv ? 'माथि — रेखा कायम' : 'तल — रेखा तोडियो (चेतावनी)'}।` : `${H[tl.a][0]} (${rs(tl.va)}) र ${H[tl.b][0]} (${rs(tl.vb)}) का झर्दा शिखर जोड्ने downtrend line आज करिब ${rs(tl.now)} मा छ; मूल्य त्यसभन्दा ${abv ? 'माथि — रेखा तोडियो (सुधारको सङ्केत, पुष्टि चाहिन्छ)' : 'तल — ओरालो कायम'}।` }) }
  // Law 6: moving averages
  const ma = [], e20 = s.reasons.find(r => r.k === 'ema20'), e20s = s.reasons.find(r => r.k === 'ema20_slope'), cr = s.reasons.find(r => r.k === 'cross');
  ma.push(`मूल्य 20 दिने EMA ${rs(m.ema20)} भन्दा ${c > m.ema20 ? 'माथि' : 'तल'} (EMA ${e20s?.pts > 0 ? 'उक्लँदो' : 'ओर्लँदो'}), 50 दिने ${rs(m.ma50)} भन्दा ${c > m.ma50 ? 'माथि' : 'तल'}${m.ma200 ? `, 200 दिने ${rs(m.ma200)} भन्दा ${c > m.ma200 ? 'माथि' : 'तल'}` : ''}`);
  if (m.ma200) ma.push(m.ma50 > m.ma200 ? '50 दिने औसत 200 दिनेभन्दा माथि' : '50 दिने औसत 200 दिनेभन्दा तल');
  if (cr) ma.push(cr.t);
  const maScore = (e20?.pts > 0 ? 1 : -1) + (e20s?.pts > 0 ? 1 : -1); ev.push(maScore >= 2 ? 1 : maScore <= -2 ? -1 : 0);
  P.push({ h: '6. Moving average', t: ma.join('; ') + '। NEPSE को जाँचमा 20 दिने EMA माथि र उक्लँदो हुनु दुवै अवधिमा काम गरेको सूचक हो; 50/200 को golden cross भने उल्टो देखिएको थियो।' });
  // Law 7: oscillators
  const st = stoch(Hh, Ll, C); const r = s.rsi;
  ev.push(r > 70 ? -1 : r >= 50 ? 1 : r < 30 ? 0 : -1);
  const dv = divText(DIV.stocks?.[s.sym], 'मूल्यले');
  P.push({ h: '7. Oscillator (RSI, Stochastic)', t: `RSI(14) ${n1(r)} — ${r > 70 ? 'overbought (Murphy: बलियो उकालोमा 70 माथि लामो समय रहन सक्छ, तर नयाँ खरिदमा जोखिम)' : r >= 50 ? 'सकारात्मक क्षेत्र' : r >= 30 ? 'कमजोर क्षेत्र' : 'oversold'}। Stochastic %K ${n0(st.K)} / %D ${n0(st.D)} — ${st.K > 80 ? 'overbought' : st.K < 20 ? 'oversold' : st.K > st.D ? '%K माथि (छोटो अवधि सकारात्मक)' : '%K तल (छोटो अवधि नकारात्मक)'}। Murphy अनुसार oscillator दायरामा बढी उपयोगी, बलियो प्रवृत्तिमा कम।` + (dv ? ' ' + dv : '') });
  // Law 8: MACD
  const C12 = emaArr(C, 12), C26 = emaArr(C, 26); const macd = C.map((x, k) => C12[k] != null && C26[k] != null ? C12[k] - C26[k] : null); const first = macd.findIndex(x => x != null); const sig = new Array(n).fill(null); emaArr(macd.slice(first), 9).forEach((v, k) => sig[first + k] = v);
  const hist = macd.map((x, k) => x != null && sig[k] != null ? x - sig[k] : null), hNow = hist[i], hPrev = hist[i - 3];
  ev.push(macd[i] > sig[i] ? (hNow > hPrev ? 1 : 0) : (hNow < hPrev ? -1 : 0));
  P.push({ h: '8. MACD', t: `MACD ${n2(macd[i])}, signal ${n2(sig[i])} — MACD signal भन्दा ${macd[i] > sig[i] ? 'माथि' : 'तल'}; histogram ${n2(hNow)}, 3 दिनमा ${hNow > hPrev ? 'बढ्दो (गति सुधार हुँदै)' : 'घट्दो (गति कमजोर हुँदै)'}; MACD शून्यभन्दा ${macd[i] > 0 ? 'माथि' : 'तल'}। (NEPSE जाँचमा MACD crossover ले बजारभन्दा कमजोर नतिजा दिएकाले यसलाई स्कोरमा राखिएको छैन; यहाँ प्रवृत्ति पुष्टिका लागि मात्र।)` });
  // Law 9: ADX
  const ax = adx(Hh, Ll, C);
  if (ax) { ev.push(ax.adx > 25 ? (ax.pdi > ax.mdi ? 1 : -1) : 0);
    P.push({ h: '9. प्रवृत्ति कि दायरा? (ADX)', t: `ADX(14) ${n1(ax.adx)} (${ax.adx > ax.adxPrev ? 'बढ्दो' : 'घट्दो'}), +DI ${n1(ax.pdi)}, −DI ${n1(ax.mdi)}। ` + (ax.adx > 25 ? `बलियो ${ax.pdi > ax.mdi ? 'उकालो' : 'ओरालो'} प्रवृत्ति — Murphy अनुसार यस्तो बेला moving average र प्रवृत्ति पछ्याउने तरिका उपयुक्त; oscillator का overbought/oversold सङ्केत कम भरपर्दो।` : ax.adx < 20 ? 'प्रवृत्ति कमजोर वा दायरामा — Murphy अनुसार यस्तो बेला oscillator (RSI, Stochastic) बढी उपयोगी; moving average crossover ले धोका दिन सक्छ।' : 'प्रवृत्ति बन्दै वा कमजोर हुँदै — पुष्टि पर्खनुहोस्।') }) }
  // Law 10: volume
  const w20 = Array.from({ length: 20 }, (_, k) => i - k).filter(k => k > 0);
  const upV = sum(w20.filter(k => C[k] > C[k - 1]).map(k => V[k])), dnV = sum(w20.filter(k => C[k] < C[k - 1]).map(k => V[k])), ratio = dnV > 0 ? upV / dnV : null;
  const obv = s.reasons.find(x => x.k === 'obv');
  ev.push(ratio == null ? 0 : ratio > 1.2 ? 1 : ratio < 0.8 ? -1 : 0);
  const vt = [`20 दिनमा बढ्ने दिनको volume घट्ने दिनको ${n2(ratio)} गुणा`, `आज volume 20 दिने औसतको ${n2(s.volR)} गुणा`];
  if (obv) vt.push(obv.pts > 0 ? 'OBV आफ्नो औसत माथि' : 'OBV आफ्नो औसत तल');
  if (f) { vt.push(`5 दिने CMF ${n2(f.cmf5)}`); if (f.ad === 'acc') vt.push('5 दिने Accumulation'); if (f.ad === 'dist') vt.push('5 दिने Distribution'); if (f.pp === 'pull') vt.push('आज खरिद Pull'); if (f.pp === 'push') vt.push('आज बिक्री Push') }
  const sb = BR?.stocks?.[s.sym]?.today;
  if (sb) vt.push(`ब्रोकर: ${sb.nBuy} ले किने, ${sb.nSell} ले बेचे; शीर्ष net खरिद #${sb.netBuyers[0]?.[0] ?? '–'}, शीर्ष net बिक्री #${sb.netSellers[0]?.[0] ?? '–'}; ${sb.asym > 10 ? 'खरिद केन्द्रित' : sb.asym < -10 ? 'बिक्री केन्द्रित' : 'दुवै छरिएका'}`);
  P.push({ h: '10. Volume ले पुष्टि', t: vt.join('; ') + '। Murphy अनुसार प्रवृत्तिको दिशामा volume बढ्नुपर्छ; ' + (ratio > 1.2 ? 'यहाँ बढ्ने दिनमा volume बढी छ — उकालोलाई पुष्टि।' : ratio < 0.8 ? 'यहाँ घट्ने दिनमा volume बढी छ — बिक्री दबाबको सङ्केत।' : 'यहाँ volume ले कुनै दिशालाई स्पष्ट पुष्टि गर्दैन।') });
  // conclusion: weight of evidence
  const bull = ev.filter(x => x > 0).length, bear = ev.filter(x => x < 0).length, net = bull - bear;
  const warn = (lv.warnAvwapLo ? 1 : 0) + (lv.warnVal ? 1 : 0) + (f?.ad === 'dist' ? 1 : 0) + (f?.pp === 'push' ? 1 : 0);
  let stance, stTxt;
  if (net >= 4 && warn === 0) { stance = 'positive'; stTxt = 'सकारात्मक' }
  else if (net >= 2 && warn <= 1) { stance = 'mildpos'; stTxt = 'सतर्क सकारात्मक' }
  else if (net <= -4) { stance = 'negative'; stTxt = 'नकारात्मक' }
  else if (net <= -2 || warn >= 2) { stance = 'weak'; stTxt = 'कमजोर' }
  else { stance = 'neutral'; stTxt = 'तटस्थ' }
  const sup1 = below[0], res1 = above[0];
  const hold = stance === 'positive' || stance === 'mildpos' ? `राखेका लगानीकर्ता: प्रवृत्ति कायम रहेसम्म होल्ड; ${rs(s.stop)} (2×ATR stop)${tl && upT ? ` वा uptrend line ${rs(tl.now)}` : ''} तल close भए जोखिम घटाउने।`
    : stance === 'neutral' ? `राखेका लगानीकर्ता: होल्ड; ${sup1 ? rs(sup1.v) + ' (' + sup1.nm + ')' : rs(s.stop)} तल close भए सावधान।`
    : `राखेका लगानीकर्ता: प्रमाण कमजोर; ${sup1 ? rs(sup1.v) + ' (' + sup1.nm + ')' : rs(s.stop)} पनि तल झरे घटाउने वा बेच्ने विचार, र मूल्य 20 दिने EMA (${rs(m.ema20)}) माथि नफर्किएसम्म थप नगर्ने।`;
  const fresh = stance === 'positive' ? `नयाँ खरिद: Murphy को "प्रवृत्तिसँगै जाने" नियमअनुसार अनुकूल; ${r > 70 ? 'तर RSI उच्च भएकाले 33–50% retracement वा 20 दिने EMA नजिक सुधार पर्खनु राम्रो' : rt && rt.up ? `सुधार क्षेत्र ${rs(rt.l382)}–${rs(rt.l50)} नजिक चरणबद्ध रूपमा, stop ${rs(s.stop)} सहित` : `stop ${rs(s.stop)} सहित चरणबद्ध रूपमा`}।`
    : stance === 'mildpos' ? `नयाँ खरिद: निगरानी; ${res1 ? res1.nm + ' ' + rs(res1.v) + ' माथि volume सहित टिके वा ' : ''}थप प्रमाण आए मात्र।`
    : stance === 'neutral' ? 'नयाँ खरिद: प्रवृत्ति स्पष्ट नहुन्जेल पर्खने।' : 'नयाँ खरिद: अहिले उपयुक्त देखिँदैन (प्रवृत्ति विरुद्ध नजाने — Murphy)।';
  P.push({ h: 'निष्कर्ष र सुझाव (प्रमाणको भार)', t: `दस नियमका सूचकमध्ये ${bull} सकारात्मक, ${bear} नकारात्मक${warn ? `, ${warn} चेतावनी` : ''} — समग्र: ${stTxt}। स्क्यान अङ्क ${s.sc > 0 ? '+' : ''}${s.sc} (${SIG[s.sig]})। ${hold} ${fresh}` });
  return { stance, stTxt, paras: P, disc: DISC_T, ev: { bull, bear, warn } };
}

// ---------- stock fundamental review: Graham ----------
function fundRow(sym, c) {
  const F = FUND[sym]; if (!F) return null;
  const num = x => x === '' || x == null || !isFinite(+x) ? null : +x;
  const epsQ = num(F.eps_q1a), epsL = num(F.eps_ly), eps = epsQ != null ? epsQ : epsL;
  const bvps = num(F.pb_ref) ? +F.ref_price / +F.pb_ref : null;
  const hist = (F.eps_hist || '').split(';').map(x => x.split(':')).filter(x => x.length === 2 && x[1] !== '' && isFinite(+x[1])).map(([y, v]) => ({ y, v: +v }));
  const dh = (F.div_hist || '').split(';').map(x => x.split(':')).filter(x => x.length === 2).map(([y, v]) => ({ y, v }));
  return { F, eps, epsQ, epsL, loss: eps != null && eps < 0, pe: eps > 0 ? c / eps : null, bvps, pb: bvps ? c / bvps : null, roe: num(F.roe), npl: num(F.npl), car: num(F.car), cr: num(F.current_ratio), de: num(F.de_ratio), hist, dh };
}
function stockFund(s) {
  const sec = sectorOf[s.sym], r = fundRow(s.sym, s.c), c = s.c, m = s.m;
  const news = NEWS.filter(n => n.symbol === s.sym).slice(0, 8);
  const P = []; let verdictOut = null, lt = 'na', ltWhy = 'आधारभूत तथ्याङ्क अझै डाटामा छैन', gnOut = null;
  if (!r) {
    P.push({ h: 'तथ्याङ्क', t: `${s.sym} को EPS, book value जस्ता आधारभूत तथ्याङ्क अझै डाटामा छैनन्, त्यसैले Graham का मापदण्ड जाँच्न सकिएन। साप्ताहिक अद्यावधिकमा थपिँदै जानेछ।` });
  } else {
    const grp = r.F.group || sec || '', isFin = /Bank|Finance|Microfinance/.test(grp), isIns = /Insurance/.test(grp);
    const caps = Object.entries(CAPS).filter(([k]) => sectorOf[k]).map(([, v]) => v).sort((a, b) => b - a), cap = CAPS[s.sym];
    const rank = cap ? caps.findIndex(v => v <= cap) + 1 : null, third = Math.ceil(caps.length / 3);
    const eps3 = r.hist.length >= 3 ? sum(r.hist.slice(-3).map(x => x.v)) / 3 : null;
    const peAvg = eps3 > 0 ? c / eps3 : r.pe;
    const gn = r.eps > 0 && r.bvps ? Math.sqrt(22.5 * r.eps * r.bvps) : null;
    const ey = r.eps > 0 ? r.eps / c * 100 : null;
    const chk = []; const C_ = (k, ok, v) => chk.push({ k, ok, v });
    C_('1. पर्याप्त आकार (NEPSE को माथिल्लो एक-तिहाइ market cap)', rank ? rank <= third : null, cap ? `market cap रु. ${(cap / 10).toFixed(0)} करोड, ${rank}/${caps.length} औँ` : 'डाटा छैन');
    if (isFin) C_('2. बलियो वित्तीय अवस्था (बैंक/वित्तका लागि अनुकूलन: CAR ≥ 12% र NPL ≤ 5%)', r.car != null && r.npl != null ? r.car >= 12 && r.npl <= 5 : r.npl != null && r.npl > 5 ? false : null, `CAR ${r.car != null ? n2(r.car) + '%' : 'छैन'}, NPL ${r.npl != null ? n2(r.npl) + '%' : 'छैन'}`);
    else if (isIns) C_('2. बलियो वित्तीय अवस्था (बीमा: solvency अनुपात चाहिन्छ)', null, 'डाटा छैन');
    else C_('2. बलियो वित्तीय अवस्था (current ratio ≥ 2, ऋण ≤ खुद चालु सम्पत्ति)', r.cr != null ? r.cr >= 2 && (r.de == null || r.de <= 1) : null, r.cr != null ? `current ratio ${n2(r.cr)}${r.de != null ? ', D/E ' + n2(r.de) : ''}` : 'डाटा छैन');
    C_('3. आम्दानी स्थिरता (10 वर्ष लगातार नाफा)', r.hist.length >= 10 ? r.hist.slice(-10).every(x => x.v > 0) : (r.hist.some(x => x.v <= 0) || r.loss) ? false : null, r.hist.length ? `${r.hist.length} वर्षको EPS: ${r.hist.map(x => `${x.y} ${n1(x.v)}`).join(', ')}` : `पछिल्लो: ${r.loss ? 'घाटा' : 'नाफा'} (बहुवर्षीय EPS डाटा छैन)`);
    const dh10 = r.dh.slice(-10), divOk = r.dh.length >= 10 ? dh10.every(x => x.v && x.v !== '0') : (r.dh.some(x => x.v === '0') ? false : null);
    C_('4. लाभांश इतिहास (NEPSE अनुकूलन: 20 को सट्टा 10 वर्ष निरन्तर, नगद वा बोनस)', divOk, r.dh.length ? `${r.dh.length} वर्षको रेकर्ड: ${r.dh.slice(-5).map(x => `${x.y} ${x.v}`).join(', ')}` : 'डाटा छैन' + (news.some(n => n.type === 'dividend') ? ' (हालै लाभांश/बोनस घोषणा भएको छ)' : ''));
    C_('5. आम्दानी वृद्धि (10 वर्षमा कम्तीमा 33%, 3 वर्षे औसतमा)', r.hist.length >= 10 ? (sum(r.hist.slice(-3).map(x => x.v)) / 3) >= 1.33 * (sum(r.hist.slice(-10, -7).map(x => x.v)) / 3) : null, r.hist.length >= 10 ? '3 वर्षे औसत तुलना' : 'डाटा छैन');
    C_('6. मध्यम P/E (≤ 15, सम्भव भए 3 वर्षे औसत EPS मा)', peAvg != null ? peAvg <= 15 : r.loss ? false : null, peAvg != null ? `P/E ${n1(peAvg)}${eps3 ? ' (3 वर्षे औसत)' : ' (उपलब्ध EPS मा)'}` : r.loss ? 'घाटा' : 'डाटा छैन');
    C_('7. मध्यम P/B (≤ 1.5, वा P/E × P/B ≤ 22.5)', r.pb != null ? (r.pb <= 1.5 || (peAvg != null && peAvg * r.pb <= 22.5)) : null, r.pb != null ? `P/B ${n2(r.pb)}${peAvg ? `, P/E × P/B ${n1(peAvg * r.pb)}` : ''}` : 'डाटा छैन');
    const known = chk.filter(x => x.ok != null), pass = known.filter(x => x.ok).length;
    P.push({ h: 'Defensive लगानीकर्ताका सात मापदण्ड (अध्याय 14)', checks: chk, t: `उपलब्ध ${known.length} मध्ये ${pass} पास; ${chk.length - known.length} मापदण्डको डाटा छैन। Graham को defensive लगानीकर्ताले सबै सात पूरा गर्ने शेयर मात्र छान्छ।` });
    const ent = [];
    ent.push(r.pb != null ? `P/B ${n2(r.pb)} ${r.pb <= 1.2 ? '≤ 1.2: net tangible assets को 120% भित्र (पास)' : '> 1.2 (पास भएन)'}` : 'P/B: डाटा छैन');
    ent.push(`पछिल्लो अवधिमा ${r.loss ? 'घाटा (पास भएन)' : 'नाफा (पास)'}`);
    if (!isFin) ent.push(r.cr != null ? `current ratio ${n2(r.cr)} ${r.cr >= 1.5 ? '≥ 1.5 (पास)' : '< 1.5 (पास भएन)'}` : 'current ratio: डाटा छैन');
    ent.push(news.some(n => n.type === 'dividend') || r.dh.length ? 'हालको लाभांश/बोनस: छ' : 'हालको लाभांश: डाटा छैन');
    P.push({ h: 'Enterprising लगानीकर्ताको जाँच (अध्याय 15)', t: ent.join('; ') + '।' });
    P.push({ h: 'सुरक्षाको सीमा (Margin of Safety, अध्याय 20)', t: (gn ? `Graham number (√22.5 × EPS ${n2(r.eps)} × BVPS ${n1(r.bvps)}) = ${rs(gn)}; आजको मूल्य ${rs(c)} — ${c <= gn ? `Graham number भन्दा ${n0((1 - c / gn) * 100)}% तल (सुरक्षाको सीमा छ)` : `Graham number भन्दा ${n0((c / gn - 1) * 100)}% माथि (सुरक्षाको सीमा छैन)`}। ` : r.loss ? 'कम्पनी घाटामा भएकाले Graham number निकाल्न मिल्दैन; सुरक्षाको सीमा छैन। ' : 'Graham number निकाल्न EPS र book value चाहिन्छ। ') +
      (ey != null ? `Earnings yield ${n1(ey)}% — ${FD_NOTE} ${FD_RATE}% को ${n1(ey / FD_RATE)} गुणा। Graham अनुसार शेयरको earnings yield उच्च गुणस्तरको bond वा निक्षेपभन्दा स्पष्ट रूपमा बढी हुनुपर्छ (P/E 15 = 6.7%)। ` : '') +
      (r.F.note && /एकपटके|प्रोभिजन फिर्ता/i.test(r.F.note) ? 'ध्यान: नाफामा एकपटके वा प्रोभिजन फिर्ताको आम्दानी भएकाले EPS बढी देखिन सक्छ; Graham ले यस्तो आम्दानी हटाएर हेर्न भन्छन्। ' : '') +
      (r.epsQ != null ? 'EPS त्रैमासिक नाफालाई वार्षिक बनाएर निकालिएको हो; Graham ले धेरै वर्षको औसत आम्दानी प्रयोग गर्न भन्छन्, त्यसैले बहुवर्षीय EPS आएपछि यो हिसाब बढी भरपर्दो हुनेछ।' : '') });
    const q = [];
    if (r.roe != null) q.push(`ROE ${n1(r.roe)}%`); if (r.npl != null) q.push(`NPL ${n2(r.npl)}%${r.npl >= 10 ? ' (धेरै उच्च)' : r.npl >= 5 ? ' (उच्च)' : ''}`); if (r.car != null) q.push(`CAR ${n2(r.car)}%`);
    const peers = Object.keys(FUND).filter(x => sectorOf[x] === sec).map(x => { const z = L.stocks.find(y => y.sym === x); return z ? fundRow(x, z.c) : null }).filter(Boolean);
    const mPE = median(peers.map(z => z.pe)), mPB = median(peers.map(z => z.pb));
    if (mPE) q.push(`समूह मध्यिका P/E ${n1(mPE)}, P/B ${n2(mPB)}`);
    if (r.F.note) q.push(r.F.note);
    if (q.length) P.push({ h: 'गुणस्तर र समूह तुलना', t: q.join('; ') + '।' });
    const pos = m.hi52 > m.lo52 ? (c - m.lo52) / (m.hi52 - m.lo52) : null;
    const cheap = gn && c <= gn, dear = (gn && c > gn * 1.5) || (peAvg != null && peAvg > 25);
    P.push({ h: 'Mr. Market (अध्याय 8)', t: `मूल्य 120 दिनमा ${p(m.r120)} र 52 हप्ते दायराको ${pos != null ? n0(pos * 100) + '%' : '–'} मा छ। ` + (pos != null && pos < 0.3 && !r.loss && pass >= Math.ceil(known.length / 2) ? 'बजार निराश देखिन्छ तर आधारभूत तथ्याङ्क उल्लेखनीय रूपमा कमजोर छैनन् — Graham अनुसार Mr. Market को निराशा अवसर हुन सक्छ, यदि सुरक्षाको सीमा छ भने।' : pos != null && pos > 0.8 && dear ? 'बजार उत्साहित देखिन्छ र मूल्याङ्कन महँगो — Graham अनुसार Mr. Market को उत्साहमा किन्नुभन्दा पर्खनु राम्रो।' : 'मूल्यलाई बजारको मनोभावभन्दा व्यवसायको आम्दानी र सम्पत्तिका आधारमा हेर्नुहोस् — Mr. Market ले दिने मूल्य स्वीकार गर्न बाध्य छैन।') });
    const known7 = chk.filter(x => x.ok != null).length, fail7 = chk.filter(x => x.ok === false).length;
    lt = r.loss || (r.npl != null && r.npl >= 10) || (gn && c > 1.5 * gn) ? 'sell'
      : known7 === 7 && fail7 === 0 ? 'buy'
      : chk[5].ok === true && chk[6].ok === true && gn && c <= gn && fail7 === 0 ? 'watch' : 'no';
    ltWhy = lt === 'sell' ? (r.loss ? 'कम्पनी घाटामा' : r.npl != null && r.npl >= 10 ? `NPL ${n1(r.npl)}% धेरै उच्च` : `मूल्य Graham number (${rs(gn)}) को ${n1(c / gn)} गुणा — धेरै महँगो`)
      : lt === 'buy' ? 'Graham का सातै मापदण्ड पूरा'
      : lt === 'watch' ? `P/E ${n1(peAvg)} र P/B ${n2(r.pb)} मापदण्डभित्र, मूल्य Graham number (${rs(gn)}) भन्दा तल; ${7 - known7} मापदण्डको डाटा आउन बाँकी`
      : `${known7} मध्ये ${known7 - fail7} मापदण्ड पास; ${chk.filter(x => x.ok === false).map(x => x.k.replace(/^\d\. /, '').replace(/ \(.*$/, '')).join(', ')} पूरा भएन`;
    gnOut = gn;
    verdictOut = r.loss ? 'Graham को मापदण्डमा अयोग्य (घाटा)' : known.length >= 5 && pass === known.length ? 'Defensive लगानीकर्ताका लागि योग्य' : pass >= Math.max(3, known.length - 1) && cheap ? 'आंशिक रूपमा योग्य; सुरक्षाको सीमा छ' : cheap ? 'सुरक्षाको सीमा छ, तर अरू मापदण्ड अपूर्ण वा कमजोर' : 'Graham को मापदण्डमा अहिले योग्य होइन (मूल्य वा गुणस्तर)';
    P.push({ h: 'निष्कर्ष', t: `${verdictOut}। तथ्याङ्कको आधार: ${r.F.period}, स्रोत ${r.F.source.replace('claude/', '')}। P/E, P/B र Graham number हरेक दिनको मूल्यमा फेरि गणना हुन्छन्; EPS र book value नयाँ प्रतिवेदन आएपछि साप्ताहिक रूपमा अद्यावधिक हुन्छन्।` });
  }
  const typeNp = { quarterly: 'त्रैमासिक/वित्तीय प्रतिवेदन', dividend: 'लाभांश/बोनस', right: 'हकप्रद', agm: 'साधारण सभा', bookclose: 'बुक क्लोज', auction: 'लिलाम', merger: 'गाभ्ने/प्राप्ति', ipo: 'IPO/FPO/ऋणपत्र', other: 'अन्य' };
  const fresh = r && news.find(n => n.type === 'quarterly' && n.date > '2026-11-25');
  if (news.length) P.push({ h: 'हालका सूचना', list: news.map(n => ({ d: n.date, t: typeNp[n.type] || n.type, title: n.title, url: n.url })) });
  return { has: !!r, verdict: verdictOut, lt, ltWhy, gn: gnOut, paras: P, disc: DISC_F, stale: !!fresh, staleNote: fresh ? `नयाँ वित्तीय प्रतिवेदन सम्बन्धी सूचना (${fresh.date}) आएको छ; EPS र book value अर्को साप्ताहिक अद्यावधिकसम्म पुराना हुन सक्छन्।` : null };
}

// ---------- index-level technical review (market / sector): Murphy's laws on close-only series ----------
function indexTech(series, label, extra) {
  const D = series.map(x => x[0]), C = series.map(x => x[1]), n = C.length, i = n - 1, c = C[i], P = [], ev = [];
  if (n < 60) return { paras: [{ h: 'प्रवृत्ति', t: 'पर्याप्त इतिहास छैन।' }], bull: 0, bear: 0 };
  const m20 = emaArr(C, 20), m50 = smaAt(C, 50, i), m200 = smaAt(C, 200, i), m50p = smaAt(C, 50, i - 10), m200p = smaAt(C, 200, i - 20);
  const W = weeklyCloses(D, C), w40 = smaAt(W, 40, W.length - 1), w40p = smaAt(W, 40, W.length - 5);
  P.push({ h: '1. प्रवृत्तिको नक्सा', t: `${label} ${n2(c)}; ` + (w40 ? `40 हप्ते औसत ${n2(w40)} (${w40 > w40p ? 'उक्लँदो' : 'ओर्लँदो'}) भन्दा ${c > w40 ? 'माथि' : 'तल'}। ` : '') + `${n} दिनको उच्च ${n2(Math.max(...C))}, न्यून ${n2(Math.min(...C))}।` });
  if (w40) ev.push(c > w40 && w40 > w40p ? 1 : c < w40 && w40 < w40p ? -1 : 0);
  const dt = dowTrend(C, C, Math.max(0, n - 120)); ev.push(dt.d);
  P.push({ h: '2. प्रवृत्ति (Dow theory)', t: `${dt.t}। ${dt.txt}।` });
  const rt = retracement(C, Math.max(0, n - 120));
  if (rt) P.push({ h: '4. Retracement', t: rt.up ? `120 दिनको मुख्य उकालो ${n2(rt.lo)} → ${n2(rt.hi)} को ${n0(rt.pct)}% फिर्ता; 38 / 50 / 62% स्तर ${n2(rt.l382)} / ${n2(rt.l50)} / ${n2(rt.l618)}।` : `120 दिनको मुख्य ओरालो ${n2(rt.hi)} → ${n2(rt.lo)} को ${n0(rt.pct)}% उछाल; 38 / 50 / 62% अवरोध ${n2(rt.l382)} / ${n2(rt.l50)} / ${n2(rt.l618)}।` });
  ev.push(c > m20[i] && m20[i] > m20[i - 5] ? 1 : c < m20[i] && m20[i] < m20[i - 5] ? -1 : 0);
  P.push({ h: '6. Moving average', t: `20 दिने EMA ${n2(m20[i])} (${m20[i] > m20[i - 5] ? 'उक्लँदो' : 'ओर्लँदो'}) भन्दा ${c > m20[i] ? 'माथि' : 'तल'}; 50 दिने ${n2(m50)} (${m50 > m50p ? 'उक्लँदो' : 'ओर्लँदो'}) भन्दा ${c > m50 ? 'माथि' : 'तल'}` + (m200 ? `; 200 दिने ${n2(m200)} (${m200 > m200p ? 'उक्लँदो' : 'ओर्लँदो'}) भन्दा ${c > m200 ? 'माथि' : 'तल'}` : '') + '।' });
  const R = rsiArr(C), r = R[i]; ev.push(r > 70 ? -1 : r >= 50 ? 1 : -1);
  P.push({ h: '7. Oscillator', t: `RSI(14) ${n1(r)} — ${r > 70 ? 'overbought' : r >= 50 ? 'सकारात्मक' : r >= 30 ? 'कमजोर' : 'oversold'}।` + (extra?.div ? ' ' + divText(extra.div, label + ' ले') : ' RSI divergence छैन।') });
  const C12 = emaArr(C, 12), C26 = emaArr(C, 26), mac = C.map((x, k) => C12[k] != null && C26[k] != null ? C12[k] - C26[k] : null), f0 = mac.findIndex(x => x != null), sg = new Array(n).fill(null); emaArr(mac.slice(f0), 9).forEach((v, k) => sg[f0 + k] = v);
  ev.push(mac[i] > sg[i] ? 1 : -1);
  P.push({ h: '8. MACD', t: `MACD ${n2(mac[i])}, signal ${n2(sg[i])} भन्दा ${mac[i] > sg[i] ? 'माथि' : 'तल'}; histogram 3 दिनमा ${mac[i] - sg[i] > mac[i - 3] - sg[i - 3] ? 'बढ्दो' : 'घट्दो'}।` });
  if (extra?.vol) P.push({ h: '10. Volume', t: extra.vol });
  return { paras: P, bull: ev.filter(x => x > 0).length, bear: ev.filter(x => x < 0).length };
}

// ---------- market review ----------
function marketReview() {
  const mk = M.market, o = M.official, bh = M.breadthHist || [];
  const nepse = o?.indices?.find(x => /^nepse/i.test(x.index));
  const b = bh.at(-1)?.[1], b5 = bh.at(-6)?.[1], b20 = bh.at(-21)?.[1];
  const secs = [...(M.sectors || [])].filter(s => s.r20 != null).sort((a, b) => b.r20 - a.r20);
  const it = indexTech(M.capIndex || [], 'बजार सूचक (cap-weighted)', { div: DIV.market, vol: mk ? `आजको कारोबार ${crore(mk.turnover)} (20 दिने औसतको ${n2(mk.turnVs20)} गुणा)। Murphy अनुसार प्रवृत्तिको दिशामा कारोबार बढ्नुपर्छ; ${mk.r5 > 0 && mk.turnVs20 > 1 ? 'बजार बढ्दा कारोबार पनि बढेको — पुष्टि।' : mk.r5 < 0 && mk.turnVs20 > 1 ? 'बजार घट्दा कारोबार बढेको — बिक्री दबाब।' : 'कारोबारले स्पष्ट पुष्टि गर्दैन।'}` : null });
  const P = [];
  P.push({ h: 'आज', t: (nepse ? `NEPSE ${n2(nepse.close ?? nepse.currentValue)} (${p(nepse.perChange, 2)}, ${nepse.change > 0 ? '+' : ''}${n2(nepse.change)} अङ्क)। ` : '') + (mk ? `${mk.adv} बढे, ${mk.dec} घटे, ${mk.unch} स्थिर। Cap-weighted सूचक 1 / 5 / 20 / 60 दिन: ${p(mk.r1, 2)} / ${p(mk.r5, 2)} / ${p(mk.r20, 2)} / ${p(mk.r60, 2)}।` : '') });
  P.push(...it.paras);
  if (b != null) P.push({ h: 'बजार चौडाइ (breadth)', t: `50 दिने औसत माथि रहेका शेयर ${n1(b)}% (5 दिनअघि ${n1(b5)}%, 20 दिनअघि ${n1(b20)}%)। Murphy अनुसार सूचक र breadth एउटै दिशामा हुनुपर्छ; ${b >= 55 ? 'breadth बलियो।' : b >= 40 ? 'breadth मिश्रित।' : 'breadth कमजोर — थोरै शेयरले मात्र सूचक धानेका।'}` });
  if (secs.length) P.push({ h: 'क्षेत्र', t: `20 दिनमा बलिया: ${secs.slice(0, 3).map(s => `${secNp(s.sector)} (${p(s.r20)})`).join(', ')}; कमजोर: ${secs.slice(-3).reverse().map(s => `${secNp(s.sector)} (${p(s.r20)})`).join(', ')}। हालै पैसा बढी आइरहेका: ${(M.sectors || []).filter(s => s.turn5vs20 > 1.15).map(s => secNp(s.sector)).join(', ') || 'छैन'}।` });
  const dS = Object.entries(DIV.stocks || {}), F = M.flows || [];
  P.push({ h: 'प्रवाह र स्क्यान', t: `Pull ${F.filter(x => x.pp === 'pull').length}, Push ${F.filter(x => x.pp === 'push').length}; Accumulation ${F.filter(x => x.ad === 'acc').length}, Distribution ${F.filter(x => x.ad === 'dist').length}; RSI divergence: Bearish ${dS.filter(x => x[1].type === 'bear').length}, Bullish ${dS.filter(x => x[1].type === 'bull').length}। स्क्यान: किन्न योग्य ${L.counts.buy}, निगरानी ${L.counts.watch}, होल्ड ${L.counts.hold}, बिक्री/सावधान ${L.counts.sell}।` });
  const net = it.bull - it.bear + (b >= 55 ? 1 : b < 40 ? -1 : 0);
  const stance = net >= 3 ? 'सकारात्मक' : net <= -3 ? 'कमजोर' : 'मिश्रित';
  P.push({ h: 'समग्र दृष्टिकोण (प्रमाणको भार)', t: `सूचकका ${it.bull} सकारात्मक र ${it.bear} नकारात्मक प्रमाण, साथै breadth ${b != null ? n1(b) + '%' : '–'} — समग्र: ${stance}। ` + (stance === 'सकारात्मक' ? 'प्रवृत्तिसँगै जाने समय; बलिया क्षेत्रका बलिया शेयरमा चरणबद्ध लगानी, stop-loss सहित।' : stance === 'कमजोर' ? 'प्रवृत्ति विरुद्ध नजाने; नयाँ लगानीमा सावधानी र नगद हिस्सा कायम।' : 'चयनात्मक रहने; क्षेत्रभन्दा बलियो र 20 दिने EMA माथि उक्लँदो शेयरमा मात्र।') });
  return { stance, paras: P, disc: DISC_T };
}

// ---------- sector review ----------
function sectorReview(sr) {
  const stocks = L.stocks.filter(s => sectorOf[s.sym] === sr.sector);
  const best = [...stocks].sort((a, b) => b.sc - a.sc).slice(0, 4), worst = [...stocks].sort((a, b) => a.sc - b.sc).slice(0, 3);
  const it = indexTech(sr.series || [], secNp(sr.sector) + ' सूचक', { div: DIV.sectors?.[sr.sector], vol: `कारोबार ${crore(sr.turnover)}; 5 दिने औसत कारोबार 20 दिनेको ${n2(sr.turn5vs20)} गुणा — ${sr.turn5vs20 > 1.15 ? 'हालै पैसा बढी आइरहेको।' : sr.turn5vs20 < 0.85 ? 'हालै चासो घटेको।' : 'सामान्य।'}` });
  const P = [];
  P.push({ h: 'प्रदर्शन', t: (sr.sub ? `${sr.sub.index} आज ${n2(sr.sub.value)} (${p(sr.sub.chg, 2)})। ` : '') + `5 / 20 / 60 दिन / 1 वर्ष: ${p(sr.r5)} / ${p(sr.r20)} / ${p(sr.r60)} / ${p(sr.r250)}।` + (M.market?.r20 != null && sr.r20 != null ? ` 20 दिनमा बजारभन्दा ${Math.abs(sr.r20 - M.market.r20).toFixed(1)} प्रतिशत-अङ्क ${sr.r20 >= M.market.r20 ? 'बलियो (सापेक्ष बल सकारात्मक)' : 'कमजोर'}।` : '') });
  P.push(...it.paras);
  P.push({ h: 'चौडाइ', t: `आज ${sr.adv} बढे, ${sr.dec} घटे; ${n1(sr.pctAbove50)}% कम्पनी 50 दिने औसत माथि; औसत स्क्यान अङ्क ${n1(sr.avgScore)}। स्क्यान: किन्न ${sr.cnt.buy}, निगरानी ${sr.cnt.watch}, होल्ड ${sr.cnt.hold}, बिक्री ${sr.cnt.sell}। Accumulation: ${sr.acc.join(', ') || 'छैन'}; Distribution: ${sr.dist.join(', ') || 'छैन'}।` });
  P.push({ h: 'शेयरहरू', t: `प्राविधिक रूपमा बलिया: ${best.map(s => `${s.sym} (${s.sc > 0 ? '+' : ''}${s.sc})`).join(', ')}। कमजोर: ${worst.map(s => `${s.sym} (${s.sc})`).join(', ')}।` + (stocks.some(x => DIV.stocks?.[x.sym]) ? ` RSI divergence: ${stocks.filter(x => DIV.stocks?.[x.sym]).map(x => `${x.sym} (${DIV.stocks[x.sym].type === 'bear' ? 'Bearish' : 'Bullish'})`).join(', ')}।` : '') });
  const fr = stocks.map(s => fundRow(s.sym, s.c)).filter(Boolean);
  if (fr.length >= 3) { const gn = fr.filter(q => q.eps > 0 && q.bvps).map(q => ({ sym: q.F.symbol, ratio: L.stocks.find(z => z.sym === q.F.symbol).c / Math.sqrt(22.5 * q.eps * q.bvps) })).sort((a, b) => a.ratio - b.ratio);
    P.push({ h: 'आधारभूत (Graham)', t: `उपलब्ध ${fr.length} कम्पनी: मध्यिका P/E ${n1(median(fr.map(q => q.pe)))}, P/B ${n2(median(fr.map(q => q.pb)))}${median(fr.map(q => q.roe)) != null ? `, ROE ${n1(median(fr.map(q => q.roe)))}%` : ''}। P/E ≤ 15 र P/B ≤ 1.5 दुवै पूरा गर्ने: ${fr.filter(q => q.pe && q.pe <= 15 && q.pb && q.pb <= 1.5).map(q => q.F.symbol).join(', ') || 'छैन'}। Graham number भन्दा तल: ${gn.filter(x => x.ratio <= 1).map(x => x.sym).join(', ') || 'छैन'}।` }) }
  const net = it.bull - it.bear + (sr.pctAbove50 >= 55 ? 1 : sr.pctAbove50 < 35 ? -1 : 0) + (M.market?.r20 != null && sr.r20 != null ? (sr.r20 >= M.market.r20 ? 1 : -1) : 0);
  P.push({ h: 'निष्कर्ष र सुझाव', t: net >= 3 ? 'प्रमाण सकारात्मक: क्षेत्र बजारभन्दा बलियो र प्रवृत्ति उकालो। यस क्षेत्रका बलिया शेयरलाई प्राथमिकता दिन सकिन्छ।' : net <= -3 ? 'प्रमाण नकारात्मक: क्षेत्र कमजोर। प्रवृत्ति नफेरिएसम्म नयाँ लगानीमा सावधानी।' : 'प्रमाण मिश्रित: कम्पनीअनुसार छनोट गर्नुपर्ने।' });
  return { paras: P, disc: DISC_T };
}

// ---------- build ----------
module.exports = { stockTech, setFlow: (sym, f) => { flowsBy[sym] = f } };
if (MAIN) {
const out = { date: L.date, generated: new Date().toISOString(), market: marketReview(), sectors: {}, stocks: {}, news: NEWS.slice(0, 60), fdRate: FD_RATE };
for (const sr of M.sectors || []) { try { out.sectors[sr.sector] = sectorReview(sr) } catch (e) { console.error('sector review failed', sr.sector, e.message) } }
const LT = { buy: 'दीर्घकालीन खरिद', watch: 'दीर्घकालीन निगरानी', no: 'Graham योग्य छैन', sell: 'महँगो/कमजोर — बिक्री विचार', na: 'डाटा छैन' };
const ST = { positive: 'अनुकूल', mildpos: 'अनुकूल', neutral: 'तटस्थ', weak: 'प्रतिकूल', negative: 'प्रतिकूल' };
const STK = { positive: 'fav', mildpos: 'fav', neutral: 'neu', weak: 'unf', negative: 'unf' };
function signals(s, tech, fund) {
  const st = STK[tech.stance], lt = fund.lt, val = lt === 'buy' || lt === 'watch';
  const combo = val && st === 'fav' ? ['both', 'मूल्य र समय दुवै अनुकूल']
    : val ? ['value_wait', 'मूल्य राम्रो; समय पर्खने वा थोरै-थोरै किन्ने']
    : st === 'fav' && lt !== 'sell' ? ['trade', 'छोटो अवधिको कारोबार मात्र — stop-loss अनिवार्य']
    : st === 'fav' && lt === 'sell' ? ['trade_dear', 'प्राविधिक अनुकूल तर मूल्य धेरै महँगो — जोखिमपूर्ण']
    : lt === 'sell' ? ['avoid_sell', 'टाढा रहने; राखेको भए बेच्ने विचार']
    : ['avoid', 'अहिले टाढा रहने वा पर्खने'];
  const e = tech.ev, m = s.m;
  const stWhy = `${e.bull} सकारात्मक र ${e.bear} नकारात्मक प्राविधिक प्रमाण${e.warn ? `, ${e.warn} चेतावनी` : ''}`;
  const trend = s.c > m.ema20 && (s.reasons.find(r => r.k === 'ema20_slope')?.pts > 0) ? 'मूल्य 20 दिने EMA माथि र उकालो' : s.c < m.ema20 ? 'मूल्य 20 दिने EMA तल' : 'मूल्य 20 दिने EMA नजिक';
  const summary = [
    `${s.sym} को आजको मूल्य ${rs(s.c)} (${p(s.chg, 2)}) छ; ${trend}।`,
    `दीर्घकालीन (Graham): ${LT[lt]} — ${fund.ltWhy}।`,
    `छोटो अवधि (Murphy): ${ST[tech.stance]} — ${stWhy}।`,
    `संयुक्त: ${combo[1]}।`,
    val || st === 'fav' ? `राखेको भए ${rs(s.stop)} तल बन्द भए जोखिम घटाउने; नयाँ किन्ने भए ${rs(Math.max(s.stop, m.ema20 * 0.99))}–${rs(m.ema20)} नजिक सुधार पर्खनु राम्रो।` : `राखेको भए ${rs(s.stop)} तल बन्द भए घटाउने वा बेच्ने विचार गर्नुहोस्।`
  ].join(' ');
  return { lt, ltTxt: LT[lt], ltWhy: fund.ltWhy, st, stTxt: ST[tech.stance], stWhy, combo: combo[0], comboTxt: combo[1], summary };
}
for (const s of L.stocks) { try { const tech = stockTech(s), fund = stockFund(s); out.stocks[s.sym] = { tech, fund, sig: signals(s, tech, fund) } } catch (e) { console.error('review failed', s.sym, e.message) } }
const sc = {}; Object.values(out.stocks).forEach(x => { const k = x.sig.lt + '/' + x.sig.st; sc[k] = (sc[k] || 0) + 1 }); console.log('signals (Graham/Murphy):', JSON.stringify(sc));
fs.writeFileSync(path.join(OUTD, 'reviews.json'), JSON.stringify(out));
const st = {}; Object.values(out.stocks).forEach(x => st[x.tech.stance] = (st[x.tech.stance] || 0) + 1);
const gv = {}; Object.values(out.stocks).forEach(x => { if (x.fund.verdict) gv[x.fund.verdict] = (gv[x.fund.verdict] || 0) + 1 });
console.log(`reviews.json: market ${out.market.stance}, ${Object.keys(out.sectors).length} sectors, ${Object.keys(out.stocks).length} stocks ${JSON.stringify(st)}, Graham ${JSON.stringify(gv)}, news ${NEWS.length}`);
}
