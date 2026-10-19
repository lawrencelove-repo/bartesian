#!/usr/bin/env python3
"""
Refresh cocktail media + long-form Shopify copy.

- Hero image (Gorgias studio cocktail shot) → images/hero/
- Marketing image (Shopify product photo) → images/marketing/
- Nutrition labels stay in images/nutrition/
- Pull full Shopify body_html into Description + Details

Usage:
  python scripts/refresh-cocktail-media.py
"""
from __future__ import annotations

import io
import json
import re
import time
import urllib.request
from html import unescape
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "tmp" / "scrape" / "cache"
SHOPIFY_JSON = ROOT / "tmp" / "scrape" / "shopify-products.json"
IMG_HERO = ROOT / "images" / "hero"
IMG_MARKETING = ROOT / "images" / "marketing"
IMG_NUTRITION = ROOT / "images" / "nutrition"
UA = "Mozilla/5.0 (compatible; BartesianPrivateCatalog/1.0)"

KNOWN_KEYS = {
    "Name",
    "Slug",
    "Description",
    "Details",
    "Spirits",
    "Glassware",
    "Garnish",
    "Pairs With",
    "Nutrition",
    "Alcohol",
    "Bartesian URL",
    "Shopify Product ID",
    "Shopify Variant ID",
    "Shopify Handle",
    "Shopify SKU",
    "Help URL",
    "Gorgias Article ID",
    "Image",
    "Hero Image",
    "Marketing Image",
    "Seasonal",
    "Enabled",
    "Favorite",
    "Quantity",
    "Capsule Barcode",
    "Case Barcode",
    "Case Qty",
}


def fetch(url: str) -> bytes:
    CACHE.mkdir(parents=True, exist_ok=True)
    key = re.sub(r"[^a-zA-Z0-9._-]+", "_", url)[-180:]
    cache_path = CACHE / key
    if cache_path.exists() and cache_path.stat().st_size > 0:
        return cache_path.read_bytes()
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    cache_path.write_bytes(data)
    time.sleep(0.2)
    return data


def parse_loose(text: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for line in text.splitlines():
        m = re.match(r"^([A-Za-z][A-Za-z0-9 ]*):[ \t]*(.*)$", line)
        if m and m.group(1) in KNOWN_KEYS:
            fields[m.group(1)] = m.group(2).strip()
    return fields


def html_to_text(html: str) -> str:
    text = unescape(html or "")
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"</p\s*>", "\n\n", text, flags=re.I)
    text = re.sub(r"</h[1-6]\s*>", "\n\n", text, flags=re.I)
    text = re.sub(r"<li[^>]*>", "- ", text, flags=re.I)
    text = re.sub(r"</li\s*>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("\xa0", " ")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def parse_shopify_copy(body_html: str, name: str) -> tuple[str, str]:
    """Return (short_description, details)."""
    text = html_to_text(body_html)
    if not text:
        return "", ""

    # Drop CTA / Read More / subscribe noise
    text = re.sub(r"\n*Read More\s*$", "", text, flags=re.I)
    text = re.sub(
        r"\n*Make Delicious Craft Cocktails at Home with Bartesian\s*\n.*$",
        "",
        text,
        flags=re.I | re.S,
    )
    text = re.sub(
        r"\n*Ready to craft your own .*?Purchase your capsules today!\s*",
        "",
        text,
        flags=re.I | re.S,
    )
    def is_noise_paragraph(p: str) -> bool:
        low = p.lower().strip()
        if low.startswith("subscribe & save"):
            return True
        if "do not contain alcohol" in low and (
            low.startswith("please note:") or "capsules do not contain alcohol" in low
        ):
            return True
        if re.fullmatch(r"read more", low):
            return True
        # Trailing shop CTAs
        if re.match(r"^(shop|order)\b.*\btoday\b", low):
            return True
        if low.startswith("make delicious craft cocktails"):
            return True
        return False

    paragraphs = [
        p.strip()
        for p in re.split(r"\n\s*\n", text)
        if p.strip() and not is_noise_paragraph(p.strip())
    ]
    if not paragraphs:
        return text, ""

    # Short description = first real paragraph that isn't just the product title
    short = ""
    for p in paragraphs:
        if re.fullmatch(rf"{re.escape(name)}(\s+Drink)?(\s+Capsules?)?", p, flags=re.I):
            continue
        if re.fullmatch(rf"{re.escape(name)}\s+Capsules?", p, flags=re.I):
            continue
        short = p
        # strip trailing "Base spirit: …" sometimes glued on
        short = re.sub(r"\s*Base spirit:\s*.*$", "", short, flags=re.I).strip()
        break

    # Details = remaining content after the short paragraph
    details_parts = []
    seen_short = False
    for p in paragraphs:
        if not seen_short and short and p.startswith(short[:40]):
            seen_short = True
            continue
        if re.fullmatch(rf"{re.escape(name)}(\s+Drink)?(\s+Capsules?)?", p, flags=re.I):
            continue
        details_parts.append(p)

    details = "\n\n".join(details_parts).strip()
    details = re.sub(
        r"\s*Please note:\s*(?:Bartesian )?capsules do not contain alcohol\.?",
        "",
        details,
        flags=re.I,
    ).strip()
    details = re.sub(r"\n{3,}", "\n\n", details)
    return short, details


def whiteish_pct(im: Image.Image) -> float:
    small = im.convert("RGB").resize((64, 64))
    triples = list(small.getdata())
    white = sum(1 for r, g, b in triples if r > 240 and g > 240 and b > 240)
    return 100.0 * white / max(len(triples), 1)


def parse_next_content(html: str) -> str:
    m = re.search(
        r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
        html,
        re.S,
    )
    if not m:
        return ""
    data = json.loads(m.group(1))
    return data.get("props", {}).get("pageProps", {}).get("htmlContent") or ""


def gorgias_image_urls(content_html: str) -> list[str]:
    urls = []
    for src in re.findall(r'src="(https://attachments\.gorgias\.help[^"]+)"', content_html):
        if "logo" in src.lower() or "slogan" in src.lower():
            continue
        if src not in urls:
            urls.append(src)
    return urls


def pick_hero_from_gorgias(urls: list[str]) -> bytes | None:
    """Studio cocktail photo: large, white background, not nutrition label."""
    best = None
    best_score = -1
    for url in urls:
        if "uploads.gorgias.io" in url or "/undefined-" in url:
            continue  # nutrition labels
        try:
            data = fetch(url)
            im = Image.open(io.BytesIO(data))
        except Exception:
            continue
        w, h = im.size
        area = w * h
        white = whiteish_pct(im)
        # Prefer large square-ish studio shots
        if area < 900_000:
            continue
        if white < 55:
            continue
        score = area + int(white * 10000)
        if abs(w - h) < 120:
            score += 500_000
        if score > best_score:
            best_score = score
            best = data
    return best


def save_image(data: bytes, dest: Path) -> str:
    dest.parent.mkdir(parents=True, exist_ok=True)
    im = Image.open(io.BytesIO(data))
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    elif im.mode == "L":
        im = im.convert("RGB")
    # normalize extension
    if dest.suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp"):
        dest = dest.with_suffix(".jpg")
    if dest.suffix.lower() == ".png":
        im.save(dest, format="PNG", optimize=True)
    else:
        if dest.suffix.lower() != ".jpg":
            dest = dest.with_suffix(".jpg")
        im.convert("RGB").save(dest, format="JPEG", quality=90)
    return str(dest.relative_to(ROOT)).replace("\\", "/")


def load_shopify() -> dict[str, dict]:
    products = json.loads(SHOPIFY_JSON.read_text(encoding="utf-8"))
    by_handle = {p.get("handle"): p for p in products if p.get("handle")}
    by_id = {str(p.get("id")): p for p in products if p.get("id")}
    return {"by_handle": by_handle, "by_id": by_id}


def shopify_for(fields: dict, shop: dict) -> dict | None:
    handle = fields.get("Shopify Handle") or ""
    pid = fields.get("Shopify Product ID") or ""
    if handle and handle in shop["by_handle"]:
        return shop["by_handle"][handle]
    if pid and pid in shop["by_id"]:
        return shop["by_id"][pid]
    # try from URL
    url = fields.get("Bartesian URL") or ""
    m = re.search(r"/products/([^/?#]+)", url)
    if m and m.group(1) in shop["by_handle"]:
        return shop["by_handle"][m.group(1)]
    return None


def pick_marketing_url(product: dict) -> str:
    imgs = product.get("images") or []
    if not imgs:
        return ""
    # Prefer packaging / capsule / product composite over secondary lifestyle if first is good
    # Shopify order usually: primary marketing first
    return imgs[0].get("src") or ""


def rewrite_cocktail(path: Path, shop: dict) -> None:
    text = path.read_text(encoding="utf-8")
    fields = parse_loose(text)
    slug = fields.get("Slug") or path.stem
    name = fields.get("Name") or slug
    help_url = fields.get("Help URL") or ""
    print(f"cocktail {slug}")

    hero_rel = ""
    marketing_rel = ""

    # Hero from Gorgias
    if help_url:
        try:
            html = fetch(help_url).decode("utf-8", errors="replace")
            urls = gorgias_image_urls(parse_next_content(html))
            hero_bytes = pick_hero_from_gorgias(urls)
            if hero_bytes:
                hero_rel = save_image(hero_bytes, IMG_HERO / f"{slug}.jpg")
        except Exception as exc:  # noqa: BLE001
            print(f"  ! hero fail: {exc}")

    # Marketing + details from Shopify
    product = shopify_for(fields, shop)
    details = fields.get("Details") or ""
    description = fields.get("Description") or ""
    if product:
        murl = pick_marketing_url(product)
        if murl:
            try:
                marketing_rel = save_image(fetch(murl), IMG_MARKETING / f"{slug}.jpg")
            except Exception as exc:  # noqa: BLE001
                print(f"  ! marketing fail: {exc}")
        short, long_copy = parse_shopify_copy(product.get("body_html") or "", name)
        if short:
            description = short
        # Always replace Details from Shopify when a product page exists so
        # stripped CTAs (Subscribe & Save, etc.) don't linger from prior runs.
        details = long_copy

    # Fallback: migrate existing images/cocktails file into marketing if needed
    old = ROOT / "images" / "cocktails" / f"{slug}.jpg"
    if not marketing_rel and old.exists():
        marketing_rel = save_image(old.read_bytes(), IMG_MARKETING / f"{slug}.jpg")

    # Primary Image for list thumbs: hero preferred, else marketing
    primary = hero_rel or marketing_rel or fields.get("Image") or ""

    # Preserve nutrition JSON
    nutrition = fields.get("Nutrition") or ""

    # Store Details with escaped newlines so the .txt key/value format stays one line per field
    details_one_line = details.replace("\\", "\\\\").replace("\n", "\\n")
    lines = [
        f"Name: {name}",
        f"Slug: {slug}",
        f"Description: {description}",
        f"Details: {details_one_line}",
        f"Spirits: {fields.get('Spirits', '')}",
        f"Glassware: {fields.get('Glassware', '')}",
        f"Garnish: {fields.get('Garnish', '')}",
        f"Pairs With: {fields.get('Pairs With', '')}",
        f"Nutrition: {nutrition}",
        f"Alcohol: {fields.get('Alcohol', '')}",
        f"Bartesian URL: {fields.get('Bartesian URL', '')}",
        f"Shopify Product ID: {fields.get('Shopify Product ID', '')}",
        f"Shopify Variant ID: {fields.get('Shopify Variant ID', '')}",
        f"Shopify Handle: {fields.get('Shopify Handle', '')}",
        f"Shopify SKU: {fields.get('Shopify SKU', '')}",
        f"Help URL: {help_url}",
        f"Gorgias Article ID: {fields.get('Gorgias Article ID', '')}",
        f"Hero Image: {hero_rel}",
        f"Marketing Image: {marketing_rel}",
        f"Image: {primary}",
        f"Seasonal: {fields.get('Seasonal', '0') or '0'}",
        f"Enabled: {fields.get('Enabled', '1') or '1'}",
        f"Favorite: {fields.get('Favorite', '0') or '0'}",
        f"Quantity: {fields.get('Quantity', '0') or '0'}",
        f"Capsule Barcode: {fields.get('Capsule Barcode', '')}",
        f"Case Barcode: {fields.get('Case Barcode', '')}",
        f"Case Qty: {fields.get('Case Qty', '8') or '8'}",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    IMG_HERO.mkdir(parents=True, exist_ok=True)
    IMG_MARKETING.mkdir(parents=True, exist_ok=True)
    IMG_NUTRITION.mkdir(parents=True, exist_ok=True)
    shop = load_shopify()
    for path in sorted((ROOT / "data" / "cocktails").glob("*.txt")):
        rewrite_cocktail(path, shop)

    # quick sample
    sample = (ROOT / "data" / "cocktails" / "AmarettoSour.txt").read_text(encoding="utf-8")
    print("--- Amaretto Sour ---")
    for line in sample.splitlines():
        if line.startswith(
            ("Description", "Details", "Hero", "Marketing", "Image", "Nutrition")
        ):
            print(line[:200])


if __name__ == "__main__":
    main()
