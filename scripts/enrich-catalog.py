#!/usr/bin/env python3
"""
Enrich data/**/*.txt:
  - Download real Nutrition Facts label images from Gorgias articles
  - Add Shopify / Gorgias ID fields
  - Set Enabled=0 when no live Shopify product URL (stub for later)

Usage:
  python scripts/enrich-catalog.py
"""
from __future__ import annotations

import io
import json
import re
import time
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "tmp" / "scrape" / "cache"
IMG_NUTRITION = ROOT / "images" / "nutrition"
IMG_COCKTAILS = ROOT / "images" / "cocktails"
IMG_RIMMERS = ROOT / "images" / "rimmers"
IMG_PACKS = ROOT / "images" / "packs"
SHOPIFY_JSON = ROOT / "tmp" / "scrape" / "shopify-products.json"
UA = "Mozilla/5.0 (compatible; BartesianPrivateCatalog/1.0)"

KNOWN_KEYS = {
    "Name",
    "Slug",
    "Description",
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
    "Seasonal",
    "Enabled",
    "Favorite",
    "Quantity",
    "Capsule Barcode",
    "Case Barcode",
    "Case Qty",
    "Kind",
    "Cocktail Slugs",
    "Nutrition Image",
    "Nutrition Image EU",
    "Barcode",
    "Notes",
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
    time.sleep(0.25)
    return data


def parse_loose(text: str) -> dict:
    fields: dict = {}
    items_block = []
    mode = "kv"
    for line in text.splitlines():
        if re.match(r"^Items:\s*$", line):
            mode = "items"
            continue
        if mode == "items":
            if line.strip():
                items_block.append(line)
            continue
        m = re.match(r"^([A-Za-z][A-Za-z0-9 ]*):[ \t]*(.*)$", line)
        if m and m.group(1) in KNOWN_KEYS:
            fields[m.group(1)] = m.group(2).strip()
    if items_block:
        fields["_items_lines"] = items_block
    return fields


def gorgias_article_id(help_url: str) -> str:
    m = re.search(r"-(\d+)/?$", (help_url or "").strip())
    return m.group(1) if m else ""


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


def content_image_urls(content_html: str) -> list[str]:
    urls = []
    for src in re.findall(r'src="(https://attachments\.gorgias\.help[^"]+)"', content_html):
        if "logo" in src.lower() or "slogan" in src.lower():
            continue
        if src not in urls:
            urls.append(src)
    return urls


def whiteish_pct(im: Image.Image) -> float:
    small = im.convert("RGB").resize((64, 64))
    triples = list(small.getdata())
    white = sum(1 for r, g, b in triples if r > 240 and g > 240 and b > 240)
    return 100.0 * white / max(len(triples), 1)


def classify_and_save(urls: list[str], slug: str, kind: str) -> dict[str, str]:
    downloaded = []
    for url in urls:
        try:
            data = fetch(url)
            im = Image.open(io.BytesIO(data))
            w, h = im.size
            downloaded.append(
                {
                    "url": url,
                    "im": im,
                    "size": (w, h),
                    "area": w * h,
                    "white": whiteish_pct(im),
                    "is_upload": ("uploads.gorgias.io" in url or "/undefined-" in url),
                }
            )
        except Exception as exc:  # noqa: BLE001
            print(f"  ! img {slug}: {exc}")
            continue

    out: dict[str, str] = {}
    if not downloaded:
        return out

    # Hero cocktail photo: large square + very white studio background
    hero = None
    for item in downloaded:
        w, h = item["size"]
        if item["area"] >= 2_500_000 and abs(w - h) < 80 and item["white"] >= 70:
            hero = item
            break
    if hero is None:
        for item in downloaded:
            w, h = item["size"]
            if max(w, h) >= 1800 and abs(w - h) < 80 and item["white"] >= 75:
                hero = item
                break

    # US nutrition: prefer Gorgias upload/undefined assets (never studio cocktail photos)
    us = next((i for i in downloaded if i["is_upload"] and i["white"] < 80), None)
    if us is None:
        cands = [i for i in downloaded if i is not hero and i["white"] < 75]
        if cands:
            cands.sort(key=lambda x: (x["area"], x["white"]))
            us = cands[0]
    # If the only remaining images are cocktail photos, leave nutrition empty.
    if us is not None and us["white"] >= 80:
        us = None

    eu = None
    for item in downloaded:
        if item is us or item is hero:
            continue
        if item["white"] < 80 and item["area"] >= 400_000:
            eu = item
            break

    def save(item, dest: Path) -> str:
        im = item["im"]
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")
        elif im.mode == "L":
            im = im.convert("RGB")
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.suffix.lower() == ".png":
            im.save(dest, format="PNG", optimize=True)
        else:
            im.save(dest, format="JPEG", quality=90)
        return str(dest.relative_to(ROOT)).replace("\\", "/")

    if us:
        out["nutrition_us"] = save(us, IMG_NUTRITION / f"{slug}.png")
    if eu:
        out["nutrition_eu"] = save(eu, IMG_NUTRITION / f"{slug}-eu.jpg")
    if hero:
        dest_dir = {"cocktail": IMG_COCKTAILS, "rimmer": IMG_RIMMERS, "pack": IMG_PACKS}[kind]
        out["product_image"] = save(hero, dest_dir / f"{slug}.jpg")
    return out


def load_shopify_index() -> dict:
    if not SHOPIFY_JSON.exists():
        return {"by_handle": {}, "by_variant": {}, "products": []}
    products = json.loads(SHOPIFY_JSON.read_text(encoding="utf-8"))
    by_handle, by_variant = {}, {}
    for p in products:
        handle = p.get("handle") or ""
        by_handle[handle] = p
        for v in p.get("variants") or []:
            vid = str(v.get("id") or "")
            if vid:
                by_variant[vid] = p
    return {"by_handle": by_handle, "by_variant": by_variant, "products": products}


def ids_from_shop_url(url: str, shop_idx: dict) -> dict[str, str]:
    out = {
        "shopify_product_id": "",
        "shopify_variant_id": "",
        "shopify_handle": "",
        "shopify_sku": "",
        "case_barcode": "",
    }
    if not url or "products/" not in url:
        return out
    m = re.search(r"/products/([^/?#]+)", url)
    handle = m.group(1) if m else ""
    vm = re.search(r"[?&]variant=(\d+)", url)
    variant_id = vm.group(1) if vm else ""
    out["shopify_handle"] = handle
    out["shopify_variant_id"] = variant_id
    p = None
    if variant_id and variant_id in shop_idx.get("by_variant", {}):
        p = shop_idx["by_variant"][variant_id]
    elif handle and handle in shop_idx.get("by_handle", {}):
        p = shop_idx["by_handle"][handle]
    if p:
        out["shopify_product_id"] = str(p.get("id") or "")
        out["shopify_handle"] = p.get("handle") or handle
        variants = p.get("variants") or []
        if not out["shopify_variant_id"] and variants:
            out["shopify_variant_id"] = str(variants[0].get("id") or "")
        if variants:
            out["shopify_sku"] = str(variants[0].get("sku") or "")
            if variants[0].get("barcode"):
                out["case_barcode"] = str(variants[0]["barcode"])
    return out


def scrape_help(help_url: str, slug: str, kind: str) -> dict[str, str]:
    if not help_url:
        return {}
    html = fetch(help_url).decode("utf-8", errors="replace")
    return classify_and_save(content_image_urls(parse_next_content(html)), slug, kind)


def rewrite_cocktail(path: Path, shop_idx: dict) -> None:
    fields = parse_loose(path.read_text(encoding="utf-8"))
    slug = fields.get("Slug") or path.stem
    help_url = fields.get("Help URL", "")
    shop_url = fields.get("Bartesian URL", "")
    if shop_url and "products/" not in shop_url:
        shop_url = ""
    shop_ids = ids_from_shop_url(shop_url, shop_idx)
    enabled = "1" if shop_url else "0"
    image = fields.get("Image", "")
    nutr: dict = {}
    try:
        saved = scrape_help(help_url, slug, "cocktail")
        if saved.get("nutrition_us"):
            nutr["label_image"] = saved["nutrition_us"]
        if saved.get("nutrition_eu"):
            nutr["label_image_eu"] = saved["nutrition_eu"]
        if saved.get("product_image"):
            image = saved["product_image"]
    except Exception as exc:  # noqa: BLE001
        print(f"  ! {slug}: {exc}")
    if not image:
        cand = IMG_COCKTAILS / f"{slug}.jpg"
        if cand.exists():
            image = str(cand.relative_to(ROOT)).replace("\\", "/")

    lines = [
        f"Name: {fields.get('Name', '')}",
        f"Slug: {slug}",
        f"Description: {fields.get('Description', '')}",
        f"Spirits: {fields.get('Spirits', '')}",
        f"Glassware: {fields.get('Glassware', '')}",
        f"Garnish: {fields.get('Garnish', '')}",
        f"Pairs With: {fields.get('Pairs With', '')}",
        "Nutrition: "
        + (json.dumps(nutr, ensure_ascii=False, separators=(",", ":")) if nutr else ""),
        f"Alcohol: {fields.get('Alcohol', '')}",
        f"Bartesian URL: {shop_url}",
        f"Shopify Product ID: {shop_ids.get('shopify_product_id', '')}",
        f"Shopify Variant ID: {shop_ids.get('shopify_variant_id', '')}",
        f"Shopify Handle: {shop_ids.get('shopify_handle', '')}",
        f"Shopify SKU: {shop_ids.get('shopify_sku', '')}",
        f"Help URL: {help_url}",
        f"Gorgias Article ID: {gorgias_article_id(help_url)}",
        f"Image: {image}",
        f"Seasonal: {fields.get('Seasonal', '0') or '0'}",
        f"Enabled: {enabled}",
        f"Favorite: {fields.get('Favorite', '0') or '0'}",
        f"Quantity: {fields.get('Quantity', '0') or '0'}",
        f"Capsule Barcode: {fields.get('Capsule Barcode', '')}",
        f"Case Barcode: {shop_ids.get('case_barcode') or fields.get('Case Barcode', '')}",
        f"Case Qty: {fields.get('Case Qty', '8') or '8'}",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")


def rewrite_rimmer(path: Path, shop_idx: dict) -> None:
    fields = parse_loose(path.read_text(encoding="utf-8"))
    slug = fields.get("Slug") or path.stem
    help_url = fields.get("Help URL", "")
    shop_url = fields.get("Bartesian URL", "")
    if shop_url and "products/" not in shop_url:
        shop_url = ""
    shop_ids = ids_from_shop_url(shop_url, shop_idx)
    enabled = "1" if shop_url else "0"
    image = fields.get("Image", "")
    nutr = nutr_eu = ""
    try:
        saved = scrape_help(help_url, slug, "rimmer")
        nutr = saved.get("nutrition_us", "")
        nutr_eu = saved.get("nutrition_eu", "")
        if saved.get("product_image"):
            image = saved["product_image"]
    except Exception as exc:  # noqa: BLE001
        print(f"  ! {slug}: {exc}")
    lines = [
        f"Name: {fields.get('Name', '')}",
        f"Slug: {slug}",
        f"Description: {fields.get('Description', '')}",
        f"Kind: {fields.get('Kind', '')}",
        f"Pairs With: {fields.get('Pairs With', '')}",
        f"Cocktail Slugs: {fields.get('Cocktail Slugs', '')}",
        f"Bartesian URL: {shop_url}",
        f"Shopify Product ID: {shop_ids.get('shopify_product_id', '')}",
        f"Shopify Variant ID: {shop_ids.get('shopify_variant_id', '')}",
        f"Shopify Handle: {shop_ids.get('shopify_handle', '')}",
        f"Help URL: {help_url}",
        f"Gorgias Article ID: {gorgias_article_id(help_url)}",
        f"Image: {image}",
        f"Nutrition Image: {nutr}",
        f"Nutrition Image EU: {nutr_eu}",
        f"Barcode: {shop_ids.get('case_barcode') or fields.get('Barcode', '')}",
        f"Quantity: {fields.get('Quantity', '0') or '0'}",
        f"Enabled: {enabled}",
        f"Favorite: {fields.get('Favorite', '0') or '0'}",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")


def rewrite_pack(path: Path, shop_idx: dict) -> None:
    text = path.read_text(encoding="utf-8")
    fields = parse_loose(text)
    slug = fields.get("Slug") or path.stem
    help_url = fields.get("Help URL", "")
    shop_url = fields.get("Bartesian URL", "")
    if shop_url and "products/" not in shop_url:
        shop_url = ""
    shop_ids = ids_from_shop_url(shop_url, shop_idx)
    enabled = "1" if shop_url else "0"
    image = fields.get("Image", "")
    nutr = nutr_eu = ""
    try:
        saved = scrape_help(help_url, slug, "pack")
        nutr = saved.get("nutrition_us", "")
        nutr_eu = saved.get("nutrition_eu", "")
        if saved.get("product_image"):
            image = saved["product_image"]
    except Exception as exc:  # noqa: BLE001
        print(f"  ! {slug}: {exc}")
    item_lines = fields.get("_items_lines") or []
    if not item_lines:
        mode = False
        for line in text.splitlines():
            if re.match(r"^Items:\s*$", line):
                mode = True
                continue
            if mode and line.strip():
                item_lines.append(line)
    lines = [
        f"Name: {fields.get('Name', '')}",
        f"Slug: {slug}",
        f"Barcode: {shop_ids.get('case_barcode') or fields.get('Barcode', '')}",
        f"Notes: {fields.get('Notes', '')}",
        f"Bartesian URL: {shop_url}",
        f"Shopify Product ID: {shop_ids.get('shopify_product_id', '')}",
        f"Shopify Variant ID: {shop_ids.get('shopify_variant_id', '')}",
        f"Shopify Handle: {shop_ids.get('shopify_handle', '')}",
        f"Help URL: {help_url}",
        f"Gorgias Article ID: {gorgias_article_id(help_url)}",
        f"Image: {image}",
        f"Nutrition Image: {nutr}",
        f"Nutrition Image EU: {nutr_eu}",
        f"Enabled: {enabled}",
        "Items:",
    ]
    for ln in item_lines:
        body = ln.strip()
        if body:
            lines.append("\t" + body if not ln.startswith("\t") else ln.rstrip())
    lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    shop_idx = load_shopify_index()
    print(f"Shopify products: {len(shop_idx.get('products') or [])}")
    for path in sorted((ROOT / "data" / "cocktails").glob("*.txt")):
        print("cocktail", path.stem)
        rewrite_cocktail(path, shop_idx)
    for path in sorted((ROOT / "data" / "rimmers").glob("*.txt")):
        print("rimmer", path.stem)
        rewrite_rimmer(path, shop_idx)
    for path in sorted((ROOT / "data" / "packs").glob("*.txt")):
        print("pack", path.stem)
        rewrite_pack(path, shop_idx)

    # summary
    def field(t, k):
        m = re.search(rf"^{re.escape(k)}:\s*(.*)$", t, re.M)
        return m.group(1).strip() if m else ""

    en = dis = with_nutr = 0
    for p in (ROOT / "data" / "cocktails").glob("*.txt"):
        t = p.read_text(encoding="utf-8")
        if field(t, "Enabled") == "0":
            dis += 1
        else:
            en += 1
        if "label_image" in field(t, "Nutrition"):
            with_nutr += 1
    print(f"Cocktails enabled={en} disabled_stubs={dis} with_nutrition={with_nutr}")
    em = (ROOT / "data" / "cocktails" / "EspressoMartini.txt").read_text(encoding="utf-8")
    print("--- Espresso Martini ---")
    for line in em.splitlines():
        if any(
            line.startswith(x)
            for x in (
                "Nutrition",
                "Bartesian",
                "Shopify",
                "Help",
                "Gorgias",
                "Enabled",
            )
        ):
            print(line)


if __name__ == "__main__":
    main()
