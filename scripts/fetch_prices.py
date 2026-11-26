"""Fetch today's NEPSE price/volume for all securities and save as data/prices/YYYY-MM-DD.csv.gz.
Raw fields are kept as returned by NepseUnofficialApi; scan_daily.js maps them.
Skips (exit 0) when the data is not for today (holiday / market closed)."""
import csv, gzip, os, sys, time, datetime as dt
from nepse import Nepse

nepse = Nepse()
nepse.setTLSVerification(False)
rows = None
for attempt in range(3):
    try:
        rows = nepse.getPriceVolume()
        break
    except Exception as e:
        print(f"attempt {attempt + 1} failed: {e!r}")
        time.sleep(30)
if not rows:
    sys.exit("No price rows returned")

today = (dt.datetime.utcnow() + dt.timedelta(hours=5, minutes=45)).date().isoformat()
stamp = next((str(r.get(k)) for r in rows for k in ("businessDate", "lastUpdatedDateTime", "lastUpdatedTime") if r.get(k)), "")
date = stamp[:10] if stamp[:4].isdigit() else today
print("sample keys:", sorted(rows[0].keys()))
print("sample row:", rows[0])
if date != today:
    print(f"price data date {date} != today {today}; skipping"); sys.exit(0)

keys = sorted({k for r in rows for k in r.keys()})
os.makedirs("data/prices", exist_ok=True)
path = f"data/prices/{date}.csv.gz"
with gzip.open(path, "wt", newline="") as f:
    w = csv.DictWriter(f, fieldnames=keys, extrasaction="ignore"); w.writeheader(); w.writerows(rows)
print(f"saved {len(rows)} rows -> {path}")
