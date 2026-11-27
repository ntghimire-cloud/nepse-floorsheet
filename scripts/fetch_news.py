"""Daily: company announcements from merolagani.com/AnnouncementList.aspx -> data/news/announcements.csv (append, dedupe by id).
Each row: id, date, symbol, type, title, url. Symbol comes from the "(SYMBOL)" in the title or a company-name match."""
import csv, html, os, re, sys, urllib.request, datetime as dt

URL = "https://merolagani.com/AnnouncementList.aspx"
OUT = "data/news/announcements.csv"
TYPES = [("agm", r"\bagm\b|sgm|general meeting|साधारण सभा"),
         ("quarterly", r"quarter|q[1-4]\b|त्रैमास|financial (report|statement|highlight)|unaudited|audited"),
         ("dividend", r"dividend|लाभांश|bonus share|बोनस"), ("right", r"right share|हकप्रद"), ("bookclose", r"book clos"), ("auction", r"auction|लिलाम"),
         ("merger", r"merger|acquisition|गाभ"), ("ipo", r"\bipo\b|fpo|debenture|ऋणपत्र")]

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (nepse-floorsheet daily job)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")

def main():
    try:
        page = get(URL)
    except Exception as e:
        sys.exit(f"announcement page failed: {e!r}")
    names, syms = {}, set()
    if os.path.exists("data/companies.csv"):
        for c in csv.DictReader(open("data/companies.csv")):
            syms.add(c["symbol"])
            if c.get("instrumentType") != "Equity" or "promoter" in c["companyName"].lower(): continue
            key = re.sub(r"[^a-z]", "", c["companyName"].lower())[:25]
            if c.get("status") == "A" or key not in names: names[key] = c["symbol"]
    rows = []
    for m in re.finditer(r'href="[^"]*AnnouncementDetail\.aspx\?id=(\d+)"[^>]*>(.*?)</a>', page, re.S | re.I):
        aid, title = m.group(1), re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", m.group(2)))).strip()
        if not title: continue
        before = page[max(0, m.start() - 600):m.start()]
        dm = list(re.finditer(r"([A-Z][a-z]{2} \d{1,2}, \d{4})", before))
        date = ""
        if dm:
            try: date = dt.datetime.strptime(dm[-1].group(1), "%b %d, %Y").date().isoformat()
            except ValueError: pass
        sm = re.findall(r"\(([A-Z0-9]{2,10})\)", title)
        sym = next((s for s in reversed(sm) if not syms or s in syms), "")
        if not sym:
            key = re.sub(r"[^a-z]", "", title.lower())
            sym = next((s for n, s in names.items() if len(n) > 8 and n[:20] in key), "")
        typ = next((t for t, rx in TYPES if re.search(rx, title, re.I)), "other")
        rows.append({"id": aid, "date": date, "symbol": sym, "type": typ, "title": title,
                     "url": f"https://merolagani.com/AnnouncementDetail.aspx?id={aid}"})
    print(f"parsed {len(rows)} announcements; first: {rows[:2]}")
    if not rows:
        print("page head:", page[:500].replace("\n", " ")); sys.exit(1)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    old = {r["id"]: r for r in csv.DictReader(open(OUT))} if os.path.exists(OUT) else {}
    new = [r for r in rows if r["id"] not in old]
    for r in rows: old[r["id"]] = r  # refresh symbol/type with the current parser
    keep = sorted(old.values(), key=lambda r: int(r["id"]), reverse=True)[:5000]
    with open(OUT, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["id", "date", "symbol", "type", "title", "url"]); w.writeheader(); w.writerows(keep)
    print(f"new {len(new)}, total {len(keep)}")

main()
