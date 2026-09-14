#!/usr/bin/env bash
# Downloads just the pieces of the Android SDK needed to build the APK
# (cmdline-tools + platform 34 + build-tools 34). ~400 MB, run once.
set -euo pipefail

SDK="${ANDROID_SDK:-/home/user/android-sdk}"
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

echo "==> installing platform 34 + build-tools 34"
"$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" \
  --install "platforms;android-34" "build-tools;34.0.0"

echo "==> sdk ready at $SDK"
