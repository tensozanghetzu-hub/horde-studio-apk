#!/usr/bin/env python3
"""Turn an upstream Horde Studio world pack into the shape the mobile app uses.

Upstream ships world-packs/ as real OpenStreetMap data: places with coordinates
and OSM tags, plus walking routes with polyline geometry. The mobile app needs
much less than that:

  - places as {id, name, kind, note, ll} - the list a virtual human can be in
  - routes as {f, t, m} - how many minutes between two of them

Geometry is dropped: it exists to draw maps, and there is no map on the phone.
Without it the pack is ~66 KB instead of 1.3 MB.

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

# OSM capability -> the kinds the app's place editor offers
KINDS = {"home", "work", "food", "rest", "exercise", "leisure", "social", "other"}


def fetch(url):
    sys.stderr.write("fetching %s\n" % url)
    with urllib.request.urlopen(url, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def convert_place(p):
    caps = (p.get("capabilities") or {}).get("capabilities") or []
    kind = next((c for c in caps if c in KINDS), None)
    if kind is None:
        kind = "other"
    tags = p.get("sourceTags") or {}
    bits = [tags.get("addr:street"), tags.get("addr:housenumber")]
    bits = [b for b in bits if b]
    return {
        "id": p["id"],
        "name": p.get("label") or "Place",
        "kind": kind,
        "note": " ".join(bits),
        "ll": p.get("mapCoordinates"),
    }


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    catalog = []

    for slug, title, blurb in PACKS:
        raw = fetch("%s/%s.json" % (UPSTREAM, slug))

        places = [convert_place(p) for p in raw.get("places", [])]
        places = [p for p in places if p["ll"]]

        # one entry per pair, keeping the quicker direction
        best = {}
        for r in raw.get("routes", []):
            a, b = r.get("from"), r.get("to")
            if not a or not b or a == b:
                continue
            try:
                mins = round(float(r.get("minutes")), 1)
            except (TypeError, ValueError):
                continue
            key = tuple(sorted((a, b)))
            if key not in best or mins < best[key]:
                best[key] = mins

        ids = {p["id"] for p in places}
        routes = [{"f": a, "t": b, "m": m}
                  for (a, b), m in sorted(best.items())
                  if a in ids and b in ids]

        pack = {
            "id": slug,
            "name": title,
            "description": blurb,
            "source": raw.get("source", ""),
            # ODbL requires this be passed on; the app shows it when a pack is loaded
            "attribution": raw.get("license",
                                   "© OpenStreetMap contributors, ODbL 1.0"),
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
