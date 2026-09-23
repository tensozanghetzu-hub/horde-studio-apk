# Horde Studio — Mobile

Current build: `HordeStudio-v1.5.0.apk` (versionCode 17), sha256 b3ec66a373f328af8c8b22659d5afcc858452a606d59c304e7ba7e058e345f27 (277,659 B).
Channel `webRev c2812024342e`, 20 files, web.zip 157,639 B.

Published as a GitHub Release (see `.github/workflows/release.yml`); the app's updater
reads the channel in `docs/`, not the release.
Permissions: INTERNET, ACCESS_NETWORK_STATE, REQUEST_INSTALL_PACKAGES (kept on purpose — it makes Play Protect warn; user accepts 'install anyway'), storage (maxSdk 28).

Rebuild: `cd apk-build && bash ./setup-sdk.sh && bash ./build.sh` (SDK is deleted after each build).
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
  outreach or a failed reroll (last message is an assistant bubble) never
  stamps a stale Retry onto an old user message.

### Where it landed

- `app.js` — catch branch flags last user message + re-renders; `retry`
  action in the thread click dispatcher; flag/DOM cleanup in the generate
  success path and at the top of `App.send`.
- `views.js` — chip in `messageHtml` (user bubbles only, `m.retry` gated);
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
