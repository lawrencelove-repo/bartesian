import json
import re
from pathlib import Path
from html import unescape

data = json.loads(Path("tmp/scrape/cocktails.json").read_text(encoding="utf-8-sig"))
# Find a classic cocktail with richer body
for p in data["products"]:
    if p["handle"] == "lemon-drop":
        body = p.get("body_html") or ""
        text = unescape(re.sub(r"<[^>]+>", "\n", body))
        text = re.sub(r"\n+", "\n", text).strip()
        print("TITLE", p["title"])
        print("TAGS", p.get("tags"))
        print("BODY\n", text[:2000])
        print("IMG", p["images"][0]["src"] if p.get("images") else None)
        print("BARCODE", p["variants"][0].get("barcode") if p.get("variants") else None)
        break

packs = json.loads(Path("tmp/scrape/cocktail-variety-packs.json").read_text(encoding="utf-8-sig"))
print("\nPACKS", len(packs["products"]))
for p in packs["products"]:
    print("-", p["title"], "|", p["handle"])

acc = json.loads(Path("tmp/scrape/barware-accessories.json").read_text(encoding="utf-8-sig"))
rimmers = [
    p
    for p in acc["products"]
    if "rimmer" in (p.get("title") or "").lower()
    and "wooden" not in (p.get("title") or "").lower()
]
print("\nRIMMERS", len(rimmers))
for p in rimmers:
    print("-", p["title"], "|", p["handle"])
