#!/usr/bin/env python3
"""
Expand rimmer "Pairs With" text into Cocktail Slugs, then (via import)
populate the cocktail_rimmers join table for cocktail → rimmer lookups.

Usage:
  python scripts/sync-rimmer-pairings.py
  node scripts/import-data.js
"""
from __future__ import annotations

import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COCKTAILS = ROOT / "data" / "cocktails"
RIMMERS = ROOT / "data" / "rimmers"


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower()
    text = text.replace("'", "").replace("'", "").replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def parse_fields(text: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for line in text.splitlines():
        m = re.match(r"^([A-Za-z][A-Za-z0-9 ]*):[ \t]*(.*)$", line)
        if m:
            fields[m.group(1)] = m.group(2).strip()
    return fields


def set_field(text: str, key: str, value: str) -> str:
    pattern = re.compile(rf"^{re.escape(key)}:.*$", re.M)
    replacement = f"{key}: {value}"
    if pattern.search(text):
        return pattern.sub(replacement, text, count=1)
    # insert after Pairs With if present, else append
    m = re.search(r"^Pairs With:.*$", text, re.M)
    if m:
        return text[: m.end()] + f"\n{replacement}" + text[m.end() :]
    return text.rstrip() + f"\n{replacement}\n"


def load_cocktails() -> list[dict]:
    items = []
    for path in sorted(COCKTAILS.glob("*.txt")):
        f = parse_fields(path.read_text(encoding="utf-8"))
        name = f.get("Name") or path.stem
        slug = f.get("Slug") or slugify(name)
        spirits = [s.strip() for s in (f.get("Spirits") or "").split(",") if s.strip()]
        items.append({"name": name, "slug": slug, "spirits": spirits, "path": path})
    return items


def cocktail_indexes(cocktails: list[dict]):
    by_slug = {c["slug"]: c for c in cocktails}
    by_name = {}
    for c in cocktails:
        by_name[c["name"].lower()] = c
        by_name[slugify(c["name"]).replace("-", " ")] = c
    return by_slug, by_name


def family_slugs(phrase: str, cocktails: list[dict]) -> list[str] | None:
    """
    Expand family phrases only — not named cocktails like "Spicy Margarita".

    Expands when:
      - "all types of Margaritas" / "all other types of Margaritas"
      - bare plurals: "Margaritas", "Lemon Drops", "Cosmopolitans", …
      - "other whiskey cocktails"
    Returns [] for vague leftovers, None when the phrase should be name-matched.
    """
    raw = phrase.lower().strip(" .&")
    raw = re.sub(r"\s+to\s+perfection$", "", raw).strip()
    if not raw:
        return []

    all_m = re.match(
        r"^(?:all(?:\s+other)?(?:\s+types)?(?:\s+of)?|other)\s+(.+)$",
        raw,
    )
    rest = (all_m.group(1) if all_m else raw).strip()

    def margaritas():
        return [c["slug"] for c in cocktails if "margarita" in c["slug"]]

    def lemon_drops():
        return [c["slug"] for c in cocktails if "lemon-drop" in c["slug"]]

    def cosmos():
        return [
            c["slug"]
            for c in cocktails
            if c["slug"] in ("cosmopolitan", "low-cal-cosmopolitan")
        ]

    def old_fashioneds():
        return [c["slug"] for c in cocktails if "old-fashioned" in c["slug"]]

    def gimlets():
        return [c["slug"] for c in cocktails if "gimlet" in c["slug"]]

    def whiskeys():
        return [
            c["slug"]
            for c in cocktails
            if any("whiskey" in s.lower() or "bourbon" in s.lower() for s in c["spirits"])
            or "whiskey" in c["slug"]
        ]

    # Vague category with no usable family
    if rest in {"cocktails", "dessert cocktails"} or re.fullmatch(
        r"(?:other\s+)?dessert\s+cocktails?", rest
    ):
        return []

    if re.search(r"whiskey\s+cocktails?$", rest):
        return whiskeys() if all_m or rest.startswith("whiskey") else None

    # "all types of … Margaritas" / "fruit-forward margaritas" under all-prefix
    if all_m:
        if "margarita" in rest:
            return margaritas()
        if "lemon drop" in rest:
            return lemon_drops()
        if "cosmopolitan" in rest:
            return cosmos()
        if "old fashioned" in rest or "old-fashioned" in rest:
            return old_fashioneds()
        if "gimlet" in rest:
            return gimlets()
        return []

    # Bare plural family words only (not "Spicy Margarita" / "Lemon Drop")
    if re.fullmatch(r"margaritas", rest):
        return margaritas()
    if re.fullmatch(r"lemon\s*drops", rest):
        return lemon_drops()
    if re.fullmatch(r"cosmopolitans", rest):
        return cosmos()
    if re.fullmatch(r"old\s*fashioneds", rest):
        return old_fashioneds()
    if re.fullmatch(r"gimlets", rest):
        return gimlets()

    return None


def split_pairing_parts(pairs_with: str) -> list[str]:
    text = pairs_with.replace("&", ",")
    # Keep "all types of X" together: split on comma / " and " but not inside "all types of"
    parts = re.split(r",|\band\b", text)
    return [p.strip(" .") for p in parts if p.strip(" .")]


def resolve_pair_slugs(pairs_with: str, cocktails: list[dict], by_slug, by_name) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()

    def add(slug: str) -> None:
        if slug and slug in by_slug and slug not in seen:
            seen.add(slug)
            found.append(slug)

    for part in split_pairing_parts(pairs_with):
        if not part:
            continue
        family = family_slugs(part, cocktails)
        if family is not None:
            for slug in family:
                add(slug)
            continue

        # Direct name / slug match
        key = part.lower().strip()
        if key in by_name:
            add(by_name[key]["slug"])
            continue

        slug = slugify(part)
        if slug in by_slug:
            add(slug)
            continue

        # Soft match: strip trailing "cocktails"
        slug2 = slugify(re.sub(r"\s+cocktails?$", "", part, flags=re.I))
        if slug2 in by_slug:
            add(slug2)
            continue

        # Prefix / contains for near names (e.g. Lemon Drops → lemon-drop already handled)
        # Try matching cocktail whose slug is contained or name startswith
        matches = [
            c
            for c in cocktails
            if c["slug"] == slug
            or c["name"].lower() == key
            or slugify(c["name"]) == slug
        ]
        for c in matches:
            add(c["slug"])

    return found


def main() -> None:
    cocktails = load_cocktails()
    by_slug, by_name = cocktail_indexes(cocktails)
    # Reverse map for reporting
    cocktail_to_rimmers: dict[str, list[str]] = {c["slug"]: [] for c in cocktails}

    total_links = 0
    for path in sorted(RIMMERS.glob("*.txt")):
        text = path.read_text(encoding="utf-8")
        fields = parse_fields(text)
        name = fields.get("Name") or path.stem
        pairs = fields.get("Pairs With") or ""
        slugs = resolve_pair_slugs(pairs, cocktails, by_slug, by_name)
        old = [
            s.strip()
            for s in (fields.get("Cocktail Slugs") or "").split(",")
            if s.strip()
        ]
        text = set_field(text, "Cocktail Slugs", ", ".join(slugs))
        path.write_text(text, encoding="utf-8")
        total_links += len(slugs)
        added = [s for s in slugs if s not in old]
        print(f"{name}: {len(slugs)} cocktails" + (f" (+{len(added)} new)" if added else ""))
        if added:
            print(f"  + {', '.join(added)}")
        for s in slugs:
            cocktail_to_rimmers[s].append(name)

    print("--- cocktail → rimmers (sample) ---")
    for slug in ("lemon-drop", "margarita", "cosmopolitan", "raspberry-ginger-gimlet", "espresso-martini"):
        rs = cocktail_to_rimmers.get(slug) or []
        print(f"{slug}: {', '.join(rs) if rs else '(none)'}")
    print(f"Total rimmer→cocktail links: {total_links}")


if __name__ == "__main__":
    main()
