#!/usr/bin/env python3
"""Stamp the version into the files that cannot read the manifest.

`AndroidManifest.xml` is the single source of truth for the version: build.sh
already derives the APK filename from it, and build-channel.py derives
version.json from it. But two files ship to the browser, where the manifest is
not available, and both carried hand-maintained copies:

    js/store.js   var VERSION = '...'      what the app displays
    sw.js         var CACHE = '...'        which shell a phone installs

Both drifted. store.js sat six releases behind (`1.39.51` while the app was
`1.39.74`), so the About screen showed a version nobody could match to a
release — the exact moment a bug report gets written down wrong.

This script runs before every build, so the two copies cannot fall behind.
Refuses to stamp an unreadable manifest rather than writing a guess.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "apk-build", "AndroidManifest.xml")
STORE = os.path.join(ROOT, "horde-studio-mobile", "js", "store.js")
SW = os.path.join(ROOT, "horde-studio-mobile", "sw.js")

SW_BANNER = """/* Horde Studio — offline app shell.
   The cache name carries the release, and this worker is cache-first
   (`return hit || net`), so a new version always installs a fresh shell
   instead of serving the previous app.js from disk.
   Written by tools/stamp-version.py from the manifest — do not edit by hand. */"""


def read_version():
    with open(MANIFEST, encoding="utf-8") as f:
        text = f.read()
    name = re.search(r'android:versionName="([^"]*)"', text)
    code = re.search(r'android:versionCode="([^"]*)"', text)
    if not name or not code:
        raise SystemExit("stamp-version: no versionName/versionCode in %s" % MANIFEST)
    return name.group(1).strip(), code.group(1).strip()


def replace_once(path, pattern, replacement, label):
    with open(path, encoding="utf-8") as f:
        text = f.read()
    new, n = re.subn(pattern, replacement, text, count=1)
    if n != 1:
        raise SystemExit("stamp-version: could not find %s in %s" % (label, path))
    if new == text:
        return False
    with open(path, "w", encoding="utf-8") as f:
        f.write(new)
    return True


def main():
    version, code = read_version()
    if not re.match(r"^\d+\.\d+\.\d+$", version):
        raise SystemExit("stamp-version: %r is not a version number" % version)

    changed = []
    if replace_once(STORE, r"var VERSION = '[^']*';",
                     "var VERSION = '%s';" % version, "var VERSION"):
        changed.append("js/store.js")
    if replace_once(SW, r"var CACHE = 'horde-studio-v[^']*';",
                    "var CACHE = 'horde-studio-v%s';" % version, "var CACHE"):
        changed.append("sw.js")

    # The prose above the cache name used to name a single old release, so it
    # went stale in a comment no one could grep for. Make it version-neutral
    # once, then leave it alone.
    with open(SW, encoding="utf-8") as f:
        sw = f.read()
    lines = sw.split("\n")
    # swallow every leading /* ... */ block (there are two) up to real code
    i = 0
    blocks = 0
    while i < len(lines) and lines[i].lstrip().startswith("/*"):
        j = i
        while j < len(lines) and not lines[j].rstrip().endswith("*/"):
            j += 1
        if j >= len(lines):
            break
        i, blocks = j + 1, blocks + 1
    if blocks and "\n".join(lines[:i]) != SW_BANNER:
        with open(SW, "w", encoding="utf-8") as f:
            f.write("\n".join(SW_BANNER.split("\n") + lines[i:]))
        if "sw.js" not in changed:
            changed.append("sw.js")

    print("stamp    version %s (code %s) -> %s" % (
        version, code, ", ".join(changed) if changed else "already current"))


if __name__ == "__main__":
    main()
