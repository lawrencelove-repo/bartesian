"""One-shot cleanup: fix jumbled ID fields + re-download true nutrition labels."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from enrich_catalog import (  # noqa: E402
    classify_and_save,
    content_image_urls,
    fetch,
    gorgias_article_id,
    gorgias_path_id,
    ids_from_shop_url,
    load_shopify_index,
    parse_next_content,
)

KNOWN_KEYS = [
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
    "Items",
]


def parse_loose(text: str) -> dict[str, str]:
    fields = {}
    items_block = []
    mode = "kv"
    for line in text.splitlines():
        if re.match(r"^Items:\s*$", line):
            mode = "items"
            fields["Items"] = ""
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


def rewrite_cocktail(path: Path, shop_idx: dict) -> None:
    fields = parse_loose(path.read_text(encoding="utf-8"))
    slug = fields.get("Slug") or path.stem
    help_url = fields.get("Help URL", "")
    shop_url = fields.get("Bartesian URL", "")
    # sanitize shop url
    if shop_url and "products/" not in shop_url:
        shop_url = ""
    shop_ids = ids_from_shop_url(shop_url, shop_idx)
    enabled = "1" if shop_url else "0"

    # nutrition
    nutr = {"label_image": ""}
    image = fields.get("Image", "")
    if help_url:
        html = fetch(help_url).decode("utf-8", errors="replace")
        content = parse_next_content(html)
        urls = content_image_urls(content)
        saved = classify_and_save_strict(urls, slug, "cocktail")
        if saved.get("nutrition_us"):
            nutr["label_image"] = saved["nutrition_us"]
        if saved.get("nutrition_eu"):
            nutr["label_image_eu"] = saved["nutrition_eu"]
        if saved.get("product_image"):
            image = saved["product_image"]
        elif not image:
            # keep existing cocktail image if any
            cand = ROOT / "images" / "cocktails" / f"{slug}.jpg"
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
        f"Nutrition: {json.dumps(nutr, ensure_ascii=False, separators=(',', ':')) if nutr.get('label_image') else ''}",
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


def classify_and_save_strict(urls, slug, kind):
    """Stricter than enrich_catalog: US label must be uploads.gorgias.io OR <=700px."""
    from PIL import Image
    import io

    IMG_NUTRITION = ROOT / "images" / "nutrition"
    IMG_COCKTAILS = ROOT / "images" / "cocktails"
    IMG_RIMMERS = ROOT / "images" / "rimmers"
    IMG_PACKS = ROOT / "images" / "packs"
    IMG_NUTRITION.mkdir(parents=True, exist_ok=True)

    downloaded = []
    for url in urls:
        try:
            data = fetch(url)
            im = Image.open(io.BytesIO(data))
            downloaded.append({"url": url, "data": data, "size": im.size, "im": im})
        except Exception as exc:
            print("  !", slug, exc)
            continue

    out = {}
    if not downloaded:
        return out

    us = None
    eu = None
    hero = None
    for item in downloaded:
        url = item["url"]
        w, h = item["size"]
        area = w * h
        if ("uploads.gorgias.io" in url or "/undefined-" in url) and us is None:
            us = item
            continue
        if area >= 1_800_000 and abs(w - h) < 80 and hero is None:
            hero = item
            continue
        # EU often 1500x1500 jpeg
        if 900_000 <= area <= 2_400_000 and eu is None and "undefined-" not in url:
            eu = item

    if us is None:
        # smallest image under 700px side as US label fallback
        small = [i for i in downloaded if max(i["size"]) <= 700 and i is not hero]
        if small:
            small.sort(key=lambda x: x["size"][0] * x["size"][1])
            us = small[0]

    def save(item, dest: Path):
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
    if eu and eu is not us:
        out["nutrition_eu"] = save(eu, IMG_NUTRITION / f"{slug}-eu.jpg")
    if hero:
        dest_map = {"cocktail": IMG_COCKTAILS, "rimmer": IMG_RIMMERS, "pack": IMG_PACKS}
        dest = dest_map[kind] / f"{slug}.jpg"
        out["product_image"] = save(hero, dest)
    return out


def rewrite_rimmer(path: Path, shop_idx: dict) -> None:
    fields = parse_loose(path.read_text(encoding="utf-8"))
    slug = fields.get("Slug") or path.stem
    help_url = fields.get("Help URL", "")
    shop_url = fields.get("Bartesian URL", "")
    if shop_url and "products/" not in shop_url:
        shop_url = ""
    shop_ids = ids_from_shop_url(shop_url, shop_idx)
    enabled = "1" if shop_url else "0"
    nutr = ""
    nutr_eu = ""
    image = fields.get("Image", "")
    if help_url:
        html = fetch(help_url).decode("utf-8", errors="replace")
        saved = classify_and_save_strict(content_image_urls(parse_next_content(html)), slug, "rimmer")
        nutr = saved.get("nutrition_us", "")
        nutr_eu = saved.get("nutrition_eu", "")
        if saved.get("product_image"):
            image = saved["product_image"]
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
    nutr = ""
    nutr_eu = ""
    image = fields.get("Image", "")
    if help_url:
        html = fetch(help_url).decode("utf-8", errors="replace")
        saved = classify_and_save_strict(content_image_urls(parse_next_content(html)), slug, "pack")
        nutr = saved.get("nutrition_us", "")
        nutr_eu = saved.get("nutrition_eu", "")
        if saved.get("product_image"):
            image = saved["product_image"]
    item_lines = fields.get("_items_lines") or []
    # preserve items from original if parse missed
    if not item_lines:
        mode = False
        for line in text.splitlines():
            if re.match(r"^Items:\s*$", line):
                mode = True
                continue
            if mode:
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
        *[ln if ln.startswith("\t") or not ln.strip() else "\t" + ln.lstrip() for ln in item_lines if ln.strip()],
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")


def main():
    # Patch enrich_catalog classify used? we use local strict
    shop_idx = load_shopify_index()
    for p in sorted((ROOT / "data" / "cocktails").glob("*.txt")):
        print("cocktail", p.name)
        rewrite_cocktail(p, shop_idx)
    for p in sorted((ROOT / "data" / "rimmers").glob("*.txt")):
        print("rimmer", p.name)
        rewrite_rimmer(p, shop_idx)
    for p in sorted((ROOT / "data" / "packs").glob("*.txt")):
        print("pack", p.name)
        rewrite_pack(p, shop_idx)

    # stats
    from PIL import Image

    small = large = missing = 0
    for p in (ROOT / "images" / "nutrition").glob("*.png"):
        if p.name.endswith("-eu.png"):
            continue
        im = Image.open(p)
        if max(im.size) <= 700:
            small += 1
        else:
            large += 1
    print("US-label-sized png (<=700):", small, "larger png:", large)


if __name__ == "__main__":
    main()
