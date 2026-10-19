#!/usr/bin/env python3
"""Populate Advent Calendar 2026 pack + spoiler cocktail from Gorgias article."""
from __future__ import annotations

import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HELP = "https://bartesian.gorgias.help/en-US/2026-advent-calendar-(spoiler-alert)-7886629"
PACK_URL = "https://bartesian.com/products/advent-calendar?variant=47520593445063"

# From https://bartesian.gorgias.help/en-US/2026-advent-calendar-(spoiler-alert)-7886629
CAPSULES = [
    {
        "name": "Berry & Bright",
        "slug": "berry-and-bright",
        "spirits": "Tequila",
        "desc": (
            "A shimmering tequila cocktail combining juicy blueberry, zesty lemon, "
            "and a hint of cozy cardamom flavor. The result is a vibrant cocktail "
            "that sparkles with the magic of the season."
        ),
        "new": True,  # one of the 3 NEW for 2026
    },
    {
        "name": "Brown Butter Old Fashioned",
        "slug": "brown-butter-old-fashioned",
        "spirits": "Whiskey",
        "desc": (
            "A rich, spirit-forward sipper infused with flavors of indulgent browned butter, "
            "bitters and a hint of orange."
        ),
        "new": False,
    },
    {
        "name": "Frosted Ambrosia",
        "slug": "frosted-ambrosia",
        "spirits": "Vodka",
        "desc": (
            "A nostalgic vodka cocktail with flavors of juicy orange, pineapple, coconut, "
            "cherry, and a soft marshmallow finish. Sweet, creamy, and fruit-forward, "
            "it's a playful holiday dessert cocktail."
        ),
        "new": True,  # one of the 3 NEW for 2026
    },
    {
        "name": "Ginger Pear Noel",
        "slug": "ginger-pear-noel",
        "spirits": "Whiskey",
        "desc": (
            "A tantalizing whiskey cocktail with ripe pear and lime juice, "
            "plus a kick of fiery ginger flavor."
        ),
        "new": False,
    },
    {
        "name": "Holiday Spiced Old Fashioned",
        "slug": "holiday-spiced-old-fashioned",
        "spirits": "Whiskey",
        "desc": (
            "A spirit-forward cocktail with flavors of orange, bitters, cinnamon and brown sugar."
        ),
        "new": False,
    },
    {
        "name": "Jollypeño Margarita",
        "slug": "jollype-o-margarita",
        "spirits": "Tequila",
        "desc": (
            "A margarita bursting with flavors of vibrant pineapple, zesty lime, "
            "and a kick of jalapeño."
        ),
        "new": False,
    },
    {
        "name": "Mistletoe Margarita",
        "slug": "mistletoe-margarita",
        "spirits": "Tequila",
        "desc": (
            "A blend of jammy pomegranate and baking spice flavors "
            "for the perfect seasonal margarita."
        ),
        "new": False,
    },
    {
        "name": "Peary Christmas",
        "slug": "peary-christmas",
        "spirits": "Tequila",
        "desc": (
            "You'll have a very \"peary\" Christmas with this elegant tequila cocktail "
            "with sweet pear, citrus, and delicate almond notes."
        ),
        "new": False,
    },
    {
        "name": "Salted Caramel Espresso Martini",
        "slug": "salted-caramel-espresso-martini",
        "spirits": "Vodka",
        "desc": (
            "Flavors of rich coffee, buttery caramel, and a hint of sea salt come together "
            "in this smooth, velvety espresso martini. Decadent yet refined, "
            "it's a luxurious twist on a cocktail favorite."
        ),
        "new": True,  # one of the 3 NEW for 2026
    },
    {
        "name": "The Grinch Appletini",
        "slug": "the-grinch-appletini",
        "spirits": "Vodka",
        "desc": "A shimmering sweet and tart vodka cocktail with green apple flavors.",
        "new": False,
    },
    {
        "name": "Winter Pear-adise",
        "slug": "winter-pear-adise",
        "spirits": "Gin",
        "desc": (
            "A sweet and tart gin cocktail, blending flavors of juicy pear, "
            "earthy sage and a twist of lime."
        ),
        "new": False,
    },
    {
        "name": "Yuletide Hurricane",
        "slug": "yuletide-hurricane",
        "spirits": "Rum",
        "desc": "A fruity, tropical rum cocktail with added shimmer.",
        "new": False,
    },
]


def cocktail_path(slug: str) -> Path:
    # Prefer existing PascalCase filenames
    for p in (ROOT / "data" / "cocktails").glob("*.txt"):
        for line in p.read_text(encoding="utf-8").splitlines():
            if line.startswith("Slug:") and line.split(":", 1)[1].strip() == slug:
                return p
    parts = slug.split("-")
    fname = "".join(w[:1].upper() + w[1:] for w in parts if w) + ".txt"
    return ROOT / "data" / "cocktails" / fname


def ensure_stub(c: dict) -> None:
    path = cocktail_path(c["slug"])
    if path.exists():
        # Enrich empty description if needed
        text = path.read_text(encoding="utf-8")
        m = re.search(r"^Description: (.*)$", text, re.M)
        if m and not m.group(1).strip():
            text = re.sub(
                r"^Description:.*$",
                f"Description: {c['desc']}",
                text,
                count=1,
                flags=re.M,
            )
            path.write_text(text, encoding="utf-8")
            print(f"  updated desc {c['slug']}")
        else:
            print(f"  keep {c['slug']} ({path.name})")
        return

    lines = [
        f"Name: {c['name']}",
        f"Slug: {c['slug']}",
        f"Description: {c['desc']}",
        "Details: ",
        f"Spirits: {c['spirits']}",
        "Glassware: ",
        "Garnish: ",
        "Pairs With: ",
        "Nutrition: {}",
        "Alcohol: {}",
        "Bartesian URL: ",
        "Shopify Product ID: ",
        "Shopify Variant ID: ",
        "Shopify Handle: ",
        "Shopify SKU: ",
        "Help URL: ",
        "Gorgias Article ID: ",
        "Hero Image: ",
        "Marketing Image: ",
        "Image: ",
        "Seasonal: 1",
        "Enabled: 0",
        "Favorite: 0",
        "Quantity: 0",
        "Capsule Barcode: ",
        "Case Barcode: ",
        "Case Qty: 8",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")
    print(f"  created stub {path.name}")


def write_pack() -> None:
    new_names = [c["name"] for c in CAPSULES if c["new"]]
    notes = (
        "With 3 NEW holiday cocktails and 9 returning festive favorites, "
        "you can enjoy a delicious cocktail surprise for 12 nights during "
        "the most wonderful time of the year. "
        f"NEW for 2026: {', '.join(new_names)}. "
        "See the spoiler article for full capsule descriptions."
    )
    lines = [
        "Name: Advent Calendar 2026",
        "Slug: advent-calendar-2026",
        "Barcode: ",
        f"Notes: {notes}",
        f"Bartesian URL: {PACK_URL}",
        "Shopify Product ID: 8913630003399",
        "Shopify Variant ID: 47520593445063",
        "Shopify Handle: advent-calendar",
        f"Help URL: {HELP}",
        "Gorgias Article ID: 7886629",
        "Image: images/packs/advent-calendar-2026.jpg",
        "Nutrition Image: ",
        "Nutrition Image EU: ",
        "Enabled: 1",
        "Items:",
    ]
    for c in CAPSULES:
        lines.append(f"\t{c['slug']}: 1")
    lines.append("")
    path = ROOT / "data" / "packs" / "AdventCalendar2026.txt"
    path.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote pack {path.name} with {len(CAPSULES)} items")


def write_spoiler() -> None:
    description = (
        "Spoiler Alert: If you wish to keep each day a festive surprise — "
        "the information below discloses the capsule selections. "
        "With 3 NEW holiday cocktails and 9 returning festive favorites, "
        "you can enjoy a delicious cocktail surprise for 12 nights during "
        "the most wonderful time of the year."
    )
    detail_parts = []
    for c in CAPSULES:
        tag = " (NEW)" if c["new"] else ""
        block = f"{c['name']}{tag}\n{c['desc']}\nBase spirit: {c['spirits']}"
        detail_parts.append(block)
    details = "\n\n".join(detail_parts)
    details_one_line = details.replace("\\", "\\\\").replace("\n", "\\n")

    lines = [
        "Name: 2026 Advent Calendar (spoiler alert!)",
        "Slug: 2026-advent-calendar-spoiler-alert",
        f"Description: {description}",
        f"Details: {details_one_line}",
        "Spirits: Tequila, Whiskey, Vodka, Gin, Rum",
        "Glassware: ",
        "Garnish: ",
        "Pairs With: ",
        'Nutrition: {"label_image":"images/nutrition/2026-advent-calendar-spoiler-alert.png","label_image_eu":"images/nutrition/2026-advent-calendar-spoiler-alert-eu.jpg"}',
        "Alcohol: {}",
        f"Bartesian URL: {PACK_URL}",
        "Shopify Product ID: 8913630003399",
        "Shopify Variant ID: 47520593445063",
        "Shopify Handle: advent-calendar",
        "Shopify SKU: ",
        f"Help URL: {HELP}",
        "Gorgias Article ID: 7886629",
        "Hero Image: ",
        "Marketing Image: images/packs/advent-calendar-2026.jpg",
        "Image: images/packs/advent-calendar-2026.jpg",
        "Seasonal: 1",
        "Enabled: 0",
        "Favorite: 0",
        "Quantity: 0",
        "Capsule Barcode: ",
        "Case Barcode: ",
        "Case Qty: 12",
        "",
    ]
    path = ROOT / "data" / "cocktails" / "2026AdventCalendarSpoilerAlert.txt"
    path.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote spoiler cocktail {path.name}")


def main() -> None:
    print("Stubs / existing capsules:")
    for c in CAPSULES:
        ensure_stub(c)
    write_pack()
    write_spoiler()


if __name__ == "__main__":
    main()
