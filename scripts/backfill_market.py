"""One-off: save data/prices_full/DATE.csv.gz for past business dates (default: last 400 days).
Usage: python scripts/backfill_market.py [days]"""
import os, sys, time, datetime as dt
from nepse import Nepse
from nepse_market import save_companies, day_prices, save_day_prices

days = int(sys.argv[1]) if len(sys.argv) > 1 else 400
n = Nepse(); n.setTLSVerification(False)
print("companies:", save_companies(n))
today = (dt.datetime.utcnow() + dt.timedelta(hours=5, minutes=45)).date()
saved = 0
for k in range(days, 0, -1):
    d = today - dt.timedelta(days=k)
    if d.weekday() == 5: continue  # Saturday: no trading
    if os.path.exists(f"data/prices_full/{d}.csv.gz"): continue
    try:
        rows = day_prices(n, d.isoformat())
    except Exception as e:
        print(d, "failed:", e); continue
    if rows:
        save_day_prices(rows, d.isoformat()); saved += 1
        print(d, len(rows))
    time.sleep(0.2)
print("saved", saved, "days")
