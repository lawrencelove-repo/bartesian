import re
from pathlib import Path

html = Path("tmp/scrape/vodka-cocktails-324907.html").read_text(encoding="utf-8-sig", errors="ignore")
links = sorted(set(re.findall(r'href="(https://bartesian\.gorgias\.help/en-US/[^"]+)"', html)))
print("absolute links", len(links))
for l in links[:40]:
    print(l)
rel = sorted(set(re.findall(r'href="(/en-US/[^"]+)"', html)))
print("rel", len(rel))
for l in rel[:50]:
    print(l)
slugs = sorted(set(re.findall(r'"slug":"([^"]+)"', html)))
print("slugs", len(slugs))
for s in slugs[:50]:
    print(s)
# article cards
ids = sorted(set(re.findall(r"/en-US/([a-z0-9-]+-\d+)", html)))
print("id-like", len(ids))
for i in ids[:60]:
    print(i)
