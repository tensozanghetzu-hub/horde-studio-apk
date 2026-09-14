# Horde Studio — Mobile

Current build: `HordeStudio-v1.4.7.apk` (versionCode 12), sha256 896429f5ea6919be7ea22d97976076ddfe76619b11b864bb789456a46f0f55fd.
Permissions: INTERNET, ACCESS_NETWORK_STATE, REQUEST_INSTALL_PACKAGES (kept on purpose — it makes Play Protect warn; user accepts 'install anyway'), storage (maxSdk 28).

Rebuild: `cd apk-build && bash ./setup-sdk.sh && bash ./build.sh` (SDK is deleted after each build).
Download/update server: `python3 apk-download/server.py` → port 8010. `/app` = newest APK, `/version.json` + `/web.zip` = self-update (recomputed live from source).
Tests: `/tmp/smoke2/` (not durable) — `smoke.js` (24), `think-test.js` (19), `retry-test.js` (9).
Self-update test: `update-test.js` (26 checks, simulates the native bridge, real HTTP).
Layout tests need chromium: `layout.js` (bubble overflow), `overflow-audit.js` (every screen at 320/360/412 px), `md-test.js` (formatter).
Test scripts live in `/home/user/tests/` (durable). After a sandbox restart: `cd tests && npm i playwright-core`, `pip install playwright && python3 -m playwright install --with-deps chromium`.
Deps are vendored in `tests/vendor` (run with NODE_PATH=tests/vendor); chromium in ~/.cache does not survive a restart.
The sandbox ID changes on restart — `build.sh` re-bakes the update address from $E2B_SANDBOX_ID, and a stale one 502s.
Needs the static server on port 8000: `python3 -m http.server 8000 --bind 0.0.0.0 --directory /home/user/horde-studio-mobile`.
