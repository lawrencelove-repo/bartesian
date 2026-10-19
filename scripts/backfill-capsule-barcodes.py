#!/usr/bin/env python3
"""Write Capsule Barcode into cocktail .txt from romkal pods_data map (when empty)."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAP_JS = ROOT / "js" / "pods-barcode-map.js"
COCKTAILS = ROOT / "data" / "cocktails"


def load_map() -> dict[str, dict]:
    text = MAP_JS.read_text(encoding="utf-8")
    m = re.search(r"window\.BARTESIAN_PODS_BARCODE_MAP\s*=\s*(\{.*\})\s*;\s*$", text, re.S)
    if not m:
        raise SystemExit("Could not parse pods-barcode-map.js")
    return json.loads(m.group(1)).get("byCode") or {}


def main() -> None:
    by_code = load_map()
    # slug -> first code (prefer longer/more recent codes if duplicates)
    slug_to_codes: dict[str, list[str]] = {}
    for code, info in by_code.items():
        slug = (info.get("slug") or "").strip()
        if not slug:
            continue
        slug_to_codes.setdefault(slug, []).append(code)

    updated = 0
    for path in sorted(COCKTAILS.glob("*.txt")):
        text = path.read_text(encoding="utf-8")
        slug_m = re.search(r"^Slug:\s*(.*)$", text, re.M)
        if not slug_m:
            continue
        slug = slug_m.group(1).strip()
        codes = slug_to_codes.get(slug) or []
        if not codes:
            continue
        # Prefer the lexicographically last numeric code (often the assigned drink-id era)
        code = sorted(codes, key=lambda c: (len(c), c))[-1]
        # Use [ \t]* not \s* — \s would swallow the newline and eat the next field.
        cur = re.search(r"^Capsule Barcode:[ \t]*(.*)$", text, re.M)
        if cur and cur.group(1).strip():
            continue
        if cur:
            text = re.sub(
                r"^Capsule Barcode:[ \t]*.*$",
                f"Capsule Barcode: {code}",
                text,
                count=1,
                flags=re.M,
            )
        else:
            text = text.rstrip() + f"\nCapsule Barcode: {code}\n"
        path.write_text(text, encoding="utf-8")
        updated += 1
        print(f"{slug}: {code}")
    print(f"Updated {updated} cocktails")


if __name__ == "__main__":
    main()
