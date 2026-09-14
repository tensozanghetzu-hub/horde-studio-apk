#!/usr/bin/env python3
"""Turn an upstream Horde Studio world pack into the shape the mobile app uses.

Upstream ships world-packs/ as real OpenStreetMap data: places with coordinates
and OSM tags, plus walking routes with polyline geometry.

What this converter deliberately keeps, because the life engine uses it:

  - caps[]      every capability a place has. Upstream gives a cafe
                ["food","leisure"], so it can answer hunger *and* boredom.
                Collapsing that to one "kind" was the bug that made places
                single-purpose.
  - hours[]     upstream's opening-hours shape, when the pack has it
  - oh          the raw OSM opening_hours string, parsed on the device
  - routes      as an undirected walking graph, so journeys route across
                several hops instead of only between direct neighbours

What it drops: polyline geometry, which exists to draw maps and is ~87% of the
pack. There is no map on the phone.

Usage:  python3 tools/build-worldpack.py
"""

import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "horde-studio-mobile", "worlds")

UPSTREAM = "https://raw.githubusercontent.com/ddkhan24/hordestudio/main/world-packs"
PACKS = [("tempe-core", "Tempe core · OpenStreetMap",
          "120 real places and walking routes in Tempe, Arizona, from an "
          "OpenStreetMap snapshot.")]

# The place editor's list, used to pick a primary kind for display only.
KINDS = ("home", "work", "food", "rest", "exercise", "leisure", "social", "other")

# Walking speed used when no route covers a pair (metres per minute).
# Upstream builds routes at 4.5 km/h = 75 m/min; the straight-line fallback is
# scaled up to allow for following streets rather than crossing them.
WALK_MPM = 75.0
DETOUR = 1.3


def fetch(url):
    sys.stderr.write("fetching %s\n" % url)
    with urllib.request.urlopen(url, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def convert_place(p):
    cap = p.get("capabilities") or {}
    caps = [c for c in (cap.get("capabilities") or []) if c]
    tags = p.get("sourceTags") or {}

    bits = [tags.get("addr:street"), tags.get("addr:housenumber")]
    bits = [b for b in bits if b]

    out = {
        "id": p["id"],
        "name": p.get("label") or "Place",
        # every capability, in upstream's order
        "caps": caps,
        # one primary kind, purely so the place editor can group them
        "kind": next((c for c in caps if c in KINDS), "other"),
        "note": " ".join(bits),
        "ll": p.get("mapCoordinates"),
    }
    if cap.get("hours"):
        out["hours"] = cap["hours"]
    if tags.get("opening_hours"):
        out["oh"] = tags["opening_hours"]
    return out


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    catalog = []

    for slug, title, blurb in PACKS:
        raw = fetch("%s/%s.json" % (UPSTREAM, slug))

        places = [convert_place(p) for p in raw.get("places", [])]
        places = [p for p in places if p["ll"]]
        ids = {p["id"] for p in places}

        # Upstream stores each direction separately; walking times are
        # symmetric, so one undirected edge per pair is lossless and half the
        # size. The app routes across these as a graph.
        best = {}
        for r in raw.get("routes", []):
            a, b = r.get("from"), r.get("to")
            if not a or not b or a == b or a not in ids or b not in ids:
                continue
            try:
                mins = round(float(r.get("minutes")), 2)
            except (TypeError, ValueError):
                continue
            if mins <= 0:
                continue
            key = tuple(sorted((a, b)))
            if key not in best or mins < best[key]:
                best[key] = mins

        routes = [{"f": a, "t": b, "m": m} for (a, b), m in sorted(best.items())]

        pack = {
            "id": slug,
            "name": title,
            "description": blurb,
            "source": raw.get("source", ""),
            # ODbL requires this be passed on; the app shows it when a pack is loaded
            "attribution": raw.get("license",
                                   "© OpenStreetMap contributors, ODbL 1.0"),
            "bbox": raw.get("bbox"),
            "placeCount": len(places),
            "routeCount": len(routes),
            "places": places,
            "routes": routes,
        }

        path = os.path.join(OUT_DIR, "%s.json" % slug)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(pack, f, ensure_ascii=False, separators=(",", ":"))

        catalog.append({
            "id": slug,
            "name": title,
            "description": blurb,
            "placeCount": len(places),
            "routeCount": len(routes),
            "attribution": pack["attribution"],
            "file": "%s.json" % slug,
        })
        print("  %-12s %4d places  %4d routes  %6.1f KB"
              % (slug, len(places), len(routes), os.path.getsize(path) / 1024))

    with open(os.path.join(OUT_DIR, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"packs": catalog}, f, ensure_ascii=False, indent=2)
    print("  index.json written")


if __name__ == "__main__":
    main()
