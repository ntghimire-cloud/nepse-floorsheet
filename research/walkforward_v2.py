"""Walk-forward test of Anchored VWAP, Volume Profile and VCP signals for NEPSE (same method as walkforward.py).
Train: signals dated 2018-01-01..2023-12-31. Test: 2024-01-01 onwards.
Entry at next-day close, exit H trading days later. Excess = stock fwd return - equal-weight universe fwd return (same dates).
Net = excess - 1% cost. Events: first day a condition turns true, 20-day cooldown per stock.
t-stat on per-date means (clusters same-day signals)."""
import sys, re, glob, os
import numpy as np, pandas as pd

DIR = sys.argv[1]
OUT = sys.argv[2]
COST = 1.0
HS = [20, 60]

def load(f):
    d = pd.read_csv(f)
    d = d[d.close > 0].copy()
    d["published_date"] = pd.to_datetime(d.published_date)
    d = d.sort_values("published_date").drop_duplicates("published_date")
    if len(d) < 300:
        return None
    c = d.close.values; pc = d.per_change.values
    fac = np.ones(len(d)); f_ = 1.0
    for i in range(len(d) - 1, 0, -1):
        fac[i] = f_
        if not np.isfinite(pc[i]) or pc[i] <= -100: continue
        if abs(c[i] / c[i-1] - 1 - pc[i] / 100) > 0.03:
            k = c[i] / (1 + pc[i] / 100) / c[i-1]
            if 0.3 < k < 0.98: f_ *= k
    fac[0] = f_
    for col in ["open", "high", "low", "close"]:
        d[col] = d[col] * fac
    d["open"] = np.where(d.open > 0, d.open, d.close)
    d["high"] = d[["high", "open", "close"]].max(axis=1)
    d["low"] = np.where(d.low > 0, np.minimum(d.low, np.minimum(d.open, d.close)), np.minimum(d.open, d.close))
    d["vol"] = d.traded_quantity.fillna(0) / fac
    d["amt"] = d.traded_amount.fillna(0)
    return d.set_index("published_date")[["open", "high", "low", "close", "vol", "amt"]]

def rsi(c, n=14):
    d = c.diff(); g = d.clip(lower=0).ewm(alpha=1/n, adjust=False).mean(); l = (-d.clip(upper=0)).ewm(alpha=1/n, adjust=False).mean()
    return 100 - 100 / (1 + g / l)

def anchored_vwap(h, l, c, v, anchor):
    """VWAP from anchor index (per day) to today, typical price."""
    tp = (h + l + c) / 3
    cpv = np.concatenate([[0], np.cumsum(tp * v)]); cv = np.concatenate([[0], np.cumsum(v)])
    t = np.arange(len(c))
    num = cpv[t + 1] - cpv[anchor]; den = cv[t + 1] - cv[anchor]
    return np.where(den > 0, num / np.where(den > 0, den, 1), np.nan)

def rolling_argext(x, n, fn):
    out = np.zeros(len(x), dtype=int)
    for t in range(len(x)):
        a = max(0, t - n + 1); out[t] = a + fn(x[a:t + 1])
    return out

def volume_profile(h, l, c, v, n=60, bins=24):
    """Rolling n-day profile: each day's volume spread evenly over its high-low range. Returns POC, VAH, VAL (70%)."""
    T = len(c); poc = np.full(T, np.nan); vah = poc.copy(); val = poc.copy()
    for t in range(n - 1, T):
        hh, ll, vv = h[t-n+1:t+1], l[t-n+1:t+1], v[t-n+1:t+1]
        lo, hi = ll.min(), hh.max()
        if hi <= lo or vv.sum() <= 0: continue
        edges = np.linspace(lo, hi, bins + 1); prof = np.zeros(bins)
        for a, b, q in zip(ll, hh, vv):
            if q <= 0: continue
            i0 = min(int((a - lo) / (hi - lo) * bins), bins - 1); i1 = min(int((b - lo) / (hi - lo) * bins), bins - 1)
            prof[i0:i1 + 1] += q / (i1 - i0 + 1)
        k = int(prof.argmax()); poc[t] = (edges[k] + edges[k + 1]) / 2
        lo_i = hi_i = k; tot = prof[k]; target = 0.7 * prof.sum()
        while tot < target:
            up = prof[hi_i + 1] if hi_i + 1 < bins else -1; dn = prof[lo_i - 1] if lo_i > 0 else -1
            if up >= dn: hi_i += 1; tot += up
            else: lo_i -= 1; tot += dn
        vah[t] = edges[hi_i + 1]; val[t] = edges[lo_i]
    return poc, vah, val

def feats(d):
    c, h, l, v, o = d.close, d.high, d.low, d.vol, d.open
    C, Hh, Ll, V = c.values, h.values, l.values, v.values
    s = {}
    va = v.rolling(20).mean().shift(1); va50 = v.rolling(50).mean()
    hi20 = h.rolling(20).max().shift(1)
    sma50 = c.rolling(50).mean(); sma200 = c.rolling(200).mean()
    hi252 = h.rolling(252, min_periods=200).max()
    # --- Anchored VWAP (anchors: 52-week low day, 52-week high day)
    a_lo = rolling_argext(Ll, 252, np.argmin); a_hi = rolling_argext(Hh, 252, np.argmax)
    av_lo = pd.Series(anchored_vwap(Hh, Ll, C, V, a_lo), index=c.index)
    av_hi = pd.Series(anchored_vwap(Hh, Ll, C, V, a_hi), index=c.index)
    s["avwap_lo_reclaim"] = c > av_lo          # above VWAP since 52-week low
    s["avwap_hi_reclaim"] = c > av_hi          # above VWAP since 52-week high (holders since the top in profit)
    s["avwap_both"] = (c > av_lo) & (c > av_hi)
    s["SELL_below_avwap_lo"] = c < av_lo
    # --- Volume Profile (60 days)
    poc, vah, val = volume_profile(Hh, Ll, C, V)
    poc, vah, val = pd.Series(poc, index=c.index), pd.Series(vah, index=c.index), pd.Series(val, index=c.index)
    s["vp_above_poc"] = c > poc
    s["vp_break_vah"] = (c > vah.shift(1)) & (v >= 1.5 * va)
    s["vp_in_value_above_poc"] = (c > poc) & (c <= vah)
    s["SELL_vp_below_val"] = c < val.shift(1)
    # --- VCP (Minervini-style volatility contraction)
    rng = lambda a, b: (h.rolling(b - a).max().shift(a) - l.rolling(b - a).min().shift(a)) / h.rolling(b - a).max().shift(a)
    d1, d2, d3 = rng(40, 60), rng(20, 40), rng(0, 20)          # depth of the 3 most recent 20-day windows (old -> new)
    trend = (c > sma50) & (sma50 > sma200) & (sma200 > sma200.shift(20)) & (c >= 0.75 * hi252)
    contract = (d1 > d2) & (d2 > d3) & (d3 < 0.12)
    dry = v.rolling(10).mean() < 0.7 * va50
    setup = trend & contract & dry
    s["vcp_setup"] = setup
    s["vcp_breakout"] = setup.shift(1).fillna(False) & (c > hi20) & (v >= 1.5 * va)
    # reference
    s["near_52w_high"] = c >= 0.95 * hi252
    S = pd.DataFrame(s).fillna(False).astype(bool)
    liq = d.amt.rolling(20).mean() > 2e5
    mom = c / c.shift(120) - 1
    return S, liq, mom

def events(state):
    on = state & ~state.shift(1, fill_value=False)
    idx = np.flatnonzero(on.values); keep = []; last = -10**9
    for i in idx:
        if i - last >= 20: keep.append(i); last = i
    out = np.zeros(len(state), bool); out[keep] = True
    return out

rows = []; fwd = {H: {} for H in HS}; moms = {}
for f in sorted(glob.glob(os.path.join(DIR, "*.csv"))):
    sym = os.path.basename(f)[:-4]
    if re.search(r"(BD|D)\d{2,}$", sym) or re.search(r"D\d{4}", sym): continue
    d = load(f)
    if d is None: continue
    if d.close.tail(250).median() < 25: continue
    S, liq, mom = feats(d)
    entry = d.close.shift(-1)
    for H in HS:
        fwd[H][sym] = (d.close.shift(-1 - H) / entry - 1) * 100
    lq = liq.fillna(False).values
    moms[sym] = mom.where(liq.fillna(False))
    for name in S.columns:
        ev = events(S[name]) & lq
        for i in np.flatnonzero(ev):
            rows.append((sym, d.index[i], name))

ev = pd.DataFrame(rows, columns=["sym", "date", "sig"])
ev = ev[ev.date >= "2018-01-01"]
for H in HS:
    F = pd.DataFrame(fwd[H]).sort_index()
    F = F[F.index >= "2017-06-01"]
    mkt = F.mean(axis=1)
    ex = F.sub(mkt, axis=0)
    st = ex.stack(); st.index.names = ["date", "sym"]
    ev[f"ex{H}"] = st.reindex(pd.MultiIndex.from_arrays([ev.date, ev.sym])).values
    ev[f"raw{H}"] = F.stack().reindex(pd.MultiIndex.from_arrays([ev.date, ev.sym])).values

def stats(g, H):
    x = g[f"ex{H}"].dropna()
    if len(x) < 10: return dict(n=len(x))
    dm = g.dropna(subset=[f"ex{H}"]).groupby("date")[f"ex{H}"].mean()
    t = dm.mean() / (dm.std(ddof=1) / np.sqrt(len(dm))) if len(dm) > 2 else np.nan
    return dict(n=len(x), ex=x.mean(), net=x.mean() - COST, hit=(x > 0).mean() * 100, t=t,
                med=x.median(), raw=g[f"raw{H}"].mean())

ev["period"] = np.where(ev.date <= "2023-12-31", "train", "test")
res = []
for sig, g in ev.groupby("sig"):
    for H in HS:
        for p in ["train", "test"]:
            st_ = stats(g[g.period == p], H)
            res.append(dict(sig=sig, H=H, period=p, **st_))
R = pd.DataFrame(res)
R.to_csv(OUT, index=False)
ev.to_csv(OUT.replace(".csv", "_events.csv.gz"), index=False)
print("events", len(ev), "max date", ev.date.max())
