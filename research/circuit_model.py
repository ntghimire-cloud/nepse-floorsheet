"""Next-day upper-circuit (+9.5%) probability model for NEPSE.
Target: close[t+1]/close[t]-1 >= 9.5% (adjusted). Features known at close t.
Train 2018-2023, test 2024-2026. Compare with base rate; also check next-day return of top buckets."""
import sys, re, glob, os
import numpy as np, pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score

DIR, OUT = sys.argv[1], sys.argv[2]

def load(f):
    d = pd.read_csv(f); d = d[d.close > 0].copy()
    d["published_date"] = pd.to_datetime(d.published_date)
    d = d.sort_values("published_date").drop_duplicates("published_date")
    if len(d) < 300: return None
    c = d.close.values; pc = d.per_change.values; fac = np.ones(len(d)); f_ = 1.0
    for i in range(len(d) - 1, 0, -1):
        fac[i] = f_
        if not np.isfinite(pc[i]) or pc[i] <= -100: continue
        if abs(c[i] / c[i-1] - 1 - pc[i] / 100) > 0.03:
            k = c[i] / (1 + pc[i] / 100) / c[i-1]
            if 0.3 < k < 0.98: f_ *= k
    fac[0] = f_
    for col in ["open", "high", "low", "close"]: d[col] = d[col] * fac
    d["open"] = np.where(d.open > 0, d.open, d.close)
    d["high"] = d[["high", "open", "close"]].max(axis=1)
    d["low"] = np.where(d.low > 0, np.minimum(d.low, np.minimum(d.open, d.close)), np.minimum(d.open, d.close))
    d["vol"] = d.traded_quantity.fillna(0) / fac; d["amt"] = d.traded_amount.fillna(0)
    return d.set_index("published_date")

frames = []
for f in sorted(glob.glob(os.path.join(DIR, "*.csv"))):
    sym = os.path.basename(f)[:-4]
    if re.search(r"(BD|D)\d{2,}$", sym) or re.search(r"D\d{4}", sym): continue
    d = load(f)
    if d is None or d.close.tail(250).median() < 25: continue
    c, h, l, v, o = d.close, d.high, d.low, d.vol, d.open
    r1 = c.pct_change() * 100
    va = v.rolling(20).mean().shift(1)
    x = pd.DataFrame(index=d.index)
    x["r1"] = r1
    x["r1_prev"] = r1.shift(1)
    x["r5"] = (c / c.shift(5) - 1) * 100
    x["r20"] = (c / c.shift(20) - 1) * 100
    x["r120"] = (c / c.shift(120) - 1) * 100
    x["circ_today"] = (r1 >= 9.5).astype(float)
    x["circ_5d"] = (r1 >= 9.5).astype(float).rolling(5).sum()
    x["up_streak"] = (r1 > 0).astype(int).groupby((r1 <= 0).cumsum()).cumsum()
    x["close_loc"] = ((c - l) / (h - l).replace(0, np.nan)).fillna(0.5)
    x["close_eq_high"] = (c >= h * 0.999).astype(float)
    x["vol_ratio"] = np.log1p(v / va)
    x["vol_ratio5"] = np.log1p(v.rolling(5).mean() / va)
    x["near52"] = c / h.rolling(252, min_periods=120).max()
    x["dist200"] = c / c.rolling(200, min_periods=120).mean() - 1
    x["volat20"] = r1.rolling(20).std()
    x["logprice"] = np.log(c)
    x["logamt"] = np.log1p(d.amt.rolling(20).mean())
    x["y"] = ((c.shift(-1) / c - 1) * 100 >= 9.5).astype(float)
    x["next_ret"] = (c.shift(-1) / c - 1) * 100
    x["next_open_ret"] = (o.shift(-1) / c - 1) * 100
    x.loc[x.index[-1], ["y", "next_ret"]] = np.nan
    x["liq"] = d.amt.rolling(20).mean() > 2e5
    x["sym"] = sym
    frames.append(x)

D = pd.concat(frames)
D = D[(D.index >= "2018-01-01") & D.liq].replace([np.inf, -np.inf], np.nan).dropna(subset=["y", "r20", "volat20", "near52"])
feat = ["r1", "r1_prev", "r5", "r20", "r120", "circ_today", "circ_5d", "up_streak", "close_loc", "close_eq_high",
        "vol_ratio", "vol_ratio5", "near52", "dist200", "volat20", "logprice", "logamt"]
tr = D[D.index <= "2023-12-31"]; te = D[D.index >= "2024-01-01"]
lines = []
P = lambda s: lines.append(s) or print(s)
P(f"rows train {len(tr)} test {len(te)}")
P(f"base rate train {tr.y.mean()*100:.2f}% test {te.y.mean()*100:.2f}%")
P("base rate by year: " + ", ".join(f"{y}:{g.y.mean()*100:.2f}%" for y, g in D.groupby(D.index.year)))

# simple rule: circuit today
for name, m in [("circuit आज (r1>=9.5)", te.circ_today == 1), ("circuit आज + close=high", (te.circ_today == 1) & (te.close_eq_high == 1))]:
    P(f"rule {name}: n={m.sum()} P(circuit भोलि)={te.y[m].mean()*100:.1f}% next_ret={te.next_ret[m].mean():.2f}%")

X = tr[feat].fillna(0); Xt = te[feat].fillna(0)
models = {
    "logit": LogisticRegression(max_iter=2000, C=0.5, class_weight=None),
    "gbm": HistGradientBoostingClassifier(max_iter=300, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=200, l2_regularization=1.0, random_state=0),
}
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
models["logit"] = make_pipeline(StandardScaler(), models["logit"])
res = {}
for nm, mdl in models.items():
    mdl.fit(X, tr.y)
    p = mdl.predict_proba(Xt)[:, 1]
    auc = roc_auc_score(te.y, p)
    te_ = te.assign(p=p)
    P(f"\n[{nm}] test AUC {auc:.3f}")
    # per-day top-k picks
    for k in [1, 3, 5]:
        top = te_.sort_values("p", ascending=False).groupby(level=0).head(k)
        P(f"  प्रति दिन शीर्ष {k}: n={len(top)} hit={top.y.mean()*100:.1f}% (base {te.y.mean()*100:.2f}%) lift={top.y.mean()/te.y.mean():.1f}x  next_close_ret={top.next_ret.mean():.2f}%  next_open_ret={top.next_open_ret.mean():.2f}%")
    q = pd.qcut(te_.p.rank(method="first"), 20, labels=False)
    g = te_.groupby(q).agg(n=("y", "size"), hit=("y", "mean"), ret=("next_ret", "mean"))
    P("  शीर्ष 5% bucket: hit {:.1f}%  next_ret {:.2f}%".format(g.hit.iloc[-1]*100, g.ret.iloc[-1]))
    res[nm] = te_
# feature importance via logit coefficients
coef = models["logit"][-1].coef_[0]
P("\nlogit coef (standardized): " + ", ".join(f"{f}:{c:+.2f}" for f, c in sorted(zip(feat, coef), key=lambda z: -abs(z[1]))[:8]))
open(OUT, "w").write("\n".join(lines))
