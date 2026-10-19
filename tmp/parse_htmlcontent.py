import json
import re
from pathlib import Path
from html import unescape

html = Path("tmp/scrape/lemon-drop.html").read_text(encoding="utf-8-sig", errors="ignore")
m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
data = json.loads(m.group(1))
content = data["props"]["pageProps"]["htmlContent"]
Path("tmp/scrape/lemon-drop.content.html").write_text(content, encoding="utf-8")
text = unescape(re.sub(r"<br\s*/?>", "\n", content, flags=re.I))
text = re.sub(r"</p>", "\n", text, flags=re.I)
text = re.sub(r"<[^>]+>", "", text)
text = re.sub(r"[ \t]+\n", "\n", text)
text = re.sub(r"\n{3,}", "\n\n", text).strip()
print(text[:2500])
print("---IMGS---")
for src in re.findall(r'src="([^"]+)"', content):
    if "logo" in src.lower():
        continue
    print(src[:220])
