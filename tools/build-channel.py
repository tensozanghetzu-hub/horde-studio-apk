#!/usr/bin/env python3
"""Build the public update channel in docs/ from the app source.

GitHub Pages publishes docs/ exactly as it is, so docs/ is the channel:
the app files themselves, plus the three things the updater fetches -

    docs/version.json            what is current
    docs/web.zip                 the bundle for an in-place update
    docs/HordeStudio-latest.apk  the APK, for when the wrapper changed

It is content-addressed and reproducible. webRev is a hash of the files, zip
entries carry a fixed timestamp, and "updated" comes from the source files
rather than the clock - so rebuilding something that has not changed produces
byte-identical output, the phone is never offered an update it already has,
and git stays clean instead of recording a no-op every time.
"""

import hashlib
import io
import json
import os
import subprocess
import re
import shutil
import sys
import time
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "horde-studio-mobile")
OUT = os.path.join(ROOT, "docs")
MANIFEST = os.path.join(ROOT, "apk-build", "AndroidManifest.xml")
APK_NAME = "HordeStudio-latest.apk"

# zip timestamps would change the bytes on every build for no reason
EPOCH = (1980, 1, 1, 0, 0, 0)

SKIP = {"icons/icon-source.png", "version.json", "web.zip", ".nojekyll"}
# static data: carried in docs/ and in the APK, but not in an update
SKIP_DIRS = ("worlds",)


def die(msg):
    sys.stderr.write("error: %s\n" % msg)
    sys.exit(1)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def bundle_files():
    """The app files that make up a release, in a stable order."""
    if not os.path.isdir(SRC):
        die("no app source at %s" % SRC)
    out = []
    for f in sorted(os.listdir(SRC)):
        if os.path.isfile(os.path.join(SRC, f)) and f not in SKIP:
            out.append(f)
    for sub in sorted(("css", "js", "icons", "worlds")):
        root = os.path.join(SRC, sub)
        if not os.path.isdir(root):
            continue
        for dirpath, _, files in os.walk(root):
            for f in files:
                rel = os.path.relpath(os.path.join(dirpath, f), SRC).replace(os.sep, "/")
                if rel not in SKIP:
                    out.append(rel)
    return sorted(out)


def app_version():
    """versionName / versionCode out of the manifest."""
    name, code = "0.0.0", 0
    try:
        with open(MANIFEST, encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return name, code
    m = re.search(r'android:versionName="([^"]*)"', text)
    if m:
        name = m.group(1)
    m = re.search(r'android:versionCode="([^"]*)"', text)
    if m:
        try:
            code = int(m.group(1))
        except ValueError:
            code = 0
    return name, code


def apk_version(path):
    """What the binary on disk says it is.

    The APK carries its own copy of the app, and tools/stamp-version.py writes
    the release into `js/store.js` inside it, so the file can be asked rather
    than trusted. `newest_apk()` picks by name at the workspace root, which
    means a build that died halfway leaves the PREVIOUS APK sitting there — and
    it gets copied into the channel and advertised under the new number, with a
    `versionCode` high enough that every phone offers it as an update. Seen on
    2026-11-26: build.sh failed for a missing SDK, the run reported
    `apk 1.48.6 (code 210)`, and the bytes were 1.48.5.
    """
    try:
        import re as _re
        import zipfile
        with zipfile.ZipFile(path) as z:
            raw = z.read("assets/js/store.js").decode("utf-8", "replace")
    except Exception:
        return None
    m = _re.search(r"var VERSION = '([^']+)'", raw)
    return m.group(1) if m else None


def newest_apk():
    import glob
    cands = [p for p in glob.glob(os.path.join(ROOT, "HordeStudio-*.apk"))]
    if not cands:
        return None
    # compare as a version triple, not as text: "v1.4.10" sorts before
    # "v1.4.9" as a string, which picked the OLD apk for the channel
    def vkey(p):
        m = re.search(r"v(\d+)\.(\d+)\.(\d+)", os.path.basename(p))
        return tuple(int(x) for x in m.groups()) if m else (0, 0, 0)
    return max(cands, key=vkey)


def pages_url():
    """Where Pages will serve docs/ - derived from the git remote so the
    address is written in exactly one place."""
    if os.environ.get("PAGES_URL"):
        return os.environ["PAGES_URL"].rstrip("/") + "/"
    try:
        remote = os.popen(
            "git -C %s remote get-url origin 2>/dev/null" % ROOT
        ).read().strip()
    except Exception:
        remote = ""
    m = re.search(r"github\.com[:/]([^/]+)/([^/\s]+?)(\.git)?$", remote or "")
    if m:
        return "https://%s.github.io/%s/" % (m.group(1), m.group(2))
    return ""


def bake_default_url(url):
    """The baked-in update address follows the channel, so a phone that has
    never been told otherwise points at Pages, which does not move."""
    if not url:
        return False
    target = os.path.join(SRC, "js", "update.js")
    try:
        with open(target, encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return False
    new = re.sub(
        r"(var DEFAULT_URL = ')[^']*(';)",
        lambda m: m.group(1) + url + m.group(2),
        text,
        count=1,
    )
    if new == text:
        return False
    with open(target, "w", encoding="utf-8") as f:
        f.write(new)
    return True


def zip_entry(z, arcname, data):
    """Add a file with a fixed timestamp, so identical content gives
    identical bytes no matter when it was built."""
    info = zipfile.ZipInfo(arcname, date_time=EPOCH)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    z.writestr(info, data)


def main():
    # the browser cannot read the manifest, so the two copies it needs are
    # stamped from it before anything is hashed or copied (see stamp-version.py)
    subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                                 "stamp-version.py")], check=True)
    url = pages_url()
    moved = bake_default_url(url)

    names = bundle_files()
    shipped = [r for r in names if r.split("/")[0] not in SKIP_DIRS]
    manifest = [(rel, sha256_file(os.path.join(SRC, rel))) for rel in shipped]
    rev = hashlib.sha256(
        "".join("%s %s\n" % kv for kv in manifest).encode()
    ).hexdigest()[:12]

    # when the files last changed, not when we happened to build
    stamp = 0
    for rel in names:
        try:
            stamp = max(stamp, int(os.path.getmtime(os.path.join(SRC, rel))))
        except OSError:
            pass
    updated = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(stamp or 0))

    version, code = app_version()

    # docs/ mirrors the source exactly: stale files from an older build go.
    #
    # One file is exempt, and it is the one that matters. docs/HordeStudio-latest.apk
    # is not built from horde-studio-mobile/ — it is copied from a *gitignored*
    # artifact at the workspace root, which is routinely deleted once a release is
    # out. Mirroring without the exemption therefore deleted the published APK on
    # the next run (seen 2026-11-23: `apk none found`, the file gone from docs/, and
    # version.json left advertising an apkUrl that 404s for every phone on the
    # channel). A scratch file going missing must never take the download with it.
    keep = {APK_NAME}
    if os.path.isdir(OUT):
        for f in os.listdir(OUT):
            if f in keep:
                continue
            p = os.path.join(OUT, f)
            shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)
    os.makedirs(OUT, exist_ok=True)

    for rel in names:
        dst = os.path.join(OUT, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(os.path.join(SRC, rel), dst)
    with open(os.path.join(OUT, ".nojekyll"), "w") as f:
        f.write("")

    # the zip carries its own revision, so an update applied from a file
    # (no network at all) still knows which revision it is
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in shipped:
            with open(os.path.join(SRC, rel), "rb") as f:
                zip_entry(z, rel, f.read())
        zip_entry(z, "version.json", (json.dumps({
            "apk": version, "apkCode": code, "web": version, "webRev": rev,
            "updated": updated,
        }, indent=2) + "\n").encode())
    zip_bytes = buf.getvalue()
    with open(os.path.join(OUT, "web.zip"), "wb") as f:
        f.write(zip_bytes)

    apk = newest_apk()
    apk_size = 0
    retained = False
    stale = None
    if apk:
        # check the bytes BEFORE they land in docs/: refusing after the copy
        # would leave the channel holding the very file it just rejected
        inside = apk_version(apk)
        if inside != version:
            stale = inside
        else:
            shutil.copy2(apk, os.path.join(OUT, APK_NAME))
            apk_size = os.path.getsize(apk)
    else:
        published = os.path.join(OUT, APK_NAME)
        if os.path.exists(published):
            # Nothing new to publish: the channel keeps the APK it already had, and
            # reports the size of the bytes that are actually there.
            retained = True
            apk_size = os.path.getsize(published)
            inside = apk_version(published)
            if inside != version:
                stale = inside
    if stale is not None:
        # Refuse, rather than write a version.json that promises an update no phone
        # can tell from the one it already has.
        sys.stderr.write(
            "error    docs/%s carries %s, not %s (code %s) from the manifest.\n"
            "         The APK on this channel is the previous release's bytes.\n"
            "         Run apk-build/build.sh, then publish again.\n"
            % (APK_NAME, stale or "no readable version", version, code))
        return 1

    info = {
        "apk": version,
        "apkCode": code,
        # a bare filename: the app reads it relative to the update address, so
        # this channel works from Pages, raw.githubusercontent or a home server
        # without being rewritten for each
        "apkUrl": APK_NAME,
        "web": version,
        "webRev": rev,
        "apkSize": apk_size,
        "webSize": len(zip_bytes),
        "files": len(shipped),
        "updated": updated,
        "note": "Fixes to the interface arrive as a small download, no reinstall. "
                "Only a change to the app wrapper itself needs Android to install it.",
    }
    with open(os.path.join(OUT, "version.json"), "w", encoding="utf-8") as f:
        f.write(json.dumps(info, indent=2) + "\n")

    print("channel  %s" % (url or "(no Pages address yet)"))
    print("app      %s (code %d)" % (version, code))
    print("files    %d shipped (+%d static)" % (len(shipped), len(names) - len(shipped)))
    print("webRev   %s" % rev)
    print("web.zip  %d bytes" % len(zip_bytes))
    print("apk      %s" % (
        os.path.basename(apk) if apk
        else (APK_NAME + " (retained; no fresh build at the workspace root)" if retained
              else "none found — no APK has been published to this channel yet")))
    if retained:
        # The manifest decides what version.json advertises, so a bumped manifest
        # with no rebuild would pair a new number with an old binary. Say it loudly
        # rather than leaving it for a phone to discover.
        print("warning  docs/%s was not rebuilt in this run, so it is whatever the"
              " last build left there. version.json advertises %s (code %s) from the"
              " manifest: if the wrapper changed since that file was built, the two"
              " disagree — run apk-build/build.sh and publish again."
              % (APK_NAME, version, code))
    if moved:
        print("baked    DEFAULT_URL -> %s" % url)
    if not url:
        print("warning: no git remote yet, so the app has no baked-in address.")


if __name__ == "__main__":
    # sys.exit, not a bare call: `apk-build/build.sh` and `sync-github.sh` both
    # run this script, and a refusal that returns 0 reads to them as a publish
    # that succeeded.
    sys.exit(main())
