# Horde Studio — Mobile

Current build: `HordeStudio-v1.30.2.apk` (versionCode 65) — 339,299 B,
sha256 `41a9dae16b026c7d269ca91cc0561e21cad5e96bd6ef2aa205a54cffbce6ff86`.
Built 2026-10-16: `docs/` serves v1.30.2 (webRev `6b1dcfd90680`) and
release `v1.30.2` is the latest on the repo.

Published as a GitHub Release (see `.github/workflows/release.yml`); the app's updater
reads the channel in `docs/`, not the release.
Permissions: INTERNET, ACCESS_NETWORK_STATE, REQUEST_INSTALL_PACKAGES (kept on purpose — it makes Play Protect warn; user accepts 'install anyway'), storage (maxSdk 28).

Rebuild: `cd apk-build && bash ./setup-sdk.sh && bash ./build.sh` — the SDK
does not survive a turn boundary (see the HAZARD below), so setup + build must
run as one command.
Tests: 43 suites in `/home/user/tests/`, one file per fix —
`node /home/user/tests/<suite>-test.js` (v1.30.2: 1334 checks in total).
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


## HAZARD: turn boundaries roll .git back to a stale state (×9, diagnosed 2026-10-16)

Observed 9 times (8 before, 4 in one session on 2026-10-16). Fingerprint,
always the same: the **worktree is current**, but git has been restored to
the last snapshot state in which `.git` was captured *completely* — here
always `b22b121` (the v1.28.1 era). HEAD and the remote-tracking ref
rewind, the object DB is missing every commit made after that state,
`origin` and the local identity are gone, and
`MainActivity.java` comes back in an old partial state. Servers are down,
`tests/node_modules` and the Playwright browser are wiped.

**Cause (confirmed parts):** at a boundary the workspace is rebuilt from a
snapshot that is **best-effort, capped at ~128 MB / 10,000 files**, and
that **excludes** `node_modules`, `.cache`, build dirs, and credential
paths — **`.git/config` is on that exclusion list**, which is why the
remote and identity vanish every time. Processes don't survive at all,
and `apk-build/android-sdk` is wiped (setup + build must stay one command).

**Cause of the .git rollback (evidence-based):** the snapshot drops the
loose-object cloud. Before the fix below, `.git` held **1,166 loose
object files (30.6 MB)** — a file-count target under the 10k cap, so its
capture is partial; a restore then merges the current worktree with the
stale last-complete `.git`. Everything pushed to GitHub is never lost —
every one of the 9 losses touched only unpushed commits, and all of them
were cheap to reconstruct because the worktree survived.

**The permanent fix is on the platform side** (snapshot `.git` reliably,
or make it a first-class restore target) — report it to Arena with this
fingerprint. In the meantime, losses are made harmless:

1. **`bash tools/git-doctor.sh`** (add `--fix` to restore victim files) —
   the full recovery as one idempotent command: key perms, identity,
   remote, fetch, reset-to-origin (only when strictly behind), victim-file
   check, and a `git gc`. Run it at the start of any turn that touches git.
2. **Commit AND push in the same turn.** The remote is the durable source
   of truth; an unpushed commit is the only thing a loss can eat.
3. **`git gc` after every push** (the doctor does it automatically):
   packs loose objects into a single ~1 MB pack file instead of a
   thousand tiny files — the shape that survives the snapshot cap.
4. Re-warm the wiped deps when needed: `cd tests && npm i` +
   `npx playwright-core install chromium` (apt libs persist, the browser
   binary and node_modules do not).

---

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

## HAZARD: field initializers must not touch the context

Found 2026-10-10 (v1.22.1): `private final File logFile =
new File(getFilesDir(), …)` in MainActivity crash-looped every launch —
field initializers run during construction, before `attach()`, so
`getFilesDir()` NPEs. Compile-clean, invisible to the Node battery,
present in the dex as a string: **the marker was in the dex; the bug was
in when the line runs.** Guard: `tests/initializers-test.js` scans for
context calls in `private … = …;` lines and fails the battery. Any new
wrapper state that depends on a context is a method or an onCreate
assignment, never a field initializer.

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

## v1.30.2 — The referee stops pasting the whole sheet into the story (2026-10-16)

### The bug (on-device, reported 2026-10-16)

On the first turn of a heavy authored world ("The Lantern Marches", 64
hudConfig stats), the model's reply ended with the ENTIRE character sheet
pasted back as prose — "Time: Thursday 15:20 / Stats: … 64 lines … /
Money: 0 copper marks / Carrying: …" — appended to the scene, making the
story text unreadable.

### The diagnosis (model vs world)

The app feeds the referee a state block every turn
(`hordeworld.js: describeState`): `Time: …`, `Stats: …` (every hudConfig
stat), `Money: …`, `Carrying: …`, `Tasks: …`. The pasted text in the
player's reply matched that block **word for word, line for line** — it is
the referee's own bookkeeping block echoed verbatim into the answer, not
an app bug and not a double-applied state. Two things made it likely:
(1) the world declares a large sheet (64 stats), so the block is long and
tempting to "confirm"; (2) some models on turn one dump the current state
as a baseline before playing. The fix is a standing prompt rule.

### The change

- **`js/hordeworld.js`, `buildPrompt`** — the Rules block now tells the
  referee: the state given above (Time/Stats/Money/Carrying/Tasks) is for
  its own record-keeping; **NEVER repeat, paste, or restate it in the
  reply** — the player has the sheet for that; the reply is the scene only,
  plus the tags it needs.

### Verification

`tests/hordeworld-test.js` gained the regression check ("the referee is
told not to paste the state block back into the story"). Full battery,
43 suites: **1334 node checks, 0 failed** (1333 + the new one).

APK `HordeStudio-v1.30.2.apk` — 339,299 B, sha256
`41a9dae16b026c7d269ca91cc0561e21cad5e96bd6ef2aa205a54cffbce6ff86`;
in-APK bundle verified: `VERSION = '1.30.2'`, sw `horde-studio-v52`,
versionCode 65, the new rule in `hordeworld.js`, baked-in update address =
the Pages channel. The superseded `HordeStudio-v1.30.1.apk` was dropped
(release asset retains the copy).

Bumps: 1.30.2 (patch — on-device prompt fix), apk code 65, sw cache v52.

---

## v1.30.1 — The world's answer no longer leaves your words in the box (2026-10-16)

### The bug (on-device, reported 2026-10-16)

The v1.29.1 transaction rewrite changed when the world's input box gets
cleared. The old code cleared it the instant the player hit send; the
new code only ever RESTORED the text (on a failed turn) and never
cleared it on success. So a perfectly committed turn — the message in
the thread, the referee's answer arriving, the HUD updated — left the
player's words sitting in the input box, looking un-sent.

### The change

- **`js/app.js`, `App.worldTurn`** — clear the input box at the moment
  the words go into the thread (the original send-time behaviour). The
  transaction's failure paths already put the words back into the box
  when a turn fails or is stopped, so nothing is lost either way.

### Verification

`tests/worldturn-integrity-test.js` gained the regression check
("the input box is cleared once the turn commits" — 89 checks now); the
failed-turn sections already assert the words come BACK into the box.
Full battery, 43 suites: **1333 node checks, 0 failed.**

APK `HordeStudio-v1.30.1.apk` — 339,299 B, sha256
`12a6408ee93b4a1f3b2a1cc6ff87fe90d7797f94cf76e3ec82e049c80b4b1929`;
in-APK bundle verified: `VERSION = '1.30.1'`, sw `horde-studio-v51`,
the clear in app.js. The superseded `HordeStudio-v1.30.0.apk` was
dropped (release asset retains the copy).

Bumps: 1.30.1 (patch — on-device regression fix), apk code 64,
sw cache v51.

---

## v1.30.0 — Worlds keep their face (2026-10-16)

### The ask

"Worlds on the PC version have an avatar. The APK doesn't import the
avatar. Can you make it so it does?"

The PC version renders `world.banner` — one top-level image in the
`.horde_world` JSON — as the world's avatar: the library card's banner
and the world's DM-header face (a 🌐 fallback when absent). The mobile
import used to strip it: `banner` was in `MEDIA_KEYS`, and any
top-level `data:` URI went with it, so a 2.5 MB world arrived at about
50 KB of pure text and looked faceless on the phone.

### The change

- **`js/hordeworld.js`, `parse`** — `banner` is out of the strip list and
  is now kept, exactly one image: the world's face. Every OTHER
  top-level `data:` URI and the bulk media keys (`mediaAssets`,
  `_mediaManifest`, `visuals`, `presentation`) are still stripped, so a
  2.5 MB world still arrives small. A world without a banner gets a
  stable empty `banner` field.
- **`js/app.js`, `App.importWorld`** — the banner gets the same storage
  diet as card images (512px long edge, via the existing
  `normalizeDataUrl` canvas path, now exposed as
  `Views.dietDataUrl`) BEFORE the world is stored. Web-URL banners and
  anything undecodable pass the diet untouched.
- **`js/views.js`**
  - The worlds screen wears the face: installed-world cards and
    in-progress run cards (a run card shows its WORLD's banner) get the
    avatar box — image when there is one, initials when there isn't.
  - The run's status sheet opens with the world's face and name, the
    same banner the PC version shows in the world header.
  - `avatarHtml`'s src was already attribute-escaped; banners from
    imported files are safe.
- **`css/app.css`** — `.ws-head` (the sheet's face row).

### Verification

`tests/worldavatar-test.js` (new, 23 checks): a bannered world parses
with its banner byte-for-byte while every other top-level data: URI and
the bulk media keys are still stripped; unknown keys still pass through;
a bannerless world gets the stable empty banner; the import path stores
the banner (dieted on a real device, pass-through in the bare sandbox),
says so in the toast, and keeps web-URL banners untouched; the worlds
screen shows the banner on installed and in-progress cards and initials
for bannerless worlds; the status sheet shows the face (or initials)
and keeps its sections; and the banner survives parse → JSON → parse
and an IDB reload. The two legacy "banner is dropped" assertions in
`hordeworld-test` now encode the stable-empty shape. Full battery, 43
suites: **1332 node checks, 0 failed.**

APK `HordeStudio-v1.30.0.apk` — 339,299 B, sha256
`cc4660e04770e65b052d4a6c94792bc69f9ce445302faff28f22de5321d6b7b1`;
in-APK bundle verified: `VERSION = '1.30.0'`, sw `horde-studio-v50`,
`dietDataUrl` in views.js and app.js, the banner keep in hordeworld.js,
`.ws-head` in app.css. The superseded `HordeStudio-v1.29.1.apk` was
dropped (release asset retains the copy).

Note: worlds imported BEFORE this version have no banner to show —
re-import the file and it gets its face back.

Bumps: 1.30.0 (minor — user-visible feature), apk code 63, sw cache v50.

---

## v1.29.1 — Worlds: a turn is a transaction (2026-10-16)

### The bug (P1, data integrity)

`App.worldTurn` ran `HW.applyTags` on the **live** run to judge the first
model reply, then `finishTurn` ran it on the **same** live run again.
Every clean turn double-applied its tags (a `[[clock:+5]]` became +10);
on a repair the draft's effects — the player never saw that reply — were
already persisted, and the repaired answer was applied on top of them.
The dice seed could advance for a check the player never saw. The same
screen could not undo what had happened: the Correct-state screen had no
way to remove a task, and no way to shift the clock. Meanwhile the Horde
answered with model output that the thinking filter could not see — a
scene, a divider, `Self-Correction Check: …`, `Ready to output.` — and
the planning trailer was saved into the story along with the scene.

### The change

- **`js/hordeworld.js`**
  - New `cloneRun` (a `JSON.parse(JSON.stringify(run))` deep copy — the
    old Android WebViews have no `structuredClone`) — the transaction's
    unit: candidates are judged on copies, the live run is only ever
    written by one final, validated answer.
  - New `validateReply(world, run, playerText, raw)`, run BEFORE any tag
    is parsed: an empty answer, a reply containing a code block, a reply
    that ends in a planning trailer (`Self-Correction Check` / `Ready to
    output`, matched only when they START a line — a story line merely
    containing the words is prose), a reply with no scene in it, or a
    near-verbatim repeat of the opening (turn 0) / the referee's last
    line (token containment ≥ 0.8) is not a turn; the reasons are safe to
    show the player.
  - New `preflightChecks(world, applied)`: a `[[roll:…:check:NAME]]` for a
    check the world has no definition for is refused BEFORE the turn
    commits — not after the die has already been rolled and the seed
    consumed.
  - `applyTags`: on a validating (v2) world an unknown bracket command is
    refused and kept out of the story instead of left visible (a typo or
    the model's private bookkeeping); a world that opts out with
    `ledgerV2: false` keeps the old leniency.
  - `correctState`: new `removeQuest` (a task the ledger never should have
    gained can actually go) and `clockDelta` (a manual shift in
    `extraMinutes`, the same field `[[clock:+N]]` writes).
- **`js/api.js`**
  - `stripThinking` and `cleanReply` now pop a planning TRAILER from the
    end of a reply (the observed Horde pattern), including the divider
    and blanks around it — while a story that merely ends on the
    author's own divider is left exactly as written.
  - The Horde text branch records `API.lastHorde` — the model and worker
    that ACTUALLY answered, kudos/tries, and what was requested —
    instead of dropping everything but `r.text`.
- **`js/app.js`** — `App.worldTurn` rewritten as a transaction:
  - snapshot the pre-turn run; every candidate (first reply, then the one
    repair) is evaluated on a fresh deep copy — validation, tags, scene
    audit, check preflight — and never touches the live run;
  - only a validated final answer is committed: `HW.commit` + check
    resolution + the Horde receipt (`lastModel`/`lastWorker`) happen in
    the transaction, then the run is saved;
  - a save failure, a failed API call, a stop, or a repair that is not a
    valid turn restores the pre-turn state (same run object, pre-turn
    contents), puts the player's words back in the box, and says exactly
    what stood in the way — nothing is committed, nothing is half-made;
  - a repair's refusals are kept on the run (the ledger says what the
    draft tried and why it did not stand), but the draft's state and
    prose never do.
- **`js/views.js`**
  - Correct-state screen: every task (open or done) has a **Remove**
    button, and a **Time** field shifts the clock by minutes — both flow
    through the same one-correction-per-change path as the rest.
  - The status sheet gains a **Referee** line: the model and worker that
    answered the last turn (when a Horde worker answered it).

### Verification

`tests/worldturn-integrity-test.js` (new, 88 checks) + fixture
`tests/fixtures/lantern-marches.horde_world` — written FIRST, run against
the unpatched code (38 passed / 50 failed: the whole P1 surface
reproduced — double clock/cash, the draft's phantom quest and companion
persisted with no repair ever called, the failed repair and failed save
still committing, the code fence's `[[clock:+30]]` running twice, the
planning trailer committed, the intro-echo's tags running), then green
against the fix. Covers: single-apply clean turn; rejected draft leaves
no trace and the repair is authoritative (seed untouched, no draft
prose, no draft check line); a duplicate companion vs the pre-turn party
is still refused AND the refusal survives onto the run; a failed repair /
failed first answer / failed save changes nothing and returns the input;
a valid check resolves exactly once (seed advances exactly one step);
code, trailer, unknown tag, empty reply, and intro echo are not
committed and their tags never run; `correctState` removes tasks and
shifts the clock; the trailer is stripped from output; and the Horde
receipt (model/worker/requested) survives the API. The two legacy
unknown-tag assertions (`hordeworld-test`, `worldcompanions-test`) now
encode the v2 contract (refused + kept out of the story; opt-out keeps
the old visibility). Full battery, 42 suites: **1309 node checks,
0 failed.**

APK `HordeStudio-v1.29.1.apk` — 339,299 B, sha256
`8e87da10af2c31e54477a68e9399eec61a2ede0c9589b2683d08148e2876f766`;
in-APK bundle verified: `VERSION = '1.29.1'`, sw `horde-studio-v49`,
`cloneRun`/`validateReply` in hordeworld.js, `lastHorde` in api.js, the
transaction in app.js, `removeQuest`/`clockDelta` in views.js. The
superseded `HordeStudio-v1.29.0.apk` was dropped (release asset retains
the copy).

Bumps: 1.29.1 (patch — data-integrity fix), apk code 62, sw cache v49.

---

## v1.29.0 — Character cards can carry more pictures than the avatar (2026-10-15)

### The ask

"Some character cards come with images (beside the avatar one). Can the app
show them, or don't they get imported?" — Answer at the time: they were
dropped at import. The v3 spec allows arbitrary fields in a card's `data`
block, and card authors often stash extra pictures there (data-URLs or
image web URLs). Decision: **details screen only** — no in-chat strip,
never part of the prompt.

### The change

- `js/store.js`, new `Store.cardImages(data, avatar)`: walks the card's
  data (v3 `data` block or v2 root, objects nested up to 3 levels deep)
  and collects string values that are `data:image/…` or http(s) image
  URLs (`.png/.jpg/.jpeg/.webp/.gif`, query strings allowed) as
  `[{name, src}]` — field names preserved, with the parent key prefixed
  when nested (`gallery.cover` → `gallery_cover`). `char_x` is excluded
  by name, any value duplicating the avatar is excluded by content,
  non-image strings are ignored, and the haul is capped at 8 pictures.
  Wired into `cardToCharacter` (v2 and v3 branches).
- `js/views.js`, new `Views.normalizeCardImages`: the imported pictures
  get the avatar's storage diet — data-URLs downsized to a 512px long
  edge, web URLs (and anything undecodable) pass through untouched.
  The editor gains a **Card images** group (grid below the avatar,
  shown only when the character has pictures); tap opens the existing
  lightbox full-screen. The hint says what they are: from the card,
  never sent to the model.
- `js/app.js`, `App.importCard`: runs `normalizeCardImages` right after
  the avatar is normalized, before the import-confirmation sheet.
- `js/store.js`, `characterToCard`: the pictures ride back out in the
  exported card's `data` as `image_1…image_n`, so export → import keeps
  them.

Web-only: ships as the small in-app web update (sw cache v48).

### Verification

`tests/cardimages-test.js` (new, 21 checks): v3 nested + web-URL
pictures found with their names, text and non-image URLs ignored,
avatar duplicates excluded, v2 cards covered, empty cards get an empty
list, the 8-picture cap keeps the first eight in key order,
normalization downsizes data-URLs and leaves web URLs alone (plus the
source contract that importCard runs it), the editor renders the
guarded "Card images" group wired to the lightbox, and the export →
re-import round trip preserves everything. Full battery, 41 suites:
**1205 node checks, 0 failed.**

APK `HordeStudio-v1.29.0.apk` — 335,203 B, sha256
`49eb3aa192bebd404dbcdab3455c1138b38680136ce280c224f2943f9fb7f1b1`;
in-APK bundle verified: `VERSION = '1.29.0'`, sw `horde-studio-v48`,
`cardImages` in store.js, the "Card images" group in views.js. The
superseded `HordeStudio-v1.28.3.apk` was dropped (release asset retains
the copy).

Bumps: 1.29.0 (minor — user-visible feature), apk code 61, sw cache v48.

---

## v1.28.3 — Editing a message no longer flings you up the thread (2026-10-15)

### The report

"Every time I edit a message and accept the changes, the text scrolls up
a few times. Then I need to scroll back down to the edited message and
its response."

### Finding

Two halves, both in the chat re-render:

1. `App.editAndResend` (the accept-edit flow) re-rendered the thread
   **without** the forced bottom pin — so the reader landed wherever the
   natural-stick/anchor logic decided, not on the message they just
   edited.
2. The re-render rebuilds the whole thread's HTML; the avatars and
   generated images in it are zero-height until they load. The
   bottom-pinning jump happens once, at layout time — then every image
   that lands **below the fold** pushes the content down and strands the
   pinned view higher in the thread (one visible "up" shift per image).
   The guard that re-pins on image load existed, but was attached **only
   on forced opens** (chat opening) — never on a bottom-stick that
   happened naturally, which is exactly what the edit flow produced.

### The change

- `js/app.js`, `App.editAndResend`: the re-render after accepting an edit
  is now the forced kind (`Views.thread(..., null, true)`). Accepting an
  edit is an explicit "take me to the new bottom" — the fresh reply
  lands below the edited message.
- `js/views.js`, `Views.thread`: the image re-pin (re-jump to the bottom
  when an unloaded image below the fold lands, if the reader is still
  within 160px of the bottom) is now attached on **every** bottom stick,
  forced or natural. The guard is unchanged: a reader who has scrolled
  up to read something is never yanked back. Mid-thread anchored
  re-renders (delete, swipe) keep the anchor-restore path.

Web-only: the fix arrives as the small in-app web update (sw cache
v47); the APK wrapper is rebuilt for the release as usual (code 60).

### Verification

`tests/threadscroll-test.js` gained the v1.28.3 section (6 checks): a
forced bottom open re-pins when images land below the fold, a **natural**
near-bottom pin does too (failed pre-patch), a reader who moved on is
never yanked, and the edit-and-resend re-render is the forced kind
(source contract; failed pre-patch).

Full battery, all 40 suites: **1184 node checks, 0 failed** — with the
two Playwright suites genuinely running (see below).

### Also this release — test-battery repair (no app change)

The turn boundary had wiped `node_modules`, the Playwright browser and
`apk-download/server.py` (the :8010 channel server the update-test
drives). Rebuilding them surfaced that `update-test.js` had been stale
since v1.4.7 — it assumed the pre-v1.16 flat settings screen and a dead
sandbox host for the baked update address, so it crashed at section 7
while the old tally silently counted its partial passes. The suite now
navigates the hub → App updates sub-screen, asserts the real baked
default (`tensozanghetzu-hub.github.io`), and accepts the browser
fallback's `/app` address. `server.py` rebuilt: serves `docs/` on :8010
with CORS and `/app` → `HordeStudio-latest.apk`. 29/29 green.

The same boundary had rolled local HEAD back two commits (the v1.28.2
pair) and dropped the git identity + remote; origin was intact.
Restored via `reset --mixed origin/main` + re-checkout of the v1.28.2
`MainActivity.java` — the filepicker suite caught the worktree drift
immediately (its 2 native checks failed until the restore).

APK `HordeStudio-v1.28.3.apk` — 331,107 B, sha256
`a350f154b1b1defc63abc2fcf98e14f45d1baff1ff5d866a9ebb0ebdbcde7548`;
in-APK bundle verified: `VERSION = '1.28.3'`, sw `horde-studio-v47`,
the re-pin block in `views.js`, the forced pin in `app.js`. The
superseded `HordeStudio-v1.28.2.apk` was dropped (release asset retains
the copy).

Bumps: 1.28.3 (patch — fix), apk code 60, sw cache v47.

---

## v1.28.2 — Import: the file picker actually shows the files it accepts (2026-10-11)

### The report

From the device: importing a world, the system file picker (Xplore)
showed only JSON files — "Filter: application/json" — although the app
imports `.json`, `.png` and `.horde_world`.

### Finding

The web side was correct: the world import's file input declares
`accept=".horde_world,.json,application/json"`. The native side was not:
`onShowFileChooser` kept only the FIRST accept type and set it as the
intent's type. Pickers that honor the intent's type (Xplore) then showed
exactly that one family — and extension types like `.horde_world` have
no MIME of their own to begin with, so those files could never appear,
no matter how many times the web side named them.

### The change

`apk-build/.../MainActivity.java`, `onShowFileChooser`: the picker now
stays open (`*/*`) unless the page asks for exactly one well-known
family (`image/*` for pictures, `application/json` for JSON-only
imports). Anything else — every multi-format import — shows all files,
and the app validates whatever comes back (world parse, JSON parse,
image processing), as before. No web change; the update arrives as an
APK install (webRev unchanged, sw cache unchanged).

### Verification

`tests/filepicker-contract-test.js` (new, 8 checks) pins both halves of
the contract: the world import's accept list names `.horde_world`,
`.json` and `application/json` as more than one type, and the native
handler defaults to the wildcard, narrows only on a single accepted
type, and can never narrow on an extension type. All three native-side
checks failed pre-patch. Full battery: **1153 node checks, 0 failed.**

APK `HordeStudio-v1.28.2.apk` — 331,107 B, sha256
`6f7a8d0d0c756958d738fbf83811815a23ab0f2b2811eedb05de35d9ad7905b7`;
in-APK bundle verified: `VERSION = '1.28.2'`, the recompiled
`onShowFileChooser` in classes.dex. This is the first release since
v1.25.0 whose fix lives in the native layer — the update is an APK
install (webRev changed only by the version string). The superseded
`HordeStudio-v1.28.1.apk` was dropped (release asset retains the copy).

Bumps: 1.28.2 (patch — fix), apk code 59, sw cache v46 (unchanged).

---

## v1.28.1 — Worlds: the ledger no longer celebrates nothing (2026-10-11)

### The report

From a live world (The Elos Wayfinder): a turn whose reply was only an
italic echo of the player's action, a `***`, and "What do you do?" — and
the change-chip row reading `moved to Pine-Covered Ridge`, `0 minutes
pass`, `+0 copper`, `ID +0` on a turn the player explicitly did not move.

### Findings & the change

- **The echo turn — world/model, not app.** The app displayed exactly
  what the model returned; the constrained re-ask got a proper reply, so
  the pipeline is fine. No app change; the lever is the world's model or
  dmPrompt.
- **The junk chips — model junk the app let through and celebrated.**
  The model tagged `[[clock:0]]`, `[[cash:+0]]`, `[[stat:ID:+0]]` (a stat
  id the world never declares — v2 validation checks places, items and
  tasks but never stat ids) and a move to the location the player
  already occupied. `js/hordeworld.js`:
  - zero-value clock/cash/stat tags produce no change line and no ledger
    entry;
  - a move tag to the current location is a no-op (no chip, no log);
  - a stat id the world never declares is not recorded — worlds that
    declare stats are protected, stat-less worlds (Elos et al.) stay
    free-form;
  - the scene-discipline move advisory, which used to say "the move
    went to X instead" when the model tagged the player's current place
    (misleading — the player went nowhere), now says "no move was
    recorded — you are still at X".
- **Test-harness honesty:** the battery tally now also fails on
  "N failed" (N > 0) in a suite's summary — it had been silently
  accepting a failing suite whose summary line read "365 passed, 1
  failed".

### Verification

Test-first: 7 new checks in `tests/hordeworld-test.js` (zero chips,
same-place move no-op, real move/cash/clock still chip, undeclared stat
id refused, declared stat still works, stat-less world free-form) — 3
failed pre-patch. The audit-note change kept the existing
scene-discipline check green (its "Reception" assertion now comes from
"you are still at Reception"). Post-patch: full battery **1145 node
checks, 0 failed**, under the stricter tally.

APK `HordeStudio-v1.28.1.apk` — 331,107 B, sha256
`ade64a378de399cd03fbfd914c7c9f54d9d5358b4bd2f9a91e89774dcfa2f8ee`;
in-APK bundle verified: the v1.28.1 ledger guards present in
`hordeworld.js`, `VERSION = '1.28.1'`, sw cache `horde-studio-v46`. The
superseded `HordeStudio-v1.28.0.apk` was dropped (release asset retains
the copy).

Bumps: 1.28.1 (patch — ledger hygiene), apk code 58, sw cache v46.

---

## v1.28.0 — Worlds: the party, correctable by hand (2026-10-11)

### The ask

Reported from the device: the scene clearly has the player with Elias and
a projection of Lyra, but the status sheet's PARTY line says no one is
with them. Finding: the party ledger is filled only by the referee's
`[[with:NAME]]`/`[[part:NAME]]` tags, which demand names from the
world's cast — a projection is not one — and the model in this world
simply isn't tagging companions at all. With no tags, there was no way to
fix the party by hand: Correct state had Pockets and Tasks editors but
no Party editor.

### The change

- **`js/hordeworld.js`:** `correctState` takes `addCompanion` /
  `removeCompanion`. A hand join writes the same ledger entry a tag
  would (`{name, since, at}` — the sheet's "joined at …, turn …" and the
  prompt's witnessed-scene rules work unchanged), obeys the same six
  companion cap, and normalizes casing. Unlike the referee's grammar it
  is lenient about names: a cast member is stored under the canonical
  spelling, and anything else the story actually uses ("a projection of
  Lyra") is recorded as written.
- **`js/views.js`:** the Correct-state screen gains a Party section —
  chip list with `×` removal and an "Add a companion… (any name the
  story uses)" field, same pattern as Pockets. Applying diffs names:
  removed ones `removeCompanion`, new ones `addCompanion`.
- No prompt, tag, or tag-validation changes — the referee keeps its
  existing grammar; this is the player's hand on the same ledger.

### Verification

Test-first: `tests/worldcompanions-test.js` gained five checks (hand
join carries place and turn; casing never duplicates; removal; an
unknown name is still recorded; the six cap holds) — all failed
pre-patch. `tests/worldstatus-test.js` asserts the rendered correction
screen contains the Party section (failed pre-patch).
`tests/worldbusy-test.js` registers the new form ids. Post-patch:
companions 28/0, worldstatus 29/0, full battery **1138 node checks,
0 failed.**

APK `HordeStudio-v1.28.0.apk` — 331,107 B, sha256
`cb9240d4abd5ec116e1fc176af2b089a7aa89be3908207b2749aee8dc32b4a22`;
in-APK bundle verified: `addCompanion`/`removeCompanion` in the engine,
the `wc-companion` form in the views, `VERSION = '1.28.0'`, sw cache
`horde-studio-v45`. The superseded `HordeStudio-v1.27.1.apk` was dropped
(release asset retains the copy).

Bumps: 1.28.0 (minor — user-visible feature), apk code 57, sw cache v45.

---

## v1.27.1 — Worlds: the pockets stop duplicating; Correct state renders (2026-10-11)

### The report

From a real world (The Elos Wayfinder), three observations: pockets listed
"Hose Coil" twice and "Obsidian_Stone" four times though the player
carried one of each; the **Correct world state** screen opened **blank**;
and the status sheet said "This world keeps no numbers" in a world of
levels and skills.

### Findings & the change

- **Duplicate pockets — app bug, fixed.** Worlds without an item registry
  (most authored worlds; the Policy Panic fixture included) let the
  referee's `[[item:…]]` tag push the name into `run.inventory` blindly,
  so every turn that mentioned the item again grew another copy. All add
  paths now dedupe case-insensitively: the tag path, the manual
  correction (`corr.addInventory`), and `HW.normalizeRun` — a new
  self-heal that runs when a world opens, so a saved run that already
  carries duplicates cleans itself on the next open (first spelling wins).
- **Blank Correct-state screen — app bug, fixed.** `Views.worldCorrect`
  resolved its body with `root.querySelector('#world-correct-body')`, but
  the root it receives is `document.querySelector('.screen')` — the FIRST
  screen section in the DOM — while the body div lives in the
  worldcorrect section. On a real device the lookup returned null and the
  view silently returned, leaving the title over an empty screen. The
  view now resolves the body by id at document level, like every other
  view. (The VM harness had been masking this: its fake `.screen` answered
  every `querySelector` with a deep fake. It is now honest — `'.screen'`
  resolves to a first section that does not contain the body — and
  asserts the screen actually renders.)
- **"Keeps no numbers" — not an app bug, clarified.** The Numbers panel
  shows the numbers the world's rules *declare* (`hudConfig.stats`),
  updated by the referee's `STAT:` tags. A character like Azarin can be
  "full of numbers" in her description while the world declares no
  tracked stats, in which case the panel is honestly empty. The hint now
  says which case it is: "its rules declare no tracked stats" vs
  "the referee has not reported a value for any of them yet."

### Verification

Test-first: `tests/hordeworld-test.js` gained the dedup section (double
mention → one item; casing; correction path; stored-run heal) — 5 fails
pre-patch; `tests/worldstatus-test.js` now renders the correction screen
against an honest fake DOM — 1 fail pre-patch (the blank screen);
`tests/worldbusy-test.js` updated to the document-level body contract.
Post-patch: **all green. Full battery: 1132 node checks, 0 failed.**

APK `HordeStudio-v1.27.1.apk` — 331,107 B, sha256
`1821fa2baa15cafdc14bff99c156fbb752182dc330b5269ccd86d3bbd0eee145`;
in-APK bundle verified: `normalizeRun` present, the document-level
`#world-correct-body` resolution, the clarified hint,
`VERSION = '1.27.1'`, sw cache `horde-studio-v44`. The superseded
`HordeStudio-v1.27.0.apk` was dropped (release asset retains the copy).

Bumps: 1.27.1 (patch — defect fixes), apk code 56, sw cache v44.

---

## v1.27.0 — Appearance trimmed to thirteen; quoted speech gets a voice (2026-10-11)

### The ask

User request: remove the Orchid, Porcelain and Paper colour schemes, and —
reported from the device — "sometimes the spoken text that is between `"`
is grey. Investigate why, and maybe make it a different color altogether."

### The change

- **`js/themes.js`:** Paper, Porcelain and Orchid (the three light
  schemes) removed; thirteen themes remain, all dark. The unused
  light-mode ok/warn/err constants went with them.
- **`css/app.css`:** the grey-quotes fix. Models habitually wrap NPC
  speech in asterisks (`*"Watch the door."*`); the `md()` formatter turns
  `*…*` into `<em>`, and the old rule painted every `<em>` in a bubble
  with `--dim` — the faintest text tone, originally there to soften
  narration. Whether a model italicizes its quotes varies by model and by
  reply, which is why the grey appeared only sometimes. The rule is now
  `.bubble em{color:var(--accent-tint)}`: speech stays italic but wears
  the theme's own pale tint (lavender in Midnight, sky in Abyss, cream in
  Ember, pale yellow in Carbon) — speech reads as speech, per theme.
- **`theme-variants.html`:** the preview page trimmed to the same
  thirteen.

### Verification

Test-first: the suite asserted thirteen themes, thirteen Appearance rows,
and a pinned `.bubble em` rule using the accent tint — all three failed
pre-patch (16/16/dim), all pass post-patch. Theming suite **71/71**. Full
battery: **1125 node checks, 0 failed.**

APK `HordeStudio-v1.27.0.apk` — 331,107 B, sha256
`aac09c6839df9d98d22e567518ec775a46020bfbf76d8d53ba58eabbd31585ea`;
in-APK bundle verified: thirteen theme names, no trace of the three cut
schemes, `VERSION = '1.27.0'`, sw cache `horde-studio-v43`, the
`.bubble em` rule on the accent tint. The superseded
`HordeStudio-v1.26.1.apk` was dropped (release asset retains the copy).

Bumps: 1.27.0 (minor — user-visible feature change: three themes cut,
new speech colour), apk code 55, sw cache v43.

---

## v1.26.1 — The Appearance row, actually visible in Settings (2026-10-11)

### The problem

v1.26.0 registered the Appearance section in `SETTINGS_SECTIONS` — and the
sub-screen worked — but the Settings hub draws its rows from a separate
hardcoded `ORDER` list in `Views.settings`, which never got the new key.
Result: a published feature with no door to it. Reported from a real
device (screenshots of the Settings hub showing ten rows, no Appearance).

### The change

`js/views.js`: `'appearance'` prepended to the hub's `ORDER` list. One
line; the section registry, the picker screen, persistence and theming
code are untouched.

### Verification

`tests/theming-test.js` gained two checks — the Settings hub renders a
`data-gosec="appearance"` row, labeled Appearance. Pre-fix: reproduced the
reported state (ten rows, no Appearance — 2 fails); post-patch:
**81/81**. Full battery: **1135 node checks, 0 failed.**

APK `HordeStudio-v1.26.1.apk` — 331,107 B, sha256
`571175d5ad32bfc35da29a20b68af8d2cbf45e728e35e9a03d302ef3214f8508`;
in-APK bundle verified: `VERSION = '1.26.1'`, sw cache
`horde-studio-v42`, the ORDER fix present in `assets/js/views.js`. The
superseded `HordeStudio-v1.26.0.apk` was dropped (release asset retains
the copy).

Bumps: 1.26.1 (patch — fix to v1.26.0), apk code 54, sw cache v42. The web
update re-delivers the fixed `views.js`; existing installs pick it up in
the app without reinstall.

---

## v1.26.0 — Appearance: sixteen color themes, a persisted setting (2026-10-11)

### The ask

User request: generate different color styles for the app ("show me a few
variants to pick from"), then "make it a setting. But generate ten more for
me to see." Acceptance: an in-app Appearance setting with a sixteen-theme
picker — tap applies in place and persists — plus the expanded preview page
showing all sixteen.

### The change

- **`js/themes.js`** (new): the theme registry. A theme is a map of 20 CSS
  custom properties (bg/surface/line/text tones, accent + accent-2 + deep +
  tint + soft, the two ambient glows, bar background, ok/warn/err).
  `THEMES.list/get/apply` — apply writes the tokens onto
  `document.documentElement`, so the whole app re-colors in place, no
  reload, nothing else touched. The `:root` defaults in app.css ARE
  Midnight, so the look before the theme code ever runs is exactly what it
  always was. Sixteen themes: Midnight (default), Abyss, Ember, Loam, Noir
  Rose, Paper, Graphite, Ultramarine, Crimson, Gilded, Sunset, Frost, Coral,
  Carbon, Porcelain, Orchid. Light themes (Paper, Porcelain, Orchid) carry
  deeper ok/warn/err so status colors stay readable on light surfaces.
- **`css/app.css`:** the last hardcoded accent values became tokens — new
  `:root` tokens `--accent-deep/--accent-tint/--glow-1/--glow-2/--bar-bg`,
  translucent accent surfaces switched to `color-mix` over the accent
  tokens, and the world's verdict lines ride the theme's ok/warn. Plus the
  `.theme-row` styles.
- **`js/store.js`:** `settings.theme` (default `'midnight'`).
- **`js/views.js`:** a new first Settings section — Appearance (palette
  icon) — one row per theme: five swatches of the theme's own colors, its
  name, and an "on" mark on the current pick. **`js/app.js`:**
  `App.chooseTheme` (apply + persist; an unknown name falls back to
  Midnight) and the boot-time apply before first paint. **`js/ui.js`:** the
  `palette` icon.
- **`theme-variants.html`:** the browse page — sixteen phone mockups of the
  same world screen, one per theme, tap to pick.

### Verification

`tests/theming-test.js` (new, 79 checks): every theme carries a display
name and all 20 required tokens, with values that are valid colors; apply
re-colors the document root (including a light theme's light bg); an
unknown id falls back to Midnight without writing anything unknown;
`chooseTheme` persists the pick and re-falls-back on a bogus name; the
Appearance screen renders sixteen rows and exactly one is marked "on" —
the current pick. `tests/worldstatus-test.js` gained the themes.js load and
a `documentElement` stub, because boot now applies the saved theme. Full
battery: **1133 node checks, 0 failed** (35 suites).

APK `HordeStudio-v1.26.0.apk` — 331,107 B, sha256
`30ef89f00068eb25c8d320795b8029905adcd0c5eb2dbe0b1618f2bc5abb5915`;
in-APK bundle verified: 23 web files including `js/themes.js`,
`VERSION = '1.26.0'`, sw cache `horde-studio-v41`. The superseded
`HordeStudio-v1.25.0.apk` was dropped (the release asset retains the copy).

Bumps: 1.26.0 (minor — user-visible feature), apk code 53, sw cache v41.

---

## v1.25.0 — Worlds: the status button — the desktop sidebar, on demand (2026-10-11)

### The ask

User request: the desktop app tracks the world's stats in a side panel;
the phone can't show that alongside a conversation, but there should be
**a button that, from anywhere in the world conversation, brings up the
status**.

### The change

- **`js/app.js`:** the top bar's action slot (always visible — the bar
  sits above the thread, so it is reachable wherever the conversation
  has scrolled) is now a status button on the world screen: a
  bar-chart icon, wired to the new `App.openWorldStatus`. The button
  reverts to the usual "more" icon on every other screen (set once, per
  navigation, in `App.go`).
- **`js/views.js`:** new `Views.worldStatusSheet(world, run)` — the
  whole run, always expanded: **where you are** (plus where you can
  go), **time** (clock + turn), **numbers** (every stat, with maxes,
  and the purse in the world's currency), **pockets**, **tasks** (open,
  plus finished count), and **party** (the companion ledger — who's
  with you, where and on what turn they joined). Empty corners say so
  quietly.
- **Live refresh:** a turn that finishes while the sheet is open
  re-renders it (`finishTurn` checks `App.state.worldStatusOpen`), so
  it never shows stale numbers.
- The sheet offers **Correct state…** (jumps to the correction screen)
  and Close.
- **`css/app.css`:** `ws-*` row styles for the sheet (section headers,
  stat rows, items). No native changes.

### Verification

`tests/worldstatus-test.js` (new, 27 checks): the sheet renders every
part of the run (place, exits, clock + turn, each stat, purse in the
world's currency, pockets, open tasks only, the party with join
details); empty corners render quiet lines; the button is hidden off
the world screen and visible on it; pushing it opens a sheet titled
with the world and carrying the state; **a finishing turn refreshes an
open sheet** (turn count visible in the live body); the correct-state
action navigates to the correction screen; Close resolves and clears
`worldStatusOpen`. Full battery: **1054 node checks, 0 failed.**

Bumps: 1.25.0 (minor — user-visible feature), apk code 52, sw cache
v40.

---

## v1.24.2 — World thread: a finished turn lands at the start of the reply (2026-10-11)

### The problem

User report: *after you type in your message, the response scrolls you to
its end. Then you need to scroll back up to its start so you can read it
from its beginning.*

**Root cause** in `Views.worldRun`: a world reply is not streamed — one
model call per turn, the whole scene lands at once — and the
turn-completion re-render unconditionally did
`thread.scrollTop = thread.scrollHeight`. For a scene that just appeared
in full, the bottom of the thread is the *end* of the reply: the reader
stranded at the last line. (Chat doesn't hit this — it streams and
auto-scrolls while the reader follows.)

### The change

`js/views.js`, `Views.worldRun`: when the call carries the applied turn
(`changes` — i.e. a turn finished), the scroll anchors at the **top of
the reply that just arrived** (the last non-player `.msg` in the
rebuilt thread) instead of the bottom. Check-result lines and correction
notes that follow the reply in the log don't move the anchor. Opening a
run and sending a message still land at the bottom, exactly as before.
No native changes.

### Verification

`tests/worldthreadscroll-test.js` (new, 6 checks): a fake thread with an
honest cumulative layout (top-level rows at real `offsetTop`s). Fresh
open and send → bottom (unchanged); finished turn → top of the reply,
not the bottom; a `check` line or a `correction` note after the reply
keeps the anchor on the reply. **Reproduced the end-of-scene landing
pre-fix (4 fails), 6/6 post-patch.** Full battery: **1027 node checks,
0 failed.**

Bumps: 1.24.2, apk code 51, sw cache v39.

---

## v1.24.1 — World run: the "turn N" bar follows the run (2026-10-11)

### The problem

User report (screenshot, phone): the world run header sat at **turn 0**
through an entire session and only showed the real count after exiting
and reentering the world. (The same session's other visible oddities —
four `rejected:` banners and "No move was recorded…" — were the model
emitting empty-argument tags, which the v2 ledger refused and repaired
exactly as designed; see the report for the full verdict. Nothing was
wrong with the world file.)

**Root cause** in `App.go`: the bar subtitle `'turn N'` is written only
when *navigating* to the worldrun screen. A finished turn re-renders the
screen (`Views.worldRun` — HUD chips + thread) but never the top bar, so
the label froze at whatever the last navigation showed. `run.turn`
itself was counted and persisted correctly (that's why reentering
revealed the true number — reentry re-runs the one `App.go` line).

### The change

`js/app.js`, `App.worldTurn`'s `finishTurn`: after `HW.commit` (where
`run.turn` increments) and the screen re-render, refresh `#bar-sub`
— guarded on `App.state.screen === 'worldrun'`, so a turn that finishes
after the player has walked away cannot write a turn count onto another
screen's bar. No native changes.

### Verification

`tests/worldturnbar-test.js` (new, 7 checks): drives a real
`App.worldTurn` with a scripted referee (stubbed `API.generate`, small
honest DOM): the bar opens at the true count, follows turns 1 and 2,
and a turn that completes after the screen changed leaves the other
screen's bar untouched while the run still counts.
**Reproduced the frozen "turn 0" pre-fix.** Full battery:
**1021 node checks, 0 failed.**

Bumps: 1.24.1, apk code 50, sw cache v38.

---

## v1.24.0 — Worlds: the companion ledger (2026-10-10)

### The problem

User report from a live run: two NPCs the player had **just walked to the
elder with** both turned around and asked, separately, *what the elder
said*. The same shared scene, two people both claiming to not know.

Diagnosis (code-grounded): the world engine makes **one model call per
turn** and that call writes the whole scene — both men's lines were the
model's writing, not an app duplication bug. The app's own `Present:`
list was correct. But three app-side gaps made it likely:

1. **Presence is static.** `Present:` lists NPCs by their *start* or
   *home* location only; the ledger never records that an NPC went
   somewhere with the player, so the model has no record the men were
   in the room.
2. **The context window is 12 messages.** The elder scene can fall out
   of the recent log before the next beat.
3. **No shared-knowledge record.** Nothing tells the referee "these
   people were there; they know what happened."

Fix C (chosen by the user): a real **companion ledger**.

### The change (`js/hordeworld.js` only)

- **New referee grammar:** `[[with:NAME]]` — an NPC joins the player;
  `[[part:NAME]]` — they part ways. Comma lists split on commas only
  (names like "Bramble and Pike" are one name), one name per tag part.
- **Ledger state:** `run.companions = [{ name, since, at }]` — canonical
  name, the turn they joined, the place. Added to the run factory
  (`start`); capped at **6** (`COMPA_MAX`).
- **Validation (v2 worlds):** unknown name → rejected with the cast
  listed (≤8 names); double-join → "already with the player"; parting
  with a non-companion → refused; over the cap → "the party is full".
  Case-insensitive matching, canonical spelling stored. Non-v2 worlds
  are lenient (no rejection), mirroring the item tags.
- **Prompt:** when the party is non-empty, a `Companions -` section
  lists each companion with where/when they joined and a discipline
  line: they **witnessed every scene since they joined** — never have
  them ask about or be surprised by what they saw; distinct voices;
  **at most one** asks the obvious question. The tag grammar is taught
  in the rules block (tag list + a Party bullet).
- **HUD:** the change lines "X joins the party" / "X leaves the party"
  render in the world HUD automatically. The repair path picks up
  rejections via the existing `repairOnce`. Old runs (no `companions`
  field) normalize to `[]` and work unchanged. No native changes.

### Verification

`tests/worldcompanions-test.js` (new, 23 checks): join/leave + HUD
lines; canonical storage; place/turn of joining; unknown-name rejection
that names the cast; double-join and wrong-part rejections (as
rejections, not silent no-ops); comma-list join; the six-companion cap
with a "full" rejection; case-insensitivity; the prompt section (present
with names + "witnessed every scene since" + "at most one", absent when
the party is empty); the grammar in the rules; `move` + `clock` +
`with` coexisting in one reply; old-run compatibility; and the
unchanged rule that unknown tags stay visible in text.
**Reproduced 19 failures pre-patch** (the tags were unknown, left
visible, no state, no prompt section), 23/23 post-patch.

Full battery: **1014 node checks, 0 failed** (33 node suites; the two
Playwright suites — `typing-test`, `update-test` — need chromium, which
the sandbox lost mid-turn; both were green earlier this turn on the
identical code).

Bumps: 1.24.0, apk code 49, sw cache v37.
Ships together with the v1.23.1 scroll fix (single release).

---

## v1.23.1 — Edit-accept scroll jump fix (2026-10-10)

### The problem

User report: *edit a message or a response, accept the edit → the thread
jumps up (a few times) and you have to scroll back down manually.*

**Root cause** in `Views.thread` (the anchor-restore path for
mid-thread re-renders — exactly what edit-accept triggers): the anchor
("first message in view, offset into it") is measured from the rebuilt
DOM **before its images have loaded**. Every message row carries an
avatar `<img>`; in the first layout pass those images are zero-height,
so all `offsetTop`s are compressed toward the top and the restored
`scrollTop` lands near the top of the thread. As the avatars load and
the content regrows, the reader is stranded up the thread. (The
fresh-open path already had a re-jump for this — the anchored path was
missing it.)

### The change

`js/views.js` `Views.thread`, anchored branch only: after the initial
restore, if any `<img>` in the rebuilt thread is not yet `complete`,
re-apply `restoreThreadScroll` once the pending images settle (each
`load`/`error` counted; an 800 ms timer as the floor for a broken or
slow image). A guard respects the reader: if they scrolled away more
than 60 px from the restored position in the meantime, the re-apply is
skipped — the fix cannot fight the reader, matching the v1.13.0
"never yank" rule this file was written around. Threads with no
pending images behave exactly as before (synchronous restore, no timer).

The other edit paths (delete, swipe-alts, user edit-and-resend) run
through the same `Views.thread` anchored branch, so they are all
covered by this one fix. No wrapper change.

### Verification

`tests/threadscroll-test.js` extended from 12 to 15 checks: the anchor
mechanism itself (a mid-thread re-render restores message + offset —
previously untested, the old fake thread had no `children` so the
anchor path never ran), the reported bug (collapsed first layout →
reader stranded at 0; after the avatars "load" the reader is back at
the anchored position — **reproduced failing pre-fix**), and the
scrolled-away guard. Full battery: **991 checks, 0 failed**.

APK: sha256 `36b7806e7cc4a30bdaccbd60a1af5abf36b592b5e552a8d9ae0fe74443cb0a4e`.

Bumps: 1.23.1, apk code 48, sw cache v36.

---

## v1.23.0 — Model picker robustness (upstream 18.3.6 port) (2026-10-10)

### Upstream review — v18.3.6 (published 2026-10-10)

Upstream shipped: (1) Pip can answer with a user-chosen LLM grounded in
product knowledge; (2) an illustrated, searchable user manual (75 topics,
172 control explanations, 51 screenshots, optional embedding-based
retrieval); (3) model-discovery fixes: the catalog parser accepts
`{models: [...]}` responses, a provider switch must not poison the next
catalog, and exact typed model IDs are accepted even when absent from
the catalog (which is also what keeps a Virtual Human's model after a
refresh); (4) NanoGPT metadata fixes (desktop-only provider).

**Not portable:** the manual and the Pip assistant. In the v18.3.6 git
tag their code files (`horde-manual.js`, `horde-handbook.js`,
`pip-assistant.js`, `pip-knowledge.js`, `horde-support.css`) are **0
bytes** — the tag is a skeleton (935 files emptied, index.html included);
the real content ships only in the 509 MB portable ZIP. On top of that
they are desktop sidebar features with provider-charge-bearing
embedding indexing, which the curated phone port deliberately avoids.
The NanoGPT fixes target a local provider the mobile app doesn't offer.

**Ported** (all of it small, additive, wrapper-untouched):

1. **Catalog parser** (`js/api.js` `listModels`): accepts all three
   response shapes — bare array, `{data: [...]}`, `{models: [...]}` —
   tolerates plain-string entries, and degrades to `[]` instead of
   crashing. (Pre-patch, a malformed body like `{data: "…"}` threw
   `arr.map is not a function` — caught by the new tests.)
2. **Cache source stamping** (`js/app.js` `chooseModel`): the `hs-models`
   cache is now `{source: "provider|baseUrl", models: [...]}`. Switching
   providers can no longer show the previous provider's catalog; legacy
   bare-array entries (pre-stamp) are treated as stale and refetched once.
3. **Model retention + exact IDs** (`js/app.js` `modelSheet`): if the
   current model is absent from the catalog (provider changed, model
   retired, hand-typed ID) it is **pinned to the top** of the picker,
   marked "your current model", and selectable. A filter that matches
   nothing offers a **"Use exactly: \<typed\>"** row — any model ID 