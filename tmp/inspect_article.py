import re
from pathlib import Path

html = Path("tmp/scrape/lemon-drop.html").read_text(encoding="utf-8-sig", errors="ignore")
print("bytes", len(html))
imgs = re.findall(r"https://attachments\.gorgias\.help[^\"'\s]+", html)
print("imgs", len(imgs))
for i in imgs[:30]:
    print(i[:200])

for pat in ["Base Spirit", "Glassware", "Garnish", "Alcohol Volume", "nutrition", "UPC", "Ingredients"]:
    print(pat, pat.lower() in html.lower())

for label in ["Base Spirit:", "Base Spirits:", "Recommended Glassware:", "Garnish:", "Alcohol Volume:"]:
    for m in re.finditer(re.escape(label) + r"\s*([^<]+)", html):
        print(label, m.group(1).strip()[:120])

# strip tags rough description
# find h1
h1 = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.I | re.S)
print("h1", re.sub(r"<[^>]+>", "", h1.group(1)).strip() if h1 else None)
