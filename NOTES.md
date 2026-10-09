# Horde Studio — Mobile

Current build: `HordeStudio-v1.18.0.apk` (versionCode 41) — size/sha256
in the v1.18.0 entry. Built 2026-10-09, not yet synced:
`docs/` serves v1.17.0 (webRev `fdeda4a596d7`) and release `v1.17.0`
is the latest on the repo.

Published as a GitHub Release (see `.github/workflows/release.yml`); the app's updater
reads the channel in `docs/`, not the release.
Permissions: INTERNET, ACCESS_NETWORK_STATE, REQUEST_INSTALL_PACKAGES (kept on purpose — it makes Play Protect warn; user accepts 'install anyway'), storage (maxSdk 28).

Rebuild: `cd apk-build && bash ./setup-sdk.sh && bash ./build.sh` — the SDK
does not survive a turn boundary (see the HAZARD below), so setup + build must
run as one command.
Tests: 17 node-runnable suites in `/home/user/tests/`, one file per fix —
`node /home/user/tests/<suite>-test.js` (v1.10.0: 422 checks in total).
Self-update test: `update-test.js` (29 checks, simulates the native bridge, real HTTP)
and `typing-test.js` — the two Playwright suites, the only ones that need a browser.
Test scripts live in `/home/user/tests/` (durable). After a sandbox restart: `cd tests && npm i playwright-core`, `pip install playwright && python3 -m playwright install --with-deps chromium`.
Deps are vendored in `tests/vendor` (run with NODE_PATH=tests/vendor); chromium in ~/.cache does not survive a restart.
The sandbox ID changes on restart — `build.sh` re-bakes the update address from $E2B_SANDBOX_ID, and a stale one 502s.
Needs the static server on port 8000: `python3 -m http.server 8000 --bind 0.0.0.0 --directory /home/user/horde-studio-mobile`.


## GitHub update channel

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
- `tests/apkurl-test.js` — 8 assertions, pure node via `vm`, no browser needed
  (Playwright's browser lives in `.cache`, which is not durable). Run:
  `node /home/user/tests/apkurl-test.js`.
- `GITHUB-SETUP.md` is the user-facing 3-step sheet (SSH key + repo + Pages).
- Repo: **https://github.com/tensozanghetzu-hub/horde-studio-apk** (public), branch main,
  publishing `docs/`. Channel address https://tensozanghetzu-hub.github.io/horde-studio-apk/
  Immediate fallback with no Pages config:
  https://raw.githubusercontent.com/tensozanghetzu-hub/horde-studio-apk/main/docs/
- PUSHED. Pages is enabled and has served the channel since v1.5.1 (verified
  after each release).
- **apkUrl is a bare filename**, resolved against the update address, so one
  channel works from Pages, raw.githubusercontent, a NAS or a home server.
- At setup (2026-09-14) the current APK was **HordeStudio-v1.4.8.apk**,
  228,071 B, sha256 a134739efb7a68179c37a549bc0b2c6fa882
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
- Next session: probe before assuming. The layout-test server (8000) and the SDK do not survive a
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

A third party supplied a written handoff (`uploads/Horde_Studio_1.5.0_Developer_Handoff.md`,
removed in the 2026-09-23 workspace cleanup — the findings below are the record)
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
hordectx 4 — 218 total, 0 failures (originally noted as 228, which
double-counted the handoff's own 10 checks; v1.5.2's 257 = 218 + 15 + 24
confirms the 218 base).

### Published

Done in two steps, as the handoff required. The first turn stopped at source
only — no build, commit or push — because the handoff withholds that
permission until it is asked for. The user then approved it explicitly.

`49e16d0..7fc1467` — **v1.5.1 / code 18**, `HordeStudio-v1.5.1.apk`,
277,659 B, sha256 `0de0a87d73456a15ba4763e4edfc92b1a8ffb5d05e0aa6264b19c29ec89bb398`.
Channel `webRev f58a67a46396`, web.zip 158,417 B, 20 files.

Verified after publishing: Pages serves 1.5.1; the served `sw.js` carries
`horde-studio-v6`, `api.js` carries `wantStream`, `store.js` carries the worlds
export; release `v1.5.1` holds both APK assets; the downloaded APK is
byte-identical to the local build.

Coincidence worth noting, since size alone is used as a quick identity check
elsewhere: 1.5.0 and 1.5.1 are both exactly 277,659 B. **Do not identify a
build by size** — check the sha256.

---

## v1.5.2 — collapsible world HUD (2026-09-19)

### The report

A player imported an FF14-style world ("The Unwritten Adventurer"). Its
character sheet carries ~70 stat lines (25 jobs × level/XP, gauges, gil,
gear). On the world-run screen the HUD is `position:sticky; top:0` with
`flex-wrap` and no height cap, so it rendered as a block roughly four phone
screens tall. The "What do you do?" input sits *below* the HUD in the DOM;
with the HUD eating the whole viewport it was unreachable. The player
confirmed the scroll hard-stops at the sheet's last line — on their device
the page simply does not scroll past it, so no amount of swiping reaches
the input. They were unable to play at all.

### The fix (two parts)

1. **The sheet folds.** `Views.worldHud` (js/views.js) now renders a
   permanent one-line summary — place, world clock + turn, purse, open
   tasks — and, when the world defines more than six stats, moves the stats
   and inventory into a `.wr-hud-more` block that is hidden by default,
   behind a `sheet (n)` / `hide sheet` toggle. `Views.bindWorldHud` flips
   the block in place (no re-render, so the last-turn change chips survive).
   Small worlds (≤6 stats) render flat, exactly as before. The open/closed
   state persists across per-turn re-renders.
2. **The input can never be buried again.** `.wr-hud` is capped at
   `max-height:45vh` with internal scrolling (css/app.css). Even fully
   expanded, the HUD can cover at most 45% of the viewport; the thread and
   the composer always have the rest. On the player's screen no scrolling
   is needed at all to reach the input.

`sw.js` cache bumped `horde-studio-v6` → `horde-studio-v7` — the worker is
cache-first (`return hit || net`), so a SHELL change without a new cache
name would silently no-op on phones that already ran the previous web
bundle.

### Verification

New suite `tests/worldhud-test.js` (24 checks, zero dependencies, real
`hordeworld.js` + real `views.js` in a VM with a stubbed UI/Store/document,
fake HUD element for the toggle binding):

- 7-stat sheet folds by default; summary carries place/clock/turn/purse/tasks
- toggle label and `hidden` state flip correctly, in place, no re-render
- state survives a re-render; re-binding on a fresh element does not
  double-flip
- ≤6-stat sheet stays flat with no toggle
- change chips render outside the fold

Full suite after the change: **257 passed, 0 failed** — hordeworld 76,
persona 62, worldgraph 40, worldpack 18, apkurl 11, history 7, hordectx 4,
world-compat 15, worldhud 24. `node --check` clean on every js file and
sw.js. The 45vh cap is layout and is confirmed on device, not in the VM.

Not covered here: on-device confirmation on the POCO X3 Pro (the screen that
failed), and a live-provider turn. The player's existing run (turn 0) is
untouched — the fix is purely presentational; the web-channel update
applies it without an APK reinstall.

### Published

`7509322..dad35aa` — **v1.5.2 / code 19**, `HordeStudio-v1.5.2.apk`,
277,659 B, sha256 `ead9412a51408a998db7ffb87ccbb7341556c7ec0e8b1c32cf155a296aaabd03`.
Channel `webRev 71f2b00cca9e`, web.zip 159,032 B, 20 files. Release `v1.5.2`
holds both APK assets.

Verified after publishing: Pages serves 1.5.2; the served `sw.js` carries
`horde-studio-v7`, `views.js` carries the fold markers, `app.css` carries the
45vh cap; all key files 200. The downloaded release APK is byte-identical to
the local build (first download attempt raced the asset upload and returned
empty — retry confirmed the hash). A third 277,659 B APK in the row: the
sha256 remains the only identity.

---

## Upstream review — 18.3 "Worlds release" (2026-10-08)

Checked at the user's ask (after the v1.16.0 publish): 18.3
(`10fcf10`, 1 commit, 63 files, +3865/−428, released Oct 8) reworks the
desktop Worlds engine around explicit turn context (`worlds/turn-context.js`
+84) and a `scene_draft_v2` JSON scene-draft transport
(`worlds/scene-draft.js` +351), action-resolution and outcome validation
against the world ledger (`worldActionResolutionFailures`,
`worldFinalNarrativeConflicts`, `settleWorldCheckStateOutcome`,
`canonicalizeWorldCheckNarrativeOutcomes`), committed state, a new
"Correct world state…" dialog, NPC-knowledge conditional search, and
receipt rescue / re-prompting when the model's `commit_world_turn`
tool call is incomplete or malformed (including "provider
function-call channel failed → return plain JSON"). Plus: desktop VH2
workspace (full-backup ZIP packing incl. media, vh2 message
projection/dedupe/protocol-leak repair, ComfyUI reference planning
"fit" vs "all"), VH card menu UI, life-seed made opt-in,
companion-thread scroll anchoring (double-rAF + scrollRevision), and
~25 scratch audit scripts.

**Port decision: nothing to port** (consistent with 18.2.0/18.2.1).
The mobile port has no world engine to apply this to: mobile Worlds =
curated static context files (`worlds/*.json` → "Relevant world facts"
in the prompt) — no ledger, no receipts, no checks, no
location/inventory state, no tool calls. The "narrated actions match
the world ledger" rework has no target here; porting it means building
the whole ledger system first (a v1.13-class feature, not a backport).
The "recovery when a model response is incomplete" machinery is bound
to the receipt contract (rescue, re-prompt and the "DM is
reconciling…" status labels are all world-DM turns); the generic parts
the mobile app needs already exist (autoFinish on truncation, Horde
empty-retry, state-extraction salvage, provider diagnostics from the
18.2.0 mapping). No ComfyUI/VH2 media to port (declined feature; the
mobile VH has no media pipeline). The release note's "tighten mobile
navigation" items are the VH workspace card menu and companion-thread
scroll fix — neither surface exists in the mobile port (mobile thread
scroll is separate code; the known restore-sign bug is a sign flip
18.3 doesn't touch). `worlds/model-client.js`'
provider_error/empty_completion split: already present in mobile
equivalent paths.

---

## Upstream review — 18.2.1 "Freaky Frankenstein 5.4" (2026-09-30)

Checked upstream after the v1.12.0 publish: 18.2.1 (`f63fee2`, 1 commit,
11 files, released Sep 30) is a single-purpose compatibility release —
dptgreg's third-party **Freaky Frankenstein 5.4 Internal States**
SillyTavern preset (+ FF5 Regex 3.0) added to the desktop's preset system:
preset selector in Character Chat, its SillyTavern variables,
history-depth modules, internal-state continuity, collapsible state
panels, dialogue styling and graphics; in World Play only compatible
preset modules run while Horde's canonical clock/rules/inventory/quests/
NPC state stay authoritative (incompatibles marked in Fine-Tune and
excluded from context estimates); Virtual Humans excluded by design.

**Port decision: nothing to port.** The mobile build has no preset /
modular-prompt subsystem — the character carries a plain `systemPrompt`,
macros are the fixed seven ({{char}}/{{user}}/{{name}}/{{personality}}/
{{description}}/{{scenario}}/{{persona}}), context is a single message
count, and worlds carry only Horde's own canonical `gameRules.modules`.
The two clauses that map to existing mobile behavior are already satisfied
by construction: canonical state stays authoritative in worlds, and the VH
prompt has no preset slot at all. Bundling the preset would also mean
redistributing third-party content (upstream records the author's archive
+ source sha256 in THIRD_PARTY_NOTICES), and the upstream README steers
the full FF default toward ~32k-context models with ~4k output — beyond
the phone build's Horde budget (maxTokens ≤ 2048, context ≤ 120
messages). 18.2.1 carries no bug fixes, so there is no parity urgency.

The *idea* was built natively as **v1.13.0** — see that entry: per-
character internal state (mood/intent/flags), a hidden `<state>` block
the model updates every reply, a collapsible strip at the top of the
chat, off by default, VHs excluded. No third-party content.

---

## v1.18.0 — Worlds: checks with real consequences (2026-10-09)

### The ask

"Stage 2" — the second stage of `WORLDSCOPE.md`: checks with real
consequences. Design per the scope: `[[roll:SPEC:check:NAME]]`, DC and
typed branches defined **on the world** (the model never writes
outcomes — upstream's core principle, "the engine derives the outcome
from applied state changes"), seeded dice, engine-applied branches,
HUD receipt, fail-safes.

### The change

- `js/hordeworld.js`:
  - **Seeded dice** — `imul32` + `nextRand(run)` (mulberry32); the seed
    is created in `start()` (`run.seed`) and persists with the run;
    old runs without a seed start from a constant. `roll()` takes an
    optional `rnd()` (defaults to `Math.random` for other callers), so
    plain rolls and checks roll the same seeded sequence. Same seed +
    same roll order → same outcomes, reproducibly (the battery
    relies on it).
  - **`parseCheckRequest`** — `"1d20:check:DEX"` → `{spec, name}`; a
    plain spec → null. On an opted-out world the whole tag is just an
    unparsable roll spec and is silently dropped, exactly as before.
  - **`checkDef(world, name)`** — worlds declare checks in
    `gameRules.checks` (`{stat, name, dc, on_success, on_failure}`);
    lookup by name or stat, case-insensitive.
  - **Branch vocabulary** — `parseBranchEffects` / `effectSummary` /
    `applyCheckEffects`: stats `{id:delta}`, cash, items, quests,
    clock minutes. World-authored data, trusted and applied by the
    engine; unknown keys ignored (the "malformed branch" clause of the
    scope loses its referent — the model can't author branches).
  - **`applyTags`** — a `roll` tag with a `:check:` suffix is recorded
    in `applied.checkRequests` (stripped, NOT rolled, nothing applied);
    malformed spec → rejection at parse time. Plain rolls now roll on
    the run's seeded generator.
  - **`resolveChecks(world, run, applied)`** — runs once per turn, in
    `finishTurn`, AFTER commit (so the verdict lands in the log right
    after the referee's line, and a repaired turn rolls exactly once):
    rolls each unique request (deduped by name), compares to the DC,
    applies the matching branch, pushes a `role: 'check'` log entry
    ("Dexterity check: 1d20 → 14 vs DC 10 — success (NERVE +1)").
    Unknown check name → dice still shown + rejection; malformed spec
    → rejection only.
  - **`buildPrompt`** — v2 worlds with checks are told: each check's
    name, DC and both branches' consequences (capped 10), the request
    format, and "never narrate or guess a check outcome, and request
    each check at most once per reply".
  - The `check` log role is kept as-is by the engine; the API layer
    already maps any non-user role to assistant (OpenAI path) or the
    referee name (Horde path), so no api.js change.
- `js/app.js` — `finishTurn` calls `resolveChecks` after commit,
  appends its rejections to the run's capped list, and renders the
  merged HUD object (changes + rejections + checks).
- `js/views.js` — `worldBubble` renders `check` entries as a compact
  centered verdict line, tinted green (success) / amber (failure);
  `worldHud` renders check chips (`DEX 14 vs 10 ✓`) under the change
  chips.
- `css/app.css` — `.wr-check-line.ok/.fail`, `.wr-check-chip.ok/.fail`.
- The bundled *Policy Panic* shipped with a small authored set of five
  checks (Nerve DC 10, Insight DC 11, Charm DC 11, Performance DC 12,
  Reputation DC 12 — branches using its own stats and dollars), added
  at the user's "publish with" — it was the first check-carrying
  world in the port; check-less worlds (and `ledgerV2:false` ones)
  play byte-identical to v1.17.0.

### Tests

`tests/hordeworld-test.js` 136 → **275** (+139): seeded determinism
(same seed → same dice, both across runs and across full
apply/commit/resolve sequences; different seed differs), request
parsing (stripped, recorded, nothing rolled early), the
total-vs-DC invariant over 25 fixed seeds with each seed asserting the
*matching* branch is the only one applied (and nothing else moved —
inventory/cash/quests/minutes), the guaranteed-success (dc 1) and
guaranteed-failure (dc 21) branches exercising the full effect
vocabulary, once-per-reply dedupe, unknown-check (dice shown +
rejection, nothing applied), malformed spec, opt-out legacy behaviour,
prompt contents (names, DCs, both branches, request format, the
never-narrate rule, absent for check-less worlds), and the verdict in
the next turn's context. Full battery: 25 node suites / **778 checks,
0 failing** (the two Playwright suites still need a browser).

### Ship state (this segment)

Bumped 1.18.0 / code 41 / sw v29. Built
`HordeStudio-v1.18.0.apk` (310,427 B — the pre-check build was the same
size, so the sha256 is the identity:
ba922f548980804fa8a3702de832247e15420b1266c7350e8f70d2dbfd46cec3 —
same keystore, in-place upgrade from code 40) and
in-APK verified:
`resolveChecks` + `nextRand` + `checkDef` in hordeworld.js,
`resolveChecks` call in app.js, `wr-check-line` / `wr-check-chip` in
views.js + css, the five checks in the bundled policy-panic world
file, sw v29, VERSION 1.18.0. Superseded v1.17.0 root APK
removed. Committed locally. Publish only on explicit ask.

---

## v1.17.0 — Worlds: the ledger stops lying (2026-10-09)

### The ask

"Scope the worlds idea" → scope written in `WORLDSCOPE.md` (4 stages) →
"Start building stage 1 first". Stage 1 from the scope: validate every
referee tag against the world, show refusals, one bounded repair
round, a Correct-world-state screen. (Decision points in the scope doc
resolved by default: 1.x numbering, v2-on by default with per-world
opt-out, no items/quests registries exist in the bundled pack so those
validations are naturally no-ops there, repair always on.)

### The change

- `js/hordeworld.js`:
  - `ledgerV2(world)` — `world.ledgerV2 !== false` (opt-out for world
    files); `reachable(world, run, target)` — one-move reachability
    through the exit graph, lenient when the current place defines no
    exits (sketchy maps); `statBound(world)` — `gameRules.statBound`,
    default ±100; `itemNames(world)` / `questRegistry(world)` — null
    when the world declares no list (free-form, as before).
  - `applyTags` now refuses, per tag: unknown places; one-move
    teleports; cash/stat changes beyond the bound; items not in the
    world's list (and duplicates); dropping what you don't carry;
    tasks the world doesn't know / finishing tasks that aren't open;
    malformed rolls; non-numeric clock/cash/stat values. Every refusal
    is dropped from the text AND reported in `applied.rejections`
    `{tag, reason}`. Legacy (`ledgerV2:false`) path is byte-identical
    to the old behaviour.
  - `commit` — idempotent on the player's line (the app pushes the
    user message optimistically before the request; commit no longer
    duplicates it — fixes a long-standing bug where every world turn
    logged the player line twice, doubling bubbles and wasting prompt
    context), and records `applied.rejections` on the run (capped 50).
  - `correctState(world, run, corr)` — player-side ledger edits:
    location (any — corrections force), cash, per-stat values,
    inventory add/remove, task add/finish; returns the change list,
    keeps an audit trail in `run.corrections`.
  - `buildPrompt` — v2 worlds are told their tags will be checked and
    the bound; the item/task lists are named (capped 25/20);
    `role: 'correction'` log entries are filtered out of the referee's
    message context (the corrected state itself is in the system
    prompt).
- `js/app.js` `App.worldTurn` — when the applied turn has rejections
  (and the world is v2), ONE repair round: the model gets its own
  reply back plus the rejection reasons ("keep the same story beats,
  fix the tags"), with the system prompt rebuilt so partially applied
  (valid) changes are visible. Repair fails or comes back empty → the
  first reply stands, refusals stay on record. `App.go` branch
  `worldcorrect` + back arrow.
- `js/views.js` — HUD head gains a **correct state** pill (own class
  `wr-correct-btn`; the worldhud suite asserts small sheets carry no
  `wr-hud-toggle`, so it does not reuse that class); refused changes
  render under the change chips with reasons (`applied` object is now
  the third arg to `worldRun`/`worldHud`, arrays still accepted);
  `worldBubble` renders `correction` entries as a centered ledger note;
  new `Views.worldCorrect` screen: place (with reachability hint /
  "will be forced"), purse + per-stat number inputs, pockets chips
  with remove + add, tasks with Done + add; save loops one
  `correctState` call per change, logs `State corrected: …`, re-renders
  the run with the chips.
- `index.html` — `data-screen="worldcorrect"` section.
- `css/app.css` — `.wr-rej` (amber warning lines), `.wr-note` (dashed
  ledger note), `.wr-correct-btn`, `.wc-*` (correction screen).
- The tag FORMAT is unchanged — existing runs and worlds load and play
  exactly as before; validation is per-world and non-fatal (a run can
  never get stuck: refusals log, prose is kept, the turn completes).

### Tests

`tests/hordeworld-test.js` 76 → **136** (60 new): reachability
(real-world teleport refused with reason, no-exit leniency, id + name
fallbacks, same-place moves), bounds (±statBound, default 100,
malformed values), items (registry membership, canonical names,
duplicates, drop-what-you-don't-carry, free-form without a registry,
opt-out), tasks (known/unknown, ghost finishes, free-form), rolls
(malformed refused v2 / silently dropped legacy, valid still rolls),
rejection bookkeeping (recorded on the run, capped 50, turn-numbered),
commit idempotency (optimistic push not duplicated; fresh commit still
logs both sides), `correctState` (every mutation + empty + audit
trail), prompt (rules line v2-only, item/task lists, correction notes
excluded from context). One regression caught and fixed during the
segment: the correction button initially reused the `wr-hud-toggle`
class, which the worldhud suite pins to the sheet fold only — own
class added. Full battery: 25 node suites / **639 checks, 0 failing**
(the two Playwright suites still need a browser).

### Ship state (this segment)

Bumped 1.17.0 / code 40 / sw v28. Built
`HordeStudio-v1.17.0.apk` (306,331 B; sha256
92b9b372579c2a13cc31b533cbc9a6a2acfa5ef4e2d13d6e77ee86fba79350d1 is
the identity — same keystore, in-place upgrade from code 39) and
in-APK verified:
`ledgerV2` + `correctState` + rejection code in hordeworld.js,
`repairOnce` + `worldcorrect` branch in app.js, `Views.worldCorrect`
+ `wr-rej` markup in views.js, `worldcorrect` section in index.html,
sw v28, VERSION 1.17.0. Superseded v1.16.0 root APK removed. Committed
locally. Publish only on explicit ask.

---

## v1.16.0 — the default system prompt speaks the RP formatting language (2026-10-06)

### The ask

While roleplaying, the user noticed the model reads `"she is so
beautiful"` (quoted) as spoken dialogue and bare `she is so beautiful`
as a thought — and asked for a specific "quotation" for thoughts.
Answer (RP convention, not app behaviour): double quotes = speech,
**asterisk italics** = thoughts/actions. The user then asked for the
convention to be added to the default system prompt so the model
follows it consistently instead of guessing each time.

### The change

- `store.js`: `DEFAULT_SYSTEM` gains one sentence — "Use double quotes
  for spoken dialogue and asterisk italics (*like this*) for thoughts
  and actions." — placed after the style sentence. The pre-1.16.0 text
  is kept verbatim as `LEGACY_SYSTEM`.
- `store.js` `init()`: one-time migration, same pattern as the
  personaSchema migration — if the saved `systemPrompt` is
  **byte-identical** to `LEGACY_SYSTEM` (never edited), it is replaced
  with the new default and persisted. Any edit, even one character,
  leaves the user's prompt completely untouched.
- `store.js`: `Store.defaultSystem` exported.
- `views.js`: **Reset to default** now sets `Store.defaultSystem`
  instead of a hardcoded copy — which had gone stale (predated the
  formatting line AND the prompt's closing "write only what the
  character does and says" sentence). Duplication eliminated.
- The display side needed no change: `md()` in ui.js already renders
  `*text*` as italics, so model thoughts show italicised with no
  literal asterisks on screen. The prompt field is a plain textarea
  (escaped text), so the asterisks in the default render literally
  where the user edits them.

### Tests

New suite `tests/sysprompt-test.js` (9 checks, fake-IDB harness in the
persona-test mould): fresh install gets the line; legacy-default
install is upgraded in memory AND persisted; one-char-edit and fully
custom prompts are byte-identical after init; `Store.defaultSystem`
export matches. Full battery: 25 node suites / 579 checks, 0 failing
(the two Playwright suites — update, typing — still need a browser and
don't run in this sandbox).

### Ship state (this segment)

Bumped 1.16.0 / code 39 / sw v27. Built
`HordeStudio-v1.16.0.apk` (302,235 B; sha256
728d13a3fe4042dbcd6be7adcfb2ae4b3498d89c6108963870fc6ba7e14d1658 is
the identity — same keystore, in-place upgrade from code 38) and
in-APK verified:
`DEFAULT_SYSTEM` with the line + `LEGACY_SYSTEM` + migration +
`defaultSystem` export in store.js, `Store.defaultSystem` in the
views.js reset handler, sw v27, VERSION 1.16.0. Superseded
v1.15.0 root APK removed after build. Committed locally. Publish
(push + release + channel) only on explicit ask.

---

## v1.15.0 — settings menu overhaul: personas and section screens (2026-10-04/06)

### The report

Two requests, one overhaul. First: "In settings, with each persona
added, the settings menu gets longer. Can you create a button for
Personas that opens its dedicated menu, in which you can manage your
personas? The button should stay in settings." Then, on the same
theme: "Do the same for the other ones. Connections, Generation,
System prompt, AI Horde · images &amp; free text, Memory, Data,
Storage."

Built in two local segments (persona screen, then the hub). The first
was never published on its own, so this single release ships both and
the published series goes 1.14.0 → 1.15.0. (Originally versioned as
1.15.0 + 1.16.0; renumbered at the user's suggestion before the
publish ask, because shipping the hub as 1.16.0 would have left a
hole in the published series for the unpublished persona screen.)

### The change

Part 1 — the persona screen:

- `index.html`: new `<section data-screen="personas">` with
  `#personas-body`.
- `views.js`: the per-persona row builder extracted into shared
  `personaRowsHtml(personas, activeId)` (same markup: name input,
  description, active pill / Switch-to, delete). `Views.personas`
  renders the list + "Add persona" and binds the same handlers.
  Settings keeps a fixed-length **Manage personas · N** row.
- `app.js`: `App.go` `personas` branch (title, "N identities" sub,
  back arrow); `personaReturnScreen`'s `MAIN_SCREENS` gains
  `'personas'` (create/switch from that screen stay on it);
  `App.editPersona`'s in-place row-label refresh keys off
  `'personas'` (caret/scroll preserved); `App.deletePersona`
  returns to `'personas'` when deleted from there.

Part 2 — the hub (every remaining group on its own screen):

- `index.html`: one shared sub-screen
  `<section data-screen="settings-x"><div id="settings-x-body">` —
  all nine sections render into the same body, per section.
- `views.js`: the monolithic `Views.settings` is split:
  - `Views.SETTINGS_SECTIONS` — key → {title, hint, icon, view} for
    Connection, Generation, You, System prompt, AI Horde, Memory,
    Data, Storage, App updates (icons restricted to existing ICONS;
    the old Storage `icon('map')` referenced a non-existent icon and
    rendered an empty svg — Storage now uses `copy`).
  - `settingsScope(body)` — shared bind/set/range/toggle helpers,
    scoped to the sub-screen body (ids can't collide).
  - `settingsUpdateInfo()` — version/update-channel facts shared by
    the hub (About) and the update screen.
  - `Views.settings` — the hub: one row per section (icon, title,
    hint, chevron; the personas row carries the live count) + About
    footer. Row tap → `App.openSettings(k)` (or `App.go('personas')`).
  - Nine sub-views — `settingsConnection` … `settingsUpdate` — each
    with the group's markup and handlers moved over verbatim;
    re-render targets changed from the whole screen to the current
    sub-view (provider change, name change, system-prompt reset,
    restore).
- `app.js`: `App.state.settingsSection` (default 'connection');
  `App.openSettings(sec)`; the `App.go` `settings-x` branch (title
  from the section table, dispatch to the sub-view); back arrow on
  `settings-x`; the bottom nav keeps the Settings tab highlighted on
  sub-screens (`navName`). `App.mountInstall` still appends its PWA
  button to the hub's last group (now About) — unchanged.
- Back navigation is stack-based as before: hub → section pushes
  'settings'; the back button / arrow pops to the hub.

### Tests

No data-layer change — the full battery (24 node suites / 570 checks)
stays green across both segments. The new surface is DOM navigation:
verified by code review + `node --check` + grep (all nine sub-views
present, no stale references to the old inline groups; the
`activeId` used by the "You" hint is intact in its new scope —
caught by grep after the first move).

### Ship state (this segment)

Renumbered 1.16.0 → **1.15.0 / code 38 / sw v26** (sw stays one step
ahead of the live v25). README: one merged "What's new in v1.15.0"
section covering both parts, header/Download → v1.15.0. Built
`HordeStudio-v1.15.0.apk` (302,235 B; sha256
70178394068b9a67b1ddfb0eb2147c36630368e177c4769cd776099682efcdca is
the identity — same keystore, in-place upgrade from code 37) and
in-APK verified:
personas + settings-x sections in index.html, `Views.personas` +
`SETTINGS_SECTIONS` + the nine sub-views in views.js, the App.go
branches + `App.openSettings` in app.js, sw v26, store 1.15.0.
Superseded v1.16.0 root APK removed (it was a renumber of this build).
Committed locally. Publish (push + release + channel) only on
explicit ask.

---

## v1.14.0 — persona bar on the Chats screen (2026-10-01)

### The report

"I once got scared that my chats were gone, because I created a new
persona and my chats page was empty." True — and by design: every persona
keeps its own threads with every character, and a fresh persona has none.
But the persona switcher bar only existed on Cast, and switching/creating
a persona always bounced to Cast, so from Chats the blank list read as
data loss.

### The change

- `index.html`: new `#chat-persona-bar` (class `persona-bar`) at the top
  of the Chats screen, above `#chat-list`. Same CSS, same chips as Cast.
- `views.js` `renderPersonaBar()` now fills **every** `.persona-bar`
  element from one code path (Cast + Chats stay in step; listeners live on
  the chips, which are replaced each render — no duplicates).
  `Views.chats` calls it on render.
- Empty state: when the active identity's list is empty,
  `Views.chats` asks `Store.sessionTotal()`; if another identity holds
  conversations, the text swaps to "No conversations as <identity> —
  Nothing was lost, your other conversations live under a different
  identity. Switch to it with the bar above." (Default text stays for a
  truly empty install.)
- `app.js`: `personaReturnScreen(was)` — after a persona switch or
  create, land on the current screen when it is a top-level screen
  (characters/life/chats/world/worlds/settings); sub-screens (a thread,
  the editor) still fall back to Cast. So tapping a chip on Chats
  re-renders Chats in place.
- `store.js`: new `sessionTotal()` — session count across all personas.

### Tests

New `tests/personachats-test.js` (13 checks, fake-IDB harness from
persona-test): both counts zero on an empty install; 2+2+1 distribution
across two personas + default; the scared moment (new persona sees zero
while the total says five); switching back restores exactly the same
lists; deleting a persona drops its chats from both counts. 24 node
suites green — 570 checks (557 + 13). The DOM behavior (bar rendering,
in-place re-render) is not unit-testable in this sandbox — verified by
code review + node --check, as before.

### Ship state (this segment)

Bumped 1.14.0 / code 37 / sw v25, README (v1.14.0 section + header/
Download) and NOTES updated. Built `HordeStudio-v1.14.0.apk`
(298,139 B — same size as v1.13.2; sha256
ea7cf19be64eff00a5f5c6abcab556f99d989efbe2aa7b7a64beac10a9438476 is the
identity — same keystore, in-place upgrade) and in-APK verified: the
chat-persona-bar element in the packaged index.html, the shared
multi-bar render in views.js, sessionTotal in store.js,
personaReturnScreen in app.js, sw v25, store 1.14.0.
Superseded v1.13.2 root APK removed.
**Published** on explicit ask: push `26c71d2..697f9a2`, release
`v1.14.0` with both assets (298,139 B each) downloading byte-identical
to the local build (sha256 above), live channel serving 1.14.0 / 37 /
`950b9c509ce4`.

---

## v1.13.2 — the weird symbols: repairing double-encoded card text (2026-10-01)

### The report

Screenshot of a fresh chat with "Along for the Ride": the reply is full of
`â` + boxes where apostrophes and quotes should be — `whereâs the
challenge`, `sheâd probably`, `work with.â□□`. Same family as the
v1.13.0 diagnosis, now visible end-to-end: the card's text (greeting,
persona) is **double-encoded** — UTF-8 bytes re-read as Windows-1252, so
the apostrophe of "she's" (E2 80 99) became the three characters â€™.
The model reads that in the card's greeting/persona and in its own older
replies, and starts **imitating** the mangled pattern in new text.

### The change

- `api.js` new `repairMojibake(text)` — the reverse transform:
  characters → cp1252 bytes (26-symbol table for the non-Latin-1 slots;
  C1 controls map back to their raw byte) → **strict** UTF-8 decode
  (`TextDecoder('utf-8', {fatal:true})`). The fatal decode is the safety
  net: it only succeeds when the whole byte string is genuinely
  double-encoded, so correct French (`château`, `été`), genuine euro
  signs and real curly quotes fail to decode and come back untouched. A
  repair that does not shorten the text or still carries markers (â Ã Â
  É È Ê Ë Î Ï æ) is rejected; a char beyond cp1252 aborts the whole
  repair. Idempotent — repaired text has no markers.
- Wired into `plainText` (after tag strip + entity unescape), so import
  and every character-sheet/example/always-remember field are repaired
  for **existing cards without re-import**.
- Wired into the stored-message context: `buildPrompt` history,
  `buildChat` history, `summarize` transcript + existing summary/facts,
  and the sheet's "Story so far"/"Established facts" — so an existing
  chat stops feeding the model its own imitated mojibake, and new
  summaries are generated from clean context. Converges within a few
  replies; the old visible messages keep the stored text (delete/edit
  them if wanted), same as the v1.13.1 HTML case.
- No stored-data migration: repair is prompt-side only, by design
  (never silently rewrite what the user sees).

### Tests

New `tests/mojibake-test.js` (25 checks): the reported patterns
(`sheâ€™d`, `whereâ€™s`, closing-quote shape, em dash), cp1252 round-trips
for quotes/accents, clean-text guarantees (English, correct French with
and without a marker, euro, genuine curly apostrophe, beyond-cp1252,
incomplete sequences), idempotence, plainText composition (tags +
entities + mojibake in one string), and the wire prompt / chat messages
carrying no mojibake with persona, stored reply, user message, summary
and facts all verified. 23 node suites green — 557 checks (532 + 25).

### Ship state (this segment)

Bumped 1.13.2 / code 36 / sw v24, README (v1.13.2 section + header/
Download) and NOTES updated. Built `HordeStudio-v1.13.2.apk`
(298,139 B — same size as v1.13.1; sha256
d16a03733cc9ba59253c576d923fa25b8fd73d0fb9e83f663514edca2fbacc3b is the
identity — same keystore, in-place upgrade) and in-APK verified: the
repairMojibake definition + its eight wired call sites (plainText,
sheet memory, both prompt builders, summarize) in the packaged api.js,
sw v24, store 1.13.2.
Superseded v1.13.1 root APK removed.
**Published** on explicit ask: push `9b33fe6..07db9e0`, release
`v1.13.2` with both assets (298,139 B each) downloading byte-identical
to the local build (sha256 above), live channel serving 1.13.2 / 36 /
`984fb605e12a`.

---

## v1.13.1 — cards stop leaking their HTML (2026-10-01)

### The report

Screenshot: a Janitor AI card ("Along for the Ride") whose description
embeds the bot's avatar as
`<p><img src="https://ella.janitorai.com/media-approved/…webp?width=600"></p>`.
The model read the markup from the character sheet and typed it back into
the reply as literal text; the reply renderer (correctly) showed it as
text. "Was that supposed to load an image, or random link?" — answered:
the link is the card's own avatar; nothing is supposed to load it (model
replies are text, never rendered HTML — a volunteer model must not be able
to inject scripts); the model just echoed the card's markup.

### The change

- `api.js` new `plainText(text)` — card HTML → plain prose: script/style
  blocks removed with contents, `<br>`/`</p>`/`</div>`/… → line breaks,
  all other tags dropped (with their URLs), numeric + common named
  entities unescaped (`&nbsp; &amp; &lt; &gt; &quot; &apos;`; unknown
  entities left as written), excess blank lines collapsed. No-op for text
  without `<` or `&`; idempotent.
- Prompt time: `charSheet` cleans persona, scenario, lorebook contents
  and the always-remember note; `examplesToMessages` cleans the example
  dialogue first (so a `<br>` between speakers splits into turns).
  Already-imported cards stop echoing markup with no re-import.
- Import time: `App.importCard` runs persona/scenario/greeting/examples/
  postHistory/lorebook contents through `plainText` right after
  `cardToCharacter`, so new cards arrive clean (greeting included).
- Reply rendering unchanged: model HTML still shows as text, never
  executed.

### Tests

New `tests/cardhtml-test.js` (19 checks): no-op/stray-`<` safety, br/
paragraph breaks, img drop, link caption kept, script removal, entities,
unknown entities, the exact reported Janitor greeting, idempotence,
examples `<br>` splitting, and the wire prompt (Horde `buildPrompt` and
chat `buildChat`) carrying no markup with the prose intact. 22 node
suites green — 532 checks (513 + 19); the two Playwright suites remain
unrunnable in this sandbox, unchanged.

### Ship state (this segment)

Bumped 1.13.1 / code 35 / sw v23, README (v1.13.1 section + header/
Download) and NOTES updated. Built `HordeStudio-v1.13.1.apk`
(298,139 B — same size as v1.13.0; sha256
c4b7abab66739346e91b466a62e18d46d1e425ef4cb332c1057d64c874bf2fa5 is the
identity — same keystore, in-place upgrade) and in-APK verified: the
plainText definition + the five charSheet/examples call sites in the
packaged api.js, the import cleaning in app.js, sw v23, store 1.13.1.
Superseded v1.13.0 root APK removed.
**Published** on explicit ask: push `5c4aa4d..d20c606`, release
`v1.13.1` with both assets (298,139 B each) downloading byte-identical
to the local build (sha256 above), live channel serving 1.13.1 / 35 /
`06cfeec74ebe`.

---

## v1.13.0 — internal state: characters keep their own heads (2026-09-30)

### The ask

From the 18.2.1 upstream review: build the *concept* behind the Freaky
Frankenstein preset, natively — "a per-character internal state block
(mood/intents/flags, collapsible in chat, carried in the prompt each
turn). Do this one please."

### The change

- `api.js`: new `statePrompt(char)` — when `char.stateTracking === true`
  (and the character is not a virtual human), the character sheet gains
  "Your current internal state:" (only the non-empty fields; "not
  established yet" before the first) plus a fixed instruction to end every
  reply with `<state>\nmood: …\nintent: …\nflags: …\n</state>`, hidden from
  the reader. `parseState(text)` (last block wins; case-insensitive;
  unknown keys ignored; >1200 chars or no usable key → null) and
  `stripState(text)` (removes every block). The tag is `<state>` on
  purpose — `internal` is in the stripThinking tag list and would be eaten.
- `app.js` `generateReply`: after the final text, when tracking is on the
  block is parsed out, the visible text stripped, and the character's
  `state` updated (`by: 'model'`) before the message is stored/shown; the
  strip re-renders. `App.editCharState(char)` — sheet from the strip to
  set mood/intent/flags by hand (`by: 'user'`).
- `views.js`: `stateStrip(char)` renders the collapsible strip in
  `#char-state` (mood is the collapsed headline; expanded: three rows +
  Edit button); the editor gains an **Internal state** group (toggle +
  three inputs, hidden for VH characters, who keep the simulation-driven
  Inner state sliders); `collect()` carries the fields into the save.
- `index.html`/`app.css`: the `#char-state` slot above the thread +
  `.char-state` styling. `store.js` `blankCharacter` defaults
  (`stateTracking: false`, empty state) — existing characters are
  unaffected until switched on.
- Data rides the character document: backups, exports and the IDB all
  carry it with no schema change. World runs (synthetic character without
  `stateTracking`) and VH background delivery (no parse path) are excluded
  by construction — the same VH-separation clause upstream 18.2.1 keeps.

### Tests

New `tests/internalstate-test.js` (28 checks): statePrompt on/off/partial/
fresh/VH, parseState (case-insensitivity, last-block-wins, unknown keys,
runaway size, no usable keys), stripState (end/middle/multiple/none),
buildPrompt integration (section present, history intact, VH excluded,
fresh state) and a reply round trip. 21 node suites green — 513 checks
(485 + 28); the two Playwright suites remain unrunnable in this sandbox,
unchanged.

### Ship state (this segment)

Bumped 1.13.0 / code 34 / sw v22, README (v1.13.0 section + Chats line +
header/Download) and NOTES updated. Built `HordeStudio-v1.13.0.apk`
(298,139 B — a different size at last; sha256
c04baac8494c715a6c01cec3fb948d74fed474369dd85708d28cc412c2c0ef8b — same
keystore, in-place upgrade) and in-APK verified: statePrompt/parseState
markers in the
packaged api.js, the generateReply parse block in app.js, stateStrip +
editor group in views.js, `#char-state` in index.html, `.char-state` in
app.css, sw v22, store 1.13.0. Superseded v1.12.0 root APK removed.
Committed locally (the local commit was again lost to a workspace
snapshot restore at the turn boundary; the working tree carried it
intact). Published on explicit ask: push `7716a47`; the release
workflow made release `v1.13.0` (two assets, downloaded byte-identical,
sha above) and the live channel now serves webRev `924f20bd6343`
(verified against the Pages URL).

---

## v1.12.0 — card import keeps the card's face (2026-09-30)

### The ask

Screenshot of the Cast: every imported card shows the generic silhouette.
"When you import a character card, it imports the data but not the image.
Can you make it import the image too?"

### The change

- `store.js` `cardToCharacter`: the avatar was hard-coded to `''` in both
  branches — now v2 and v3 pick up `char_x` (the SillyTavern avatar field).
  New `Store.cardAvatar` validator accepts data: image URIs and http(s)
  URLs; a relative path (another install's `charx/...` file) is dropped —
  it would be a broken `<img>` here.
- `store.js` `readCardFile` PNG branch: a PNG-embedded card IS its own
  avatar (ST stores the picture in the file, not the JSON) — when the
  embedded JSON has no usable char_x of its own, the PNG file itself is
  attached as a data URI (v3 cards carry it inside `data`, v2 top-level).
- `store.js` `characterToCard`: export writes `char_x` back out (round trip).
- `views.js` `normalizeDataUrl(dataUrl, maxDim)`: the same normalization as
  the file-based `normalizeImage` (512 px long edge, PNG only with real
  transparency, JPEG 0.85 otherwise) for data URIs. Web URLs, non-image
  data URIs, images already under the cap, and decode failures pass through
  unchanged — the card's original bytes are never lost.
- `app.js` `importCard`: runs the avatar through the normalizer before the
  import sheet.

### The update-path audit (pre-publish ask)

"Remove or modify any update option that will result in deleting all your
chats." Full audit of every update path — the files-only swap (`finishSwap`:
`files/web.tmp` → `files/web`, a single rename), Reset to shipped files
(`clearWebUpdate`: deletes only `files/web*`), the SW/cache reload, the
boot-time auto-apply and watchdog rollbacks, and the APK install
(DownloadManager + Android's own install screen): **none of them can reach
chat storage**. Chats live in the WebView's IndexedDB (DOM storage, default
data path — the app sets no custom database path), a directory no update
code ever opens; the IDB migrations are purely additive (v3,
`if (!contains) createObjectStore`), so a files update cannot drop stores
either. The only in-app eraser stays the explicit "Erase all characters and
chats" button (danger confirm, Data section — a data action, not an update).
The one update option that replaces the app itself (Install app update /
Update everything) is now gated with a confirm that states the data promise
before the download starts — "Installing over the current app keeps all your
chats and characters — data is only lost if you uninstall the app first" —
and both install prompts now carry the same sentence in their descriptions
(`views.js` `beginInstall`).

### Tests

New `tests/card-avatar-test.js` (23 checks): cardAvatar pass/reject, v2 + v3
import keeping data URIs / web URLs, relative paths dropped, the
PNG-embedded branch attaching the file itself with a fake PNG carrying a
real tEXt ccv3 chunk (v3 → `data.char_x`, v2 → top-level), the JSON's own
char_x winning, export round trip, and the normalizer (800×600 → 512×384
JPEG, alpha → PNG, under-cap kept, web URL / non-image / decode failure
unchanged). 20 node suites green — 485 checks (462 + 23 new); the two
Playwright suites remain unrunnable in this sandbox (no playwright-core /
browser), unchanged from before.

### Ship state (this segment)

Bumped 1.12.0 / code 33 / sw v21, README (v1.12.0 section + Cast line +
header/Download) and NOTES updated. Built `HordeStudio-v1.12.0.apk`
(294,043 B — four builds running at the same size; sha256
1c99bfeaa448b4f91e261df85db68ed5491df7a60e9e67d3c47f6792df4091d1 is the
identity — same keystore, in-place upgrade) and in-APK verified: the
cardAvatar/char_x markers in the packaged store.js, normalizeDataUrl in
views.js, the importCard normalizer call in app.js, the beginInstall
confirm in views.js, sw v21, store 1.12.0. Superseded v1.11.2 root APK
removed after the first v1.12.0 build; the gate rebuild overwrote the
v1.12.0 APK in place (same version name, new sha above).
Committed locally — squashed with the v1.11.2 changes into a single commit
(the per-version local commits were lost to a workspace snapshot restore;
see the v1.11.2 entry). Published on explicit ask: push `625a6db` carried
both versions; the release workflow made release `v1.12.0` (two assets,
downloaded byte-identical, sha above) and the live channel now serves
webRev `e5db10aaabab` (verified against the Pages URL).

---

## v1.11.2 — empty-reply retries 5 → 10 (2026-09-30)

### The ask

"Can you up the tries from 5 to 10?" — the Horde's blank-worker retry
budget (v1.8.0 era: 5 attempts / 45 s) ran out on busy days, where the
public cluster's empty rate means several blanks in a row.

### The change

`horde.js` text path: default `emptyTries` 5 → 10, clamp 6 → 10, and the
time budget 45 s → 90 s so 10 attempts are actually reachable (the budget
is the guard that keeps a hung worker from turning one message into a
long wait; 10 fast empties ≈ 30–60 s in practice). The error message and
the “(X of Y)” progress line are dynamic, so they update with the count —
no other change. Images keep their own 2-try budget.

### Tests

New `tests/horde-empty-retry-test.js` (10 checks) against the real
horde.js with a mocked API: an explicit count is honored (3 tries → 3
posts, “after 3 tries”), two blanks then success → tries=3, **the default
runs 10** (9 blanks then success on attempt 10 → 10 posts, progress “(1
of 10) … (9 of 10)”), and the time budget still caps the loop (a 1 ms
budget stops after the first blank — the mock gets a 30 ms poll delay so
the test is deterministic against Date.now() millisecond granularity).

### Ship state (this segment)

Bumped 1.11.2 / code 32 / sw v20, README (v1.11.2 section + Empty-replies
behavior + header/Download) and NOTES updated. 19 suites green — 462
checks (452 + 10 new). Built `HordeStudio-v1.11.2.apk` (294,043 B — three
builds running at the same size; sha256
ed8832839fb431a09f5a49dae4804239a9ef4dff885794138a7d33f28c4fdc29 is the
identity — same keystore, in-place upgrade) and in-APK verified: the
10-attempt / 90 s retry block is in the packaged horde.js, the v1.11.1
`.sheet-body` rule set still in app.css, sw v20, store 1.11.2.
Superseded v1.11.1 root APK removed (release assets keep that copy).
The per-version local commit (`d5c5674`) was lost to a workspace snapshot
restore (the .git directory reverted to the last published state at a turn
boundary); the changes ship folded into the v1.12.0 commit and were
published with it (`625a6db`) — content identical.
(Superseded by v1.12.0 — its root APK was removed after the v1.12.0 build.)

---

## v1.11.1 — the Edit message sheet stops shouting (2026-09-30)

### The report

Screenshot: the "Edit message" sheet rendered as a bright cream box with
washed-out light text on the dark app — "very disturbing to the eyes".

### The cause

Themed form-control styling only existed scoped to `.field` (the editor,
Settings) and `.composer` (the chat input). The Edit message sheet renders
its textarea directly into `.sheet-body`, so it fell back to the WebView's
default light form control while `color:inherit` gave it the app's light
text — light on light. Every sheet form field (Edit message, paste-a-URL,
…) had the same latent bug; the edit sheet just has the biggest one.

### The fix

`css/app.css` — form controls inside `.sheet-body` (text/password/url/
number inputs, textareas, selects) now get the same dark treatment as
`.field`: `--bg-2` background, `--text` color, `--line` border with the
accent focus border, `--dim` placeholders, tall vertical resize for
textareas. Pure CSS, no JS change. sw cache v18 → v19 (cache-first worker).

### Ship state (this segment)

Bumped 1.11.1 / code 31 / sw v19, README (v1.11.1 section + header/Download)
and NOTES updated. 18 suites unchanged (no JS touched) — rerun green for
the record. Built `HordeStudio-v1.11.1.apk` (294,043 B — again the same
size as v1.11.0; sha256
6c61d7a3028504c3fb50cffe2887b8dca346508a19eb7b65431e46d0324f44de is the
identity — same keystore, in-place upgrade) and in-APK verified: the
`.sheet-body` rule set is in the packaged app.css, sw v19, store 1.11.1.
Superseded v1.11.0 root APK removed (release assets keep that copy).
Published on explicit ask: push `b13b8e9..7098533`, release `v1.11.1`
(both assets; the downloaded release asset verified byte-identical to the
local build), channel verified after publish (1.11.1 / webRev
`4b6ef161b260`, sw v19, the `.sheet-body` rule set in the served app.css).

---

## v1.11.0 — choose which scenario to start from (2026-09-25)

### The ask

"some character cards have different scenarios. can the app let you choose
which one you want to start?"

SillyTavern cards can carry `scenario_list` — several starting scenarios.
The importer (`Store.cardToCharacter`) only read `data.scenario`, so every
card arrived with a single scenario and the rest of the list was dropped on
the floor.

### Implementation

- `store.js` — new pure `Store.scenarioList(data)`: trims, drops empties,
  dedupes order-preserving, and appends the card's declared default if the
  list forgot it (never lost). Both import branches now keep it:
  `scenarioList: [...]` on the character, and the character's `scenario`
  field (the one the prompt already injects as "Current situation:") holds
  the chosen one — v3: the card's declared default (or the first listed
  when the card has none), v2: the declared scenario or the first listed.
  `characterToCard` exports `scenario_list` back out, so the choices survive
  an export → re-import round trip.
- `views.js` — the editor's Scenario field head renders
  `Views.scenarioChip(char.scenarioList)` (empty for 0/1, a
  "Card scenarios (n)" chip from 2 up). Tapping it opens a `UI.sheet`
  listing the scenarios numbered with a 160-char preview; picking one puts
  the full text in the Scenario textarea — the user still reviews/edits and
  saves like any field (no hidden save path). `draft = Object.assign({},
  char)` already carried `scenarioList` into saves, so nothing else in the
  editor or the prompt changed.
- `tests/scenarios-test.js` — 30 checks: the normalizer (trim/dedupe/empty/
  order, default appended when unlisted, lone default, empty, non-array),
  v3 import (default selected, default-missing-from-list appended and still
  winning, no default → first listed, no scenarios at all → empty as
  before, persona merge unchanged), v2 import (empty scenario + list →
  first, declared wins, no list → single), export round trip (list out,
  chosen scenario alongside, re-import keeps it, absent when empty), and
  the chip helper (0/1 → none, 2+ → chip with the count).

### Ship state (this segment)

Bumped 1.11.0 / code 30 / sw v18, README (v1.11.0 section + Cast bullet +
header/Download) and NOTES updated. 18 suites green — 452 checks (422 + 30
new). Built `HordeStudio-v1.11.0.apk` (294,043 B, sha256
c433049b7e10a0590268778a84b704ea0b7d130ffee75541aeeb2fc673d7e9b2 — same
keystore, in-place upgrade from 1.10.0) and in-APK verified: scenarioList /
scenarioChip / 'Card scenarios' markers present, all v1.10.0 + older shipped
markers still present, store 1.11.0, sw v18. Superseded v1.10.0 root APK
removed (release assets keep that copy). Published on explicit ask: push
`e6eff6b..5a3aefe`, release `v1.11.0` (both assets; the downloaded release
asset verified byte-identical to the local build), channel verified after
publish (1.11.0 / webRev `04cefda4c30c`, sw v18, scenario markers in the
served bundle).

---

## v1.10.0 — upstream 18.2.0 alignment (2026-09-25)

### The ask

"horde studio 18.2.0 came out. please update the apk to this version. please
check that this update doesnt break the fixes you already made to the apk."

18.2.0 ("Virtual Human reliability, long-life storage and private always-on
hosting") is mostly desktop-scale. I ported the mobile-relevant parts and
documented what was intentionally left upstream. The acceptance criterion was
explicit: verify the shipped fixes don't regress.

### What 18.2.0 actually changed (fetched 2026-09-25)

Conversations: stable long-transcript DOM, separate foreground replies from
optional background work, LM Studio state-observer repair, editable-export
read-only, removed 5s maintenance race. Storage: bounded ledgers with
checkpoints, retention policies, compacted job prompts, resize/compress/dedup
imported images (keep transparency), service-wide storage inspection +
verified optimizer. Private always-on hosting (VH2 on a host machine).

### Mobile mapping — what I did

- **Foreground/background split (bug was real).** `App.vhOutreach` claimed
  `App.state.busy = true` up front and ran `genStart('…is typing…')` for
  AUTONOMOUS outreach, so a life tick blocked the user's `App.send` /
  `generateReply` and lit the working indicator. Now outreach claims a
  per-character slot `App.state.lifeBusy[char.id]` (a map, so two characters
  may run at once but one may not double-generate). Autonomous work never
  sets `busy` and never calls `genStart`; a manual nudge (`forced`) keeps the
  old foreground flag + banner. `bail()` releases whatever was claimed on
  every exit (success, failure, early return) — the 1.8.3 no-stuck-dots
  guarantee, extended to the life slot. `renderTyping`'s `working` formula
  (`genInfo || busy || bursting`) is untouched, so background work is
  invisible to the indicator.
- **Stable transcript / preserve scroll.** `Views.thread` (views.js) did a
  full `#thread` innerHTML rebuild, which reset `scrollTop`. Added
  `Views.threadAnchor(children, scrollTop)` (first message in view + depth +
  predecessor) and `Views.restoreThreadScroll(thread, anchor)` (restores
  offset; if the anchor message was deleted, the predecessor stands in at its
  top). The rebuild now captures the anchor pre-render (only when
  `!forceBottom`) and restores it post-render when `stickToBottom` declines.
  Fresh opens (forceBottom) still land on the last message (v1.8.1) and
  near-bottom re-renders still follow (v1.8.2) — both re-verified by
  threadscroll-test and new anchor checks.
- **Image normalization on avatar import.** `Views.normalizeImage(file,
  512)` downscales to a 512 px long edge and re-encodes PNG only when the
  picture has real transparency, JPEG 0.85 otherwise; falls back to the raw
  data URL if any step throws. The `av-file` handler now routes through it.
  Pure math (`imageTargetSize`, `imageMime`) is unit-tested.
- **Storage inspection (read-only).** Settings → Storage → "Show storage use"
  gathers characters/sessions/messages/worlds and renders
  `App.storageReport(data)` — a pure, unit-tested function that weighs text in
  UTF-16 bytes and base64 images at 3/4, reporting per-category and total.
  No optimizer: the port ships the inspection half.

### Mobile mapping — intentionally left upstream

- Private always-on VH2 hosting: needs a host machine (Docker/Caddy), not a
  phone. N/A.
- LM Studio state-observer 400 repair: our provider plumbing is the AI Horde
  + custom OpenAI-compatible, no LM Studio path. N/A.
- Editable-export read-only + 5s maintenance race: this port has no queued
  life-command flush on export and no periodic storage-maintenance timer.
  N/A (verified by grep: no `setInterval` in idb/store/vhuman).
- Full storage optimizer: desktop-scale (pauses lives, checks free space,
  replays). The port's fine-grained ledgers were already bounded by design
  (chronicle 40, feed 80, gallery 40), so "bound the ledgers" is already met.

### Regression check (the explicit criterion)

All 17 suites green (16 prior + new lifework-test, 43 checks) — including
threadscroll (11, the scroll fixes), editresend (25), retry (9),
horde-uncensored (20), aicreate (30), vhuman (16), updateflow (11), and the
world/persona suites. New `tests/lifework-test.js` covers the foreground/
background split (autonomous is background + a send mid-outreach goes
through; nudge is foreground; per-char slots; failure releases the slot),
the scroll anchor (mid-line restore, deleted-anchor predecessor, untouched
anchor, fresh open, near-bottom), the storage report (weights, empty, MB),
and the image math (downscale, no upscale, custom edge, jpeg/png).

### Ship state (this segment)

Bumped 1.10.0 / code 29 / sw v17, README (v1.10.0 section + VH/Chats bullets +
Download) and NOTES updated. Built `HordeStudio-v1.10.0.apk` (289,947 B,
sha256 3c67c8ab75c9457aa487c4dfe524906586d93dd34664fb9f2aacc68075324a34 —
same keystore, in-place upgrade from 1.9.2) and in-APK verified: the four new
feature markers plus the shipped-fix markers (editAndResend, 'Edit & resend',
retry, stickToBottom) and the versions (store 1.10.0, sw v17) are all in the
packaged assets. The superseded v1.9.2 root APK was removed (the release
assets keep that copy). Published on explicit ask: push
`a43f4bc..c9faad7`, release `v1.10.0` (both assets; the downloaded release
asset verified byte-identical to the local build), channel verified after
publish (1.10.0 / webRev `7bf5e7e106cb`, sw v17, new feature + shipped-fix
markers in the served bundle). The 422-check suite count above is the
no-regression record.

---

## v1.9.2 — edit-and-resend (2026-09-24)

### The ask

"if i type in a message and the response i get isnt to my liking. and after
a few rerolls i still dont like the response. can you make it so that after
i delete the response. i can edit my initial message and resend it after
the edit?"

### What existed

User messages already had Edit (in-place text swap, replies left stranded —
the reply no longer matched the message) and Delete; assistant replies had
Reroll/Continue/Edit/Copy/Delete. Nothing re-generated from an edited user
message.

### Implementation

- `App.send`'s post-arrival tail (retry-offer cleanup, VH pending-schedule
  vs immediate generation) extracted to `App.afterUserMessage(m)` — shared
  by a fresh send and by edit-and-resend, so a virtual human who is busy or
  asleep still answers a resent line on their own schedule.
- New `App.editAndResend(msg, text)`: guards (busy → 'busy', unchanged text
  → 'unchanged', both spend nothing) → if the message has successors, a
  danger confirm names exactly how many will be deleted → persists the edit
  (`Store.updateMessage`), deletes everything after it, re-renders the
  thread, then `App.afterUserMessage(msg)` — a plain `generateReply()` that
  answers the edited tail.
- The message-menu Edit handler: user messages now route through
  editAndResend (empty result rejected with a toast); assistant messages
  keep the plain in-place edit.
- `tests/editresend-test.js` (25 checks, app.js loaded in a VM with stubbed
  Store/Views/VH and a recorded generateReply): tail edit (no confirm, one
  generation, aimed at the edited tail), mid-thread edit (confirm names the
  2 cut messages, danger style, 'Edit & resend' label, both deleted, thread
  cut), declined confirm (nothing deleted/generated, text untouched), busy
  guard, unchanged no-op, and the VH pending path (no immediate generation,
  pending parked + persisted, system notice shown).

### Ship state (this segment)

Bumped 1.9.2 / code 28 / sw v16, README (v1.9.2 section + Chats bullet +
Download) updated, 16 suites green. Build + publish only on explicit ask.

## v1.9.1 — AI drafts under the Horde's 512-token limit (2026-09-24)

### The report

User screenshot: "Draft failed: Due to heavy demand, for requests over 512
tokens, the client needs to already have the required kudos. This request
requires 1328.57 kudos to fulfil." — pressed *Draft the whole person* with
the anonymous Horde.

### The cause

The AI Horde's demand-spike policy: when thailed: Due to heavy demand, for requests over 512
tokens, the client needs to already have the required kudos. This request
requires 1328.57 kudos to fulfil." — pressed *Draft the whole person* with
the anonymous Horde.

### The cause

The AI Horde's demand-spike policy: when the cluster is under heavy demand,
jobs with `max_length` **over 512 tokens** must be pre-paid with kudos. The
v1.9.0 whole-person draft asked for 900; world creation for 2,400. The
per-field chips (320/160/120), story summarise (320) and VH outreach (≤120)
were all already under the line — only the two v1.9.0 draft calls exceeded
it.

### The fix (upstream 18.1.0's bounded-drafting model)

- `hordeworld.js`: new pure `HW.assemble({places, people, rules})` — joins
  the three world-draft parts into one `.horde_world`-shaped object ready
  for `parse()` (missing parts degrade to parse defaults; no locations →
  parse still rejects). Exported for tests.
- Person draft (views.js): one 900-token request → **two** bounded requests
  (450 the person — name/tagline/persona<150w/scenario/greeting/examples;
  350 the life — 3 places, 5 routine entries, sleep, 2-3 people, diary,
  conditioned on the persona). The person lands in the fields as it comes;
  a failed life part keeps it and the toast says "press again to finish it".
  Button now reads "(2 requests)".
- World draft (app.js): one 2400-token request → **three** bounded requests
  (480 the places — 5-7 connected locations; 480 the people — 3-4 entities,
  factions, relationships; 480 the rules — dmPrompt 150-220 words, intro,
  startingLives told the real location ids, gameRules, hudConfig).
  `HW.assemble` → `HW.parse` → `HW.save`; stop-on-failure, nothing partial
  saved, status line per stage with live queue position. Button now reads
  "(3 requests)".
- All draft `max_length`s are now ≤ 480 < 512 — the anonymous client passes
  the kudos check even under heavy demand.
- `tests/aicreate-test.js`: 23 → 30 checks (assemble join, per-part
  survival, missing-places rejection, empty assemble rejection).

### Ship state (this segment)

Bumped 1.9.1 / code 27 / sw v15, README (v1.9.1 section + Features bullet +
Download) updated. Build + publish only on explicit ask.

## v1.9.0 — AI-assisted creation (2026-09-23)

### The ask

"horde studio 18.1.1 has a function to create your own virtual human. is
that function possible to be implemented into the apk? same with worlds.
you can use ai to help you create your own vh or world"

### What upstream actually is

The creation feature is **v18.1.0** (v18.1.1 is only VH reply-recovery +
a Windows patch): a rebuilt, page-scoped creation experience and "Safer
AI drafting" — retired whole-human generation, ONE bounded plain-text
request per selected field, the exact request count shown before
submission, opening a builder spends nothing, stop-on-failure (keep what
is done, retry only the affected field), and direction preservation
(unsettling/obsessive/antagonistic/eccentric/solitary stays that way,
not normalised into an agreeable template). The phone port applies the
same rules at phone scale.

### Implementation

- `api.js`:
  - `parseAiJson(text)` — pulls one JSON object out of a model reply,
    tolerating code fences, surrounding prose and trailing commas;
    returns null (never throws) when there is no usable object.
  - `aiJson(settings, prompt, maxTokens, onProgress)` — one bounded JSON
    request at temperature 0.3; Horde path maxWait 600, onProgress
    forwarded so a long world draft shows queue position instead of
    looking frozen.
- Editor (`views.js`): a *Create with AI* card shown on an empty sheet
  only (persona AND scenario AND greeting all blank) — one line of who
  they are → ONE request (900 tokens) → name/tagline (only if empty),
  persona/scenario/greeting/examples, and the VH life: places (3–5,
  snake-id, current place set to the first), routine (HH:MM-validated,
  ≤12), sleep (validated), people (closeness clamped -1..1,
  `VH.uid('pe')` ids), chronicle (diary beats). Direction preserved by
  the same clause the persona chip already carried. Re-renders the
  editor with the filled draft (the card disappears once the sheet is
  non-empty).
- Per-field *AI draft* chips now also on **scenario** (160 tokens) and
  **greeting** (120 tokens), same pattern as the existing persona chip.
- Worlds screen: *Create a world with AI* → sheet with a description →
  ONE request (2400 tokens) in the exact `.horde_world` shape →
  `HW.parse()` (the same importer a file import uses) → `HW.save()` →
  worlds screen. Malformed = status line in the sheet + press again; no
  auto-retry (app culture). Sheet stays open during generation with
  live queue status; Cancel is the other button.
- Prompt shape verified key-by-key against `HW.parse` (hordeworld.js
  :51): `_format` falls back to horde-world when locations+entities are
  present; locations[] is the only hard requirement; entities/factions/
  relationships/lorebook/startingLives/gameRules/hudConfig all
  normalise with defaults.
- `tests/aicreate-test.js` (23 checks): extractor (clean / fenced /
  prose-wrapped / trailing comma / garbage / empty / top-level array /
  unbalanced / nested), aiJson knobs (model, maxTokens, temp 0.3,
  apikey, maxWait 600, onProgress wired), malformed → null, and a
  model-shaped world through `HW.parse` end to end.

### Ship state (this segment)

Source done, 15 suites green (14 + aicreate), bumped 1.9.0 / code 26 /
sw v14, README + NOTES updated. **Build + publish only on explicit ask.**

## v1.8.3 — one-check updates + stuck-thinking fix (2026-09-23)

### The asks

1. "the thinking animation never stops" — the typing dots / working banner
   keep running after a reply.
2. "is there a way to make updating simpler. now its Check for updates →
   Apply now → Check for update → Install app update → Check for update →
   Apply now" — the update flow needs six actions and three re-checks.

### The stuck thinking dots

`working = App.genInfo || App.state.busy || App.state.bursting`. Every
`busy=true`/`genStart` site (generateReply, vhOutreach) clears in a final
`.then` chained after `.catch` — so **any throw inside the error handler
skips the cleanup and the dots run forever**. The error handler is exactly
the code path a Horde user hammers (≈1 in 4 jobs empty → 5 retries → throw
→ my v1.8.0 retry-chip block re-renders the thread inside the catch).
Fix: both error handlers wrapped in try/catch so they cannot throw, and
the final cleanup (`busy=false`, `abort=null`, `setStop(false)`,
`renderTyping()`) now runs unconditionally. Audited: only two `busy=true`
sites exist; `bursting` is balanced on both settle paths of deliverBurst;
`deliverPending` checks busy BEFORE clearing the pending session, so no
reply is silently dropped; api.js does not swallow Horde errors (no phantom
"…" replies); the image path uses no busy/genInfo state.

### The simpler update

Root cause of the six-tap flow: nothing was remembered between the three
Check presses, and applying web + installing APK + re-checking was left as
manual bookkeeping.

- **Guided check result (views.js):** one path per situation —
  newWeb only → *Apply now*; newApk only → *Install app update* (+ or in
  browser); both → primary **Update everything** (the install) with the
  promise "reopen the app — the new files apply themselves", plus a
  secondary *Files only — keep this app*.
- **Boot auto-apply (update.js):** the boot IIFE now records
  `hs.lastApkCode` each start. When the code goes up (fresh install or
  upgrade) and a remembered `hs.remote` exists that is **fresh** (<48h — a
  week-old remembered check would apply files OLDER than the new APK ships)
  and not already the overlay's revision, it runs `applyWebUpdate` with the
  remembered revision, flags `hs.pendingRev` (the existing boot watchdog
  covers crash-rollback), and reloads fresh. A failed auto-apply marks the
  version as seen (no retry loop on every boot) and says so.
- **Resulting flows:** files-only = Check, Apply (2 taps). Full update =
  Check, Update everything, Android's confirm, reopen — files apply
  themselves (3 taps, zero re-checks).
- Nothing here auto-downloads on its own: the check remains manual, and the
  auto-apply only consumes the answer to a check the user pressed.

### Where it landed

- `app.js` — generateReply + vhOutreach error handlers try/caught; final
  cleanup guaranteed.
- `views.js` — check-result rebuilt into guided single paths +
  `btn-upd-all` handler.
- `update.js` — boot IIFE: version-code marker + guarded auto-apply.
- `tests/updateflow-test.js` — new suite, 11 checks: fresh upgrade applies
  the remembered rev (+pending flag, +marker), no misfire on same code /
  no remote / stale remote / current overlay, one-behind overlay applies,
  first boot records the marker.

### Verification

- 14/14 runnable suites green (update-test is the playwright one, absent in
  sandbox — same as always).
- APK content-checked after build (btn-upd-all, auto-apply block,
  try/catch handlers, sw v13, store 1.8.3).
- Native wrapper untouched — the whole release is web + version bump, no
  new permissions.

## v1.8.2 — don't fight the reader (2026-09-23)

### The ask

"Ok so now it scrolls down by itself. But the moment i get a message it
scrolls to the last word. Then i need to scroll back up so i can read the
recieved message from it start. Can you make it so it scrolls to last
message. But when i send a message and i recieve the response, it doesant
go to the bottom" — keep open-at-last-message; stop the view jumping to the
last word while a reply is being read from its start.

### Root cause

Seven places in the chat path scrolled `#thread` unconditionally: the
reply-finished handler (the main yank — a completed reply always jumped to
its last word), the VH burst parts, autonomous outreach, photos, image
replies, `appendMessage` itself, and (guarded but separately) the stream
deltas. The streaming delta already respected a 260px near-bottom
threshold; everything else didn't.

### The fix

- **One helper, one rule.** `Views.stickToBottom(thread, force)` — scroll
  only if `force` or the user is within 260px of the bottom. Every
  main-chat scroll in app.js/views.js now goes through it; no raw
  `#thread.scrollTop` writes remain (only the open-time image re-jump and
  the world-run log, both deliberate).
- **Force** (always jump): opening a chat (forceBottom), your own send,
  the "they're asleep/busy" system note right after a send.
- **Guarded** (follow only if at the bottom): streaming deltas, a finished
  reply, burst parts, autonomous outreach, photos, image replies, and
  `appendMessage` (which now carries the guard, so the four call sites
  that scrolled after it needed no scroll of their own anymore).

### Where it landed

- `views.js` — `stickToBottom` (exported, returns whether it scrolled);
  `Views.thread` and `appendMessage` use it.
- `app.js` — onDelta, reply-finished, send, VH-delay note, burst, outreach,
  photo, image reply — all through the helper.
- `tests/threadscroll-test.js` — extended to 11 checks: follows at the
  bottom, follows within 260px, does NOT yank when 500px up, force still
  wins, appendMessage keeps a reader at 1000px and follows at the bottom.

### Verification

- Full suite 13/13 (307 + 6 new checks).
- Grepped the whole scroll inventory: zero unconditional `#thread`
  scrolls left; worldrun's log (separate screen, turn-based) untouched.
- CSS/layout: unchanged from 1.8.1 (no device re-verification needed).

## v1.8.1 — chats open on the last message (2026-09-22)

### The ask

"Every time you close the app and restart it. The chats start at the first
message, and you need to scroll down until last message. Can you make it so
it start at last message or a button that appears just at the start to
scroll automatically to last message" — open chats should start on the
latest message (or offer a jump-to-latest button).

### Root cause (found by reading, not guessing)

The chat screen was `.screen-chat{min-height:calc(100vh - bars)}` — a
**minimum** height, so a long conversation grew `.view` (min-height:100vh)
and the **window** became the scroller. The code, meanwhile, was written
for the other case: `Views.thread`, `appendMessage` and the streaming
`onDelta` all do `thread.scrollTop = thread.scrollHeight` on `#thread`,
which is a silent no-op when `.thread` (flex:1, overflow-y:auto) never
overflows because its container grew instead. And `App.go` ends with
`window.scrollTo(0,0)` — so every chat open reset the window to the top.
Short chats (content shorter than the viewport) never hit this, which is
why it looked like a fresh-start problem.

### The fix

- **CSS:** `.screen-chat` — `min-height` → `height` (100vh, with a
  `@supports (height:100dvh)` enhancement for mobile viewports). `.thread`
  is now always the real scroller, and every existing scrollTop call in the
  codebase works as written: bottom-on-open, follow-while-streaming,
  near-bottom re-renders.
- **JS:** `Views.thread(char, session, messages, streamingId, forceBottom)`
  — new 5th parameter. `App.openSession` (the funnel for every chat open:
  character card resume, chat list, new-chat greeting, fork) passes
  `true`, so a fresh open always lands on the last message even if the
  previous content's scroll position was mid-way. Images below the fold
  (generated art, avatars) load after the first jump and push the content
  down — a one-time `load` handler re-jumps as long as the user hasn't
  scrolled away (<160 px from the bottom).
- No jump button: with auto-scroll-on-open the button's job is done;
  offering the alternative the user suggested would have added UI for a
  state that no longer happens.

### Where it landed

- `css/app.css` — `.screen-chat` fixed height + comment explaining the trap.
- `views.js` — `Views.thread` forceBottom param + image-load re-jump.
- `app.js` — `App.openSession` passes forceBottom.
- `tests/threadscroll-test.js` — new suite, 5 checks, on a fake `#thread`
  with real scroll math: fresh open → bottom; top of a long previous chat →
  bottom; mid-scroll re-render keeps position; near-bottom re-render
  follows; streaming reply scrolls to bottom.

### Verification

- Full suite 13/13, all green (302 + 5 checks).
- CSS half (the actual scroller swap) is layout — verified on device per
  project convention, pinned in code comment + README.
- Worldrun (`#wr-thread`, different screen) and every other screen
  untouched — the change is scoped to `.screen-chat`.

## v1.8.0 — Retry button on a failed send (2026-09-20)

### The ask

"In horde mode. After 5 tryes the process stops. Can you add a button to the
last thing user send. To retry" — when a Horde send dies after the built-in
5-worker empty retry, the process stops with an error toast and the user has
to retype the message. They want a button on their last sent message to send
it again.

### Design

- **Flag on the message, chip in the renderer.** On failure, `generateReply`
  marks the last *user* message `retry = true` and re-renders the thread.
  `Views.messageHtml` renders a highlighted `↻ Retry` chip (first in the
  user bubble's `.msg-actions`) exactly when that flag is set. Assistant
  messages never get it. The flag survives re-renders (navigate away and
  back, the offer is still there) until it's cleared.
- **Retry = same message, fresh attempt.** The chip's handler clears the
  flag and calls `App.generateReply()` with no options — the existing user
  message stays put (no duplicate bubble, context identical to the original
  send) and a new assistant bubble is generated against the same history.
  The Horde re-dispatches to whatever worker is free. If that also fails,
  the catch flags it again — the chip stays, tap again.
- **Cleared when moot.** Any successful reply (the `generateReply` success
  path) and any fresh `App.send` clear all `retry` flags and remove any
  leftover `.chip.retry` from the DOM.
- **Only honest triggers.** The flag is set in the non-abort error branch,
  and only when the last stored message is a user message — so a failed VH
  outreach or a failed reroll (last message is an assistant bubbs.js` — chip in `messageHtml` (user bubbles only, `m.retry` gated);
  `Views.messageHtml` exported for testing.
- `css/app.css` — `.chip.retry` styling (accent colour, soft background).
- `tests/retry-test.js` — new suite, 9 checks: chip rendered for flagged
  user messages (with icon + highlight class + sibling chips intact), absent
  when unflagged, absent on assistant messages even when flagged, present
  for an empty message body.

### Verification

- Full suite 12/12, all green (293 + 9 checks).
- APK content-checked after build (chip string in views.js, retry action in
  app.js, `.chip.retry` in app.css, sw v10, store 1.8.0).

## v1.7.0 — “Any available (uncensored)” Horde text model (2026-09-20)

### The ask

“in horde text model theres an option that says Any available (fastest), can
you make an option any available (Uncensored) that targets any available
model but Uncensored ones only?” — a text-model option that uses any
available Horde model, restricted to uncensored ones.

### The API has no uncensored flag (verified empirically)

`GET /api/v2/status/models?type=text&model_state=all`
(Client-Agent + `apikey: 0000000000`) → 29 text models; each row carries
exactly `{name,count,eta,jobs,performance,queued,type}`. No safety or
uncensored field exists in the response, and the older endpoints
(`/api/v2/models`, `/api/v2/text/models`) 404. So “uncensored” must be a
name-pattern filter over the live model list — the community convention
(abliterated / heretic / uncensored), the same tags used in the
Termux/llama.cpp context.

### Design decisions

- **Sentinel value, not a model name.** `s.hordeTextModel =
  '__any_uncensored__'` (`Horde.ANY_UNCENSORED`), alongside `''` = no
  filter. All four Horde-text call sites in api.js (chat, memory summary,
  persona quickText, VH generateFree) keep passing the stored value through;
  resolution happens exactly once, inside `Horde.generateText`, before the
  payload is built.
- **Detection by name.** `Horde.isUncensored(name)`: marker
  `/abliterat|uncens|heretic/i` plus a short curated family list for the
  well-known uncensored models that ship without a marker
  (forgotten-safeword, stheno, magnum). Against the live 29-model list of
  2026-09-20 it flags exactly the marker models (Qwen3.8-27B-Uncensored,
  gemma-4-31B-it-heretic, Gemma-4-E4B-it-Ultra-Uncensored-Heretic,
  Judas-Uncensored, gemma-4-E4B-it-ultra-uncensored-heretic-Q4_K_M,
  Gemma-4-E4B-Uncensored-HauhauCS) plus Stheno ×3, Forgotten-Safeword and
  mini-magnum — and skips plain instruct and unmarked RP models (Skyfall,
  Behemoth, Cydonia, Angelic Eclipse, Nymphaea, Super-Nova).
- **“Any available” = has workers right now.** `anyUncensored()` =
  `onlineTextModels()` filtered by `isUncensored` — reuses the existing
  5-minute model-list cache, so no extra requests.
- **No silent censored fallback.** If zero uncensored models are online,
  `generateText` rejects with “No uncensored workers are online right now —
  use ‘Any available (fastest)’ or pick a specific model.” Falling back to a
  random instruct model would defeat the purpose of the option.
- **guardModel skips the sentinel** (it is not one model); the refusal lives
  in generateText, where the list is known.

### Where it landed

- `horde.js` — `ANY_UNCENSORED`, `isUncensored`, `anyUncensored`,
  `modelLabel`; `generateText` is now a thin wrapper over
  `generateTextCore(o, models)` that resolves the model first;
  `payload.models` is built from the resolved list.
- `app.js` — model sheet gains a third entry (text type only):
  value = sentinel, label “Any available (uncensored)”.
- `api.js` — `guardModel` passes the sentinel through.
- `views.js` — settings button shows `Horde.modelLabel(...)` so the sentinel
  renders as its option name.
- `store.js` — comment on `hordeTextModel`.
- `tests/horde-uncensored-test.js` — new suite, 20 checks: detector
  positives/negatives, availability filter (offline uncensored model
  excluded), the exact payload for '' / sentinel / named model (captured
  from the mocked `/generate/text/async` POST), and the refusal message.

### Verification

- Full suite 11/11 suites, 293 checks (273 + 20 new).
- Live sanity: on today's live list the sentinel resolves to 10 models, all
  count>0 (Qwen3.8-27B-Uncensored 4 workers, Forgotten-Safeword-22B 4,
  L3-8B-Stheno-v3.2 4, gemma-4-31B-it-heretic 3, mini-magnum-12b-v1.1 2, …).

### Limits / not ported

- Heuristic only: a model with no marker in its name and no family on the
  list is invisible to the option. `UNCENS_FAMILIES` is deliberately short;
  extend it when a new staple appears.
- No per-worker verification — the filter decides which *models* to ask for,
  not what a worker actually serves.
- Images: no equivalent option (the image model sheet is unchanged).

## v1.6.0 — upstream 18.1.0 alignment (2026-09-20)

### The ask

"Update the APK to the latest version" — clarified to mean upstream
`ddkhan24/hordestudio` 18.1.0, released 2026-09-20 08:22 UTC. Upstream
18.1.0 is a Virtual Humans 2.0 desktop release: rebuilt creation forms
(page builder, system map), three new engine subsystems (mind 685 lines,
cognition 95, embodiment 138), 52 Python backend modules reorganised into
`virtual_humans/backend/`, and behavioural fixes found by a 100-day
end-to-end scenario (docs/vh2/complex-100-day-e2e-20260920). Scope decided
with the user: **aligned port** — the behavioural fixes that make sense on
a phone, the desktop-only subsystems documented as not ported.

Method: GitHub compare API for `v18.0.4...v18.1.0` (2 commits, 296 files —
the repo tarballs are ~320 MB each and /tmp is a 1 GB tmpfs, so no
extracting), patches read for the simulation-relevant engines
(vh2-social-bonds, vh2-lifestyle/geography, vh2-decision, vh2-transport,
vh-simulation-core, vh-life-schema), plus the 18.0.2/18.0.3 release notes
to close the gap since the mobile app's last port (18.0.1, context budget).

### What the 100-day test actually found (and what the phone shared)

- **Social bonds:** completed contact activities never counted as bond
  evidence — only calendar-plan co-location did, so over 100 days
  relationships with supporting people flatlined. **The mobile engine had
  the identical bug**: `people[].closeness` was authored once and nothing
  in the engine ever touched it. → Ported.
- **Sleep:** urgent-sleep-pressure gate (pressure ≥ 85 → only sleep goals;
  ≥ 75 at home → propose sleep). Mobile sleep is a fixed window
  (`isAsleep` by time) — no pressure dynamics exist to fix. → Not
  applicable.
- **Meals:** poverty no longer suppresses essential meals (eat, record
  debt; home meals free). Mobile lives have no money/cost model — meals
  always happen. → Not applicable.
- **Travel:** embodiment-aware mode filtering (new embodiment subsystem).
  Mobile travel is a single walking/routed leg, no modes, no body profile.
  → Not applicable.
- **Decision temperature scaling** (uneven cognition) — mobile wander is a
  plain probability, no temperature. → Not applicable.

### Changes

1. `js/vhuman.js` — `VH.tickPeople` (wired into `tick` after needs, so
   travel/meal beats still win the chronicle slot): per-person
   `lastContact`; contact probability per awake hour by autonomy
   (off 0 / low 0.03 / medium 0.08 / high 0.16, ×1.5 when social need >
   0.7); a meeting is 15–120 min and moves closeness by 0.025–0.135
   (positive when the bond is not hostile, negative when it is); drift:
   only people with a recorded meeting fade, 0.012/day after 14 days of
   silence, capped at neutral. `CONTACT` table beside `WANDER`.
2. `js/views.js` — AI persona draft: the tagline becomes the character's
   direction with an explicit anti-normalisation instruction; "strengths,
   flaws" reworded to "strengths and flaws as they actually are". Still
   one bounded `quickText` request (320 tokens) filling the persona field
   only.
3. `js/app.js` — `vhOutreach`: a reply that is empty after
   `stripThinking`/`cleanReply` now throws into the existing backoff
   handler — no budget spent, no "…" bubble, no auto-resubmit. (18.0.3
   class.)
4. `js/views.js` — Life-editor place delete: cancels an ongoing trip to/from
   the place, moves them if it's where they are, clears `placeId` from
   diary events, and toasts exactly what happened.
5. Audits with no change needed: outreach budget was already deducted only
   on success with backoff (18.0.2/18.0.3 parity); no save-path truncation
   of long character text (all `slice`s are display/prompt-context);
   template + full portable-human export/import already v18-era. The
   *interactive* reply path keeps its "…" placeholder on an empty reply
   (app.js main generateReply): that flow has a built-in 3-attempt Horde
   retry, no budget to burn, nothing to wedge, and the bubble is
   re-rollable — so upstream's malformed-reply recovery changes behaviour
   there only for the worse.
6. `sw.js` cache `horde-studio-v7` → `horde-studio-v8` (SHELL changed;
   cache-first worker).

### Verification

New suite `tests/vhuman-test.js` — 16 checks, real `vhuman.js` in a VM
with a frozen `Date` (2026-09-20T10:00Z) and a steerable `Math.random`,
so the 100-day-class behaviour is provable: authored unmet people stay
exactly as written; met people drift gently and stop at neutral; a 24h
high-autonomy tick guarantees a recorded meeting that warms a warm bond
and sours a hostile one; no contact while asleep, at autonomy off, or when
the low-autonomy roll fails.

Full suite: **273 passed, 0 failed** (previous 257 + 16 new).

Not ported (desktop-only, documented in README): mind/cognition/embodiment
subsystems, embodiment-aware routing, sleep-pressure dynamics,
money/debt model, page-builder creation form, Python live backend,
worker-encoding/packaging fixes.
ssed, 0 failed** (previous 257 + 16 new).

Not ported (desktop-only, documented in README): mind/cognition/embodiment
subsystems, embodiment-aware routing, sleep-pressure dynamics,
money/debt model, page-builder creation form, Python live backend,
worker-encoding/packaging fixes.
