# Horde Studio — Mobile

Current build: `HordeStudio-v1.5.0.apk` (versionCode 17), sha256 b3ec66a373f328af8c8b22659d5afcc858452a606d59c304e7ba7e058e345f27 (277,659 B).
Channel `webRev c2812024342e`, 20 files, web.zip 157,639 B.

Published as a GitHub Release (see `.github/workflows/release.yml`); the app's updater
reads the channel in `docs/`, not the release.
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
- Current APK: **HordeStudio-v1.4.8.apk**, 228,071 B, sha256 a134739efb7a68179c37a549bc0b2c6fa882
  79a83890b51ac352075aedb02fb7, code 13. Dex-verified: all 10 bridge methods present.
- **THE 1.4.8 BUG (root-caused, fixed):** `jobStatus` embedded `j.result` via
  `jsonEscape()`, which replaces every `"` with `'`. `checkUpdate` puts the whole
  version.json body in `result`, so it arrived unparseable and the app reported
  "the server did not answer with a version file" - for EVERY server, always.
  Fixed by adding `jsonString()` (real escaping) and using it for message+result.
  `jsonEscape()` is kept only for the overlay revision, which nobody parses.
- `update.js` also grew `parseVersionFile()`, which repairs the mangled form, so
  already-installed builds work without a reinstall. Covered by 2 new assertions.


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


## CONFIRMED WORKING ON THE USER'S PHONE (2026-09-14)

- User installed 1.4.8 via the GitHub channel and reported "works perfect".
- **Check for update → Install app update → About shows 1.4.8**: verified end to end from
  a real device over GitHub Pages. The update channel is no longer theoretical.
- What this retires: the dead-sandbox 502, the hardcoded `1.0.0`, and the mangled
  version file. All three were reported by the user and all three are now closed.
- The phone is permanently on `https://tensozanghetzu-hub.github.io/horde-studio-apk/`.
  From here, shipping a fix is `bash /home/user/sync-github.sh "what changed"` and the
  user pressing Check for update. No reinstall, no address typing, no sandbox.
- Next session: probe before assuming. Servers (8000/8010) and the SDK do not survive a
  restart, and `dl/` reappears whenever `setup-sdk.sh` runs (it is gitignored now).


## APK visibility: GitHub Releases (2026-09-14)

- The user could not find the APK on the repo front page. It lives in `docs/`
  because **Pages publishes `docs/`**, and the updater resolves `apkUrl` against
  the channel address - so it cannot simply be moved without breaking updates.
- Instead: `.github/workflows/release.yml` publishes a GitHub Release on every
  push to main, using the built-in `GITHUB_TOKEN` (no PAT needed). Releases show
  in the front-page **Releases** box + "Latest" badge.
- Each release carries two assets, both the same file:
  - `HordeStudio-v<version>.apk`  (you can tell which version you downloaded)
  - `HordeStudio-latest.apk`      (permanent URL that never changes)
- Permanent direct download:
  `https://github.com/tensozanghetzu-hub/horde-studio-apk/releases/latest/download/HordeStudio-latest.apk`
- **sync-github.sh now also stages `.github/`** - it only adds named folders, so
  the workflow would never have reached the repo otherwise.
- Releases are for humans; `docs/` is for the app's updater. Do not point the
  updater at a release - the tag changes every version.


## World packs (v1.4.9)

- Upstream `world-packs/` = real OpenStreetMap places + walking routes. NOT a
  lorebook. Our "World" screen is a lorebook; the packs feed VH **places/travel**.
- `tools/build-worldpack.py` converts upstream -> `horde-studio-mobile/worlds/`:
  drops route geometry (maps only, 1.1 MB of 1.3 MB) and dedupes routes to one
  per pair. Result: 120 places + 918 routes = 70 KB.
- `js/worlds.js` = loader. `Worlds.minutes(pack,a,b)` uses a measured route when
  known, else haversine/80m-per-min x1.3 for detours.
- `apply()` is NON-DESTRUCTIVE on purpose: it keeps every existing place and
  appends the pack's. A test caught the first version, which kept only home/work
  and silently deleted anything the user had written.
- The pack is in `docs/` and the APK, but **excluded from web.zip** (SKIP_DIRS)
  so updates stay ~139 KB. Consequence: a pack cannot be delivered by a web
  update - it needs the APK, hence the bump to code 14.
- ODbL 1.0: attribution is carried in the pack and shown in the load dialog.

## The Horde context bug (v1.4.10)

Symptom the user reported: "no matter what I type, the response is always the
first message from the start of the conversation."

Not a history bug. `tests/history-test.js` proves all six turns of a
conversation reach the model, on both the chat-completions and Horde paths.

The cause was two caps that were never connected:

- `api.js` trimmed history past `CONTEXT_CAP` = 128,000 bytes (~32,000 tokens)
- `horde.js` requested `min(8192, promptTokens + maxLength + 64)`

A chat of ~40 roleplay turns produces ~9,772 tokens. The worker's window is
8,192, so ~1,580 tokens get truncated. A backend that keeps the head of the
prompt leaves the model reading the character sheet and the earliest turns, so
the answer is anchored to the start of the conversation - and stays there as the
chat grows, because the cut point barely moves.

Fix: `buildPrompt` takes a `budgetTokens` argument, and `generate()` passes
`HORDE_CTX_TOKENS - maxTokens - 64` (twice the reply room on a continuation
round). History is trimmed oldest-first down to that budget. `horde.js` reads
the same `API.HORDE_CTX_TOKENS` instead of its own literal 8192.

## HAZARD: `.git/config` is excluded from snapshots

The remote disappears after every turn boundary, so `sync-github.sh` fails with
"no remote yet" and `build-channel.py` prints "no Pages address yet". Re-add it
in the same command as the sync:

    git remote add origin git@github.com:tensozanghetzu-hub/horde-studio-apk.git

The baked-in `DEFAULT_URL` in `update.js` survives, because `build-channel.py`
only rewrites it when a remote is found - so the app never loses its address.

## HAZARD: the Android SDK does not survive a turn boundary

Snapshots are capped around 128 MB and the SDK is ~400 MB, so it is silently
dropped. Downloading it and building the APK have to happen in **one** command:

    bash apk-build/setup-sdk.sh && bash apk-build/build.sh

Otherwise the build dies at `aapt2: No such file or directory`.

## HAZARD: `newest_apk()` sorted by filename

`max(cands, key=lambda p: (os.path.basename(p), mtime))` picked `v1.4.9` over
`v1.4.10`, because "1.4.10" < "1.4.9" as text - so the OLD apk was copied into
docs/ for the update channel. Now compares a parsed version triple.

## Worlds, researched properly (v1.4.11)

Upstream "worlds" is TWO subsystems. The v1.4.9 pass shipped one of them and
called it worlds.

1. `world-packs/*.json` (schema v1) - real OSM geography. 120 places, 1836
   directed routes (== 918 undirected pairs; walking times are symmetric, so
   upstream's reverse edge carries the same minutes and deduping is lossless).
   Consumed by `vh2-geography-engine.js`, `vh2-travel-engine.js`,
   `vh2-npc-travel.js`.
2. `.horde_world` (format v2) - authored worlds. `vh-world-engine.js` (50 KB),
   `video-worlds.js` (112 KB). Policy Panic is 23 locations, 8 NPCs, 6 factions,
   15 lorebook entries, 14 relationships, gameRules/hudConfig/sandboxConfig,
   kernel + worldAgent (a turn-based DM loop). 2.5 MB, of which ~98% is base64
   art.

### What was actually wrong with the v1.4.9 geography port

- capabilities collapsed to one `kind`. Upstream gives `["food","leisure"]` to a
  cafe; ALL 120 places carry `leisure` and 94 also carry `food`. Every place had
  become single-purpose.
- `minutes()` only looked up direct pairs. 87% of pairs (6222 of 7140) have no
  direct route, so nearly every journey was a haversine guess. Now Dijkstra over
  the undirected route graph.
- no travel budget. Upstream has `maxTravelMinutes` (default 60).
- hours dropped. In truth only 2/120 places carry upstream's `hours` shape - the
  builder only sets it for `24/7` - but 36 places carry a real
  `sourceTags.opening_hours` string, which is now preserved and parsed.

One place (`SDFC Field`, osm:way/65014628) has degree 0: upstream could not snap
it to the walking network. It is unreachable by design and falls back to an
estimate.

### Authored-world scope decision

Ported: locations + exits + travelTime, entities, factions, relationships,
lorebook (keyword-triggered), startingLives with inventory, gameRules (stats,
currency, dice, module flags), hudConfig (clock, stats, timeStep), sandboxConfig
principles, dmPrompt/authorNote/intro.

Not ported: the DM kernel (`kernel`/`worldAgent`), NPC schedules, faction
reputation ledgers, seasons/growth, video. These need a host process and a
durable turn loop. `vh-world-engine.js` also depends on activity, plans, people,
transport, exploration and humanDynamics engines that do not exist here.

Art is stripped by key at any depth: `visuals`, `banner`, `mediaAssets`,
`_mediaManifest`, `presentation`, plus any `data:` string. 2.5 MB -> 50 KB.

### The referee tag protocol

The model ends its reply with `[[move:id]]`, `[[clock:+N]]`, `[[cash:+N]]`,
`[[stat:id:+N]]`, `[[item:x]]`, `[[drop:x]]`, `[[quest:x]]`, `[[quest-done:x]]`,
`[[roll:2d6+1]]`. Unknown tags are LEFT VISIBLE on purpose, so a typo shows up
instead of silently doing nothing.

### Storage

DB_VERSION 1 -> 2, adding `worlds` and `worldRuns` stores. The upgrade is
additive (createObjectStore guarded by `objectStoreNames.contains`), so existing
characters, sessions and messages survive.

## Personas (v1.5.0, 2026-09-14)

The app had exactly one player identity: `settings.userName` + `settings.userPersona`,
edited in Settings. Virtual humans already tracked bonds **per persona**
(`vhuman.js` `bonds{}`, keyed by the user's name) — that half existed since the
v18 port, but was unreachable, because there was only ever one of you. v1.5.0
makes personas a first-class thing.

User's two decisions (asked, not assumed): switcher in **both** places (a chip
bar on the Characters tab for switching, a full list in Settings for managing),
and each persona keeps **its own resumable thread** per character.

### The key design choice: swap in place, don't add a resolver

~25 call sites read `Store.settings.userName` / `userPersona` directly, across
`api.js`, `vhuman.js`, `views.js` and `app.js`. Introducing a `Store.who()`
resolver would have been cleaner on paper but meant touching all of them, on an
app I cannot test on a device.

Instead the **existing** fields always hold the *effective* identity, and
switching swaps them:

- `settings.userName` / `userPersona` — effective identity; every existing path
  keeps working untouched
- `settings.defaultName` / `defaultPersona` — the fallback, stashed when you
  leave the default and restored when you come back
- `settings.activePersona` — persona id, or `''` for the default

Zero call sites changed. `setIdentity()` routes Settings edits to the persona
record when one is active, else to the default pair.

### Migration: key on a schema number, not on `undefined`

First attempt checked `if (s.defaultName === undefined)` and **silently never
fired**, because `DEFAULTS` supplies `defaultName` — so `Object.assign` always
populates it and it is never undefined. Same trap with a `personaSchema: 1`
marker that lives in `DEFAULTS`.

The rule: **a migration marker must default to the un-migrated value (`0`), not
the migrated one.** `personaSchema: 0` in DEFAULTS; `init()` migrates when
`!== 1`. Existing installs keep `userName`/`userPersona` verbatim and gain
`defaultName`/`defaultPersona` as copies — behaviour is bit-identical.

### Session scoping without a schema change

Sessions gained one optional field, `personaId`, written at creation. Reads
filter with `(s.personaId || '') === active`, so pre-1.5.0 sessions (no field)
naturally belong to the default identity. **No compound index, no backfill, no
reindex** — deliberately, to keep the on-device upgrade failure surface at zero.

### Traps hit while building

- **`data-pdel` was already taken** by the virtual-human places editor in
  `Views.editor`. A blanket rename then renamed *that* too, creating the very
  collision being avoided. Persona attributes are now `data-persona-*`; the
  editor keeps `data-pdel`.
- **`build.sh` had `FINAL` hardcoded** to `v1.4.11`, so the 1.5.0 build silently
  overwrote the previous release. Now derived from the manifest.
- `allSessions()` (the Conversations tab) had to be scoped too, not just
  `getSessions()` — otherwise the tab leaked every persona's chats.
- Settings were never part of a backup (pre-existing). So a restore brings back
  personas and their chats but starts on the default identity; switching to a
  restored persona reveals its chats. Left as-is — importing settings would drag
  provider and key config across devices.

### Tests

`tests/persona-test.js` — 62 assertions over a fake IndexedDB: migration leaves
an existing install untouched, session scoping both ways, switching swaps what
every code path reads and round-trips without losing the default, Settings edits
land on the right record, deleting an inactive persona leaves you where you were
while deleting the active one falls back, backup/restore, wipe.

## v1.5.1 — authored-world compatibility repair (2026-09-19)

A third party supplied a written handoff (`uploads/Horde_Studio_1.5.0_Developer_Handoff.md`)
pinning baseline `49e16d0` — which is exactly the v1.5.0 commit pushed minutes
earlier, so the findings applied to live code. It described four defects, gave a
reference patch, and supplied a standalone VM regression test.

I did **not** blindly apply the patch. I verified each finding in source, wrote
the test first and reproduced the failures, then made the changes.

### The four reported defects

1. **World prompt never reached the model.** `App.worldTurn()` passes
   `HW.buildPrompt(...).system` as `character.systemPrompt`, but `buildChat()`
   and `buildPrompt()` read `settings.systemPrompt`. Every authored-world turn
   went out with the narrator rules, location, stats, inventory, tasks and lore
   missing. Fixed in both builders: `character.systemPrompt || s.systemPrompt`.
2. **Chat replies were appended twice.** `round()` accumulated streamed chunks
   into `full` via `onDelta`; `loop()` then cleaned the returned text and
   appended it again. One `[[cash:+10]]` settled as **+20**. Fixed with a
   separate `streamed` preview buffer; `full` is committed only in `loop()`.
   The non-streaming branch had the same fault (`onDelta(txt)` with the whole
   text) and is covered by the same fix.
3. **`stream: true` was hardcoded.** Only the response side honoured
   `settings.streaming`. Now derived from the setting.
4. **Backups omitted `worlds` / `worldRuns`** while Settings claimed otherwise.
   Added to export and import. Absent keys must never clear existing data, so
   import guards on `Array.isArray(...)` and only writes when non-empty.

### A fifth defect the handoff did not list

While checking #3 I found `streamChat()` chose its **parser** from
`s.streaming`, but its **request** could be forced to `stream: false` by an
override. `summarize()` (auto-memory) and `quickText()` (AI persona draft) both
force that override. With streaming **on** — the shipped default — their JSON
response was fed to the SSE parser and returned `''`.

So **auto-memory had never recorded anything** for a default user, and the
"AI draft" persona button did nothing. Fixed by deriving one `wantStream` value
and using it for both request and response.

This is why the new tests assert the `streaming: true` and `streaming: false`
cases separately: the bug only manifests when streaming is on.

### Service worker cache is part of the fix, not decoration

`sw.js` is **cache-first** (`return hit || net`). Without a new `CACHE` name a
phone keeps running the previous `api.js` / `store.js` from disk even after the
web channel has replaced the files. Bumped `horde-studio-v5` → `-v6`. Skip this
and the web-channel update silently does nothing.

### Verification

`tests/world-compatibility-regression-test.js` (15 checks, no dependencies, no
network). Run against a pristine `git archive` of the baseline:

| | baseline | patched |
|---|---:|---:|
| handoff's own 10 checks | 2 passed / 8 failed | 10 / 0 |
| full suite (incl. 5 added) | 4 passed / 11 failed | **15 / 0** |

The baseline figures match the handoff's stated 2/8 exactly, which is good
evidence the report was accurate. Existing suites unchanged afterwards:
hordeworld 76, persona 62, worldgraph 40, worldpack 18, apkurl 11, history 7,
hordectx 4 — 228 total, 0 failures.

### State at the end of this turn

Source, tests and changelog are done and versioned **1.5.1 / code 18**.
**Nothing was built, rebuilt, committed or published** — the handoff explicitly
withholds that permission, and `docs/` still serves 1.5.0. Publishing needs a
fresh `build.sh` + `build-channel.py` + push, and the user's go-ahead.
