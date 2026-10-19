"""Clear nutrition fields that still point at cocktail photos; re-scrape those items."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

# import by path
import importlib.util

spec = importlib.util.spec_from_file_location("enrich", ROOT / "scripts" / "enrich-catalog.py")
enrich = importlib.util.module_from_spec(spec)
spec.loader.exec_module(enrich)


def is_cocktail_photo(path: Path) -> bool:
    if not path.exists():
        return False
    im = Image.open(path)
    w, h = im.size
    pct = enrich.whiteish_pct(im)
    return pct >= 80 and max(w, h) >= 900


def main():
    shop_idx = enrich.load_shopify_index()
    fixed = 0
    for path in sorted((ROOT / "data" / "cocktails").glob("*.txt")):
        text = path.read_text(encoding="utf-8")
        m = re.search(r'^Nutrition:\s*(\{.*\}|\s*)$', text, re.M)
        if not m or not m.group(1).strip().startswith("{"):
            continue
        try:
            nutr = json.loads(m.group(1))
        except json.JSONDecodeError:
            continue
        label = nutr.get("label_image") or ""
        if label and is_cocktail_photo(ROOT / label):
            print("fix", path.name, label)
            enrich.rewrite_cocktail(path, shop_idx)
            fixed += 1
    print("fixed", fixed)

    # verify dirty vodka
    t = (ROOT / "data" / "cocktails" / "DirtyVodkaMartini.txt").read_text(encoding="utf-8")
    print("DirtyVodkaMartini Nutrition:", re.search(r"^Nutrition:.*$", t, re.M).group(0))


if __name__ == "__main__":
    main()
