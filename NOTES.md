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
- Blocker: waiting on the user's GitHub username / repo name to set the remote.
