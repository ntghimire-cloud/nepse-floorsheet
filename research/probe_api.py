"""One-off probe of NepseUnofficialApi endpoints (run by the probe workflow; prints shapes, saves samples)."""
import json, time, os, datetime as dt
from nepse import Nepse
n = Nepse(); n.setTLSVerification(False)
os.makedirs("probe", exist_ok=True)
def show(name, fn):
    t = time.time()
    try:
        r = fn()
        size = len(r) if hasattr(r, "__len__") else "-"
        first = r[0] if isinstance(r, list) and r else (r if isinstance(r, dict) else str(r)[:300])
        print(f"== {name}: {type(r).__name__} len={size} ({time.time()-t:.1f}s)")
        print(json.dumps(first, default=str)[:1500])
        json.dump(r, open(f"probe/{name}.json", "w"), default=str)
        return r
    except Exception as e:
        print(f"== {name}: ERROR {e!r}")
cl = show("companyList", n.getCompanyList)
if cl:
    from collections import Counter
    print("sectors:", Counter(c.get("sectorName") for c in cl).most_common())
show("nepseIndex", n.getNepseIndex)
show("subIndices", n.getNepseSubIndices)
g = show("nepseIndexGraph", n.getDailyNepseIndexGraph)
show("companyDetails_NABIL", lambda: n.getCompanyDetails("NABIL"))
show("priceHist_NABIL", lambda: n.getCompanyPriceVolumeHistory("NABIL", dt.date(2026, 11, 1), dt.date(2026, 11, 26)))
show("floorsheetOf_NABIL_2026-11-24", lambda: n.getFloorSheetOf("NABIL", "2026-11-24"))
show("priceVolumeHistory_2026-11-24", lambda: n.getPriceVolumeHistory("2026-11-24"))
show("supplyDemand", n.getSupplyDemand)
