import json
import re
from pathlib import Path
from html import unescape

html = Path("tmp/scrape/lemon-drop.html").read_text(encoding="utf-8-sig", errors="ignore")
m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
print("next_data", bool(m))
if not m:
    raise SystemExit(1)
data = json.loads(m.group(1))
Path("tmp/scrape/lemon-drop.next.json").write_text(json.dumps(data, indent=2)[:200000], encoding="utf-8")

# Walk for article content
def find_keys(obj, needle, path=""):
    found = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = f"{path}.{k}" if path else k
            if needle in str(k).lower():
                found.append((p, type(v).__name__, str(v)[:200]))
            found.extend(find_keys(v, needle, p))
    elif isinstance(obj, list):
        for i, v in enumerate(obj[:50]):
            found.extend(find_keys(v, needle, f"{path}[{i}]"))
    return found

for needle in ["content", "body", "article", "html"]:
    hits = find_keys(data, needle)
    print(needle, len(hits))
    for h in hits[:12]:
        print(" ", h[0], h[1], h[2][:120].replace("\n", " "))

# Try common path
props = data.get("props", {}).get("pageProps", {})
print("pageProps keys", props.keys())
for k, v in props.items():
    if isinstance(v, dict):
        print(k, v.keys())
    else:
        print(k, type(v).__name__, str(v)[:100])
