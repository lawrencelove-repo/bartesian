#!/usr/bin/env python3
"""
Scrape Bartesian cocktail / pack / rimmer catalog into data/ + images/.

Sources:
  - Gorgias nutritional help center (authoritative metadata)
  - Shopify collection JSON (product images, shop URLs, case barcodes)

Usage:
  python scripts/scrape-catalog.py
  python scripts/scrape-catalog.py --skip-images
"""
from __future__ import annotations

import argparse
import json
import re
import time
import urllib.error
import urllib.request
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "tmp" / "scrape" / "cache"
OUT_COCKTAILS = ROOT / "data" / "cocktails"
OUT_PACKS = ROOT / "data" / "packs"
OUT_RIMMERS = ROOT / "data" / "rimmers"
IMG_COCKTAILS = ROOT / "images" / "cocktails"
IMG_RIMMERS = ROOT / "images" / "rimmers"
IMG_NUTRITION = ROOT / "images" / "nutrition"
IMG_PACKS = ROOT / "images" / "packs"

UA = "Mozilla/5.0 (compatible; BartesianPrivateCatalog/1.0)"

GORGIAS_CATEGORIES = {
    "vodka": "https://bartesian.gorgias.help/en-US/articles/vodka-cocktails-324907",
    "rum": "https://bartesian.gorgias.help/en-US/articles/rum-cocktails-324910",
    "gin": "https://bartesian.gorgias.help/en-US/articles/gin-cocktails-324911",
    "whiskey": "https://bartesian.gorgias.help/en-US/articles/whiskey-cocktails-324912",
    "tequila": "https://bartesian.gorgias.help/en-US/articles/tequila-cocktails-324913",
    "seasonal": "https://bartesian.gorgias.help/en-US/articles/seasonal-cocktails-325180",
    "rimmers": "https://bartesian.gorgias.help/en-US/articles/rimmers-325185",
    "variety_packs": "https://bartesian.gorgias.help/en-US/articles/variety-packs-325205",
}

SHOPIFY_COLLECTIONS = {
    "cocktails": "https://bartesian.com/collections/cocktails/products.json?limit=250",
    "packs": "https://bartesian.com/collections/cocktail-variety-packs/products.json?limit=250",
    "accessories": "https://bartesian.com/collections/barware-accessories/products.json?limit=250",
}

SKIP_ARTICLE_PREFIXES = (
    "articles/",
    "articles",
)


def slugify(name: str) -> str:
    s = name.lower().strip()
    s = s.replace("&", " and ")
    s = re.sub(r"['’]", "", s)
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def clean_name(title: str) -> str:
    t = title.strip()
    t = re.sub(r"\s+Capsules?\s*$", "", t, flags=re.I)
    t = re.sub(r"\s+Variety Pack\s*$", "", t, flags=re.I)
    t = re.sub(r"\s+Collection\s*$", "", t, flags=re.I)
    return t.strip()


def fetch(url: str, dest: Path | None = None, binary: bool = False) -> bytes | str:
    CACHE.mkdir(parents=True, exist_ok=True)
    key = re.sub(r"[^a-zA-Z0-9._-]+", "_", url)[-180:]
    cache_path = CACHE / key
    if cache_path.exists() and cache_path.stat().st_size > 0:
        data = cache_path.read_bytes()
    else:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = resp.read()
        cache_path.write_bytes(data)
        time.sleep(0.35)
    if dest:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
    return data if binary else data.decode("utf-8", errors="replace")


def parse_next_html_content(html: str) -> tuple[str, str, str]:
    m = re.search(
        r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
        html,
        re.S,
    )
    if not m:
        return "", "", ""
    data = json.loads(m.group(1))
    props = data.get("props", {}).get("pageProps", {})
    return (
        props.get("title") or "",
        props.get("htmlContent") or "",
        props.get("slugArticleId") or "",
    )


def html_to_text(content: str) -> str:
    text = unescape(content)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"</p>", "\n", text, flags=re.I)
    text = re.sub(r"</li>", "\n", text, flags=re.I)
    text = re.sub(r"<li[^>]*>", "- ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("\xa0", " ").replace("\u200b", "")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def field(text: str, *labels: str) -> str:
    for label in labels:
        m = re.search(
            rf"{re.escape(label)}\s*:?\s*(.+?)(?:\n|$)",
            text,
            flags=re.I,
        )
        if m:
            return m.group(1).strip(" .")
    return ""


def parse_alcohol(raw: str) -> dict:
    out = {}
    if not raw:
        return out
    for key, pat in [
        ("mocktail_oz", r"Mocktail\s*=\s*([\d.]+)\s*oz"),
        ("light_oz", r"Light\s*=\s*([\d.]+)\s*oz"),
        ("regular_oz", r"Regular\s*=\s*([\d.]+)\s*oz"),
        ("strong_oz", r"Strong\s*=\s*([\d.]+)\s*oz"),
    ]:
        m = re.search(pat, raw, re.I)
        if m:
            out[key] = float(m.group(1))
    if out:
        out["raw"] = raw
    return out


def parse_spirits(raw: str) -> list[str]:
    if not raw:
        return []
    raw = re.split(r"\.|Recommended|Alcohol|Garnish", raw, maxsplit=1)[0]
    parts = re.split(r",|&| and |/", raw, flags=re.I)
    spirits = []
    for p in parts:
        name = p.strip(" .")
        name = re.sub(r"\s+", " ", name)
        if not name:
            continue
        # Normalize
        low = name.lower()
        if "whisky" in low or "whiskey" in low:
            name = "Whiskey"
        elif "vodka" in low:
            name = "Vodka"
        elif "tequila" in low or "mezcal" in low:
            name = "Tequila" if "mezcal" not in low else "Mezcal"
        elif "rum" in low:
            name = "Rum"
        elif "gin" in low:
            name = "Gin"
        elif name.lower() in ("multiple spirits", "multi"):
            continue
        if name not in spirits:
            spirits.append(name)
    return spirits


def extract_article_links(category_html: str) -> list[tuple[str, str]]:
    """Return list of (slug-id, title-ish slug)."""
    links = sorted(set(re.findall(r'href="/en-US/([a-z0-9()%-]+-\d+)"', category_html, flags=re.I)))
    out = []
    for link in links:
        if link.startswith("articles"):
            continue
        out.append(link)
    return out


def nutrition_image_urls(content_html: str) -> list[str]:
    urls = []
    for src in re.findall(r'src="(https://attachments\.gorgias\.help[^"]+)"', content_html):
        low = src.lower()
        if "logo" in low or "slogan" in low:
            continue
        # Prefer png/jpeg nutrition labels; skip tiny cdn-cgi thumbs by unwrapping
        if "/cdn-cgi/image/" in src:
            m = re.search(r"https://attachments\.gorgias\.help/(?!cdn-cgi)[^\"\s]+", src)
            if m:
                src = m.group(0)
        if src not in urls:
            urls.append(src)
    return urls


def shopify_products(url: str) -> list[dict]:
    raw = fetch(url)
    data = json.loads(raw.lstrip("\ufeff"))
    return data.get("products") or []


def shopify_index(products: list[dict]) -> dict[str, dict]:
    idx = {}
    for p in products:
        handle = p.get("handle") or ""
        title = clean_name(p.get("title") or "")
        idx[handle] = p
        idx[slugify(title)] = p
        idx[slugify(handle)] = p
        # also without common suffixes
        idx[slugify(re.sub(r"-capsules?$", "", handle))] = p
    return idx


def match_shopify(slug: str, name: str, idx: dict) -> dict | None:
    for key in (
        slug,
        slugify(name),
        slugify(name.replace("Low-Cal", "Low Cal")),
        f"{slug}-capsules",
        f"{slug}-variety-pack",
        f"{slug}-collection",
    ):
        if key in idx:
            return idx[key]
    # fuzzy: startswith
    for key, p in idx.items():
        if key.startswith(slug) or slug.startswith(key):
            if abs(len(key) - len(slug)) <= 12:
                return p
    return None


def shopify_product_url(product: dict | None) -> str:
    """Canonical store URL with first variant id when available."""
    if not product:
        return ""
    handle = product.get("handle") or ""
    if not handle:
        return ""
    variants = product.get("variants") or []
    vid = variants[0].get("id") if variants else None
    base = f"https://bartesian.com/products/{handle}"
    return f"{base}?variant={vid}" if vid else base


def spirits_from_tags(tags) -> list[str]:
    if not tags:
        return []
    if isinstance(tags, list):
        tag_list = tags
    else:
        tag_list = [t.strip() for t in str(tags).split(",")]
    mapping = {
        "base-spirit_vodka": "Vodka",
        "base-spirit_rum": "Rum",
        "base-spirit_gin": "Gin",
        "base-spirit_tequila": "Tequila",
        "base-spirit_whiskey": "Whiskey",
        "vodka": "Vodka",
        "rum": "Rum",
        "gin": "Gin",
        "tequila": "Tequila",
        "whiskey": "Whiskey",
        "whisky": "Whiskey",
    }
    out = []
    for t in tag_list:
        spirit = mapping.get(t.lower())
        if spirit and spirit not in out:
            out.append(spirit)
    return out


def glassware_from_tags(tags) -> str:
    if not tags:
        return ""
    if isinstance(tags, list):
        tag_list = tags
    else:
        tag_list = [t.strip() for t in str(tags).split(",")]
    for t in tag_list:
        m = re.match(r"glassware-icon-(.+)$", t, re.I)
        if m:
            return m.group(1).replace("-", " ").title()
    return ""


def write_kv(path: Path, rows: list[tuple[str, str]]) -> None:
    lines = []
    for k, v in rows:
        if v is None:
            v = ""
        if isinstance(v, (dict, list)):
            v = json.dumps(v, ensure_ascii=False, separators=(",", ":"))
        lines.append(f"{k}: {v}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_pack_items(text: str, cocktail_slugs: set[str]) -> list[dict]:
    """
    Extract cocktail items from pack description text.

    Prefer "- Cocktail Name: blurb" bullets. Never treat flavor blurbs
    (text after the colon) as cocktail names. Soft-match only longer prefixes.
    """
    items: list[dict] = []
    normalized = (text or "").replace(" - ", "\n- ")

    qty_each = None
    m_qty = re.search(r"(\d+)\s+each\b", normalized, re.I)
    if m_qty:
        qty_each = int(m_qty.group(1))

    names: list[str] = []
    for m in re.finditer(
        r"(?:^|\n)\s*[-•*]\s*([A-Z][^:\n]{1,80}?)\s*:",
        normalized,
    ):
        name = m.group(1).strip()
        low = name.lower()
        if low.startswith(
            ("please note", "subscribe", "base spirit", "compatibility", "contains", "retrieve", "add your", "apply your")
        ):
            continue
        if "pack" in low and "cocktail" not in low:
            continue
        names.append(name)

    # Simple "2 each of: A, B, C, and D" without bullet descriptions
    if not names:
        m = re.search(
            r"(\d+)\s+each\s+of[:\s]+(.+?)(?:\.|\n\n|Please note|Base spirit|$)",
            normalized,
            re.I | re.S,
        )
        if m:
            qty_each = int(m.group(1))
            blob = m.group(2).strip()
            if ":" not in blob and " - " not in blob:
                names = [
                    n.strip(" .")
                    for n in re.split(r",|\band\b", blob)
                    if n.strip(" .")
                    and len(n.strip()) < 50
                    and not re.search(r"\b(flavor|with|juice)\b", n, re.I)
                ]

    # Deduplicate
    seen: set[str] = set()
    uniq: list[str] = []
    for n in names:
        key = slugify(clean_name(n))
        if not key or key in seen:
            continue
        seen.add(key)
        uniq.append(n)

    if not uniq:
        return items

    if qty_each is None:
        if re.search(r"\b1\s+each\b", normalized, re.I) or len(uniq) == 8:
            qty_each = 1
        elif len(uniq) in (2, 4):
            qty_each = 2
        else:
            qty_each = 1

    for n in uniq:
        slug = slugify(clean_name(n))
        if slug not in cocktail_slugs:
            alt = None
            # Prefer longer prefix matches only (avoid lime→lemon-drop style)
            for cs in sorted(cocktail_slugs, key=len, reverse=True):
                if len(slug) >= 8 and (cs.startswith(slug) or slug.startswith(cs)):
                    alt = cs
                    break
                if len(slug) >= 8 and cs.startswith(slug + "-"):
                    alt = cs
                    break
            if alt:
                slug = alt
        items.append({"cocktail_slug": slug, "qty": qty_each})
    return items


def download_image(url: str, dest: Path, skip: bool) -> str:
    if skip or not url:
        return ""
    try:
        fetch(url, dest=dest, binary=True)
        return str(dest.relative_to(ROOT)).replace("\\", "/")
    except Exception as exc:  # noqa: BLE001
        print(f"  ! image fail {url[:80]}: {exc}")
        return ""


def scrape_article(path_id: str) -> dict:
    url = f"https://bartesian.gorgias.help/en-US/{path_id}"
    html = fetch(url)
    title, content_html, slug_id = parse_next_html_content(html)
    text = html_to_text(content_html)
    # Description = paragraphs before first labeled field
    desc = text
    for marker in (
        "Base Spirit",
        "Base Spirits",
        "Recommended Glassware",
        "Garnish",
        "Alcohol Volume",
        "Cocktail pairings",
    ):
        if marker in desc:
            desc = desc.split(marker, 1)[0].strip()
            break
    desc = re.sub(r"\s+", " ", desc).strip()

    spirits_raw = field(text, "Base Spirit", "Base Spirits")
    glass = field(text, "Recommended Glassware")
    garnish = field(text, "Garnish")
    alcohol_raw = field(text, "Alcohol Volume")
    pairings = field(text, "Cocktail pairings", "Cocktail Pairings")

    name = title or path_id.rsplit("-", 1)[0].replace("-", " ").title()
    # Drop region-only noise from name for slug but keep in name
    slug = slugify(re.sub(r"\s*\((EU/UK|UK Only|US Only)\)\s*", "", name, flags=re.I))

    return {
        "name": name,
        "slug": slug,
        "path_id": path_id,
        "help_url": url,
        "description": desc,
        "spirits": parse_spirits(spirits_raw),
        "glassware": glass,
        "garnish": garnish,
        "alcohol": parse_alcohol(alcohol_raw),
        "pairings": pairings,
        "text": text,
        "content_html": content_html,
        "nutrition_urls": nutrition_image_urls(content_html),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-images", action="store_true")
    args = ap.parse_args()

    for d in (
        OUT_COCKTAILS,
        OUT_PACKS,
        OUT_RIMMERS,
        IMG_COCKTAILS,
        IMG_RIMMERS,
        IMG_NUTRITION,
        IMG_PACKS,
        CACHE,
    ):
        d.mkdir(parents=True, exist_ok=True)

    print("Fetching Shopify collections…")
    shop_cocktails = shopify_products(SHOPIFY_COLLECTIONS["cocktails"])
    shop_packs = shopify_products(SHOPIFY_COLLECTIONS["packs"])
    shop_acc = shopify_products(SHOPIFY_COLLECTIONS["accessories"])
    cocktail_idx = shopify_index(shop_cocktails)
    pack_idx = shopify_index(shop_packs)
    rimmer_shop = [
        p
        for p in shop_acc
        if "rimmer" in (p.get("title") or "").lower()
        and "wooden" not in (p.get("title") or "").lower()
        and "bar rimmer" not in (p.get("title") or "").lower()
    ]
    rimmer_idx = shopify_index(rimmer_shop)

    # Category membership
    seasonal_ids = set()
    cocktail_ids: dict[str, set[str]] = {}  # path_id -> categories
    rimmer_ids = []
    pack_ids = []

    for cat, url in GORGIAS_CATEGORIES.items():
        print(f"Category {cat}…")
        html = fetch(url)
        links = extract_article_links(html)
        if cat == "rimmers":
            rimmer_ids = links
        elif cat == "variety_packs":
            pack_ids = links
        else:
            for link in links:
                cocktail_ids.setdefault(link, set()).add(cat)
                if cat == "seasonal":
                    seasonal_ids.add(link)

    print(
        f"Found {len(cocktail_ids)} cocktail articles, {len(rimmer_ids)} rimmers, {len(pack_ids)} packs"
    )

    # Clear old scaffold sample files (keep directory)
    for old in OUT_COCKTAILS.glob("*.txt"):
        old.unlink()
    for old in OUT_PACKS.glob("*.txt"):
        old.unlink()
    for old in OUT_RIMMERS.glob("*.txt"):
        old.unlink()

    cocktails = []
    for i, path_id in enumerate(sorted(cocktail_ids.keys()), 1):
        print(f"[{i}/{len(cocktail_ids)}] cocktail {path_id}")
        try:
            art = scrape_article(path_id)
        except Exception as exc:  # noqa: BLE001
            print(f"  ! fail {exc}")
            continue
        art["seasonal"] = 1 if path_id in seasonal_ids else 0
        cats = cocktail_ids[path_id]
        # If spirits missing, infer from category
        if not art["spirits"]:
            for cat in ("vodka", "rum", "gin", "whiskey", "tequila"):
                if cat in cats:
                    art["spirits"] = [cat.title()]
                    break

        shop = match_shopify(art["slug"], art["name"], cocktail_idx)
        image_path = ""
        case_barcode = ""
        # Prefer live product page; keep help URL separately. Never use bare homepage.
        bartesian_url = shopify_product_url(shop)
        if shop:
            imgs = shop.get("images") or []
            if imgs:
                image_path = download_image(
                    imgs[0]["src"],
                    IMG_COCKTAILS / f"{art['slug']}.jpg",
                    args.skip_images,
                )
            variants = shop.get("variants") or []
            if variants and variants[0].get("barcode"):
                case_barcode = str(variants[0]["barcode"])
            tag_spirits = spirits_from_tags(shop.get("tags"))
            if tag_spirits:
                # Prefer Gorgias if multi; else fill
                if not art["spirits"]:
                    art["spirits"] = tag_spirits
                elif len(tag_spirits) > len(art["spirits"]):
                    art["spirits"] = tag_spirits
            if not art["glassware"]:
                art["glassware"] = glassware_from_tags(shop.get("tags"))
            tags = shop.get("tags") or ""
            tag_str = ",".join(tags) if isinstance(tags, list) else str(tags)
            if "limited" in tag_str.lower():
                art["seasonal"] = 1

        nutrition_path = ""
        if art["nutrition_urls"]:
            # Prefer first non-undefined upload that looks like a label
            for u in art["nutrition_urls"]:
                if "undefined-" in u:
                    continue
                ext = ".png" if ".png" in u.lower() else ".jpg"
                nutrition_path = download_image(
                    u, IMG_NUTRITION / f"{art['slug']}{ext}", args.skip_images
                )
                if nutrition_path:
                    break

        nutrition_json = {}
        if nutrition_path:
            nutrition_json["label_image"] = nutrition_path

        cocktail = {
            **art,
            "image": image_path,
            "bartesian_url": bartesian_url,
            "case_barcode": case_barcode,
            "nutrition_json": nutrition_json,
            "alcohol_json": art["alcohol"],
        }
        cocktails.append(cocktail)

        fname = "".join(ch if ch.isalnum() else "" for ch in art["name"]) + ".txt"
        if not fname.lower().endswith(".txt"):
            fname = art["slug"].replace("-", "").title() + ".txt"
        # Stable filename from slug
        fname = "".join(
            w.capitalize() for w in art["slug"].split("-") if w
        ) + ".txt"

        write_kv(
            OUT_COCKTAILS / fname,
            [
                ("Name", art["name"]),
                ("Slug", art["slug"]),
                ("Description", art["description"]),
                ("Spirits", ", ".join(art["spirits"])),
                ("Glassware", art["glassware"]),
                ("Garnish", art["garnish"]),
                ("Pairs With", art["pairings"]),
                ("Nutrition", nutrition_json),
                ("Alcohol", art["alcohol"]),
                ("Bartesian URL", bartesian_url),
                ("Help URL", art["help_url"]),
                ("Image", image_path),
                ("Seasonal", art["seasonal"]),
                ("Favorite", 0),
                ("Quantity", 0),
                ("Capsule Barcode", ""),
                ("Case Barcode", case_barcode),
                ("Case Qty", 8),
            ],
        )

    cocktail_slugs = {c["slug"] for c in cocktails}

    # Rimmers
    rimmers = []
    for i, path_id in enumerate(rimmer_ids, 1):
        print(f"[{i}/{len(rimmer_ids)}] rimmer {path_id}")
        try:
            art = scrape_article(path_id)
        except Exception as exc:  # noqa: BLE001
            print(f"  ! fail {exc}")
            continue
        shop = match_shopify(art["slug"], art["name"], rimmer_idx)
        image_path = ""
        bartesian_url = shopify_product_url(shop)
        case_barcode = ""
        if shop:
            imgs = shop.get("images") or []
            if imgs:
                image_path = download_image(
                    imgs[0]["src"],
                    IMG_RIMMERS / f"{art['slug']}.jpg",
                    args.skip_images,
                )
            variants = shop.get("variants") or []
            if variants and variants[0].get("barcode"):
                case_barcode = str(variants[0]["barcode"])
        kind = "salt" if "salt" in art["name"].lower() else "sugar"
        nutrition_path = ""
        for u in art["nutrition_urls"]:
            if "undefined-" in u:
                continue
            ext = ".png" if ".png" in u.lower() else ".jpg"
            nutrition_path = download_image(
                u, IMG_NUTRITION / f"rimmer-{art['slug']}{ext}", args.skip_images
            )
            if nutrition_path:
                break

        # Resolve cocktail pairings to slugs
        pair_slugs = []
        if art["pairings"]:
            for part in re.split(r",| and ", art["pairings"]):
                part = part.strip()
                if not part or part.lower().startswith("all types"):
                    # keep textual note in pairs_with
                    continue
                ps = slugify(clean_name(part))
                if ps in cocktail_slugs:
                    pair_slugs.append(ps)

        rimmer = {
            "name": art["name"],
            "slug": art["slug"],
            "description": art["description"],
            "kind": kind,
            "image": image_path,
            "bartesian_url": bartesian_url,
            "help_url": art["help_url"],
            "pairs_with": art["pairings"],
            "pair_slugs": pair_slugs,
            "nutrition_image": nutrition_path,
            "barcode": case_barcode,
        }
        rimmers.append(rimmer)
        fname = "".join(w.capitalize() for w in art["slug"].split("-") if w) + ".txt"
        write_kv(
            OUT_RIMMERS / fname,
            [
                ("Name", rimmer["name"]),
                ("Slug", rimmer["slug"]),
                ("Description", rimmer["description"]),
                ("Kind", rimmer["kind"]),
                ("Pairs With", rimmer["pairs_with"]),
                ("Cocktail Slugs", ", ".join(pair_slugs)),
                ("Bartesian URL", bartesian_url),
                ("Help URL", art["help_url"]),
                ("Image", image_path),
                ("Nutrition Image", nutrition_path),
                ("Barcode", case_barcode),
                ("Quantity", 0),
            ],
        )

    # Variety packs — prefer Gorgias articles; enrich from Shopify
    packs_written = 0
    seen_pack_slugs = set()
    for i, path_id in enumerate(pack_ids, 1):
        print(f"[{i}/{len(pack_ids)}] pack {path_id}")
        try:
            art = scrape_article(path_id)
        except Exception as exc:  # noqa: BLE001
            print(f"  ! fail {exc}")
            continue
        shop = match_shopify(art["slug"], art["name"], pack_idx)
        bartesian_url = shopify_product_url(shop)
        barcode = ""
        image_path = ""
        if shop:
            variants = shop.get("variants") or []
            if variants and variants[0].get("barcode"):
                barcode = str(variants[0]["barcode"])
            imgs = shop.get("images") or []
            if imgs:
                image_path = download_image(
                    imgs[0]["src"], IMG_PACKS / f"{art['slug']}.jpg", args.skip_images
                )
            # Prefer shop body for item lists if richer
            body = shop.get("body_html") or ""
            shop_text = html_to_text(body)
            if len(shop_text) > len(art["text"]):
                art["text"] = shop_text
                art["description"] = re.split(
                    r"Our \d+-pack|This variety pack|Base spirit",
                    shop_text,
                    maxsplit=1,
                    flags=re.I,
                )[0].strip()
                art["description"] = re.sub(r"\s+", " ", art["description"])

        items = parse_pack_items(art["text"], cocktail_slugs)
        if art["slug"] in seen_pack_slugs:
            continue
        seen_pack_slugs.add(art["slug"])
        fname = "".join(w.capitalize() for w in art["slug"].split("-") if w) + ".txt"
        lines = [
            f"Name: {art['name']}",
            f"Slug: {art['slug']}",
            f"Barcode: {barcode}",
            f"Notes: {art['description']}",
            f"Bartesian URL: {bartesian_url}",
            f"Image: {image_path}",
            "Items:",
        ]
        for it in items:
            lines.append(f"\t{it['cocktail_slug']}: {it['qty']}")
        (OUT_PACKS / fname).write_text("\n".join(lines) + "\n", encoding="utf-8")
        packs_written += 1

    # Also write any Shopify-only packs not in Gorgias
    for p in shop_packs:
        name = clean_name(p["title"])
        slug = slugify(name)
        if slug in seen_pack_slugs or slugify(p["handle"]) in seen_pack_slugs:
            continue
        body = html_to_text(p.get("body_html") or "")
        items = parse_pack_items(body, cocktail_slugs)
        barcode = ""
        variants = p.get("variants") or []
        if variants and variants[0].get("barcode"):
            barcode = str(variants[0]["barcode"])
        image_path = ""
        imgs = p.get("images") or []
        if imgs:
            image_path = download_image(
                imgs[0]["src"], IMG_PACKS / f"{slug}.jpg", args.skip_images
            )
        fname = "".join(w.capitalize() for w in slug.split("-") if w) + ".txt"
        lines = [
            f"Name: {name}",
            f"Slug: {slug}",
            f"Barcode: {barcode}",
            f"Notes: {re.sub(r'\s+', ' ', body)[:400]}",
            f"Bartesian URL: {shopify_product_url(p)}",
            f"Image: {image_path}",
            "Items:",
        ]
        for it in items:
            lines.append(f"\t{it['cocktail_slug']}: {it['qty']}")
        (OUT_PACKS / fname).write_text("\n".join(lines) + "\n", encoding="utf-8")
        packs_written += 1
        seen_pack_slugs.add(slug)

    summary = {
        "cocktails": len(cocktails),
        "rimmers": len(rimmers),
        "packs": packs_written,
        "seasonal": sum(1 for c in cocktails if c.get("seasonal")),
    }
    (ROOT / "tmp" / "scrape" / "summary.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )
    print("Done:", summary)


if __name__ == "__main__":
    main()
