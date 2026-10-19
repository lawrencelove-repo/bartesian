#!/usr/bin/env python3
"""Fetch romkal pods_data.csv and emit js/pods-barcode-map.js + data/barcodes/pods_data.csv."""
from __future__ import annotations

import json
import re
import unicodedata
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_CSV = ROOT / "data" / "barcodes" / "pods_data.csv"
OUT_JS = ROOT / "js" / "pods-barcode-map.js"

URLS = [
    "https://romkal.github.io/bartesian_pods/pods_data.csv",
    "https://raw.githubusercontent.com/romkal/bartesian_barcode/main/app/src/main/assets/pods_data.csv",
]

# romkal name → our cocktail slug when names diverge
NAME_ALIASES = {
    "white snagria": "white-sangria",
    "jalapeño lime shrub": "jalape-o-lime-shrub",
    "jollypeño margarita": "jollype-o-margarita",
    "witch's heart": "witchs-heart",
    "bee's knees": "bees-knees",
    "frosty's bananas foster": "frostys-bananas-foster",
}


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower().replace("'", "").replace("'", "")
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def fetch_csv() -> str:
    local = ROOT / "tmp" / "romkal" / "pods_data.csv"
    for url in URLS:
        try:
            with urllib.request.urlopen(url, timeout=30) as resp:
                text = resp.read().decode("utf-8")
            print("Fetched", url)
            return text
        except Exception as exc:  # noqa: BLE001
            print("Fail", url, exc)
    if local.exists():
        print("Using local", local)
        return local.read_text(encoding="utf-8")
    raise SystemExit("Could not load pods_data.csv")


def load_cocktail_index() -> dict[str, str]:
    """slugify(name) / slug → slug"""
    idx: dict[str, str] = {}
    for path in (ROOT / "data" / "cocktails").glob("*.txt"):
        name = slug = ""
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith("Name:"):
                name = line.split(":", 1)[1].strip()
            elif line.startswith("Slug:"):
                slug = line.split(":", 1)[1].strip()
        if not slug:
            continue
        idx[slug] = slug
        if name:
            idx[slugify(name)] = slug
            idx[name.lower()] = slug
    return idx


def resolve_slug(name: str, idx: dict[str, str]) -> str | None:
    key = name.strip().lower()
    if key in NAME_ALIASES:
        return NAME_ALIASES[key]
    if key in idx:
        return idx[key]
    s = slugify(name)
    if s in idx:
        return idx[s]
    # soft: our slug starts with or equals
    for slug in set(idx.values()):
        if slug == s or slug.startswith(s + "-") or s.startswith(slug + "-"):
            if len(s) >= 6:
                return slug
    return None


def main() -> None:
    text = fetch_csv()
    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    OUT_CSV.write_text(text, encoding="utf-8")

    idx = load_cocktail_index()
    by_code: dict[str, dict] = {}
    matched = unmatched = 0
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        code_s, name = line.split(",", 1)
        code = int(code_s.strip())
        name = name.strip()
        slug = resolve_slug(name, idx)
        if slug:
            matched += 1
        else:
            unmatched += 1
            print("  unmatched:", name)
        by_code[str(code)] = {"name": name, "slug": slug or ""}

    payload = {
        "source": "https://github.com/romkal/bartesian_barcode",
        "docs": "https://github.com/romkal/bartesian_barcode/blob/main/BARCODES.md",
        "byCode": by_code,
    }
    OUT_JS.write_text(
        "window.BARTESIAN_PODS_BARCODE_MAP = "
        + json.dumps(payload, indent=2, ensure_ascii=False)
        + ";\n",
        encoding="utf-8",
    )
    print(f"Wrote {OUT_CSV.relative_to(ROOT)} and {OUT_JS.relative_to(ROOT)}")
    print(f"Codes: {len(by_code)} matched={matched} unmatched={unmatched}")


if __name__ == "__main__":
    main()
