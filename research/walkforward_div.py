"""Walk-forward test of pivot-based RSI divergence signals for NEPSE (same method as walkforward.py).
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

def rsi_w(c, n=14):
    d = c.diff(); g = d.clip(lower=0).ewm(alpha=1/n, adjust=False).mean(); l = (-d.clip(upper=0)).ewm(alpha=1/n, adjust=False).mean()
    return 100 - 100 / (1 + g / l)

def divergences(C, R, k=3, lookback=60, gap=5):
    """Regular RSI divergence on closes with pivot confirmation k bars later (no look-ahead).
    bear[t]=True when, as of day t, the two latest confirmed pivot highs (within lookback, >=gap apart) show
    higher close but lower RSI (by >2, first RSI >=55), and the second pivot was confirmed within the last 10 days.
    bull[t] mirrors it on pivot lows (lower close, higher RSI, first RSI <=45)."""
    n = len(C); bear = np.zeros(n, bool); bull = np.zeros(n, bool)
    ph, pl = [], []
    for t in range(2 * k, n):
        p = t - k  # candidate pivot confirmed today
        w = C[p - k:p + k + 1]
        if C[p] == w.max(): ph.append(p)
        if C[p] == w.min(): pl.append(p)
        hs = [x for x in ph if t - x <= lookback]; ls = [x for x in pl if t - x <= lookback]
        if len(hs) >= 2:
            a, b = hs[-2], hs[-1]
            if b - a >= gap and t - b <= 10 + k and C[b] > C[a] and R[b] < R[a] - 2 and R[a] >= 55: bear[t] = True
        if len(ls) >= 2:
            a, b = ls[-2], ls[-1]
            if b - a >= gap and t - b <= 10 + k and C[b] < C[a] and R[b] > R[a] + 2 and R[a] <= 45: bull[t] = True
    return bear, bull

def feats(d):
    c, v = d.close, d.vol
    R = rsi_w(c)
    bear, bull = divergences(c.values, R.values)
    s = {"rsi_bear_div": pd.Series(bear, index=c.index), "rsi_bull_div": pd.Series(bull, index=c.index),
         "near_52w_high": c >= 0.95 * d.high.rolling(252, min_periods=200).max()}
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
