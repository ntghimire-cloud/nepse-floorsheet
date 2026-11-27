// Written (Nepali) technical and fundamental reviews for the market, each sector and each stock.
// Rule-based: every sentence comes from the day's numbers, so it updates with the daily chart data.
// Usage: node scripts/build_reviews.js <repo data dir> <docs/data dir>   (needs latest.json, market.json, brokers.json there)
const fs = require('fs'), path = require('path');
const [DATA, OUTD] = process.argv.slice(2);
const L = JSON.parse(fs.readFileSync(path.join(OUTD, 'latest.json'), 'utf8'));
const M = JSON.parse(fs.readFileSync(path.join(OUTD, 'market.json'), 'utf8'));
const BR = fs.existsSync(path.join(OUTD, 'brokers.json')) ? JSON.parse(fs.readFileSync(path.join(OUTD, 'brokers.json'), 'utf8')) : null;
const csv = t => { const R = t.trim().split(/\r?\n/); const H = R[0].split(','); return R.slice(1).map(l => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = '' } else cur += ch } out.push(cur); const o = {}; H.forEach((k, j) => o[k] = out[j] ?? ''); return o }) };
const newsPath = path.join(DATA, 'news', 'announcements.csv');
const NEWS = fs.existsSync(newsPath) ? csv(fs.readFileSync(newsPath, 'utf8')) : [];

// ---------- helpers ----------
const n1 = x => x == null || !isFinite(x) ? '–' : Number(x).toFixed(1);
const n2 = x => x == null || !isFinite(x) ? '–' : Number(x).toFixed(2);
const p = (x, d = 1) => x == null || !isFinite(x) ? '–' : (x > 0 ? '+' : '') + Number(x).toFixed(d) + '%';
const rs = x => x == null || !isFinite(x) ? '–' : 'रु. ' + Number(x).toFixed(x >= 1000 ? 0 : 1);
const crore = x => (x / 1e7).toFixed(2) + ' करोड';
const sum = a => a.reduce((x, y) => x + y, 0);
const median = a => { const b = a.filter(x => x != null && isFinite(x)).sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : null };
const sma = (a, n, i = a.length - 1) => i + 1 >= n ? sum(a.slice(i - n + 1, i + 1)) / n : null;
const SECNP = { 'Commercial Banks': 'वाणिज्य बैंक', 'Development Banks': 'विकास बैंक', 'Finance': 'वित्त', 'Hotels And Tourism': 'होटल तथा पर्यटन', 'Hydro Power': 'जलविद्युत', 'Investment': 'लगानी', 'Life Insurance': 'जीवन बीमा', 'Manufacturing And Processing': 'उत्पादन तथा प्रशोधन', 'Microfinance': 'लघुवित्त', 'Non Life Insurance': 'निर्जीवन बीमा', 'Others': 'अन्य', 'Tradings': 'व्यापार' };
const secNp = s => SECNP[s] || s || 'अवर्गीकृत';
const SIG = { buy: 'किन्न योग्य', watch: 'निगरानी', hold: 'होल्ड', sell: 'बिक्री/सावधान' };
const flowsBy = Object.fromEntries((M.flows || []).map(f => [f.sym, f]));
const secRow = Object.fromEntries((M.sectors || []).map(s => [s.sector, s]));
const sectorOf = M.sectorOf || {};
const FUND = M.fundamentals || {};
const DISC = 'यो नियममा आधारित स्वचालित प्राविधिक समीक्षा हो, लगानी सल्लाह होइन। Backtest मा स्क्यानको खरिद सङ्केतले भरपर्दो रूपमा बजार जितेको देखिएको छैन; निर्णय गर्नुअघि आफ्नो जोखिम क्षमता र कम्पनीको विवरण पनि हेर्नुहोस्।';

function trendWord(c, ma, slope) {
  if (ma == null) return null;
  const above = c > ma, up = slope > 0.005, down = slope < -0.005;
  if (above && up) return 'उकालो'; if (!above && down) return 'ओरालो'; if (above) return 'माथि तर समतल'; return 'तल तर समतल';
}
function fundRow(sym, c) {
  const F = FUND[sym]; if (!F) return null;
  const num = x => x === '' || x == null ? null : +x;
  const epsQ = num(F.eps_q1a), epsL = num(F.eps_ly), eps = epsQ != null ? epsQ : epsL;
  const bvps = F.pb_ref ? +F.ref_price / +F.pb_ref : null;
  return { F, eps, epsQ, epsL, loss: eps != null && eps < 0, pe: eps > 0 ? c / eps : null, peL: epsL > 0 ? c / epsL : null, bvps, pb: bvps ? c / bvps : null, roe: num(F.roe), npl: num(F.npl), car: num(F.car) };
}

// ---------- stock technical review ----------
function stockTech(s) {
  const H = s.hist, C = H.map(r => r[4]), i = C.length - 1, c = s.c, m = s.m, lv = s.lv || {};
  const ma200p = sma(C, 200, i - 20), ma50p = sma(C, 50, i - 10), ema20p = (() => { let e = null; const k = 2 / 21; for (let j = 0; j <= i - 5; j++) e = j < 19 ? null : j === 19 ? sum(C.slice(0, 20)) / 20 : C[j] * k + e * (1 - k); return e })();
  const t200 = trendWord(c, m.ma200, ma200p ? m.ma200 / ma200p - 1 : 0), t50 = trendWord(c, m.ma50, ma50p ? m.ma50 / ma50p - 1 : 0), t20 = trendWord(c, m.ema20, ema20p ? m.ema20 / ema20p - 1 : 0);
  const sec = sectorOf[s.sym], sr = secRow[sec], f = flowsBy[s.sym];
  const P = [];
  // 1. trend
  const tr = [];
  if (t200) tr.push(`दीर्घकालीन (200 दिने औसत ${rs(m.ma200)}) हिसाबले मूल्य ${t200} अवस्थामा छ`);
  if (t50) tr.push(`मध्यम अवधि (50 दिने औसत ${rs(m.ma50)}) मा ${t50}`);
  if (t20) tr.push(`छोटो अवधि (20 दिने EMA ${rs(m.ema20)}) मा ${t20}`);
  P.push({ h: 'प्रवृत्ति', t: `${s.sym} को अन्तिम मूल्य ${rs(c)} (${p(s.chg, 2)}) छ। ${tr.join('; ')}। ` +
    (t20 === 'उकालो' && (t50 || '').startsWith('उकालो') ? 'छोटो र मध्यम दुवै अवधिको प्रवृत्ति एउटै दिशामा उकालो छ। ' : t20 === 'ओरालो' && t50 === 'ओरालो' ? 'छोटो र मध्यम दुवै अवधिमा दबाब देखिन्छ। ' : 'विभिन्न अवधिका प्रवृत्ति एकै दिशामा छैनन्, त्यसैले दिशा अझै स्पष्ट छैन। ') +
    `Backtest मा 20 दिने EMA माथि र उक्लँदो हुनु नै NEPSE मा दुवै अवधिमा काम गरेको सङ्केत हो।` });
  // 2. momentum & relative strength
  const rel = sr && sr.r20 != null && m.r20 != null ? m.r20 - sr.r20 : null, relM = M.market?.r20 != null && m.r20 != null ? m.r20 - M.market.r20 : null;
  P.push({ h: 'गति र सापेक्ष बल', t: `RSI(14) ${n1(s.rsi)} छ — ` + (s.rsi > 75 ? 'धेरै तानिएको (overbought); छोटो अवधिमा सुधार (pullback) आउन सक्छ।' : s.rsi > 70 ? 'overbought सीमामा; नयाँ खरिदमा हतार नगर्दा राम्रो।' : s.rsi >= 55 ? 'सकारात्मक गति।' : s.rsi >= 45 ? 'तटस्थ गति।' : s.rsi >= 30 ? 'कमजोर गति।' : 'oversold; तर उल्टिने पुष्टि नभई किन्नु जोखिमपूर्ण।') +
    ` प्रतिफल: 5 दिन ${p(m.r5)}, 20 दिन ${p(m.r20)}, 60 दिन ${p(m.r60)}, 120 दिन ${p(m.r120)}।` +
    (rel != null ? ` 20 दिनमा यो शेयर आफ्नो क्षेत्र (${secNp(sec)}, ${p(sr.r20)}) भन्दा ${Math.abs(rel).toFixed(1)} प्रतिशत-अङ्क ${rel >= 0 ? 'बलियो' : 'कमजोर'} र बजार (${p(M.market.r20)}) भन्दा ${Math.abs(relM).toFixed(1)} अङ्क ${relM >= 0 ? 'बलियो' : 'कमजोर'} रह्यो।` : '') +
    (m.hi52 ? ` 52 हप्ते उच्च ${rs(m.hi52)} बाट ${p((c / m.hi52 - 1) * 100)} र न्यून ${rs(m.lo52)} बाट ${p((c / m.lo52 - 1) * 100)} टाढा छ।` : '') });
  // 3. volume & money flow
  const vtxt = [];
  if (s.volR != null) vtxt.push(`आजको कारोबार (${Math.round(m.vol).toLocaleString('en-IN')} कित्ता) 20 दिने औसतको ${n2(s.volR)} गुणा${s.volR >= 1.5 ? ' — उल्लेखनीय रूपमा बढी' : s.volR < 0.7 ? ' — कम; चालको पुष्टि कमजोर' : ''}`);
  if (f) {
    vtxt.push(`पछिल्ला 5 दिनको Chaikin Money Flow ${n2(f.cmf5)} (${f.cmf5 >= 0.25 ? 'बलियो खरिद प्रवाह' : f.cmf5 >= 0.05 ? 'हल्का खरिद प्रवाह' : f.cmf5 <= -0.25 ? 'बलियो बिक्री प्रवाह' : f.cmf5 <= -0.05 ? 'हल्का बिक्री प्रवाह' : 'सन्तुलित'}) र बढ्ने दिनको volume हिस्सा ${Math.round(f.upRatio * 100)}%`);
    if (f.ad === 'acc') vtxt.push('5 दिने मापदण्डले यसलाई Accumulation (सञ्चय) मा राखेको छ');
    if (f.ad === 'dist') vtxt.push('5 दिने मापदण्डले यसलाई Distribution (बिक्री दबाब) मा राखेको छ');
    if (f.pp === 'pull') vtxt.push('आज बलियो खरिद Pull देखियो (मूल्य +2%+, उच्च नजिक close, volume 1.5×+)');
    if (f.pp === 'push') vtxt.push('आज बलियो बिक्री Push देखियो (मूल्य −2%+, न्यून नजिक close, volume 1.5×+)');
  }
  const obv = s.reasons.find(r => r.k === 'obv');
  if (obv) vtxt.push(obv.pts > 0 ? 'OBV आफ्नो 20 दिने औसत माथि छ (पैसा भित्रिँदै)' : 'OBV आफ्नो 20 दिने औसत तल छ (पैसा बाहिरिँदै)');
  if (vtxt.length) P.push({ h: 'कारोबार र पैसाको प्रवाह', t: vtxt.join('। ') + '।' });
  // 4. brokers
  const sb = BR?.stocks?.[s.sym];
  if (sb?.today) {
    const t = sb.today, w = sb.thisWeek;
    const nb = t.netBuyers[0], ns = t.netSellers[0];
    P.push({ h: 'ब्रोकर गतिविधि', t: `आज ${t.nBuy} ब्रोकरले किने र ${t.nSell} ले बेचे। ` + (nb ? `सबैभन्दा बढी net खरिद ब्रोकर #${nb[0]} (${nb[1].toLocaleString('en-IN')} कित्ता)` : '') + (ns ? `, सबैभन्दा बढी net बिक्री #${ns[0]} (${Math.abs(ns[1]).toLocaleString('en-IN')} कित्ता)` : '') + `। ` +
      `शीर्ष 5 net खरिदकर्ताले कुल कारोबारको ${n1(t.top5b)}% र शीर्ष 5 net बिक्रेताले ${n1(t.top5s)}% ओगटे; खरिदको एकाग्रता (HHI) ${n1(t.hhiB)} र बिक्रीको ${n1(t.hhiS)} — ` +
      (t.asym > 10 ? 'खरिद थोरै ब्रोकरमा केन्द्रित (कसैले जम्मा गरिरहेको हुन सक्छ)।' : t.asym < -10 ? 'बिक्री थोरै ब्रोकरमा केन्द्रित (ठूलो बिक्रेता सक्रिय)।' : 'खरिद र बिक्री दुवै छरिएका।') +
      (w && BR.dates.thisWeek.length > 1 ? ` यो हप्ता (${BR.dates.thisWeek.length} दिन) शीर्ष net खरिदकर्ता #${w.netBuyers[0]?.[0] ?? '–'} र बिक्रेता #${w.netSellers[0]?.[0] ?? '–'}।` : '') +
      ' (Floorsheet 2026-11-26 देखि मात्र जम्मा भइरहेकाले ब्रोकर सूचकको backtest अझै भएको छैन।)' });
  }
  // 5. levels
  const lv_ = [];
  const add = (v, n) => { if (v != null && isFinite(v) && v > 0) lv_.push({ v, n }) };
  add(s.sup, '20 दिने न्यून'); add(s.res, '20 दिने उच्च'); add(m.ma50, '50 दिने औसत'); add(m.ma200, '200 दिने औसत'); add(m.ema20, '20 दिने EMA');
  add(lv.avwapLo, '52 हप्ते न्यूनदेखिको AVWAP'); add(lv.avwapHi, '52 हप्ते उच्चदेखिको AVWAP'); add(lv.poc, '60 दिने POC'); add(lv.vah, 'VAH'); add(lv.val, 'VAL'); add(m.hi52, '52 हप्ते उच्च');
  const below = lv_.filter(x => x.v < c * 0.998).sort((a, b) => b.v - a.v).slice(0, 3), above = lv_.filter(x => x.v > c * 1.002).sort((a, b) => a.v - b.v).slice(0, 3);
  P.push({ h: 'महत्त्वपूर्ण मूल्य स्तर', t: (below.length ? `तलका आधार (support): ${below.map(x => `${rs(x.v)} (${x.n}, ${p((x.v / c - 1) * 100)})`).join(', ')}। ` : 'नजिकै तल कुनै प्रमुख आधार स्तर छैन। ') +
    (above.length ? `माथिका अवरोध (resistance): ${above.map(x => `${rs(x.v)} (${x.n}, ${p((x.v / c - 1) * 100)})`).join(', ')}। ` : 'माथि नजिक कुनै प्रमुख अवरोध छैन (52 हप्ते उच्च नजिक)। ') +
    `ATR(14) ${n1(m.atr)} अनुसार stop-loss स्तर ${rs(s.stop)} (${n1(s.risk)}% जोखिम)।` + (lv.warnAvwapLo ? ' ⚠️ मूल्य 52 हप्ते न्यूनदेखिको AVWAP तल छ — backtest मा यस्ता शेयर कमजोर रहे।' : '') + (lv.warnVal ? ' ⚠️ मूल्य 60 दिने value area तल झरेको छ — backtest मा यो पनि कमजोर सङ्केत।' : '') });
  // 6. verdict & suggestion
  const e20 = s.reasons.find(r => r.k === 'ema20'), e20s = s.reasons.find(r => r.k === 'ema20_slope');
  const good = (e20?.pts > 0) + (e20s?.pts > 0), warn = (lv.warnAvwapLo ? 1 : 0) + (lv.warnVal ? 1 : 0) + (f?.ad === 'dist' ? 1 : 0) + (f?.pp === 'push' ? 1 : 0);
  let stance, stTxt;
  if (s.sig === 'buy' && good === 2 && warn === 0) { stance = 'positive'; stTxt = 'सकारात्मक' }
  else if ((s.sig === 'buy' || s.sig === 'watch') && good >= 1 && warn === 0) { stance = 'mildpos'; stTxt = 'सतर्क सकारात्मक' }
  else if (s.sig === 'sell' && (warn >= 1 || good === 0)) { stance = 'negative'; stTxt = 'नकारात्मक' }
  else if (s.sig === 'sell' || warn >= 2 || good === 0) { stance = 'weak'; stTxt = 'कमजोर' }
  else { stance = 'neutral'; stTxt = 'तटस्थ' }
  const sup1 = below[0], res1 = above[0];
  const hold = stance === 'positive' || stance === 'mildpos'
    ? `राखेका लगानीकर्ताका लागि: प्रवृत्ति कायम रहेसम्म होल्ड गर्न सकिने अवस्था; ${rs(s.stop)} (stop) तल close भए जोखिम घटाउने विचार गर्नुहोस्।`
    : stance === 'neutral' ? `राखेका लगानीकर्ताका लागि: होल्ड; ${sup1 ? rs(sup1.v) + ' (' + sup1.n + ')' : rs(s.stop)} तल close भए सावधान हुनुहोस्।`
    : `राखेका लगानीकर्ताका लागि: कमजोर अवस्था; ${sup1 ? rs(sup1.v) + ' (' + sup1.n + ')' : rs(s.stop)} पनि तल झरे घटाउने/बेच्ने विचार गर्नुहोस्, र मूल्य 20 दिने EMA (${rs(m.ema20)}) माथि नफर्किएसम्म थप नगर्नुहोस्।`;
  const fresh = stance === 'positive' ? `नयाँ खरिदका लागि: अवस्था अनुकूल, ${s.rsi > 70 ? 'तर RSI उच्च भएकाले 20 दिने EMA (' + rs(m.ema20) + ') नजिक सुधार पर्खनु राम्रो' : 'तर एकै पटक नभई चरणबद्ध रूपमा, stop ' + rs(s.stop) + ' सहित'}।`
    : stance === 'mildpos' ? `नयाँ खरिदका लागि: निगरानीमा राख्नुहोस्; 20 दिने EMA माथि टिकेर स्क्यान अङ्क 7+ पुगे मात्र विचार गर्नुहोस्${res1 ? '; नजिकको अवरोध ' + rs(res1.v) : ''}।`
    : stance === 'neutral' ? 'नयाँ खरिदका लागि: स्पष्ट सङ्केत छैन; प्रवृत्ति स्पष्ट नहुन्जेल पर्खनु राम्रो।'
    : 'नयाँ खरिदका लागि: अहिले उपयुक्त देखिँदैन।';
  P.push({ h: 'निष्कर्ष र सुझाव', t: `समग्र प्राविधिक अवस्था: ${stTxt}। स्क्यान अङ्क ${s.sc > 0 ? '+' : ''}${s.sc} (${SIG[s.sig]})। ${hold} ${fresh}` });
  return { stance, stTxt, paras: P, disc: DISC };
}

// ---------- stock fundamental review ----------
function stockFund(s) {
  const sec = sectorOf[s.sym], r = fundRow(s.sym, s.c);
  const news = NEWS.filter(n => n.symbol === s.sym).slice(0, 8);
  const P = [];
  if (!r) {
    P.push({ h: 'तथ्याङ्क', t: `${s.sym} को EPS, book value जस्ता आधारभूत तथ्याङ्क अझै डाटामा छैनन्। त्रैमासिक प्रतिवेदन आएपछि थपिनेछ।` });
  } else {
    const peers = Object.keys(FUND).filter(x => sectorOf[x] === sec || FUND[x].group === r.F.group).map(x => { const q = L.stocks.find(y => y.sym === x); return q ? fundRow(x, q.c) : null }).filter(Boolean);
    const mPE = median(peers.map(q => q.pe)), mPB = median(peers.map(q => q.pb)), mROE = median(peers.map(q => q.roe));
    const isBank = /Bank|Finance|Microfinance/.test(r.F.group || sec || '');
    P.push({ h: 'नाफा र मूल्याङ्कन', t: (r.loss ? `कम्पनी पछिल्लो प्रतिवेदनमा घाटामा छ, त्यसैले P/E अर्थपूर्ण छैन। ` : `वार्षिक EPS ${n2(r.eps)}${r.epsQ != null && r.epsL != null ? ` (Q1 बाट वार्षिक; गत वर्ष ${n2(r.epsL)})` : r.epsQ != null ? ' (Q1 बाट वार्षिक)' : ' (गत वर्ष)'} अनुसार आजको मूल्यमा P/E ${n1(r.pe)}${mPE ? `, जुन समूहको मध्यिका ${n1(mPE)} भन्दा ${r.pe < mPE * 0.85 ? 'कम (तुलनात्मक रूपमा सस्तो)' : r.pe > mPE * 1.15 ? 'बढी (तुलनात्मक रूपमा महँगो)' : 'नजिक'}` : ''}। `) +
      (r.pb ? `Book value प्रति शेयर करिब ${rs(r.bvps)}; P/B ${n2(r.pb)}${mPB ? ` (समूह मध्यिका ${n2(mPB)})` : ''}। ` : '') +
      (r.eps > 0 && r.bvps ? `Graham number (√22.5 × EPS × BVPS) करिब ${rs(Math.sqrt(22.5 * r.eps * r.bvps))} — मूल्य यसको ${n1(s.c / Math.sqrt(22.5 * r.eps * r.bvps) * 100)}% मा छ। ` : '') +
      (r.eps > 0 ? `Earnings yield ${n1(r.eps / s.c * 100)}%।` : '') });
    const q = [];
    if (r.roe != null) q.push(`ROE ${n1(r.roe)}% ${r.roe >= 15 ? '(उच्च)' : r.roe >= 10 ? '(मध्यम)' : '(कमजोर)'}${mROE ? `, समूह मध्यिका ${n1(mROE)}%` : ''}`);
    if (r.npl != null) q.push(`NPL ${n2(r.npl)}% ${r.npl < 3 ? '(कर्जा गुणस्तर राम्रो)' : r.npl < 5 ? '(ठीकै)' : r.npl < 10 ? '(उच्च — कर्जा जोखिम)' : '(धेरै उच्च — गम्भीर कर्जा जोखिम)'}`);
    if (r.car != null) q.push(`CAR ${n2(r.car)}%${isBank ? (r.car < 12 ? ' (न्यूनतम सीमाको नजिक)' : ' (पर्याप्त)') : ''}`);
    if (r.F.note) q.push(r.F.note);
    if (q.length) P.push({ h: 'गुणस्तर', t: q.join('; ') + '।' });
    const oneOff = /एकपटके|प्रोभिजन फिर्ता|provision/i.test(r.F.note || '');
    const val = r.loss ? 'घाटामा' : oneOff ? 'P/E कम देखिए पनि नाफामा एकपटके/प्रोभिजन फिर्ताको आम्दानी भएकाले भ्रामक हुन सक्छ' : r.pe && mPE ? (r.pe < mPE * 0.85 ? 'समूहको तुलनामा सस्तो' : r.pe > mPE * 1.15 ? 'समूहको तुलनामा महँगो' : 'समूहको तुलनामा उचित') : 'तुलना गर्न अपुग';
    const qual = r.npl != null && r.npl >= 10 ? 'कमजोर (NPL उच्च)' : r.roe == null ? (r.npl != null ? (r.npl < 5 ? 'ठीकै' : 'मध्यम') : null) : r.roe >= 13 && (r.npl == null || r.npl < 5) ? 'राम्रो' : r.roe >= 8 ? 'मध्यम' : 'कमजोर';
    P.push({ h: 'निष्कर्ष', t: `मूल्याङ्कन: ${val}${qual ? '; गुणस्तर: ' + qual : ''}। आधार: ${r.F.period}, स्रोत ${r.F.source.replace('claude/', '')}। P/E र P/B हरेक दिनको मूल्यमा फेरि गणना हुन्छन्; EPS र book value नयाँ प्रतिवेदन आएपछि मात्र बदलिन्छन्। अपरिष्कृत तथ्याङ्कमा आधारित; निर्णयअघि कम्पनीको आधिकारिक प्रतिवेदन हेर्नुहोस्।` });
  }
  const typeNp = { quarterly: 'त्रैमासिक/वित्तीय प्रतिवेदन', dividend: 'लाभांश/बोनस', right: 'हकप्रद', agm: 'साधारण सभा', bookclose: 'बुक क्लोज', auction: 'लिलाम', merger: 'गाभ्ने/प्राप्ति', ipo: 'IPO/FPO/ऋणपत्र', other: 'अन्य' };
  const fresh = r && news.find(n => n.type === 'quarterly' && n.date > '2026-11-25');
  if (news.length) P.push({ h: 'हालका सूचना', list: news.map(n => ({ d: n.date, t: typeNp[n.type] || n.type, title: n.title, url: n.url })) });
  return { has: !!r, paras: P, stale: !!fresh, staleNote: fresh ? `नयाँ वित्तीय प्रतिवेदन सम्बन्धी सूचना (${fresh.date}) आएको छ; माथिका EPS/book value पुराना हुन सक्छन्।` : null };
}

// ---------- market review ----------
function marketReview() {
  const mk = M.market, o = M.official, cap = M.capIndex || [], bh = M.breadthHist || [];
  const nepse = o?.indices?.find(x => /^nepse/i.test(x.index));
  const capV = cap.map(x => x[1]), c = capV.at(-1);
  const m50 = sma(capV, 50), m200 = sma(capV, 200);
  const b = bh.at(-1)?.[1], b5 = bh.at(-6)?.[1], b20 = bh.at(-21)?.[1];
  const secs = [...(M.sectors || [])].filter(s => s.r20 != null).sort((a, b) => b.r20 - a.r20);
  const P = [];
  P.push({ h: 'सूचक', t: (nepse ? `NEPSE ${n2(nepse.close ?? nepse.currentValue)} अङ्कमा बन्द भयो (${p(nepse.perChange, 2)}, ${nepse.change > 0 ? '+' : ''}${n2(nepse.change)} अङ्क)। ` : '') +
    (mk ? `सबै कम्पनीको market cap भारित सूचक 1 दिनमा ${p(mk.r1, 2)}, 5 दिनमा ${p(mk.r5, 2)}, 20 दिनमा ${p(mk.r20, 2)} र 60 दिनमा ${p(mk.r60, 2)} चलेको छ। ` : '') +
    (m50 ? `सूचक आफ्नो 50 दिने औसत ${c > m50 ? 'माथि' : 'तल'}${m200 ? ` र 200 दिने औसत ${c > m200 ? 'माथि' : 'तल'}` : ''} छ — ` + (m200 && c > m50 && c > m200 ? 'मध्यम र दीर्घ दुवै प्रवृत्ति सकारात्मक।' : m200 && c < m50 && c < m200 ? 'मध्यम र दीर्घ दुवै प्रवृत्ति कमजोर।' : 'प्रवृत्ति मिश्रित।') : '') });
  if (mk) P.push({ h: 'Breadth र कारोबार', t: `आज ${mk.adv} कम्पनी बढे, ${mk.dec} घटे र ${mk.unch} स्थिर रहे। कारोबार ${crore(mk.turnover)} भयो, जुन 20 दिने औसतको ${n2(mk.turnVs20)} गुणा हो${mk.turnVs20 > 1.2 ? ' — सहभागिता बढेको' : mk.turnVs20 < 0.8 ? ' — सहभागिता घटेको' : ''}। ` +
    (b != null ? `50 दिने औसत माथि रहेका शेयर ${n1(b)}% छन्${b5 != null ? ` (5 दिनअघि ${n1(b5)}%, 20 दिनअघि ${n1(b20)}%)` : ''} — ` + (b >= 55 ? 'बजार चौडाइ बलियो।' : b >= 40 ? 'बजार चौडाइ मिश्रित।' : 'बजार चौडाइ कमजोर; थोरै शेयरले मात्र सूचक धानिरहेका।') : '') });
  if (secs.length) P.push({ h: 'क्षेत्र', t: `20 दिनमा सबैभन्दा बलिया क्षेत्र: ${secs.slice(0, 3).map(s => `${secNp(s.sector)} (${p(s.r20)})`).join(', ')}; कमजोर: ${secs.slice(-3).reverse().map(s => `${secNp(s.sector)} (${p(s.r20)})`).join(', ')}। ` +
    `हालै पैसा बढी आइरहेका (कारोबार 5/20 > 1.15): ${(M.sectors || []).filter(s => s.turn5vs20 > 1.15).map(s => secNp(s.sector)).join(', ') || 'छैन'}।` });
  const F = M.flows || [];
  P.push({ h: 'पैसाको प्रवाह र स्क्यान', t: `आज खरिद Pull ${F.filter(x => x.pp === 'pull').length} र बिक्री Push ${F.filter(x => x.pp === 'push').length} शेयरमा देखियो; 5 दिने Accumulation ${F.filter(x => x.ad === 'acc').length} र Distribution ${F.filter(x => x.ad === 'dist').length}। स्क्यानमा किन्न योग्य ${L.counts.buy}, निगरानी ${L.counts.watch}, होल्ड ${L.counts.hold} र बिक्री/सावधान ${L.counts.sell}।` });
  let stance = 'मिश्रित', sug;
  if (b != null && m50) {
    if (b >= 55 && c > m50) { stance = 'सकारात्मक'; sug = 'बजार चौडाइ र प्रवृत्ति दुवै अनुकूल। राम्रो प्रवृत्ति भएका शेयरमा चरणबद्ध लगानी विचार गर्न सकिन्छ, तर stop-loss सहित।' }
    else if (b < 40 && c < m50) { stance = 'कमजोर'; sug = 'बजार चौडाइ र प्रवृत्ति दुवै कमजोर। नयाँ लगानीमा सावधानी, नगद हिस्सा कायम राख्ने, र कमजोर शेयरमा stop-loss पालना गर्ने समय।' }
    else { sug = 'बजार मिश्रित अवस्थामा छ। सबै शेयरमा होइन, आफ्नो क्षेत्रभन्दा बलियो र 20 दिने EMA माथि उक्लँदो शेयरमा मात्र चयनात्मक रहनु राम्रो।' }
  }
  P.push({ h: 'समग्र दृष्टिकोण', t: `समग्र बजार अवस्था: ${stance}। ${sug || ''}` });
  return { stance, paras: P, disc: DISC };
}

// ---------- sector review ----------
function sectorReview(sr) {
  const stocks = L.stocks.filter(s => sectorOf[s.sym] === sr.sector);
  const best = [...stocks].sort((a, b) => b.sc - a.sc).slice(0, 4), worst = [...stocks].sort((a, b) => a.sc - b.sc).slice(0, 3);
  const fr = stocks.map(s => fundRow(s.sym, s.c)).filter(Boolean);
  const P = [];
  P.push({ h: 'प्रदर्शन', t: (sr.sub ? `${sr.sub.index} आज ${n2(sr.sub.value)} मा ${p(sr.sub.chg, 2)} ले बन्द भयो। ` : '') +
    `क्षेत्रको market cap भारित प्रतिफल: 5 दिन ${p(sr.r5)}, 20 दिन ${p(sr.r20)}, 60 दिन ${p(sr.r60)}, 1 वर्ष ${p(sr.r250)}। सूचक आफ्नो 50 दिने औसत ${sr.aboveIdx50 ? 'माथि' : 'तल'} छ।` +
    (M.market?.r20 != null && sr.r20 != null ? ` 20 दिनमा बजारभन्दा ${Math.abs(sr.r20 - M.market.r20).toFixed(1)} प्रतिशत-अङ्क ${sr.r20 >= M.market.r20 ? 'बलियो' : 'कमजोर'}।` : '') });
  P.push({ h: 'चौडाइ र कारोबार', t: `आज ${sr.adv} कम्पनी बढे र ${sr.dec} घटे। ${n1(sr.pctAbove50)}% कम्पनी आफ्नो 50 दिने औसत माथि छन्; औसत स्क्यान अङ्क ${n1(sr.avgScore)}। कारोबार ${crore(sr.turnover)}; 5 दिने औसत कारोबार 20 दिनेको ${n2(sr.turn5vs20)} गुणा — ` + (sr.turn5vs20 > 1.15 ? 'हालै पैसा बढी आइरहेको।' : sr.turn5vs20 < 0.85 ? 'हालै चासो घटेको।' : 'सामान्य।') +
    ` स्क्यान: किन्न योग्य ${sr.cnt.buy}, निगरानी ${sr.cnt.watch}, होल्ड ${sr.cnt.hold}, बिक्री/सावधान ${sr.cnt.sell}। Accumulation: ${sr.acc.join(', ') || 'छैन'}; Distribution: ${sr.dist.join(', ') || 'छैन'}।` });
  P.push({ h: 'शेयरहरू', t: `प्राविधिक रूपमा बलिया: ${best.map(s => `${s.sym} (${s.sc > 0 ? '+' : ''}${s.sc})`).join(', ')}। कमजोर: ${worst.map(s => `${s.sym} (${s.sc})`).join(', ')}।` });
  if (fr.length >= 3) P.push({ h: 'आधारभूत (उपलब्ध ' + fr.length + ' कम्पनी)', t: `मध्यिका P/E ${n1(median(fr.map(q => q.pe)))}, P/B ${n2(median(fr.map(q => q.pb)))}${median(fr.map(q => q.roe)) != null ? `, ROE ${n1(median(fr.map(q => q.roe)))}%` : ''}${median(fr.map(q => q.npl)) != null ? `, NPL ${n2(median(fr.map(q => q.npl)))}%` : ''}। सबैभन्दा कम P/E: ${fr.filter(q => q.pe).sort((a, b) => a.pe - b.pe).slice(0, 3).map(q => `${q.F.symbol} (${n1(q.pe)})`).join(', ')}।` });
  const strong = sr.aboveIdx50 && sr.pctAbove50 >= 50 && M.market?.r20 != null && sr.r20 >= M.market.r20, weak = !sr.aboveIdx50 && sr.pctAbove50 < 35;
  P.push({ h: 'निष्कर्ष र सुझाव', t: strong ? 'क्षेत्र बजारभन्दा बलियो र प्रवृत्ति सकारात्मक। यस क्षेत्रका बलिया शेयरलाई निगरानी सूचीमा प्राथमिकता दिन सकिन्छ।' : weak ? 'क्षेत्र कमजोर; अधिकांश शेयर 50 दिने औसत तल। नयाँ लगानीमा सावधानी, र प्रवृत्ति नफेरिएसम्म पर्खनु राम्रो।' : 'क्षेत्र मिश्रित अवस्थामा; कम्पनीअनुसार छनोट गर्नुपर्ने।' });
  return { paras: P, disc: DISC };
}

// ---------- build ----------
const out = { date: L.date, generated: new Date().toISOString(), market: marketReview(), sectors: {}, stocks: {}, news: NEWS.slice(0, 60) };
for (const sr of M.sectors || []) out.sectors[sr.sector] = sectorReview(sr);
for (const s of L.stocks) { try { out.stocks[s.sym] = { tech: stockTech(s), fund: stockFund(s) } } catch (e) { console.error('review failed', s.sym, e.message) } }
fs.writeFileSync(path.join(OUTD, 'reviews.json'), JSON.stringify(out));
const st = {}; Object.values(out.stocks).forEach(x => st[x.tech.stance] = (st[x.tech.stance] || 0) + 1);
console.log(`reviews.json: market ${out.market.stance}, ${Object.keys(out.sectors).length} sectors, ${Object.keys(out.stocks).length} stocks ${JSON.stringify(st)}, news ${NEWS.length}`);
