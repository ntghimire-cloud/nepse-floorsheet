# nepse-floorsheet

Daily NEPSE floorsheet archive, prices and a scan dashboard, all updated by GitHub Actions.

- `data/floorsheet/YYYY-MM-DD.csv.gz` — every trade of the day (`businessDate, contractId, stockSymbol, buyerMemberId, sellerMemberId, contractQuantity, contractRate, contractAmount, tradeTime`)
- `data/prices/YYYY-MM-DD.csv.gz` — close, % change and volume for each security
- `docs/` — the dashboard (GitHub Pages). Data in `docs/data/` is generated on each run and not committed.
- `scripts/lib_scan.js` — indicators, scoring and data loading (shared by the scan, the dashboard and the backtest)
- `scripts/scan_daily.js` — daily scan; `REPORT_OUT=file.json` also writes the dashboard data
- `scripts/backtest_components.js` — historical effect of each indicator and of the total score
- `research/` — walk-forward and circuit-model studies
- Workflow `.github/workflows/floorsheet.yml` runs Sun–Fri at 16:15 Nepal time (or by hand: Actions → daily-floorsheet → Run workflow)

One-time setup for the dashboard: Settings → Pages → Source: **GitHub Actions**, and a repository secret **DASH_PASSWORD**. The dashboard data is published only encrypted (AES-256-GCM, key from PBKDF2-SHA256 of that password, `scripts/encrypt_data.js`); the page asks for the password. Without the secret no readable data is published.

Price history: [Aabishkar2/nepse-data](https://github.com/Aabishkar2/nepse-data). Live data: [NepseUnofficialApi](https://github.com/basic-bgnr/NepseUnofficialApi).
Rule-based technical screening only, not investment advice.
