"""Fetch today's NEPSE floorsheet and save as data/floorsheet/YYYY-MM-DD.csv.gz
Source: NepseUnofficialApi (github.com/basic-bgnr/NepseUnofficialApi)."""
import csv, gzip, os, sys, time, datetime as dt
from nepse import Nepse

nepse = Nepse()
nepse.setTLSVerification(False)

rows = None
for attempt in range(3):
    try:
        rows = nepse.getFloorSheet()
        break
    except Exception as e:  # nepalstock.com is flaky / may block foreign IPs
        print(f"attempt {attempt + 1} failed: {e!r}")
        time.sleep(30)
if rows is None:
    sys.exit("Could not fetch floorsheet after 3 attempts")
if not rows:
    print("No floorsheet rows (holiday or market closed)"); sys.exit(0)

date = str(rows[0].get("businessDate") or dt.date.today())[:10]
keep = ["businessDate", "contractId", "stockSymbol", "buyerMemberId", "sellerMemberId",
        "contractQuantity", "contractRate", "contractAmount", "tradeTime"]
os.makedirs("data/floorsheet", exist_ok=True)
path = f"data/floorsheet/{date}.csv.gz"
with gzip.open(path, "wt", newline="") as f:
    w = csv.DictWriter(f, fieldnames=keep, extrasaction="ignore"); w.writeheader(); w.writerows(rows)
print(f"saved {len(rows)} rows -> {path}")
