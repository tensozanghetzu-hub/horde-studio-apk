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


## GitHub update channel (set up in progress)

- Repo: the workspace itself is the git repo (`/home/user/.git`). `docs/` is what
  GitHub Pages publishes; `tools/build-channel.py` regenerates it from
  `horde-studio-mobile/`.
- `bash /home/user/sync-github.sh "message"` = rebuild channel + commit + push over SSH.
- Push key: `~/.ssh/id_ed25519` (ed25519). **`.ssh/` is git-ignored** and the sync script
  refuses to commit anything matching a key/cache/photo pattern. `~/.ssh` is NOT in the
  snapshot exclusion list, so it survives restarts — but re-`chmod 600` if ssh complains.
- The channel address is derived from `git remote get-url origin`
  (`git@github.com:u/r.git` -> `https://u.github.io/r/`), so it is written in one place.
  Override with `PAGES_URL=... python3 tools/build-channel.py`.
- `version.json` gained **`apkUrl`**; the app uses it for the APK and falls back to
  `<address>/app` when it is absent. GitHub cannot serve `/app`, hence the field.
- `webRev` in the GitHub channel is a **content hash** (12 hex of sha256 over the file
  manifest), not a timestamp — rebuilding with no changes produces no update offer.
  `apk-download/server.py` still uses mtime; harmless, it is the fallback channel.
- `tests/apkurl-test.js` — 8 assertions, pure node via `vm`, no browser needed
  (Playwright's browser lives in `.cache`, which is not durable). Run:
  `node /home/user/tests/apkurl-test.js`.
- `GITHUB-SETUP.md` is the user-facing 3-step sheet (SSH key + repo + Pages).
- Repo: **https://github.com/tensozanghetzu-hub/horde-studio-apk** (public), branch main,
  publishing `docs/`. Channel address https://tensozanghetzu-hub.github.io/horde-studio-apk/
  Immediate fallback with no Pages config:
  https://raw.githubusercontent.com/tensozanghetzu-hub/horde-studio-apk/main/docs/
- PUSHED. Pages itself is NOT enabled yet - only the user can flip it in repo Settings.
- **apkUrl is a bare filename**, resolved against the update address, so one channel
  works from Pages, raw.githubusercontent, a NAS or a home server.
- Current APK: HordeStudio-v1.4.7.apk, 228,071 B, sha256 ef2fa2233d493bf84e54b1a3cd266630
  a4591c986aeaec5d4a38d5642f11ea58, code 12. Dex-verified: all 9 bridge methods present.


## HAZARD: snapshots silently revert MainActivity.java

Found on 2026-09-14: a restore dropped `pickUpdateZip`, `openDownload`, `finishSwap`,
`revFromBundle`, REQ_UPDATE/updateJob and put `return "1.0.0"` back in `version()`. This
is the **third** time (v1.4.5, v1.4.7, and this session). The web sources were untouched.

- **The source tree is not evidence of what shipped.** Grep the compiled dex:
  `unzip -q -o HordeStudio-*.apk -d /tmp/x && grep -a -c pickUpdateZip /tmp/x/classes.dex`
- Recompile before rebuilding: `javac --release 8 -encoding UTF-8 -cp $SDK/android.jar`.
  `--release` and `-bootclasspath` cannot be combined.
- `finishSwap`/`revFromBundle` live on `NativeBridge`, so `onActivityResult` (an outer
  method) reaches them through the `bridge` field. Static methods are illegal in an
  inner class under Java 8.
- Other reverts seen this session: `tests/vendor/` came back empty (the Playwright browser
  was in `.cache`, which is excluded), and both servers were down. Probe, never assume.
