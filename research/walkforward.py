"""Walk-forward indicator selection for NEPSE.
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

def feats(d):
    c, h, l, v, o = d.close, d.high, d.low, d.vol, d.open
    s = {}
    va = v.rolling(20).mean().shift(1)
    hi20 = h.rolling(20).max().shift(1); lo20 = l.rolling(20).min().shift(1)
    hi252 = h.rolling(252, min_periods=200).max()
    sma50 = c.rolling(50).mean(); sma200 = c.rolling(200).mean(); ema20 = c.ewm(span=20, adjust=False).mean()
    slope200 = sma200 / sma200.shift(20) - 1
    r = rsi(c)
    obv = (np.sign(c.diff()).fillna(0) * v).cumsum()
    mfm = ((c - l) - (h - c)) / (h - l).replace(0, np.nan)
    cmf = (mfm.fillna(0) * v).rolling(20).sum() / v.rolling(20).sum()
    vwap20 = (c * v).rolling(20).sum() / v.rolling(20).sum()
    m = c.ewm(span=12, adjust=False).mean() - c.ewm(span=26, adjust=False).mean(); sg = m.ewm(span=9, adjust=False).mean()
    near52 = c >= 0.95 * hi252
    s["vol2x_brk_52w"] = (c > hi20) & (v >= 2 * va) & near52
    s["vol15_brk"] = (c > hi20) & (v >= 1.5 * va)
    s["rsi_gt70"] = r > 70
    s["rsi_60_70"] = (r > 60) & (r <= 70)
    s["near_52w_high"] = near52
    s["obv_cmf"] = (obv > obv.rolling(20).mean()) & (cmf > 0.1)
    strong = ((c - l) / (h - l).replace(0, np.nan) >= 0.7) & (v > va)
    s["fs_proxy"] = strong.astype(float).rolling(10).sum() >= 5
    s["fvg"] = (l > h.shift(2)) & (v >= 1.5 * va) & (c > sma50)
    s["above_vwap20"] = c > vwap20
    s["pullback"] = (c > sma50) & (sma50 > sma200) & (l <= ema20) & (c > ema20) & (c > o)
    s["macd_cross"] = m > sg
    s["g1_obv"] = (c > sma200) & (slope200 >= -0.01) & (obv > obv.rolling(50).mean())
    s["g4_deep"] = (c < 0.7 * sma200) & (slope200 < -0.01)
    s["dd_from_52w_40"] = c <= 0.6 * hi252
    s["SELL_distribution"] = (obv < obv.rolling(20).mean()) & (cmf < -0.1)
    s["SELL_below_200"] = (c < sma200) & (c.shift(1) >= sma200.shift(1))
    s["SELL_20d_low"] = c < lo20
    s["SELL_g8_ext"] = (c > 1.4 * sma200) & (slope200 > 0.01)
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

# momentum top-20% cross-sectional (event = enters top quintile)
M = pd.DataFrame(moms)
rank = M.rank(axis=1, pct=True)
for sym in M.columns:
    st = (rank[sym] >= 0.8).fillna(False)
    for i in np.flatnonzero(events(st)):
        rows.append((sym, M.index[i], "mom120_top20"))

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
