"""Daily: company/sector list, full day prices (with market cap) and NEPSE + sector indices.
Runs after fetch_floorsheet.py; skips the day files when today's floorsheet is missing (holiday)."""
import os, sys, datetime as dt
from nepse import Nepse
from nepse_market import save_companies, day_prices, save_day_prices, save_indices

n = Nepse(); n.setTLSVerification(False)
print("companies:", save_companies(n))
today = (dt.datetime.utcnow() + dt.timedelta(hours=5, minutes=45)).date().isoformat()
if not os.path.exists(f"data/floorsheet/{today}.csv.gz"):
    print(f"no trading today ({today}); skipping prices and indices"); sys.exit(0)
rows = day_prices(n, today)
print(f"prices {today}: {len(rows)} rows ->", save_day_prices(rows, today) if rows else "none")
print("indices ->", save_indices(n, today))
