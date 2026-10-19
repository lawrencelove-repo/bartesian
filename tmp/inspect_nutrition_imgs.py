import json
import re
from pathlib import Path
from html import unescape

html = Path("tmp/scrape/cache").glob("*espresso-martini*")
# find cached article
CACHE = Path("tmp/scrape/cache")
hits = [p for p in CACHE.iterdir() if "espresso-martini" in p.name.lower()]
print("cache hits", [h.name for h in hits])
path = None
for p in CACHE.iterdir():
    if "espresso-martini-98045" in p.name or p.name.endswith("espresso-martini-98045"):
        path = p
        break
if not path:
    # any file containing the slug
    for p in CACHE.iterdir():
        if "espresso_martini" in p.name or "espresso-martini" in p.name:
            path = p
            break
print("using", path)
if not path:
    raise SystemExit(1)
html = path.read_text(encoding="utf-8", errors="ignore")
m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
data = json.loads(m.group(1))
content = data["props"]["pageProps"]["htmlContent"]
print("--- content imgs ---")
for i, src in enumerate(re.findall(r'src="([^"]+)"', content)):
    print(i, src[:200])
print("--- all attachment urls in content ---")
for i, src in enumerate(re.findall(r"https://attachments\.gorgias\.help[^\"'\s]+", content)):
    print(i, src[:220])
