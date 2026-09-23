#!/usr/bin/env bash
# Builds a signed, installable APK that wraps the Horde Studio web app.
# No Gradle, no Android Studio — just the SDK command line tools.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$ROOT/../horde-studio-mobile" && pwd)"
SDK="${ANDROID_SDK:-/home/user/android-sdk}"
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

if [ ! -f "$KEY" ]; then
  echo "==> creating signing key"
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

echo
echo "==> done: $FINAL"
ls -lh "$FINAL"
