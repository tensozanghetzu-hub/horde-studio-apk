#!/usr/bin/env bash
# Builds a signed, installable APK that wraps the Horde Studio web app.
# No Gradle, no Android Studio — just the SDK command line tools.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$ROOT/../horde-studio-mobile" && pwd)"
# Where the SDK lives, in order of precedence: an explicit $ANDROID_SDK, a
# pre-existing /home/user/android-sdk, then $HOME/.local/android-sdk — which is
# where setup-sdk.sh now installs it. It used to sit at /home/user/android-sdk,
# and that single directory was 117 MB and 9,700 files, i.e. almost the entire
# file budget of the workspace snapshot the agent relies on; .local/ is excluded
# from that snapshot (and is gitignored here), so the SDK stops crowding out the
# project while staying exactly where the build expects it.
if [ -n "${ANDROID_SDK:-}" ]; then SDK="$ANDROID_SDK"
elif [ -d /home/user/android-sdk ]; then SDK=/home/user/android-sdk
else SDK="$HOME/.local/android-sdk"; fi
BT="$SDK/build-tools/34.0.0"
PLAT="$SDK/platforms/android-34"
JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/jdk-11}"

AAPT2="$BT/aapt2"
D8="$BT/d8"
ZIPALIGN="$BT/zipalign"
APKSIGNER="$BT/apksigner"
KEYTOOL="$JAVA_HOME/bin/keytool"
JAVAC="$JAVA_HOME/bin/javac"

OUT="$ROOT/build"
KEY="$ROOT/horde-studio.keystore"
# Derived from the manifest, so bumping the version can never ship an APK
# under a stale filename (it used to overwrite the previous release).
APK_VERSION="$(grep -o 'android:versionName="[^"]*"' "$ROOT/AndroidManifest.xml" | head -1 | sed 's/.*="//;s/"//')"
FINAL="/home/user/HordeStudio-v${APK_VERSION}.apk"

# store.js and sw.js ship to the browser, where the manifest is not readable,
# so their version copies are stamped from it here. They used to be bumped by
# hand and store.js fell six releases behind — the About screen showed a number
# that matched no release. The script is idempotent; a stale copy cannot ship.
python3 "$ROOT/../tools/stamp-version.py"

echo "==> cleaning"
rm -rf "$OUT"
mkdir -p "$OUT/res-flat" "$OUT/obj" "$OUT/dex"

# The sandbox address changes whenever this workspace restarts, and a stale one
# answers 502 "sandbox was not found". Re-point the baked default at the sandbox
# we are standing in right now, so a fresh build always aims somewhere real.
if grep -q "https://8010-[a-z0-9]*\.e2b\.app" "$APP/js/update.js"; then
  # only while the channel is still this sandbox
  [ -n "${E2B_SANDBOX_ID:-}" ] && \
    sed -i "s|https://8010-[a-z0-9]*\\.e2b\\.app|https://8010-${E2B_SANDBOX_ID}.e2b.app|g" "$APP/js/update.js" && \
    echo "==> update address pointed at sandbox ${E2B_SANDBOX_ID}"
else
  echo "==> update address is the GitHub channel, not a sandbox - left alone"
fi

echo "==> copying web app into assets"
mkdir -p "$OUT/assets"
cp -r "$APP/index.html" "$APP/css" "$APP/js" "$APP/icons" "$OUT/assets/"
# world packs are static data: they ship in the APK, not in an update
[ -d "$APP/worlds" ] && cp -r "$APP/worlds" "$OUT/assets/worlds"
cp "$APP/manifest.webmanifest" "$OUT/assets/manifest.webmanifest"
cp "$APP/sw.js" "$OUT/assets/sw.js"
rm -f "$OUT/assets/icons/icon-source.png"
du -sh "$OUT/assets"

echo "==> compiling resources"
"$AAPT2" compile --dir "$ROOT/res" -o "$OUT/res.zip"
unzip -q -o "$OUT/res.zip" -d "$OUT/res-flat"

echo "==> linking APK (resources + manifest + assets)"
"$AAPT2" link \
  -I "$PLAT/android.jar" \
  --manifest "$ROOT/AndroidManifest.xml" \
  -A "$OUT/assets" \
  -o "$OUT/app-nodex.apk" \
  --min-sdk-version 24 \
  --target-sdk-version 34 \
  --auto-add-overlay \
  -R $(ls "$OUT"/res-flat/*.flat | tr '\n' ' ')

echo "==> compiling Java"
"$JAVAC" --release 8 -encoding UTF-8 -nowarn -cp "$PLAT/android.jar" \
  -d "$OUT/obj" "$ROOT/src/com/hordestudio/mobile/MainActivity.java"

echo "==> dexing"
"$D8" --lib "$PLAT/android.jar" --min-api 24 --output "$OUT/dex" \
  "$OUT/obj/com/hordestudio/mobile/"*.class

echo "==> adding classes.dex"
python3 - "$OUT" <<'PY'
import sys, zipfile, os
out = sys.argv[1]
apk = os.path.join(out, 'app-nodex.apk')
dex = os.path.join(out, 'dex', 'classes.dex')
assert os.path.exists(dex), 'classes.dex missing'
with zipfile.ZipFile(apk, 'a', zipfile.ZIP_DEFLATED) as z:
    if 'classes.dex' not in z.namelist():
        z.write(dex, 'classes.dex')
print('   dex size:', os.path.getsize(dex), 'bytes')
PY

echo "==> zipalign"
"$ZIPALIGN" -p -f 4 "$OUT/app-nodex.apk" "$OUT/app-aligned.apk"

# The signing key is no longer in git. It is the app's identity, and a public
# repo cannot keep one: anyone who could clone the repo could sign APKs that
# install over everybody's existing copy. So the file lives beside the build,
# is gitignored, and its only offline copy is keystore-backup/.
#
# This used to silently generate a fresh key when the file was missing. That was
# a trap, not a convenience: a new key means every existing install rejects the
# update for good, with an error that reads like a corrupt download. So it stops
# with instructions instead, and a new identity has to be asked for by name.
if [ ! -f "$KEY" ]; then
  if [ "${HS_ROTATE_KEY:-}" != "1" ]; then
    echo "ERROR: signing key missing: $KEY" >&2
    echo "       Restore it, do not regenerate it:" >&2
    echo "         base64 -d \"$ROOT/../keystore-backup/horde-studio.keystore.base64.txt\" > \"$KEY\"" >&2
    echo "       then check: sha256sum \"$KEY\"" >&2
    echo "       expected 735a6fdbffceb01e47d951faf57bf07cf03b37e454ffb2cf3598bdb14729dfc2" >&2
    echo "       Set HS_ROTATE_KEY=1 only to deliberately start a NEW signing" >&2
    echo "       identity, which breaks in-place upgrades on every old install." >&2
    exit 1
  fi
  echo "==> creating a NEW signing key (deliberate rotation — old installs will reject these builds)"
  rm -f "$KEY"
  "$KEYTOOL" -genkeypair -v -keystore "$KEY" -alias hordestudio -keyalg RSA -keysize 2048 \
    -validity 10950 -storepass hordestudio -keypass hordestudio \
    -dname "CN=Horde Studio Mobile, OU=Mobile, O=HordeStudio, L=Timisoara, ST=TM, C=RO" >/dev/null
fi

echo "==> signing"
"$APKSIGNER" sign --ks "$KEY" --ks-key-alias hordestudio \
  --ks-pass pass:hordestudio --key-pass pass:hordestudio \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
  --out "$OUT/app-signed.apk" "$OUT/app-aligned.apk"

echo "==> verifying"
"$APKSIGNER" verify --print-certs "$OUT/app-signed.apk" > "$OUT/verify.txt"
head -8 "$OUT/verify.txt"

# The identity of record. signing-identity.txt carries the certificate fingerprint
# this app is signed with; the APK just built has to agree. That catches the two
# ways a rotation goes wrong quietly: restoring the burned key out of habit, or
# generating a fresh one on a machine that lost the file. Both produce an APK no
# existing install will accept, and both look like a bad download from the phone.
IDENT="$ROOT/signing-identity.txt"
if [ -f "$IDENT" ]; then
  # sed, not grep: under `set -euo pipefail` a grep that matches nothing fails the
  # whole assignment and the script dies without printing a word. The guard must
  # never be the reason a build fails quietly.
  WANT_CERT="$(sed -n 's/^[[:space:]]*cert-sha256:[[:space:]]*//p' "$IDENT" | tr -d ' :' | tr 'A-Z' 'a-z' | sed -n 1p || true)"
  GOT_CERT="$(sed -n 's/.*certificate SHA-256 digest:[[:space:]]*//p' "$OUT/verify.txt" | tr -d ' ' | sed -n 1p || true)"
  if [ -z "$GOT_CERT" ]; then
    echo "ERROR: cannot read a certificate digest out of $OUT/verify.txt" >&2
    echo "       refusing to guess; look at the apksigner output above" >&2
    exit 1
  fi
  if [ -z "$WANT_CERT" ]; then
    echo "ERROR: $IDENT has no parsable cert-sha256 line" >&2
    exit 1
  fi
  if [ "$GOT_CERT" != "$WANT_CERT" ]; then
    if [ "${HS_ALLOW_OTHER_KEY:-}" = "1" ]; then
      echo "   WARNING: signed with $GOT_CERT, not the identity of record ($WANT_CERT)"
      echo "   WARNING: deliberate override in effect — these builds will not update old installs"
    else
      echo "ERROR: this APK is not signed by the recorded identity" >&2
      echo "       APK certificate:  $GOT_CERT" >&2
      echo "       $IDENT says: $WANT_CERT" >&2
      echo "       If the key was restored from a backup, that backup is the burned one:" >&2
      echo "         ls \"$ROOT/../keystore-backup/\" and use the LIVE copy" >&2
      echo "       If you meant to rotate, update $IDENT and re-run." >&2
      echo "       HS_ALLOW_OTHER_KEY=1 builds anyway (only for a deliberate, recorded rotation)." >&2
      exit 1
    fi
  else
    echo "   signing identity matches $IDENT"
  fi
else
  echo "   note: no $IDENT to compare against — every release should have one"
fi
"$AAPT2" dump badging "$OUT/app-signed.apk" > "$OUT/badging.txt"
head -6 "$OUT/badging.txt"

cp "$OUT/app-signed.apk" "$FINAL"

echo "==> building the web-only update bundle"
VERSION="$(grep -o 'android:versionName="[^"]*"' "$ROOT/AndroidManifest.xml" | head -1 | sed 's/.*="//;s/"//')"
VERCODE="$(grep -o 'android:versionCode="[^"]*"' "$ROOT/AndroidManifest.xml" | head -1 | sed 's/.*="//;s/"//')"
# any change to a source file bumps the revision, so the phone can tell "newer"
WEBREV="$(cd "$APP" && find index.html css js icons manifest.webmanifest sw.js -type f -printf '%T@\n' 2>/dev/null | sort -n | tail -1 | cut -d. -f1)"

python3 - "$APP" "$ROOT/.." "$FINAL" "$VERSION" "$VERCODE" "$WEBREV" <<'PYEOF'
import json, os, sys, time, zipfile
app, home, apk, version, vercode, webrev = sys.argv[1:7]

names = []
for root_part in ('index.html', 'manifest.webmanifest', 'sw.js'):
    p = os.path.join(app, root_part)
    if os.path.exists(p): names.append(root_part)
for sub in ('css', 'js', 'icons'):
    d = os.path.join(app, sub)
    if not os.path.isdir(d): continue
    for dirpath, _, files in os.walk(d):
        for f in files:
            rel = os.path.relpath(os.path.join(dirpath, f), app)
            if rel == os.path.join('icons', 'icon-source.png'): continue
            names.append(rel)

zpath = os.path.join(home, 'horde-studio-web.zip')
if os.path.exists(zpath): os.remove(zpath)
with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED) as z:
    for rel in sorted(names):
        z.write(os.path.join(app, rel), rel)
    z.writestr('version.json', json.dumps({
        'apk': version, 'apkCode': int(vercode), 'web': version,
        'webRev': int(webrev),
        'updated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(int(webrev))),
    }, indent=2) + chr(10))
print('   web bundle:', len(names), 'files,', os.path.getsize(zpath), 'bytes')

info = {
    'apk': version,
    'apkCode': int(vercode),
    'web': version,
    'webRev': int(webrev),
    'apkSize': os.path.getsize(apk),
    'webSize': os.path.getsize(zpath),
    'updated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    'note': 'Fixes to the interface arrive as a small download — no reinstall.'
}
vpath = os.path.join(home, 'horde-studio-version.json')
with open(vpath, 'w') as f:
    json.dump(info, f, indent=2)
    f.write('\n')
print('   version.json: web', version, 'rev', webrev)
PYEOF

# Keep exactly one root APK. Every version is permanently available from its
# GitHub release, so older local builds are scratch - they used to stack up
# one per release until someone noticed a pile of fifteen.
for old in /home/user/HordeStudio-v*.apk; do
  [ -e "$old" ] || continue
  [ "$old" = "$FINAL" ] && continue
  rm -f "$old"
done

echo
echo "==> done: $FINAL"
ls -lh "$FINAL"
