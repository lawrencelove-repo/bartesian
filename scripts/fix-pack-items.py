#!/usr/bin/env python3
"""
Re-parse variety pack cocktail Items from Shopify body_html / Notes.

Fixes the scrape bug that treated flavor blurbs as cocktail names.

Usage:
  python scripts/fix-pack-items.py
  node scripts/import-data.js
"""
from __future__ import annotations

import json
import re
import unicodedata
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKS = ROOT / "data" / "packs"
COCKTAILS = ROOT / "data" / "cocktails"
SHOPIFY_JSON = ROOT / "tmp" / "scrape" / "shopify-products.json"

HEADER_KEYS = {
    "Name",
    "Slug",
    "Barcode",
    "Notes",
    "Bartesian URL",
    "Shopify Product ID",
    "Shopify Variant ID",
    "Shopify Handle",
    "Help URL",
    "Gorgias Article ID",
    "Image",
    "Nutrition Image",
    "Nutrition Image EU",
    "Enabled",
}


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower().replace("'", "").replace("'", "")
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def html_to_text(html: str) -> str:
    text = unescape(html or "")
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"</p\s*>", "\n\n", text, flags=re.I)
    text = re.sub(r"</h[1-6]\s*>", "\n\n", text, flags=re.I)
    text = re.sub(r"<li[^>]*>", "\n- ", text, flags=re.I)
    text = re.sub(r"</li\s*>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("\xa0", " ")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def load_cocktails() -> list[dict]:
    items = []
    for path in sorted(COCKTAILS.glob("*.txt")):
        name = slug = ""
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith("Name:"):
                name = line.split(":", 1)[1].strip()
            elif line.startswith("Slug:"):
                slug = line.split(":", 1)[1].strip()
        if not slug and name:
            slug = slugify(name)
        if slug:
            items.append({"name": name or slug, "slug": slug})
    return items


def cocktail_lookup(cocktails: list[dict]):
    by_slug = {c["slug"]: c for c in cocktails}
    # longest name first for prefix matching
    by_name = sorted(
        ((c["name"].lower(), c) for c in cocktails),
        key=lambda x: len(x[0]),
        reverse=True,
    )
    return by_slug, by_name


def resolve_name(raw: str, by_slug, by_name) -> str | None:
    """Map a candidate cocktail name to a known slug, or slugify if plausible."""
    name = raw.strip().strip("-").strip()
    name = re.sub(r"\s+", " ", name)
    if not name or len(name) < 3:
        return None
    low = name.lower()
    # reject obvious non-cocktails
    if low.startswith(
        (
            "please note",
            "subscribe",
            "base spirit",
            "compatibility",
            "contains",
            "shopify",
            "gorgias",
            "our ",
            "this variety",
            "calling all",
        )
    ):
        return None

    for n, c in by_name:
        if low == n or low.rstrip(".") == n:
            return c["slug"]

    slug = slugify(name)
    if slug in by_slug:
        return slug

    # Allow near matches: "Strawberry Acai" → strawberry-acai-refresher
    for s, c in by_slug.items():
        if s.startswith(slug + "-") or s.startswith(slug):
            # only if candidate is a meaningful prefix (not "lime" → something)
            if len(slug) >= 8 or slug.count("-") >= 1:
                return s
        if slug.startswith(s) and len(s) >= 8:
            return s

    # Name contained in cocktail name (e.g. "Blackberry Mango" in "Blackberry Mango Refresher")
    for n, c in by_name:
        if n.startswith(low) or low.startswith(n):
            if len(low) >= 8:
                return c["slug"]
        # token overlap for "Pineapple Passion Fruit" vs "Pineapple Sage..." — skip weak
        if low in n and len(low) >= 10:
            return c["slug"]

    # Unknown but looks like a real cocktail title (Title Case / has letters)
    if re.search(r"[A-Za-z]", name) and len(slug) >= 5 and not re.search(r"\b(flavor|juice|note|hint)\b", low):
        return slug
    return None


def extract_bullet_names(text: str) -> list[str]:
    """Pull cocktail titles from '- Name: description' bullets."""
    names = []
    # Normalize collapsed single-line notes that use " - Name:"
    normalized = text.replace(" - ", "\n- ")
    for m in re.finditer(
        r"(?:^|\n)\s*[-•*]\s*([A-Z][^:\n]{1,80}?)\s*:",
        normalized,
    ):
        name = m.group(1).strip()
        # Stop if description leaked (no — names shouldn't contain long clauses)
        if "," in name and len(name) > 40:
            continue
        names.append(name)
    return names


def extract_each_of_names(text: str) -> tuple[int | None, list[str]]:
    """
    Parse 'contains 2 each of: A, B, C, and D' when there are no bullet descriptions.
    """
    m = re.search(
        r"(\d+)\s+each\s+of(?:\s+\d+\s+\w+)?[:\s]+(.+?)(?:\.|\n\n|Please note|Base spirit|$)",
        text,
        re.I | re.S,
    )
    if not m:
        return None, []
    qty = int(m.group(1))
    blob = m.group(2).strip()
    # If bullets follow, don't use this blob
    if re.search(r"(?:^|\n)\s*[-•*]\s*[A-Z]", blob) or " - " in blob[:20]:
        return qty, []
    # Simple comma list only
    if ":" in blob:
        return qty, []
    parts = re.split(r",|\band\b", blob)
    names = [p.strip(" .") for p in parts if p.strip(" .")]
    # Reject if parts look like descriptions
    names = [n for n in names if len(n) < 50 and not re.search(r"\b(flavor|with|juice)\b", n, re.I)]
    return qty, names


def parse_pack_items(text: str, by_slug, by_name) -> list[tuple[str, int]]:
    qty_each, each_names = extract_each_of_names(text)
    bullet_names = extract_bullet_names(text)
    names = bullet_names or each_names

    # Also: "contains 1 each of: A, B, ..." with bullets elsewhere — prefer bullets
    if not names:
        # Last resort: find known cocktail names mentioned after "each of"
        m = re.search(r"each\s+of[:\s]+(.+)$", text, re.I | re.S)
        if m:
            blob = m.group(1)
            found = []
            for n, c in by_name:
                if re.search(rf"(?:^|[\n\-•*,])\s*{re.escape(c['name'])}\s*:", blob, re.I):
                    found.append(c["name"])
            # preserve order of appearance
            order = []
            for m2 in re.finditer(
                r"(?:^|\n|\-\s*)([A-Z][^:\n]{1,60}?)\s*:",
                blob.replace(" - ", "\n- "),
            ):
                cand = m2.group(1).strip()
                slug = resolve_name(cand, by_slug, by_name)
                if slug:
                    order.append(cand)
            names = order or found

    # Qty from "N each" or infer from pack size language
    if qty_each is None:
        m = re.search(r"(\d+)\s+each\b", text, re.I)
        if m:
            qty_each = int(m.group(1))
        elif re.search(r"\b1\s+each\b|\bcontains\s+1\s+each\b", text, re.I):
            qty_each = 1
        elif re.search(r"\b8-pack\b|\beight-pack\b|\b8-count\b", text, re.I):
            qty_each = 2 if len(names) == 4 else 1
        elif re.search(r"\b4-pack\b", text, re.I):
            qty_each = 1
        else:
            qty_each = 2 if len(names) in (2, 4) else 1

    items: list[tuple[str, int]] = []
    seen: set[str] = set()
    for n in names:
        slug = resolve_name(n, by_slug, by_name)
        if not slug or slug in seen:
            continue
        seen.add(slug)
        items.append((slug, qty_each))
    return items


def parse_headers(text: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for line in text.splitlines():
        if re.match(r"^Items:\s*$", line):
            break
        m = re.match(r"^([A-Za-z][A-Za-z0-9 ]*):[ \t]*(.*)$", line)
        if m and m.group(1) in HEADER_KEYS:
            fields[m.group(1)] = m.group(2).strip()
    return fields


def rewrite_pack(path: Path, shop_by_handle: dict, by_slug, by_name) -> None:
    text = path.read_text(encoding="utf-8")
    fields = parse_headers(text)
    handle = fields.get("Shopify Handle") or ""
    notes = fields.get("Notes") or ""

    # Prefer Shopify body, but keep region-specific Notes (e.g. EU/UK packs)
    # when the local name marks a regional variant.
    is_regional = bool(re.search(r"\b(EU|UK|US Only)\b", fields.get("Name") or "", re.I))
    source = notes
    product = shop_by_handle.get(handle) if handle else None
    shop_body = ""
    if product and not is_regional:
        shop_body = html_to_text(product.get("body_html") or "")
        if shop_body:
            source = shop_body
            short = re.split(
                r"Please note:|Subscribe & Save|Craft Authentic|Make Delicious",
                shop_body,
                maxsplit=1,
                flags=re.I,
            )[0].strip()
            short = re.sub(r"\s+", " ", short)
            if short:
                fields["Notes"] = short[:800]
    elif product and is_regional and notes:
        source = notes

    items = parse_pack_items(source, by_slug, by_name)
    if not items and notes and notes != source:
        items = parse_pack_items(notes, by_slug, by_name)
    if not items and shop_body:
        items = parse_pack_items(shop_body, by_slug, by_name)

    # Advent / preorder pages aren't cocktail lists — don't keep redemption steps
    if "advent" in slugify(fields.get("Slug") or path.stem) and (
        not items
        or all(
            s.startswith(("retrieve", "add-your", "apply-your", "how-pre"))
            for s, _ in items
        )
    ):
        items = []

    # Rebuild file cleanly
    name = fields.get("Name") or path.stem
    slug = fields.get("Slug") or slugify(name)
    lines = [
        f"Name: {name}",
        f"Slug: {slug}",
        f"Barcode: {fields.get('Barcode', '')}",
        f"Notes: {fields.get('Notes', '')}",
        f"Bartesian URL: {fields.get('Bartesian URL', '')}",
        f"Shopify Product ID: {fields.get('Shopify Product ID', '')}",
        f"Shopify Variant ID: {fields.get('Shopify Variant ID', '')}",
        f"Shopify Handle: {handle}",
        f"Help URL: {fields.get('Help URL', '')}",
        f"Gorgias Article ID: {fields.get('Gorgias Article ID', '')}",
        f"Image: {fields.get('Image', '')}",
        f"Nutrition Image: {fields.get('Nutrition Image', '')}",
        f"Nutrition Image EU: {fields.get('Nutrition Image EU', '')}",
        f"Enabled: {fields.get('Enabled', '1') or '1'}",
        "Items:",
    ]
    for cocktail_slug, qty in items:
        lines.append(f"\t{cocktail_slug}: {qty}")
    lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")

    known = sum(1 for s, _ in items if s in by_slug)
    print(f"{slug}: {len(items)} items ({known} known) → {', '.join(s for s,_ in items) or '(none)'}")


def main() -> None:
    cocktails = load_cocktails()
    by_slug, by_name = cocktail_lookup(cocktails)
    products = json.loads(SHOPIFY_JSON.read_text(encoding="utf-8"))
    shop_by_handle = {p.get("handle"): p for p in products if p.get("handle")}

    for path in sorted(PACKS.glob("*.txt")):
        rewrite_pack(path, shop_by_handle, by_slug, by_name)


if __name__ == "__main__":
    main()
