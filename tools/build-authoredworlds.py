#!/usr/bin/env python3
"""Bundle an upstream authored world (.horde_world) into the app.

The Worlds screen is no use without a world to open, so one ships with the
install, stripped of its artwork. `Policy Panic at Bramble & Pike` is 2.5 MB as
published and about 50 KB without the base64 images, which is what makes it
reasonable to carry.

The world is not installed for you. It appears under "Available to install" and
becomes an ordinary world once you tap it.

Usage:  python3 tools/build-authoredworlds.py
"""

import json
import os
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "horde-studio-mobile", "worlds")
BASE = "https://raw.githubusercontent.com/ddkhan24/hordestudio/main"

# filename -> bundled id. Kept short: the id is what the app stores.
WORLDS = [
    ("Policy Panic at Bramble and Pike.horde_world", "policy-panic",
     "A living small-town workplace comedy inside a dysfunctional regional "
     "insurance branch: 23 rooms, 8 colleagues, 6 factions, and a clock that "
     "starts at 8:57 on a Monday."),
]

# Art lives under these keys, at any depth.
MEDIA_KEYS = ("visuals", "banner", "mediaAssets", "_mediaManifest", "presentation")


def fetch(url):
    sys.stderr.write("fetching %s\n" % url)
    with urllib.request.urlopen(url, timeout=180) as r:
        return r.read()


def strip_media(node):
    """Drop artwork and any data: URI, keeping everything else."""
    if isinstance(node, dict):
        out = {}
        for k, v in node.items():
            if k in MEDIA_KEYS:
                continue
            if isinstance(v, str) and v.startswith("data:"):
                continue
            out[k] = strip_media(v)
        return out
    if isinstance(node, list):
        return [strip_media(x) for x in node]
    return node


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    catalog = []

    for filename, slug, blurb in WORLDS:
        raw = fetch(BASE + "/" + urllib.parse.quote(filename))
        original = json.loads(raw.decode("utf-8"))

        world = strip_media(original)
        world["id"] = "world_" + slug
        world.pop("_exportedAt", None)

        out = os.path.join(OUT_DIR, slug + ".horde_world")
        with open(out, "w", encoding="utf-8") as f:
            json.dump(world, f, ensure_ascii=False, separators=(",", ":"))

        size = os.path.getsize(out)
        catalog.append({
            "id": world["id"],
            "name": world.get("name") or slug,
            "description": blurb,
            "file": slug + ".horde_world",
            "places": len(world.get("locations") or []),
            "people": len(world.get("entities") or []),
            "factions": len(world.get("factions") or []),
            "lore": len(world.get("lorebook") or []),
            "roles": len(world.get("startingLives") or []),
            "bytes": size,
            "attribution": "Authored world from Horde Studio (github.com/ddkhan24/hordestudio). "
                           "Artwork stripped for size.",
        })
        print("  %-14s %2d places  %2d people  %6.1f KB (from %.1f MB)"
              % (slug, len(world.get("locations") or []),
                 len(world.get("entities") or []),
                 size / 1024, len(raw) / 1048576))

    index = os.path.join(OUT_DIR, "authored.json")
    with open(index, "w", encoding="utf-8") as f:
        json.dump({"worlds": catalog}, f, ensure_ascii=False, indent=2)
    print("  authored.json written")


if __name__ == "__main__":
    main()
