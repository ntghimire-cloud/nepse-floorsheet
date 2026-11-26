"""Shared helpers to save market-wide data from NepseUnofficialApi.
- companies:   data/companies.csv            (symbol, name, sector, instrument, status)
- day prices:  data/prices_full/DATE.csv.gz   (OHLC, volume, turnover, trades, market cap for every security)
- indices:     data/index/DATE.json           (NEPSE, sensitive, float indices + 13 sector sub-indices)"""
import csv, gzip, json, os, time

def retry(fn, tries=3, wait=20):
    for k in range(tries):
        try:
            return fn()
        except Exception as e:
            print(f"  attempt {k + 1} failed: {e!r}")
            if k + 1 < tries: time.sleep(wait)
    return None

def save_companies(n):
    rows = retry(n.getCompanyList)
    if not rows: return 0
    os.makedirs("data", exist_ok=True)
    keep = ["symbol", "companyName", "sectorName", "instrumentType", "status"]
    with open("data/companies.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=keep, extrasaction="ignore"); w.writeheader()
        w.writerows(sorted(rows, key=lambda r: r["symbol"]))
    return len(rows)

def day_prices(n, date):
    """All securities for one business date (paginated). Empty list on holidays."""
    out, page = [], 0
    while True:
        url = f"{n.api_end_points['todays_price']}?&size=500&businessDate={date}&page={page}"
        r = retry(lambda: n.requestPOSTAPI(url=url, payload_generator=n.getPOSTPayloadIDForFloorSheet))
        if r is None: raise RuntimeError(f"price fetch failed for {date}")
        content = r.get("content", []) if isinstance(r, dict) else []
        out += content
        if not isinstance(r, dict) or page + 1 >= r.get("totalPages", 1): break
        page += 1
    return [x for x in out if str(x.get("businessDate", ""))[:10] == str(date)]

PRICE_KEYS = ["businessDate", "symbol", "securityId", "openPrice", "highPrice", "lowPrice", "closePrice",
              "previousDayClosePrice", "totalTradedQuantity", "totalTradedValue", "totalTrades",
              "averageTradedPrice", "marketCapitalization", "fiftyTwoWeekHigh", "fiftyTwoWeekLow"]

def save_day_prices(rows, date):
    os.makedirs("data/prices_full", exist_ok=True)
    path = f"data/prices_full/{date}.csv.gz"
    with gzip.open(path, "wt", newline="") as f:
        w = csv.DictWriter(f, fieldnames=PRICE_KEYS, extrasaction="ignore"); w.writeheader(); w.writerows(rows)
    return path

def save_indices(n, date):
    idx, sub = retry(n.getNepseIndex), retry(n.getNepseSubIndices)
    if not idx and not sub: return None
    os.makedirs("data/index", exist_ok=True)
    path = f"data/index/{date}.json"
    json.dump({"date": str(date), "indices": idx or [], "sub": sub or []}, open(path, "w"), indent=0)
    return path
