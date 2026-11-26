# nepse-floorsheet

Daily NEPSE floorsheet archive, collected by GitHub Actions.

- `data/floorsheet/YYYY-MM-DD.csv.gz` — one file per trading day
- Columns: `businessDate, contractId, stockSymbol, buyerMemberId, sellerMemberId, contractQuantity, contractRate, contractAmount, tradeTime`
- Workflow: `.github/workflows/floorsheet.yml` — runs Sun–Fri at 16:15 Nepal time; can also be run by hand (Actions → daily-floorsheet → Run workflow)
- Source: [NepseUnofficialApi](https://github.com/basic-bgnr/NepseUnofficialApi)
