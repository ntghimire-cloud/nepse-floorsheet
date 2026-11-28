// Do Japanese candlestick reversal patterns (Nison) predict NEPSE stock returns?
// Usage: node research/backtest_candles.js <nepse-data/data/company-wise> <out.json>
// Data: bonus/right-adjusted daily OHLC from lib_scan.loadAll, 2018-01 onward (before 2018 the open is mostly a copy of the
// previous close, so open-based candles are meaningless). Candles with an invalid range (low > min(open,close) etc.) or whose
// open is an exact copy of the previous close are skipped for patterns that use the open.
// Context (needed for a "reversal"): bullish patterns only after a decline — close below its 20-day EMA and 10-day return ≤ −5%;
// bearish only after a rise — close above the 20-day EMA and 10-day return ≥ +5%.
// Liquid only: 20-day average turnover ≥ Rs 2 lakh. Entry at the NEXT day's close (no look-ahead); also a "confirmed" variant
// that waits for a next-day close beyond the pattern (above its high / below its low) and enters at that close.
// Forward 5/10/20 trading days; excess = vs the equal-weight average of all liquid stocks' returns over the same window from
// the same entry date. Train 2018–2023, test 2024+; t clustered by date.
const fs = require('fs');
const { loadAll } = require('../scripts/lib_scan.js');
const [dir, out] = process.argv.slice(2);
const { groups } = loadAll(dir, null, Infinity);
const HS = [5, 10, 20], START = '2018-01-01';
const sum = a => a.reduce((x, y) => x + y, 0), r2 = x => Math.round(x * 100) / 100;

// 1. benchmark: mean forward return of all liquid stocks per entry date and horizon
const bench = {}; // ds -> {h: [sum, n]}
const prep = {};
for (const [sym, R] of Object.entries(groups)) {
  const n = R.length, ema = new Array(n), to20 = new Array(n);
  let e = R[0].c; const k = 2 / 21; let tsum = 0;
  for (let i = 0; i < n; i++) { e = i ? R[i].c * k + e * (1 - k) : R[i].c; ema[i] = e;
    tsum += R[i].c * R[i].v; if (i >= 20) tsum -= R[i - 20].c * R[i - 20].v; to20[i] = i >= 19 ? tsum / 20 : 0 }
  prep[sym] = { ema, to20 };
  for (let i = 25; i < n - 1; i++) { if (R[i].ds < START || to20[i] < 2e5) continue;
    for (const h of HS) { if (i + h >= n) continue; const b = (bench[R[i].ds] ??= {}); const x = (b[h] ??= [0, 0]); x[0] += (R[i + h].c / R[i].c - 1) * 100; x[1]++ } }
}
const bmk = (ds, h) => { const x = bench[ds]?.[h]; return x && x[1] >= 20 ? x[0] / x[1] : null };

// 2. patterns
const P = {
  bull_engulf: { side: 1, n: 'Bullish engulfing', f: (a, b) => a.c < a.o && b.c > b.o && b.o <= a.c && b.c >= a.o && (b.c - b.o) > (a.o - a.c) },
  bear_engulf: { side: -1, n: 'Bearish engulfing', f: (a, b) => a.c > a.o && b.c < b.o && b.o >= a.c && b.c <= a.o && (b.o - b.c) > (a.c - a.o) },
  hammer: { side: 1, n: 'Hammer', f: (a, b) => { const body = Math.abs(b.c - b.o), rng = b.h - b.l, lo = Math.min(b.o, b.c) - b.l, up = b.h - Math.max(b.o, b.c);
    return rng > 0 && body > 0 && lo >= 2 * body && up <= 0.25 * rng && body <= 0.35 * rng } },
  shooting_star: { side: -1, n: 'Shooting star', f: (a, b) => { const body = Math.abs(b.c - b.o), rng = b.h - b.l, lo = Math.min(b.o, b.c) - b.l, up = b.h - Math.max(b.o, b.c);
    return rng > 0 && body > 0 && up >= 2 * body && lo <= 0.25 * rng && body <= 0.35 * rng } },
  hanging_man: { side: -1, n: 'Hanging man', f: (a, b) => P.hammer.f(a, b) },
  inv_hammer: { side: 1, n: 'Inverted hammer', f: (a, b) => P.shooting_star.f(a, b) },
  doji_bot: { side: 1, n: 'Doji (ओरालोपछि)', f: (a, b) => { const rng = b.h - b.l; return rng > 0 && Math.abs(b.c - b.o) <= 0.1 * rng && rng >= 0.02 * b.c } },
  doji_top: { side: -1, n: 'Doji (उकालोपछि)', f: (a, b) => P.doji_bot.f(a, b) },
  piercing: { side: 1, n: 'Piercing line', f: (a, b) => a.c < a.o && b.c > b.o && b.o < a.c && b.c > (a.o + a.c) / 2 && b.c < a.o },
  dark_cloud: { side: -1, n: 'Dark cloud cover', f: (a, b) => a.c > a.o && b.c < b.o && b.o > a.c && b.c < (a.o + a.c) / 2 && b.c > a.o },
  morning_star: { side: 1, n: 'Morning star', f3: (x, a, b) => x.c < x.o && (x.o - x.c) >= 0.02 * x.o && Math.abs(a.c - a.o) <= 0.3 * (x.o - x.c) && Math.max(a.o, a.c) < x.c * 1.005 && b.c > b.o && b.c > (x.o + x.c) / 2 },
  evening_star: { side: -1, n: 'Evening star', f3: (x, a, b) => x.c > x.o && (x.c - x.o) >= 0.02 * x.o && Math.abs(a.c - a.o) <= 0.3 * (x.c - x.o) && Math.min(a.o, a.c) > x.c * 0.995 && b.c < b.o && b.c < (x.o + x.c) / 2 },
  three_white: { side: 1, n: 'Three white soldiers', f3: (x, a, b) => [x, a, b].every(k => k.c > k.o && (k.c - k.o) >= 0.6 * (k.h - k.l) && k.h > k.l) && a.c > x.c && b.c > a.c && a.o > x.o && a.o < x.c && b.o > a.o && b.o < a.c },
  three_black: { side: -1, n: 'Three black crows', f3: (x, a, b) => [x, a, b].every(k => k.c < k.o && (k.o - k.c) >= 0.6 * (k.h - k.l) && k.h > k.l) && a.c < x.c && b.c < a.c && a.o < x.o && a.o > x.c && b.o < a.o && b.o > a.c },
};
const ok = (r, prev) => r.h >= Math.max(r.o, r.c) && r.l <= Math.min(r.o, r.c) && r.h > 0 && Math.abs(r.o - prev.c) > 1e-9;
const obs = []; // {p, conf, ds, x5,x10,x20}
for (const [sym, R] of Object.entries(groups)) {
  const { ema, to20 } = prep[sym], n = R.length;
  for (let i = 25; i < n - 2; i++) {
    if (R[i].ds < START || to20[i] < 2e5) continue;
    const b = R[i], a = R[i - 1], x = R[i - 2];
    if (!ok(b, a) || !ok(a, x)) continue;
    const r10 = (R[i - 1].c / R[i - 11].c - 1) * 100;   // trend before the pattern (excludes today)
    const down = R[i - 1].c < ema[i - 1] && r10 <= -5, up = R[i - 1].c > ema[i - 1] && r10 >= 5;
    const x3ok = ok(x, R[i - 3]);
    for (const [k, p] of Object.entries(P)) {
      if (p.side === 1 && !down) continue; if (p.side === -1 && !up) continue;
      // three-candle patterns: trend measured before the first candle
      if (p.f3) { if (!x3ok) continue; const r10b = (R[i - 3].c / R[i - 13].c - 1) * 100; const d2 = R[i - 3].c < ema[i - 3] && r10b <= -5, u2 = R[i - 3].c > ema[i - 3] && r10b >= 5;
        if ((p.side === 1 && !d2) || (p.side === -1 && !u2)) continue; if (!p.f3(x, a, b)) continue }
      else if (!p.f(a, b)) continue;
      for (const conf of [0, 1]) {
        let e = i + 1;                                     // enter at next close
        if (conf) { const nx = R[i + 1]; if (p.side === 1 ? !(nx.c > b.h) : !(nx.c < b.l)) continue; e = i + 1 }
        const o = { p: k, conf, ds: R[e].ds, side: p.side };
        let any = false;
        for (const h of HS) { if (e + h >= n) continue; const bm = bmk(R[e].ds, h); if (bm == null) continue; o['x' + h] = (R[e + h].c / R[e].c - 1) * 100 - bm; any = true }
        if (any) obs.push(o);
      }
    }
  }
}
const stat = (L, h) => { L = L.filter(o => o['x' + h] != null); if (L.length < 30) return { n: L.length };
  const d = {}; for (const o of L) d[o.ds] = (d[o.ds] || 0) + o['x' + h]; const S = Object.values(d), tot = sum(S);
  return { n: L.length, ex: r2(tot / L.length), t: r2(tot / Math.sqrt(sum(S.map(v => v * v)))), hit: r2(L.filter(o => o['x' + h] > 0).length / L.length * 100) } };
const res = { generated: new Date().toISOString(), patterns: {} };
for (const [k, p] of Object.entries(P)) for (const conf of [0, 1]) {
  const L = obs.filter(o => o.p === k && o.conf === conf), key = k + (conf ? '_conf' : '');
  res.patterns[key] = { name: p.n + (conf ? ' + पुष्टि' : ''), side: p.side };
  for (const h of HS) { res.patterns[key]['train' + h] = stat(L.filter(o => o.ds <= '2023-12-31'), h); res.patterns[key]['test' + h] = stat(L.filter(o => o.ds >= '2024-01-01'), h) }
}
fs.writeFileSync(out, JSON.stringify(res, null, 1));
const fmt = s => s.ex == null ? `n${s.n}` : `${s.ex >= 0 ? '+' : ''}${s.ex} (t ${s.t}, n${s.n})`;
for (const [k, v] of Object.entries(res.patterns)) console.log((v.side > 0 ? '↑ ' : '↓ ') + v.name.padEnd(34), '| 10d', fmt(v.train10).padEnd(24), fmt(v.test10).padEnd(24), '| 20d', fmt(v.train20).padEnd(24), fmt(v.test20));
