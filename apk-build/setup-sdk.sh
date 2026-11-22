#!/usr/bin/env bash
# Downloads just the pieces of the Android SDK needed to build the APK
# (cmdline-tools + platform 34 + build-tools 34). ~400 MB, run once.
set -euo pipefail

# Installs the SDK where build.sh will look for it: $ANDROID_SDK if set, else an
# existing /home/user/android-sdk, else $HOME/.local/android-sdk. The .local
# location is deliberate — it is excluded from the workspace snapshot and from
# git, and the ~400 MB download cache lands beside it in $HOME/.local/dl for the
# same reason. Nothing about the build changes; only where the bytes sit.
if [ -n "${ANDROID_SDK:-}" ]; then SDK="$ANDROID_SDK"
elif [ -d /home/user/android-sdk ]; then SDK=/home/user/android-sdk
else SDK="$HOME/.local/android-sdk"; fi
JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/jdk-11}"
CMDLINE_ZIP="commandlinetools-linux-9477386_latest.zip"   # v9.0 — works with JDK 11

mkdir -p "$SDK" "$(dirname "$SDK")/dl"
cd "$(dirname "$SDK")/dl"

if [ ! -f "$CMDLINE_ZIP" ]; then
  echo "==> downloading command line tools"
  curl -sSL -o "$CMDLINE_ZIP" "https://dl.google.com/android/repository/$CMDLINE_ZIP"
fi

echo "==> unpacking"
rm -rf "$SDK/cmdline-tools"
mkdir -p "$SDK/cmdline-tools"
unzip -q -o "$CMDLINE_ZIP" -d "$SDK/cmdline-tools"
if [ -d "$SDK/cmdline-tools/cmdline-tools" ]; then
  mv "$SDK/cmdline-tools/cmdline-tools" "$SDK/cmdline-tools/latest"
fi

export JAVA_HOME
echo "==> accepting licences"
yes | "$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" --licenses >/dev/null 2>&1 || true

# A workspace that has been snapshotted and restored can hold these directories
# with their large files gone — `build-tools/34.0.0` with nothing but a
# `renderscript` folder, `platforms/android-34` without `android.jar`. sdkmanager
# calls a half-present package "already installed" and, if it does not agree,
# installs the complete copy into a `34.0.0-2` sibling that build.sh never looks
# at. So: finish a half copy by moving the sibling into place, or clear it so the
# install below lands where it is read from.
for pair in "build-tools/34.0.0:aapt2" "platforms/android-34:android.jar"; do
  dir="$SDK/${pair%%:*}"; need="${pair##*:}"; alt="$dir-2"
  if [ ! -f "$dir/$need" ] && [ -f "$alt/$need" ]; then
    echo "==> completing ${pair%%:*} from its ${alt##*/} copy"
    ( cd "$SDK" && for f in "$alt"/*; do rm -rf "${dir}/${f##*/}"; mv "$f" "$dir/"; done; rmdir "$alt" )
  elif [ ! -f "$dir/$need" ] && [ -d "$dir" ]; then
    echo "==> dropping the incomplete ${pair%%:*} directory"
    rm -rf "$dir"
  fi
done

echo "==> installing platform 34 + build-tools 34"
"$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" \
  --install "platforms;android-34" "build-tools;34.0.0"

echo "==> sdk ready at $SDK"
