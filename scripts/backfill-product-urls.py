#!/usr/bin/env python3
"""
Backfill Bartesian URL fields with real Shopify product pages including ?variant=.

Pulls products from shop collections + /collections/all (paginated), then matches
each cocktail / rimmer / pack by handle/slug/title.
"""
from __future__ import annotations

import json
import re
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UA = "Mozilla/5.0 (compatible; BartesianPrivateCatalog/1.0)"


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
    t = re.sub(r"\s+Rimmer\s*$", "", t, flags=re.I)
    return t.strip()


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read().decode("utf-8", errors="replace").lstrip("\ufeff")
    time.sleep(0.25)
    return json.loads(raw)


def fetch_all_products() -> list[dict]:
    products = []
    seen = set()
    urls = [
        "https://bartesian.com/collections/cocktails/products.json?limit=250",
        "https://bartesian.com/collections/cocktail-variety-packs/products.json?limit=250",
        "https://bartesian.com/collections/barware-accessories/products.json?limit=250",
    ]
    # Paginate all products
    page = 1
    while page <= 20:
        urls.append(f"https://bartesian.com/collections/all/products.json?limit=250&page={page}")
        page += 1

    for url in urls:
        try:
            data = fetch_json(url)
        except Exception as exc:  # noqa: BLE001
            print("fail", url, exc)
            continue
        batch = data.get("products") or []
        if not batch and "page=" in url:
            break
        for p in batch:
            handle = p.get("handle")
            if not handle or handle in seen:
                continue
            seen.add(handle)
            products.append(p)
        print(f"  {url.split('collections/')[-1].split('?')[0]} -> +{len(batch)} (total {len(products)})")
        if "page=" in url and len(batch) < 250:
            break
    return products


def product_url(p: dict) -> str:
    handle = p.get("handle") or ""
    variants = p.get("variants") or []
    vid = variants[0].get("id") if variants else None
    base = f"https://bartesian.com/products/{handle}"
    if vid:
        return f"{base}?variant={vid}"
    return base


def build_index(products: list[dict]) -> dict[str, dict]:
    idx: dict[str, dict] = {}
    for p in products:
        handle = p.get("handle") or ""
        title = clean_name(p.get("title") or "")
        keys = {
            handle,
            slugify(handle),
            slugify(title),
            slugify(re.sub(r"-capsules?$", "", handle)),
            slugify(re.sub(r"-variety-pack$", "", handle)),
            slugify(re.sub(r"-collection$", "", handle)),
            slugify(title + " capsules"),
            slugify(title + " variety pack"),
        }
        # Common aliases
        if "espresso-martini" in handle:
            keys.add("espresso-martini")
        for k in keys:
            if k and k not in idx:
                idx[k] = p
    return idx


def fold(s: str) -> str:
    """ASCII-fold for jalapeño / café style slugs."""
    table = str.maketrans(
        {
            "á": "a",
            "à": "a",
            "ä": "a",
            "â": "a",
            "é": "e",
            "è": "e",
            "ë": "e",
            "ê": "e",
            "í": "i",
            "ì": "i",
            "ï": "i",
            "î": "i",
            "ó": "o",
            "ò": "o",
            "ö": "o",
            "ô": "o",
            "ú": "u",
            "ù": "u",
            "ü": "u",
            "û": "u",
            "ñ": "n",
            "ç": "c",
        }
    )
    return s.lower().translate(table)


def best_match(slug: str, name: str, idx: dict[str, dict], kind: str) -> dict | None:
    slug_f = fold(slug)
    name_slug = slugify(fold(clean_name(name)))
    # Known Shopify handle aliases that don't follow slug + suffix
    aliases = {
        ("cocktail", "lemon-drop"): "vodka-martini-lemon-drop-cocktails",
        ("cocktail", "jalapeno-lime-shrub"): "jalapeno-lime-shrub-cocktails",
        ("cocktail", "jalape-o-lime-shrub"): "jalapeno-lime-shrub-cocktails",
        ("cocktail", "uptown-rocks"): "gin-cocktails-uptown-rocks",
        ("cocktail", "sex-on-the-beach"): "sex-on-the-beach-vodka-cocktails",
        ("cocktail", "low-cal-cosmopolitan"): "low-calorie-cosmopolitan-martini-cocktails",
        ("cocktail", "low-cal-margarita"): "low-calorie-margarita-cocktails",
        ("cocktail", "low-cal-whiskey-sour"): "low-calorie-whiskey-sour-cocktails",
        ("cocktail", "witchs-heart"): "witchs-heart-cocktails",
        ("cocktail", "cosmopolitan"): "cosmopolitan-martini-cocktails",
        ("rimmer", "sweet-cinnamon-vanilla-sugar-rimmer"): "sweet-cinnamon-vanilla-sugar-rimmer",
        ("rimmer", "golden-demerara-sugar"): "golden-demerara-rimming-sugar",
        ("pack", "classic-collection-favorites"): "classic-cocktails-favorites",
        ("pack", "poolside-vibes"): "poolside-vibes-collection-variety-pack",
    }
    alias = aliases.get((kind, slug_f)) or aliases.get((kind, slug))
    if alias and alias in idx:
        return idx[alias]

    candidates = [
        slug_f,
        name_slug,
        f"{slug_f}-capsules" if kind == "cocktail" else "",
        f"{slug_f}-cocktails" if kind == "cocktail" else "",
        f"{name_slug}-capsules" if kind == "cocktail" else "",
        f"{name_slug}-cocktails" if kind == "cocktail" else "",
        f"{slug_f}-variety-pack" if kind == "pack" else "",
        f"{slug_f}-collection" if kind == "pack" else "",
        f"{slug_f}-rimmer" if kind == "rimmer" else "",
        f"{slug_f}-sugar-rimmer" if kind == "rimmer" else "",
        f"{slug_f}-salt-rimmer" if kind == "rimmer" else "",
    ]
    for key in candidates:
        if key and key in idx:
            p = idx[key]
            handle = p.get("handle") or ""
            if kind == "cocktail" and any(
                x in handle for x in ("variety-pack", "bundle", "collection", "advent")
            ):
                continue
            if kind == "pack" and handle.endswith("-capsules"):
                continue
            return p

    # Score all products; lower is better
    scored = []
    for p in {id(v): v for v in idx.values()}.values():
        handle = fold(p.get("handle") or "")
        title = fold(clean_name(p.get("title") or ""))
        if not handle:
            continue
        if kind == "cocktail":
            if "rimmer" in handle or any(
                x in handle for x in ("variety-pack", "-bundle", "advent-calendar")
            ):
                continue
            # Prefer single-flavor cocktail SKUs
            if not any(x in handle for x in ("capsule", "cocktail")) and "collection" in handle:
                continue
        if kind == "rimmer" and "rimmer" not in handle and "rimming" not in handle:
            continue
        if kind == "pack":
            if handle.endswith("-capsules") or (
                "cocktail" in handle
                and "pack" not in handle
                and "collection" not in handle
                and "advent" not in handle
                and "sampler" not in handle
            ):
                continue

        score = 100
        if handle == f"{slug_f}-capsules" or handle == f"{slug_f}-cocktails":
            score = 0
        elif handle.endswith(f"{slug_f}-capsules") or handle.endswith(f"{slug_f}-cocktails"):
            score = 1
        elif slug_f in handle and any(handle.endswith(s) for s in ("-capsules", "-cocktails")):
            score = 2
        elif title == fold(clean_name(name)) or title == slug_f.replace("-", " "):
            score = 3
        elif slug_f in handle:
            score = 10 + abs(len(handle) - len(slug_f))
        elif name_slug and name_slug in handle:
            score = 12 + abs(len(handle) - len(name_slug))
        else:
            continue
        # Prefer shorter handles (more specific) at same score tier
        scored.append((score, len(handle), p))

    if scored:
        scored.sort(key=lambda x: (x[0], x[1]))
        return scored[0][2]
    return None


def rewrite_url_in_file(path: Path, new_url: str) -> bool:
    text = path.read_text(encoding="utf-8")
    if re.search(r"^Bartesian URL:\s*.*$", text, re.M):
        updated = re.sub(r"^Bartesian URL:\s*.*$", f"Bartesian URL: {new_url}", text, count=1, flags=re.M)
    else:
        # insert after Alcohol or Help URL-ish; append near top fields
        updated = text.rstrip() + f"\nBartesian URL: {new_url}\n"
    if updated == text:
        return False
    path.write_text(updated, encoding="utf-8")
    return True


def parse_field(text: str, key: str) -> str:
    m = re.search(rf"^{re.escape(key)}:\s*(.*)$", text, re.M)
    return (m.group(1).strip() if m else "")


def process_dir(dir_path: Path, kind: str, idx: dict[str, dict]) -> tuple[int, int]:
    matched = 0
    missing = 0
    if not dir_path.exists():
        return 0, 0
    for path in sorted(dir_path.glob("*.txt")):
        text = path.read_text(encoding="utf-8")
        name = parse_field(text, "Name")
        slug = parse_field(text, "Slug") or slugify(name)
        p = best_match(slug, name, idx, kind)
        if not p:
            missing += 1
            print(f"  ! no shop match [{kind}] {slug}")
            continue
        url = product_url(p)
        if rewrite_url_in_file(path, url):
            matched += 1
            print(f"  OK {slug} -> {url}")
        else:
            # still count as matched if already correct
            current = parse_field(text, "Bartesian URL")
            if current == url:
                matched += 1
            else:
                print(f"  ~ unchanged {slug}")
    return matched, missing


def main() -> None:
    print("Fetching Shopify products…")
    products = fetch_all_products()
    idx = build_index(products)
    print(f"Indexed {len(products)} products / {len(idx)} keys")

    # Persist index for scrape reuse
    out = ROOT / "tmp" / "scrape" / "shopify-products.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(products, ensure_ascii=False), encoding="utf-8")

    c_ok, c_miss = process_dir(ROOT / "data" / "cocktails", "cocktail", idx)
    r_ok, r_miss = process_dir(ROOT / "data" / "rimmers", "rimmer", idx)
    p_ok, p_miss = process_dir(ROOT / "data" / "packs", "pack", idx)
    print(
        "Done:",
        f"cocktails {c_ok} matched / {c_miss} missing,",
        f"rimmers {r_ok}/{r_miss},",
        f"packs {p_ok}/{p_miss}",
    )


if __name__ == "__main__":
    main()
