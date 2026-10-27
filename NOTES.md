# Horde Studio Mobile — release notes

## v1.39.27 — replay-proof auto-finish stitching
- api.js replayedTail(before, piece): verbatim run starting in `before` AND
  reaching its end, ≥ 40 chars = a rerun of the cut tail; loop() strips it
  before glue, stops the pass on a pure rerun.
- Test: stitchreplay-test.js (8): replay+continue heals to one copy,
  mid-word seam intact, ordinary continuation byte-identical, pure rerun
  single copy + stops, short echo < threshold unpinned behavior.

## v1.39.26 — auto-title refuses echoes
- App.validAutoTitle(raw): strip quotes/Title:/meta prefaces; null on
  instruction echoes ("the user wants", "name this conversation", "at most
  N words"), >10-word sentences, >60 chars, empties.
- maybeAutoTitle: invalid candidate → _titleFails++ and nothing saved;
  3 misses → give up quietly (titleAuto = true).
- chatwork-test carve list gains App.validAutoTitle (harness slicing).
- Test: autotitle-test.js (11) incl. the exact reported echo string.

## v1.39.25 — repetition guard (frequency_penalty)
- api.js: body.frequency_penalty = settings.frequencyPenalty when set (>0);
  omitted otherwise on both stream and non-stream chat-completions paths.
- views.js generation settings: "Repetition guard" slider 0–1 step 0.05.
- Test: repeatguard-test.js (5).

## v1.39.24 — plain-prose rendering toggle
- UI.md(): when Store.settings.plainEmphasis is on, asterisk emphasis
  renders as plain text and unmatched/triplet asterisks are stripped;
  speech spans, blockquotes and code fences unchanged. Default off.
- views.js settingsGeneration: "Plain-prose rendering" toggle row (t-plain)
  after Strip-thinking, with explainer hint.
- Test: uiplain-test.js (11): default-mode pins, marker stripping, stray
  removal, speech survival.

## v1.39.23 — continuation scrolling lands at the seam
- generateReply records el.offsetHeight when a Continue begins (seamPx) and
  hands it to followReply; Views.followReply(thread, el, fromPx) anchors at
  offsetTop + seam − 90px instead of the bubble head.
- msgtail-test.js +4 (14 total): seam landing vs head vs tail; app wiring.

## v1.39.22 — walls of text open at their first line
- App.generateReply finish: Views.followReply(thread, el) replaces the raw
  stickToBottom pin; guarded call keeps every old Views stub valid.
- views.js followReply(): near-bottom readers follow; bubble taller than
  (viewport − 60px) → anchor at el.offsetTop − 8; otherwise bottom pin;
  up-thread readers never moved; no element → classic semantics.
- Test: msgtail-test.js (10): head-anchor vs tail, short-pin, no-yank,
  element-less fallback, app-level finish wiring + stub fallback.

## v1.39.21 — SSE comments don't kill the stream
- streamChat line(): lines starting with ':' are SSE comments (spec) —
  ignored; OpenRouter sends ': OPENROUTER PROCESSING' heartbeats, so every
  streaming request on a working :free model failed as "invalid chat
  stream" (the user hit it the moment they switched to nemotron).
- mid-stream data frames carrying {"error": ...} now reject with the real
  provider message rather than resolving ''.
- strictness kept: non-comment junk (HTML error page) still fails loud.
- Test: ssecomment-test.js (4): comments between/before deltas, comment
  split across chunks, junk still fails, error frame speaks.

## v1.39.20 — free-pool 429s stop blaming the user
- providerError() takes the model name; for IDs ending :free the 429 text
  explains the shared upstream pool (verified live: google/gemma-4-31b-it:free
  has 429ed every daily probe for a week straight, 0/7) and offers the
  exits; account wording kept for everything else.
- ratelimit-test.js +4 (18 total).

## v1.39.19 — 429s retry themselves, errors explain themselves
- streamChat wraps its connect in attemptFetch(): on 429 wait Retry-After
  (capped 30s) or backoff [5s, 15s], up to 2 retries, all inside the
  existing stream deadline; retries stay silent after settle/abort.
- providerError() classifies: 429 → rate-limit explanation incl. the real
  free-tier caps; 402 → credits/quota; 401/403 → key rejected. Anything
  else keeps the historic "API <code>: <body>" string (stream-test pin).
- Test: ratelimit-test.js (14): lone-429 invisibility, Retry-After timing,
  bounded retries on a daily cap, 402/401 no-retry, 5xx shape guard.

## v1.39.18 — edit-confirm scroll jump, for real this time
- restoreThreadScroll added anchor.dy where it must have been ALL ALONG
  (offsetTop − dy snapped the anchor fully into view = a 2×dy yank upward;
  on a long reply, "a few messages up" exactly. Encoded in two suites as a
  feature — re-pinned to pixel-exact).
- Edit sheet captures Views.threadAnchor at OPEN, before the IME reflows
  the viewport; the confirm re-render (incl. alts array sync) restores via
  Views.thread's new preAnchor param.
- Tests: editanchor-test.js (6: drift documented, pre-anchor restore,
  shifted-layout restore, forceBottom/streaming callers untouched);
  threadscroll 21 + lifework 43 re-pinned.

## v1.39.17 — Continue actually continues
- looksTruncated: a trailing apostrophe glued to a letter ("don'") is a
  mid-word cut, not punctuation — the whitelist made it look complete and
  auto-finish never engaged (the user's live report).
- API.generate gains continueFrom: the partial text seeds the assembly and
  rides the wire as the assistant turn-in-progress (chat) / appended to the
  prompt (horde); history no longer duplicates the cut message (app side
  filters it out).
- Seam rule: "{contraction stem}'" + letter joins tight for real stems
  (don', can', it'…) but never for plural possessives; dash/open-paren
  endings stopped force-joining ("x —" + "and…" keeps its space).
- continueFor completion is now text = generated (assembled), replacing the
  msg.text + "\n\n" + tail glue.
- Tests: continuefix-test.js (16: truncation shapes, seam tight/loose,
  prefix wire shape, multi-round continuation); rerollswap D updated to
  the seed-contract (23).

## v1.39.16 — cardsu0027 always-remember lines survive import
- cardToCharacter dropped data.post_history_instructions entirely (the
  field was hardcoded to "" — any author tone-lock arrived silent).
  Mapped in both V2/V3 branches; it rides the existing plainText wash,
  and export writes it back.
- V2 import now merges top-level fields with data.* (data wins): cards
  that keep everything under data only — against the old both-copies
  convention — import whole instead of half-empty.
- Test: tests/posthistory-test.js (5 checks: V2/V3 mapping, empty-field
  degrade, export round trip, no phantom field).

## v1.39.15 — intro swipes in the editor
- Views.introNavModel: greeting + alternateGreetings as swipeable slots
  (copy-in, collect-out — browsing never mutates the sheet by aliasing).
- Editor greeting field gains ‹ n / N › arrows like the chat opening
  bubble, an Add intro chip (fresh empty slot, paste or write), and a bin
  chip on alternates only; the main greeting cannot be removed.
- collect() folds the textarea into the slot on show first — saving while
  looking at intro k no longer risks clobbering the main greeting.
- Test: tests/editintros-test.js — 27 checks over build/move/set/add/
  remove/collect incl. wrap-around, blank-slot drop and array aliasing.

Will loop steady until the llama sleeps.

## v1.39.14 — PNG cards stop maiming non-ASCII
- store.js readCardFile PNG branch decoded the `chara` base64 with
  `JSON.parse(atob(...))` — atob hands back bytes-as-chars, so any
  multibyte UTF-8 (emoji, em/en dashes, smart quotes, accents) arrived as
  mojibake (🐍→ðŸ, —→â€""). ccv3 branch was right all along: same
  decode-then-UTF-8 dance ported.
- Hidden for months because the repair pass covered name/description/etc.
  on plain-text paths but PNG-import surfaces (esp. name and the
  alternateGreetings added in 1.39.11) had no bath — now they do.
- Test: tests/pngutf8-test.js builds a synthetic PNG card whose name,
  alt-intro and lorebook entry carry every glyph class that was seen
  mangled in screenshots and asserts byte-equality through import-
  character and the newChat alt-seed path.

# Horde Studio — Mobile

Current build: `HordeStudio-v1.39.13.apk` (versionCode 92).
Same day, third drop: cards with multiple intros (V2 `alternate_greetings`)
import them all now; a new chat seeds them as swipeable alts on the opening
message; the import sheet counts them ("It also brings N intros").
Suite: tests/altintros-test.js (13 checks). Asked by the user about a
JannyAI "+10 intros" card importing with only one.

Previous build, same day: `HordeStudio-v1.39.12.apk` (versionCode 91).
Same day, second fix: reroll/Continue now edit the bubble IN PLACE
(`document.querySelector('[data-mid=...]')` on the target instead of
appendMessage) — cancel puts the original text back, a provider error keeps
the message. Suite: tests/rerollswap-test.js (21 checks). Reported by the
user with screenshots of the twin bubbles after a cancel.

Previous build, same day: `HordeStudio-v1.39.11.apk` (versionCode 90).
Built 2026-10-24: release `v1.39.11` imports a card's EMBEDDED lorebook on the
V2/legacy paths too (was V3-only), exports it back out in
`data.character_book`, and the import sheet states plainly whether a book is
aboard. Suite: tests/cardlore-test.js (12 checks).

Previous build, same day: `HordeStudio-v1.39.10.apk` (versionCode 89).
Built 2026-10-24: `docs/` serves v1.39.10 and
release `v1.39.10` ports the upstream 18.3.7 "worlds recovery" refresh of the
bundled Policy Panic world: 10 repaired exits (Maplebridge -> NPC flats,
parking lot & reception -> office), the rewritten opening-intro, and per-life
opening scenes. Kept OURS on purpose: the world id (installs bind to it), the
dice `gameRules.checks` table (upstream 18.x dropped it; our turn engine needs
it), and the art-stripped shape (no media payload in the APK). NOTE: worlds are
static data shipped in the APK, NOT in web.zip — so this fix only reaches a
phone through the wrapper update (versionCode 88 -> 89), never via a web update.

Published as a GitHub Release (see `.github/workflows/release.yml`); the app's updater
reads the channel in `docs/`, not the release.
Permissions: INTERNET, ACCESS_NETWORK_STATE, REQUEST_INSTALL_PACKAGES (kept on purpose — it makes Play Protect warn; user accepts 'install anyway'), storage (maxSdk 28).

Rebuild: `cd apk-build && bash ./setup-sdk.sh && bash ./build.sh` — the SDK
does not survive a turn boundary (see the HAZARD below), so setup + build must
run as one command.
Tests: 50 suites in `/home/user/tests/`, one file per fix —
`node /home/user/tests/<suite>-test.js` (v1.39.4: 1660+ checks in total).
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

New suite `tests/worldhud-test.js` (24 checks — retired by the v1.39.8 HUD slim-down; its coverage moved to `tests/hudslim-test.js` — zero dependencies, real
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

---

---

## v1.39.5 - the task ledger folds (2026-10-20)

On a phone, two or three open quests made the world HUD's inline task list
swallow half the screen. The ledger now lives in its own block BELOW the
head row (location, clock, coins stay put), with an "N tasks" pill that
folds and reveals it. The choice persists WITH the run (run.hudTasksOpen -
this run's pocket, not a global), so his phone stays readable across
sessions. Old runs default open; done quests never weigh in; correct-state
stay in the head. The old task prefix string is unchanged (`tasks: ...`),
so v1.22-era HUD suites still pass word-for-word. Suite:
`tests/worldfold-test.js` (20 checks).

## v1.39.4 - worlds learn the player's name (2026-10-20)

World runs previously knew only the picked LIFE ("The player begins as:
Guild hopeful") - the referee never saw who you actually are. `HW.start`
now accepts the effective identity ({name, persona} from settings - the
switch handle the personas screen already swaps in place) and FREEZES it
into the run at start, like the life and the class: later persona swaps
abroad never rewrite a run mid-flight. The referee prompt layers it above
the life ("The player is Ramiros... Narration stays second person, but
named characters know and use the name" + the persona blurb itself), and
old-shape runs prompt exactly as before. Also shipped same-day on the
workspace: `tools/verify-world.js` - the 19-check authored-world validator
(real HW.parse gate + reference integrity), and the worked example it
grew from — an Azarinth-Healer-inspired draft world, pruned 2026-10-24. Suite:
`tests/worldpersona-test.js` (10 checks, incl. regression guard).

## v1.39.3 - a way home from tinkering (2026-10-20)

The Generation settings screen gains a "Reset to defaults" button at the
foot of the page. It restores exactly the nine keys that screen owns -
temperature .85, max reply length 400, top P .95, context 40, plus the five
behaviour toggles - behind one confirmation. Provider, API key, model,
personas, theme and everything else stay precisely put: the source of truth
is `Store.generationDefaults()` (nine keys from the DEFAULTS table,
re-composable, never aliased). Suite: `tests/genreset-test.js` (19 checks -
scope, confirm guard, and a live tinker-reset-and-survive round in the vm
harness).

## v1.39.2 - speech picks its color (2026-10-19)

The v1.39.1 speech span now carries ONE dedicated color - warm amber gold
(`--say: #FFB454`) - fixed across every theme (theme palettes may not recolor
the voice). Picked live from a four-way rendered A/B/C/D
preview (`say-colors.html`, pruned 2026-10-24); the two other spacing tweaks from v1.39.1 (upright,
heavier) stay. Suite grew to 15 checks.

## v1.39.1 - spoken words step out of the narration (2026-10-19)

The renderer now wraps dialogue (straight `"..."` and curly smart quotes) in
a `<span class="say">` inside every bubble, and one CSS rule lifts spoken text
out of the italic narration: upright, heavier, and warmer through the theme's
accent tint. Apostrophes inside speech ride along (they are `&#39;`, not
`&quot;`), unmatched quotes mark nothing, code fences are untouched, and
emphasis still works inside speech. Tests: `tests/saybubble-test.js` (13
checks). The rendered preview that judged the contrast (`speech-preview.html`) has been pruned.

## v1.39.0 - eight small chat powers, one release (2026-10-18)

A sweep across the single most-lived-in screen of the app. All additive, all
migrating cleanly from v1.38.x sessions (new fields default off/absent).

**A. Find, pin, tidy.** The chats list gains a search box (every word must be
found in the character name, chat title or memory summary - query `night blue`
finds chats owning both). Chats can be **pinned** (they ride above the rest,
newest-first inside the pin pile) and **archived** (tucked away behind a
"Show archived (N)" row - nothing is deleted). Pin/archive chips mark their
holders in the list; manual renames set `titleAuto:false` so the app never
overwrites a name you chose.

**B. Take chats with you - both ways.** The chat menu's Export opens a
two-way sheet: "For reading (.txt)" is the old prose transcript; "Backup
(.json)" emits a `.hordechat.json` (kind-tagged, `k:"hordesession", v:1`)
holding title, memory, facts and every message. The chats screen's Import
button reads such a file back as a brand-new session under a character you
pick (import always creates, never overwrites); the payload kind is
validated up front.

**C. A chat may lean local over its character.** "Chat settings…" in the
session menu carries temperature, max-reply-tokens and a per-chat style note.
These are the most local generation layer (chat over character over global
defaults): an empty field defers downward, a filled one wins. The style note
joins any one-off generation note in the prompt.

**D. Rerolls compare and can be steered.** The alternate-reply swipe row now
shows each alternate's word count, and a new 📝 chip on the assistant action
row asks "Steer the reroll" - the answer rides that generation only as a
reroll instruction.

**E. Say it with a photo.** A paperclip in the composer stages a picture:
it is downscaled to 640px through the existing `normalizeImage`, then you
write the caption the character actually *reads* (the honest pixel-to-words
translation). The message stores `image` + `imageCaption`; prompt history
decorates it `[photo: caption]`, so the text model sees what was meant, not
opaque binary. A photo alone is a complete send (no text required).

**F. Every reply can be heard.** A Listen chip on every assistant message
reads the reply with the platform's own speech engine (works offline; text is
stripped of markdown first, `Views.speechText`). One voice at a time, a
second tap stops it, and navigating away or switching chats always silences
speech (`App.stopSpeech`).

**G. The health sheet.** "Chat health" totals what the chat is spending:
message/reply counts, average reply length, rerolls spent, messages since the
last memory write (against the memory cadence), and an estimated prompt
weight in tokens (~chars/4 of memory + facts + the rolling window). Pure
`App.chatHealth` for tests.

**H. Chats name themselves.** After three full exchanges, an untitled chat
gets exactly one tiny one-shot title call (`API.generateFree`, ≤5 words) and
saves it with `titleAuto:true`. Failures are silent - a title is a nicety,
not an availability problem - and user-chosen names are never overwritten.

Tests: new suite `tests/chatwork-test.js` (39 checks, A-H, vm-sandbox +
fakeIDB; loadCoreLite carves `App.chatHealth`/`App.maybeAutoTitle` out of
app.js so the pure helpers run for real). Full battery: 47 suites, zero
failures.

## v1.38.1 - the honest budget: the AI world-creator vs the 512-token wall (2026-10-18)

The real-model quality pass (bench rig: `tools/ai-world-bench.cjs`, runs the app's own
prompt strings live against Horde models, judges the answers) found a production-fatal
bug hiding behind the "each under the Horde's 512-token anonymous limit" comment: the
three-request flow's asks had drifted to 480/700/800, and the Horde **rejects anything
over 512 without kudos** - proven live ("Due to heavy demand... requires kudos").
Anonymous players could never finish a world draft; every run died at part 2 of 3 with
a queue wait and a kudos error.

- The AI world-creator is now **five small bounded requests, every one at most 480
  tokens**: the places, the people, the referee, the ways in (lives, quests, stats),
  and the book and the bent (skills, classes, lore). Same stop-on-failure semantics,
  same assemble -> parse -> save chain, button says "Create (5 requests)". The referee,
  the ways in and the book merge into the same single rules tape the old three-part
  machine knew, so HW.parse/assemble is untouched.
- Each ask echoes a tiny **example object** of the exact one-line shape it wants back
  (built with JSON.stringify, no quote soup) and pre-anchors the output ("Answer with
  ONE JSON object only, first and last characters curlies"). All spec text demonstrates
  quoted identifiers - an early bones draft died copying bare `id:origin_main` style.
- `API.parseAiJson` gained a deterministic **salvage pass** after the direct attempts:
  several top-level objects in a row (one entity each, a live-model pathology) are
  closed by brace depth, parsed, deep-merged by key; a single clean chunk beats
  nothing when the model writes one good object and then commentary or a truncated
  echo; junk bracket endings get trimming retries. Applies everywhere aiJson is used,
  not just world creation.
- Live bench validation, anonymous Stheno class worker (the realistic anon target):
  all five stages produce structurally clean, playable output (4 connected places, 2
  major people with schedules, referee prompt, 1-2 walk-in lives with stats, skills
  catalog, classes left empty when the model judged the world wouldn't wear them,
  concrete one-word lore keywords). Model-style flake modes catalogued: pretty-print
  budget burn, "Here's how you can add more locations" tutorial slop, multi-object
  distribution, repetition past the close, blank replies on some worker families -
  the app surfaces them as "press Create to try again", never a partial save.
- The bench tool stays in the repo: `node tools/ai-world-bench.cjs "<idea>" <model>
  <outdir>` / `--print-only`. It lifts the ask expressions straight out of app.js so
  the bench can never drift from what the phone sends.

## v1.38.0 — Classwork: the world asks what you're good at (2026-10-18)

The classless shelf is off the waiting list (authored-worlds gap #18,
parked on the record, requested today). New format keys, all optional:
`skillsCatalog` (trainings with the stat they lean on) and `classes`
(archetype bundles: statOverrides, starting skills, obligations,
outfit). At begin, a world that declares classes asks after the life is
chosen - every row says what the class brings, and "No class" is always
a legitimate door; plain worlds pass straight through unchanged. Runs
record `classId`, `className`, and `skills: {id: level}`. The referee
can teach: `[[skill:Rudderwork]]` levels the training in the ledger,
one level per lesson, five is mastery, lessons past mastery land as a
line saying so - and the catalog is the only syllabus (unknown skills
are rejected with a reason, same table as the other tags). Checks gain
`skill`: a named check attached to a catalog skill counts the player's
level into the roll ("+1 (Lockpicking)"), known trainings tip the dice,
unknown ones withhold nothing - a bonus, never a penalty. The ledger
line in buildPrompt names the class and trainings, so prose and
catalogue agree; the book's viewer got a Classes page (no secrets
involved); assemble() carries both keys, and the AI author's rules
draft offers them (with explicit permission to say: this world would
not wear classes).

Engine-first as always: hordeworld-test +29 (parse/assemble keep the
keys, class-topped stats with clamps, quests+outfit from both origins,
seed-matched dice differing by exactly the level, mastery caps, catalog
rejection, the ledger line), new suite worldclass-test (14: the begin
sheet for classed worlds, the no-class door, many-lived chains into the
class gate, plain worlds never quizzed, saved-run payloads),
worldlore-test +3 (the classes page, no page when no classes),
aicreate-test +3 (assemble carries both keys; the draft offers them).
Git house note: the local main pointer reverted mid-turn again - the
commit was staged **mixed** on top of origin/main instead of rebased on
the stale pointer, so no surprise rebase conflict sweep this time.
Full battery: **46 suites, 1627 checks, 0 failed**.

APK `HordeStudio-v1.38.0.apk` — 359,779 B, sha256
`a3dae432e8d400f0b8b294e1f7727391f5bfaeaf06762c40c05c60807ede86b9`;
in-APK verified (VERSION 1.38.0 / CACHE v64 / aapt code 77 / the
skillDef, worldClasses and skillsCatalog strands present). The web
channel serves 1.38.0 (rev `97344824a144`) — "Check for update" on the
phone picks it up, no reinstall. Published 2026-10-18.

Bumps: 1.38.0 (minor), apk code 77, sw cache v64. Next: v1.38.1 - the
AI-creator quality pass against a live model (the second half of
today's request).

---

## v1.37.0 — The open book (2026-10-18)

The lore series closes with the reader's chair (gaps #5, #6 and #7 of
the lore analysis). The world viewer — the eye button on any
installed or catalogue world — now shows **the known book**: every lore
entry with its keywords and what it says, *except* secret-gated entries,
which stay sealed forever: no content, but the hinge named (a task
reaching «...», or the witness whose presence opens it), so a peek
teaches the mechanism without printing the spoiler. An entry whose
keyword the world's own text never says gets a quiet "may go unheard"
hint — the dead-key lint, honest as a hint because a player can still
type anything (HW.deadKey: corpus = places and exits, people, factions,
ways in, plans, opening, and the OTHER entries, matched with the same
word edges play uses). Character-side lore injection gains the world
side's byte budget: the pile stops at 1536 bytes with first-come order
kept, and one fact may still exceed it alone. That closes the lore
series: memory that remembers (v1.36.0), words with edges and books
that arrive written (v1.36.1), and now a book you can trust without
being spoiled (v1.37.0).

New suite worldlore-test (15: sealed content never, hinges named, gates
labelled, dead-key hinted, empty book hides the section), aicreate-test
+3 (budget pile stop at 2×600, latecomer waits, lone 2000-char floor).
Full battery: **45 suites, 1618 checks, 0 failed**.

APK `HordeStudio-v1.37.0.apk` — 355,683 B, sha256
`367616d0e6f9f5d5c2181f68ed207e5b54a1961359d64533298d5a7e860377bf`;
in-APK verified (VERSION 1.37.0 / CACHE v63 / aapt code 76 / the
deadKey, open-book and char-budget strands present). The web channel
serves 1.37.0 (rev `81413b072b18`) — "Check for update" on the phone
picks it up, no reinstall. Published 2026-10-18.

Bumps: 1.37.0 (minor), apk code 76, sw cache v63. The lore series is
complete.

---

## v1.36.1 — Words with edges, books with spines (2026-10-18)

Second fold of the lore series (gaps #3 and
#4 of the lore analysis). **Keywords know their own edges now.** The world matcher no longer
treats a substring as a sighting — "bell" stays quiet for "labelling",
"mark" for "market" — while a bare plural keeps working ("gossip" still
finds "gossips"): the good half of the old rule kept deliberately
instead of by accident. The match is a regex built at trigger time
(match-time only; stored keywords untouched), the >2-char floor stands,
and a multi-word key must meet its whole self. The character-side
lorebooks learned the same rule, minus a floor they never had — word
edges already blunt the short-key risk. **The AI author drafts a book
now.** The third draft (the rules) asks for 3–5 lore entries whose
keywords will really come up in play — a place name, a family name, an
artefact, never a word hiding inside a longer word — and assemble()
finally carries `lorebook` through to parse, gates (npc/faction/secret)
intact. A created world arrives with a living book instead of an empty
one.

hordeworld-test +10 (labelling/market false positives, plural carry,
multi-word and punctuation keys, the floor, repeat-outranks),
aicreate-test +6 (assemble carries the book with gates, char-side word
edges through the real buildChat, and the draft asks for it). Full
battery: **44 suites, 1560 checks, 0 failed**.

APK `HordeStudio-v1.36.1.apk` — 355,683 B, sha256
`2779ca70e376b3e965996c3799859199308af1c73f57e3106db5770b1a950c5d`;
in-APK verified (VERSION 1.36.1 / CACHE v62 / aapt code 75 / the
edge-matcher and lorebook-draft strands present). The web channel serves
1.36.1 (rev `18622dc9a411`) — "Check for update" on the phone picks it
up, no reinstall. Published 2026-10-18.

Bumps: 1.36.1 (patch), apk code 75, sw cache v62. Next: v1.37.0 "the
open book" — the lore browser in the world viewer (secrets sealed), the
character-side byte budget, and the import-time dead-key lint.

---

## v1.36.0 — Recall: the story remembers itself (2026-10-18)

First cut of the lore series (the map lives in the lore analysis (`lore-aspect-analysis.md`, pruned 2026-10-24)):
a saved world run knew only its ledger and its last twelve messages -
two hours in, every earlier beat was gone. Two quiet mechanisms now keep
the past alive. **World memory:** on the persona-chat cadence (autoMemory,
every N turns, the same settings) the run asks the model once for a
strict-JSON {summary, facts} - dice verdicts and tag mechanics explicitly
excluded - and the next prompt carries it as "Story memory", prose
subordinate by instruction to the ledger above it. The hook is
fire-and-forget in commitTurn, so a memory pass can never hold up or
break a turn; the write-side (HW.memoryDue / HW.applyMemory) is bounded
(1500-char summary, 12 deduped facts) and an empty pass does not burn the
cadence marker. **Lore recall:** the trigger text is now the player's
line plus the last exchange's referee reply - "Tell me more" about a
place the referee just named finally surfaces its entry - and a fresh hit
lingers warm for two turns (loreFired, pruned after three) inside the
existing byte budget, so a conversation can chase a fact without
re-uttering the keyword every line.

hordeworld-test +21 (cadence / write-side bounds / the prompt carries
memory labelled / window / linger-then-expire), aicreate-test +3
(summarizeWorld: world-flavoured transcript, ledger-off-the-menu
instruction, noisy output still parses). Full battery: **44 suites,
1544 checks, 0 failed**.

APK `HordeStudio-v1.36.0.apk` — 355,683 B, sha256
`83a8e0ecd00bf39ae3ac251bbc358f1a95249dfdcb48da7f400b13a75e37896f`;
in-APK verified (VERSION 1.36.0 / CACHE v61 / aapt code 74 / the
summarizeWorld, Story-memory and loreFired strands present). The web
channel serves 1.36.0 (rev `8769c5ea717b`) - "Check for update" on the
phone picks it up, no reinstall. Published 2026-10-18.

Bumps: 1.36.0 (minor), apk code 74, sw cache v61; the series continues
with v1.36.1 (word-boundary keyword matching, the AI author drafting a
lorebook) and v1.37.0 (the lore browser in the world viewer, secrets
sealed).

---

## v1.35.1 — Faces in the world chat (2026-10-18)

Day-after report from play: "Persona avatar and world avatars don't show
in authored world chat." True: worldBubble hard-coded initials into both
sides of the thread and never looked at either face - v1.30.0 had covered
cards and the status sheet, v1.31.0 the persona chat, and the thread
itself slipped through the seam between them. The fix mirrors
messageHtml's semantics exactly: the referee bubble wears the world's
banner, the player's bubble the active persona's photo when it has one,
initials stand in when a face was never set (never an empty <img>).

worldavatar-test gains section F: banner on the referee side, persona
photo on the player side, and both fallbacks asserted against a
bannerless world and a photo-less persona. Full battery: **44 suites,
1520 checks, 0 failed**.

APK `HordeStudio-v1.35.1.apk` — 351,587 B, sha256
`1254b6870f72c4ab80dd37e77498a0d239b0719743103a624bb74fc71c1ba279`;
in-APK verified (VERSION/CACHE v60/aapt code 73 + 1.35.1, both avatar
paths present in views.js). The web channel carries the fix - avatar
rendering is pure web code, so "Check for update" on the phone picks it
up without a reinstall. Published 2026-10-18.

Bumps: 1.35.1 (patch), apk code 73, sw cache v60.

---

## v1.35.0 — Worn words, open books (living-world pack, 4 of 4 — series complete) (2026-10-18)

Final plank of the gap series. Three changes that give breadth: the
equipment module becomes real, the AI world author stops drafting thin
worlds, and every world — installed or merely offered — can be read
before anyone lives in it.

### What changed

- **Equipment: carried vs worn.** Worlds that switch the module on and
  declare slots (array or {slots:[...]}) get [[equip:SLOT:ITEM]] and
  [[unequip:SLOT]] under the ledger's discipline: equips move the thing
  from pockets to slot (what you do not carry, you do not wear), a full
  slot swaps rather than clobbers, one-slot tables forgive the shorthand,
  empty unequips and unnamed slots are told off in prose that names the
  slots. An "Equipped:" line rides the state block in declared slot
  order, the grammar teaches the tags only at equipped tables, HUD chips
  and a proper Equipment corner of the status sheet show the kit, and old
  runs grow the pockets for worn things quietly.
- **The AI author drafts lived-in worlds.** The second draft now knows
  the place ids and gives every person a home and a 2–4-stop day with
  real rooms; factions come with goals. The third draft can name task
  seeds (startingQuests), goal programs (schemes with ordered steps), a
  stat registry (3–5 tracked numbers), stat overrides + obligations +
  outfit on the lives, a non-flat start time, and the scene cap. The
  three-part budget grew with the shape (700/800 tokens) and assemble()
  passes the new pieces through. What the model returns is what the v1.32
  truth pack now knows how to honor - the plumbing was built first, on
  purpose.
- **Every world is an open book.** A ✧-no, an eye chip on every installed
  world and every catalogue offering opens a read-only summary: the clock,
  the systems, every place, every person with their want and their day,
  the factions, the lives, and an honest under-the-hood count. Peeking at
  a catalogue world parses it without saving; peeking is the same truth
  the referee runs on. The catalogue (worlds/authored.json) continues as
  the single index of what ships - one fetch, shared by the offer, the
  install, and now the peephole.

### Verification

hordeworld-test: slots order/gating, equip pocket→slot ledger lines,
swap semantics, state line, grammar gating, all five refusal shapes,
one-slot shorthand, normalizeRun backfill; peek-bundled happy path plus
unknown-id rejection, inside the install flow. aicreate-test: the whole
rich schema (schedules + home, goal programs, stat registry, scene cap,
lives that start lived) driven through assemble→parse→start, and the
ask itself asserted against app.js (schema keys, placeIds, budgets).
worldstatus-test: Equipment corner with both empty and module-off
states; the summary viewer against the real fixture (clock line, days,
counts: 23 places · 8 people · 6 factions · 14 ties). Full battery:
**44 suites, 1516 checks, 0 failed**.

APK `HordeStudio-v1.35.0.apk` — 351,587 B, sha256
`851925e1789c144574f19e3f4224c585e03b0d0872b65bb0255d615836db43f5`;
in-APK verified (VERSION/CACHE v59/aapt code 72 + 1.35.0, all feature
markers, incl. the new eye icon). The v1.34.0 APK was dropped; release
keeps its copy. **Published 2026-10-18** under the standing series
go-ahead - the four-version plan from that gap analysis
is now complete, all additive.

Bumps: 1.35.0 (minor), apk code 72, sw cache v59.

---

## v1.34.0 — The dice are the world's own (living-world pack, 3 of 4) (2026-10-17)

Third plank: gameRules.dice, zeroHpMode and the conditions module stop
being parsed-but-decorative and start governing play. Everything is
read off the authored table; nothing was invented.

### What changed

- **The dice table is honored.** defaultDifficulty becomes the DC a
  check falls back to when it declares none (Policy Panic: 11, said
  once in the rules); modifierMode "per_stat" makes a named check
  inherit its stat's authored fixedModifier from the sheet (only
  numbers the world actually wrote - normalized curves remain the
  author's job); dice.criticals turns an all-max roll into a critical
  success that beats any DC and an all-one into a critical fumble that
  fails any roll, marked in the check line. Tables that never opted in
  just honor the numbers - criticals are opt-in, never imposed.
- **The floor means something.** Worlds that switch the health module
  on AND name vitalStatId get the zeroHp flow: at or below zero the run
  is downed ("the next scene begins from consequences, not game over -
  take their agency, never their story"), back above it they are on
  their feet again; the ledger narrates both transitions. The vital
  stat carries a ✧ in the referee's readout and on both sheets.
  Half-declared health (Policy Panic: module off, empty vital id) stays
  decor - the comedy's stats can dive without consequence.
- **Conditions are a system, not a tag graveyard.** [[condition:NAME]]
  / [[clear:NAME]] at tables that switched the module on (deduped,
  case-insensitive, clear-of-nothing told off, module-off refused rather
  than dropped); the grammar line teaches the tags only when the module
  is on; the state block lists them; both sheets show them (compact
  chips + a full Conditions corner in the status sheet) and the Downed
  banner sits by the clock. Old runs grow the new fields quietly.

### Verification

hordeworld-test gains the three blocks: dice (fallback DC in words,
branch landing, seeds found via the exported PRNG for natural-max and
natural-one, opt-out world, per-stat modifier and its mode gate),
conditions (dedupe, clear by case-insensitive name, refusals, grammar
gating, state line) and the floor (vitalStat requiring both halves,
downed/up transitions with ledger lines, the ✧ mark, the no-health
world unaffected, normalizeRun backfill). worldstatus-test gains sheet
coverage (Conditions corner with its kind empty state, module-off
absence, vital mark, Downed banner). Full battery: **44 suites, 1477
checks, 0 failed**.

APK `HordeStudio-v1.34.0.apk` — 347,491 B, sha256
`b3018156dd0c0ca93dc68f7b130e20fe223b54f7997f685a8353cd98ebcf34eb`;
in-APK verified (VERSION/CACHE v58/aapt code 71 + 1.34.0, all feature
markers). The v1.33.0 APK was dropped; release keeps its copy.
**Published 2026-10-17** under the standing series go-ahead.

Bumps: 1.34.0 (minor), apk code 71, sw cache v58.

---

## v1.33.0 — The world moves without you (living-world pack, 2 of 4) (2026-10-17)

Second plank of the approved plan (after the v1.32.0 truth pack): the
off-screen pulse and standing with consequences. Still no invention -
everything on the wire comes from the authored files.

### What changed

- **The world ticks.** `worldAgent` is parsed and normalized
  (`{enabled, intervalTurns}`; enabled is opt-out, interval defaults to
  15). On every turn that lands exactly on the interval, the referee's
  brief gains one line of off-screen momentum ("Off-screen, the world
  has moved: …") and a nudge to weave it in as background. buildPrompt
  stays pure: the beat is a pure function of the turn number.
- **Goal programs surface and advance.** `goalPrograms` parse to
  `{name, actor, steps[]}`; the state block always names what the world
  is working toward ("…now: 'whispers from corporate'"), advancing one
  step per landed beat and pinning on the final step once the program
  runs out - the deterministic world does not invent endings. Worlds
  without programs beat through their factions' own goals instead,
  rotating one per beat so each breath says something different
  (Policy Panic: six goal-bearing factions, a different agenda every
  18 turns).
- **Standing has consequences.** New ledger tag `[[rep:FACTION:±N]]`
  (id or name, zero is not a change, unknown factions told off, per-turn
  deltas obey the same ±bound as stats, the score itself clamps ±100).
  The state block now shows "Standing: The Switchboard +4; …" (up to 4
  entries), and the ledger-V2 rules explain the tag with the world's own
  faction ids. The starting life's `factionReputation` seeds the ledger
  as before - now it visibly continues from there.

### Verification

New hordeworld-test section ("off-screen"): pulse math (tick/multiples/
off-by-one/turn-zero), agent parsing (absent/disabled/default interval),
goal-needle progression and pinning, beat text rotation across the
fixture's six goal-bearing factions, rep-tag ledger behavior (seed from
the life - policy-panic's new hire starts `fac_frontdesk:5`, id vs name,
accumulation, zero-silent, unknown-rejected, ±100 clamp) and the
Standing/goal lines in the state block. Full battery: **44 suites,
1443 checks, 0 failed** (typing+update re-run after the by-now-routine
post-boundary dep wipe).

APK `HordeStudio-v1.33.0.apk` — 347,491 B, sha256
`ea67e25d1d4a26132173efaa7b0e055544706da3745e35161000cd620bc69161`;
in-APK verified (VERSION/CACHE v57/aapt code 70 + 1.33.0, all feature
markers). The v1.32.0 APK was dropped; release keeps its copy.
**Published 2026-10-17** under the standing series go-ahead.

Bumps: 1.33.0 (minor), apk code 70, sw cache v57.

---

## v1.32.0 — The world you are looking at (the living-world truth pack, 1 of 4) (2026-10-17)

### From research to roadmap

"Research the concept for authored worlds... what does it need to be
better... closer to the initial concept" produced the authored-worlds gap analysis
(`authored-worlds-gap-analysis.md`, pruned 2026-10-24): the .horde_world format is a
living-world spec (schedules, goal programs, faction state, an off-screen
agent tick, weather/seasons, full starting lives), and the APK parsed
most of it away or left it unread (grep-verified zeros for schedule,
goalSteps, statOverrides; relationshipsFor exported with zero callers).
"Start in the order you decided" began the plan: v1.32.0 truth pack →
v1.33.0 pulse+standing → v1.34.0 RPG depth → v1.35.0 breadth.

### What changed (all read-side, no new tags)

- **Schedules honored.** The parser keeps `entity.schedule`; a
  `scheduleActiveAt` resolver (weekday/weekend/named days, "governs
  until the next entry") drives "who is actually present" — the single
  most-violated upstream covenant. Present NPCs also get a
  "should be: <activity>" line so the scene is true to the hour.
- **Relationships in the prompt.** Present NPCs bring their strongest
  three ties ("Denton ↔ Eli: desperate for approval (51)");
  `relationshipsFor` finally has a caller.
- **Started lives actually start like the life.** statOverrides apply
  (clamped; a world's `max: 0` reads as "no cap" — the data's own
  convention for currency); obligations and `startingQuests` arrive as
  open tasks the ledger can complete by name; socialRank/legalStatus
  become the identity line; the authored outfit is the "Wearing" state.
- **Place texture.** Authored danger/prosperity reaches the referee
  as-is ("Referee texture: danger 8, prosperity 58 of 100"), no invented
  thresholds.
- **Seasons.** Worlds declaring a calendar get "Season: Maplebridge
  civic year · early spring · day 1" in state and on the status sheet —
  from the run clock, no live weather on the phone.
- **Prompt budget foundation.** A played NPC (name in any past reply)
  downgrades from full dossier to a ~200-char synopsis; the location-id
  roll-call obeys `kernel.sceneLocationLimit` (current + reachable
  first, "+N more"); validation keeps the whole map either way.
- **Status sheet** gains Season / You are / Wearing rows.

### Verification

New assertions in `hordeworld-test.js` (schedule math on the real
fixture's 6-entry days, presence/activity/relationship lines, texture,
life application incl. the cash `max: 0` no-cap convention, seeded-quest
completion, synopsis-vs-dossier, scene-cap roll-call) and
`worldstatus-test.js` (sheet rows). The classic "starting a run" block
was re-pinned to the life now honored (performance 40, 3 obligations,
35 after -5, 4 tasks after one more). Full battery: **44 suites, 1414
checks, 0 failed** (typing+update re-run after the nth boundary dep
wipe — system libs this time; install-deps cured it).

APK `HordeStudio-v1.32.0.apk` — 343,395 B, sha256
`434b8f9a6f3b1feaaf37b7d1d0e740d4e7a7e466dc4c2f36992dc02642fd0383`;
in-APK verified (`VERSION = '1.32.0'`, sw `horde-studio-v56`, aapt
badging code 69 / 1.32.0, all feature markers present). The superseded
v1.31.0 APK was dropped (release asset retains its copy).
**Published 2026-10-17** under the standing series go-ahead.

Bumps: 1.32.0 (minor — feature), apk code 69, sw cache v56.

---

## v1.31.0 — Personas get a face (2026-10-17)

### The ask

"Personas should have the option to import a photo for the avatar."

### The shape

A persona now carries its own photo. `avatar` lives on the persona
record — never in settings — so each identity keeps its own face, and
switching still swaps only name and text. Old installs need no
migration: a persona record without the key simply reads as no photo.

- **Import** — every persona row on the personas screen gained a thumb;
  tap it to pick a picture, and a small × removes a set photo. The
  picture goes through the shared image normalizer before IndexedDB —
  the same 512px diet as card avatars and world banners, so a 12 MP
  phone photo never becomes megabytes of base64.
- **Where the face shows** — the persona row itself, the identity-bar
  chip on Cast and Chats, and the player's own chat bubbles (they had
  an avatar slot all along; it only ever rendered initials). The
  default identity (no persona selected) and personas without a photo
  keep initials everywhere.
- Editing stays smooth: the thumb and the remove dot update in place
  instead of re-rendering the screen, so the name/text fields never
  lose the caret.

### Verification

New suite `personaavatar-test.js` (19 checks: rows, chips, chat
bubbles, the avatar helper, every fallback) plus persona-record checks
in `persona-test.js` (field shape, round-trip, pre-avatar records, the
avatar-never-in-settings contract). Full battery, 44 suites:
**1371 node checks, 0 failed.**

APK `HordeStudio-v1.31.0.apk` — 343,395 B, sha256
`00025fff7a6bf996871f8d7b740fe8540538983022d0e4fe434b1e51475cd379`;
in-APK bundle verified: `VERSION = '1.31.0'`, sw `horde-studio-v55`,
aapt badging versionCode 68 / versionName 1.31.0, avatar field +
row/chip/bubble wiring + pavat styles all present. The superseded `HordeStudio-v1.30.4.apk` was dropped (the release
asset retains its copy). **Published 2026-10-17** on the user's go-ahead.

Bumps: 1.31.0 (minor — new feature), apk code 68, sw cache v55.

---

## v1.30.4 — The referee stops quoting its own rulebook (2026-10-17)

### The bug (on-device, reported 2026-10-17)

"Why does it always say who is with the player at the end of every
reply?" — a screenshot of The Elos Wayfinder, turn 1: the referee's
answer ends with a bare "- who is with the player" line.

### The diagnosis

The referee's tag-grammar line was the only one carrying an inline note:
`[[with:NAME]] [[part:NAME]] - who is with the player` — the note was
meant as documentation of what the two tags track. Models copied the
line into their replies: with real tags (the ledger strips [[...]] spans
in place, leaving the bare words behind) or, when nothing about the
party had changed, just the note on its own. The leftover is neither a
tag nor a planning/thinking line, so neither applyTags nor cleanReply
removed it; it surfaced in the story every turn, and once stored in the
run it went back to the model as history and was parroted again.

### The change

- **`js/hordeworld.js`, rules** — the grammar line is now just
  `[[with:NAME]] [[part:NAME]]`, like every other tag. What they mean
  is told in prose instead: the "Party" rule, hoisted out of the
  ledgerV2-only block so every world gets it.
- **`js/hordeworld.js`, `stripTagArtifacts`** — a line that is just the
  note (optional dash/bullet, optional trailing punctuation) is dropped;
  prose that merely mentions it, and anything the player typed, is never
  touched. Applied in three places: `applyTags` (the displayed and
  stored reply), `buildPrompt` (stored turns going back to the model as
  history), and `normalizeRun` (runs saved before the fix are scrubbed
  when they are opened).

### Verification

New checks in `tests/hordeworld-test.js`: the grammar line carries no
annotation (v2 and opted-out worlds), the Party rule is told to every
world, the tag-plus-note and the bare note both vanish from the reply,
mentioning the phrase inside prose is kept, stored notes never reach
the referee again, old runs are scrubbed on open, player lines are
never scrubbed. Full battery, 43 suites: **1346 node checks, 0 failed.**

APK `HordeStudio-v1.30.4.apk` — 339,299 B, sha256
`c1fdf82f360204144c1985298b0942802bb2023d8b19a5c36ee3e66b2110dd7a`;
in-APK bundle verified: `VERSION = '1.30.4'`, sw `horde-studio-v54`,
aapt badging versionCode 67 / versionName 1.30.4, grammar line clean,
Party rule and stripTagArtifacts present. The superseded
`HordeStudio-v1.30.3.apk` was dropped (release asset retains its copy).

Bumps: 1.30.4 (patch — on-device prompt fix), apk code 67, sw cache v54.

---

## v1.30.3 — The app finally understands OOC (2026-10-17)

### The question (on-device, reported 2026-10-17)

"Do the app understand ooc: out of character? Because it always seems not
to react to what's mentioned in an ooc: situation."

### The diagnosis

The app had NO OOC feature. An "OOC: …" line was sent to the model as an
ordinary in-fiction message, and three things made it look ignored:
(1) the default character prompt says "Stay in character at all times"
and forbids commentary — an active instruction against answering OOC;
(2) no prompt anywhere told the model what to do with an OOC note;
(3) on AI Horde, each answer may come from a different volunteer model,
so whatever a model guessed about the convention varied turn to turn.

### The change

- **`js/api.js`** — a standing `OOC_RULE` is now appended to the system
  prompt of every character chat, in both wire formats (chat-provider
  `buildChat` and Horde plain-text `buildPrompt`): if the player writes an
  OOC note (OOC:, [ooc], (ooc)), the character steps out and answers it in
  one short plain line, then returns to the scene exactly where it left
  off; the character never comments on OOC inside the fiction. `{{user}}`
  / `{{char}}` are substituted, and it applies on top of any custom
  system prompt.
- **`js/hordeworld.js`, `buildPrompt`** — the referee's rules gained a
  world-specific OOC rule: an OOC note is a direct instruction to the
  referee, not in-fiction speech — carry it out (time-skip, house rule,
  correction), continue the scene from the new state, never narrate the
  OOC itself in-fiction. (World runs also flow through `API.generate`, so
  they get the generic rule too — the two are consistent.)

### Verification

New checks: "both wire formats carry the OOC rule, names substituted"
(`cardhtml-test.js`) and "the referee is told OOC notes are direct
instructions, not in-fiction speech" (`hordeworld-test.js`). Full battery,
43 suites: **1336 node checks, 0 failed.**

APK `HordeStudio-v1.30.3.apk` — 339,299 B, sha256
`cb0f1500d839670e8c6e42aa05d7df0f0e4e8106d67a2710669c5e41985e2f45`;
in-APK bundle verified: `VERSION = '1.30.3'`, sw `horde-studio-v53`,
versionCode 66, the OOC rule in both api.js and hordeworld.js. The
superseded `HordeStudio-v1.30.2.apk` was dropped (release asset retains
the copy).

Bumps: 1.30.3 (patch — OOC understanding), apk code 66, sw cache v53.

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
   nothing offers a **"Use exactly: \<typed\>"** row — any model ID can
   be selected and is saved as-is. Applies to both the provider and the
   Horde picker.
4. **Mobile-specific bug the new tests surfaced:** choosing
   "Any available" (value `''`) in the Horde picker never saved, because
   the sheet resolved through `if (v && onPick)` and `''` is falsy. The
   guard is now `v !== undefined && v !== null`, so `''` saves
   (clears the filter) and a dismissed sheet still saves nothing.

### Verification

`tests/modelcatalog-test.js` — 22 checks: the three parser shapes,
string entries, malformed-body degradation, error propagation; cache
first-open/reuse, provider-switch non-poisoning, new-cache reuse,
legacy-cache staleness; pinned-current retention (both pickers),
single-listing regression, exact-ID offer + save-as-is, no-duplicate-row,
and "Any available" clearing the filter. **Reproduced pre-patch:**
`{models: [...]}` → `[]`, malformed body → `TypeError: arr.map is not a
function`, and all picker behaviors absent. Full battery after the
patch: **987 checks, 0 failed** (965 + 22). No wrapper change —
MainActivity.java untouched, so the v1.22.1 launch-crash fix, install
fix, error log and wake lock are byte-identical in this build.

Bumps: 1.23.0, apk code 47, sw cache v35.

---

## v1.22.1 — launch crash fix (2026-10-10)

### The problem

After installing v1.22.0 the app crash-looped on launch ("Horde Studio
keeps stopping" on the user's Mi phone).

**Root cause:** the error-log store declared its file as a field
initializer —

```java
private final File logFile = new File(getFilesDir(), "errorlog.jsonl");
```

Field initializers run while the `Activity` is being **constructed**,
before `attach()` gives it a context. `getFilesDir()` there throws NPE on
every launch. It compiled clean and no Node test could see it (none of
them instantiates an Android Activity), so it sailed through the whole
battery and the dex marker check alike — the marker string was in the
dex; the crash was in *when* the line runs.

### The change

- `logFile` is now a **method** (`logFile()`) — the path resolves lazily,
  only once the activity actually has a context. All five call sites
  updated.
- New **`tests/initializers-test.js`** — a static scan that fails the
  battery if any `private … = …;` field initializer in the wrapper
  calls a context method (`getFilesDir`, `getSystemService`,
  `getSharedPreferences`, …). This is the class of bug, not this
  instance.
- Bumps: 1.22.1, apk code 46, sw cache v34 (store.js changed).

No other v1.22.0 code touched: the install fix, the error log and the
wake lock all stay exactly as shipped.

### Verification

Full battery: **965 checks, 0 failed** (962 + 3 new initializers
checks). The dex was disassembled and audited method by method:
`getFilesDir` appears in 13 call sites, **zero of them in
`MainActivity.<init>`** — the constructor now only calls
`Activity.<init>`, `HashMap.<init>`, `Object.<init>`; the log path is
built inside `logFile()` at first use. That is the strongest proof
available without a device; the constructor is byte-for-byte clean of
context calls.

APK: 322,850 B, sha256 `7c6ae611b1c911a4bdc5876119ee235388c0b767e5a6a50865c7cc9eb6bcaa95`,
code 46 / 1.22.1, signed with the same key (v1.22.0 stays installed-
compatible — this is an in-place upgrade, all user data kept).

---

## v1.22.0 — Install repair, error log, stay-awake replies (2026-10-10)

### The problem

The in-app APK install failed on the user's Android 14 phone: the file
downloaded, then a one-line "Install failed: com.hordestudio.mobil…" toast
flashed and vanished, and the APK had to be installed by hand from
Downloads.

**Root cause:** Android 14 (targeting S+) throws `SecurityException` when
`registerReceiver` is called for the `DownloadManager.ACTION_DOWNLOAD_COMPLETE`
broadcast without an export flag — and the exception message starts with
the app's package name, which is exactly the toast the user saw. Because
the throw happened *after* `dm.enqueue`, the download finished anyway but
the completion receiver was never registered, so nobody ever handed the
file to the installer.

### The change

1. **`MainActivity.java` — the install actually opens now.**
   - `registerReceiver(…, Context.RECEIVER_EXPORTED)` with an API 24/25
     fallback branch (the constant is a compile-time int, so it is a
     harmless no-op on API 26-32 where the flag is unknown).
   - A finished-but-failed download no longer reports a bare
     "did not finish": it is recorded in the error log with the URL.
   - Every install failure path (register, open-installer, download-not-
     finished, could-not-start, open-browser) and every update job
     failure (`jobFail`) now lands in the error log, as do main-frame
     WebView load errors.

2. **Error log (the suggestion became a feature).**
   - The wrapper keeps the last **200** errors — one JSON line each in
     private storage (`filesDir/errorlog.jsonl`), rewritten from memory on
     every add, so it cannot grow past the cap; a broken disk degrades to
     "no log", never a crash.
   - Bridge: `HSAndroid.logError(msg)`, `.errorLog()`, `.clearErrorLog()`.
   - `js/errorlog.js` (loaded first): `Logs.push/list/clear`, plus
     `window` `error` / `unhandledrejection` hooks, so JS crashes that
     used to be invisible without adb are captured too. `Logs.push`
     normalises whitespace, truncates at 300 chars, and never throws.
   - `js/update.js`: update-job failures and the boot auto-apply failure
     are pushed to the log.
   - **Settings → App updates** now has an **Error log** section: newest
     first, scrollable, timestamps, a confirmed **Clear** button, and a
     hint explaining the automatic 200-entry rollover.

3. **A reply can no longer hang when you switch apps** (user report:
   "the moment I switch to another app, the response hangs or times
   out").
   - **Root cause:** MainActivity had no lifecycle code at all, so
     nothing kept the process alive. The moment the app left the
     foreground, Android may sleep the CPU and freeze the process
     (Android 12+ freezes background processes unless they hold a
     wake lock). A frozen process ticks no timers — the Horde queue
     poll, the 35-second read timeouts that drive its retries, the
     stream deadline — so the in-flight request simply stops until the
     app is foregrounded again.
   - **`js/keepawake.js`** (loaded first): a tiny refcounted
     `KeepAwake.hold()/release()` that calls
     `HSAndroid.setReplyInFlight(bool)`; refcounted because a chat
     reply, a world turn and an image can be in flight at once.
   - Hold sites: chat `generateReply` (busy → final cleanup, so
     success, provider failure and save failure all settle it),
     `worldTurn` (worldBusy → turn settle), and `horde.js pollJob`
     (every Horde queue wait — text AND image — holds it for the whole
     poll, releasing on resolve, timeout and abort alike).
   - **`MainActivity.java`**: a `PARTIAL_WAKE_LOCK`
     (`hordestudio:reply-in-flight`) acquired while the refcount is
     above zero, **capped at 30 minutes** in `acquire()` so a lost
     release can never drain the battery, released in `onDestroy`.
     PARTIAL_WAKE_LOCK needs no permission.

   Not done (noted for a future release if this proves not to be
   enough on some devices): a foreground service with a
   "Generating…" notification — the only mechanism that also survives
   aggressive OEM process killers; a wake lock is the standard
   proportionate fix.

### Verification

`tests/errorlog-test.js` — 20 checks: rendering (newest first, escaped,
timestamps), the empty state, clear confirmed/declined, the Logs module
(normalisation, truncation, never-throws against a throwing bridge), and
both crash hooks. `tests/wakelock-test.js` — 16 checks: the chat path
holds/releases on success, provider failure and save failure; the busy
guard holds nothing; refcounting across overlapping generations; the
web-only (no bridge) case; and the Horde queue wait holding the lock for
the whole poll, including abort. Full suite: **962 passed, 0 failed**
(926 + 20 + 16). `MainActivity.java` compiles clean against platform 34.

The install and stay-awake fixes are in the wrapper, so they need the
v1.22.0 APK installed once (which the fixed flow will then be able to
do).

---

## v1.21.0 — Chat reliability (2026-10-10)

### The ask

Upstream v18.3.5 ("critical reliability release following a deep audit")
reviewed against the phone build: port what applies without touching the
fixes already shipped. Three items are portable; everything else
(multiplayer, video worlds, the MCP bridge, VH2 life-clock machinery,
embeddings, the HordeDB identity/cross-tab rework, the storage-failure
banner + emergency export) has no mobile equivalent — `exportAll` reads
the IDB directly, so the banner's data path does not exist here.

### The change

Purely additive; no existing fix is removed or reverted.

1. **`js/api.js` — the streaming request now dies loud.**
   - A **120 s per-request deadline** (`STREAM_TIMEOUT_MS`) on the
     OpenAI-compatible path: a reader that hangs mid-stream used to wedge
     the app in "Generating…" forever. The deadline raises
     `TimeoutError`, cancels the reader, and is cleared on settle. The
     Horde path is untouched (already bounded by `hordeMaxWait`, 600 s).
   - A **non-SSE body** (an HTML error page, a proxy notice — any line
     that is not empty, `data:`, `event:`, `id:` or `retry:`) now throws
     "invalid chat stream" instead of dissolving into an empty reply.
   - A stream that **ends with no text and not one parseable completion
     frame** throws "completed without visible text". A frame that parsed
     but carried no content is legitimate and keeps resolving `''` —
     the existing "…" bubble behaviour is preserved.
   - The non-stream JSON path is byte-identical in behaviour; the only
     new requirement for test sandboxes is the `setTimeout` pair.

2. **`js/app.js` — a storage failure no longer eats text or replies.**
   - `App.send`: the draft is captured before the input is cleared; if
     saving the user message fails, the text goes back into the box and
     the toast says "message was not sent — saving failed".
   - `App.generateReply`: a **finished reply stays in the thread** when
     its save fails — the storage error gets its own toast ("Reply kept
     on screen, but it could not be saved…"), the message is marked
     `saveFailed`, `afterReply` is not re-armed while the ledger is
     down, and the provider-failure path (remove bubble + re-spent retry
     chip) is not used. Burst delivery does not queue the remaining
     bubbles behind a failed save.
   - The abort-time partial save is no longer fire-and-forget: its
     failure gets its own toast too.
   - The provider-failure path is unchanged (reply removed, retry chip
     armed, `Error:` toast).

3. **Mid-turn guards (upstream's `chatTurnInProgress` destructive-op
   checks, mobile equivalents).**
   - `App.deleteCharacter` — refused while the reply for that character
     is generating; a failed delete now toasts instead of resolving
     silently.
   - Session menu **Delete chat** — refused while the active session is
     generating.
   - **Worlds correct-state** — the HUD button and the "Apply
     corrections" button are refused while `App.state.worldBusy` (a turn
     applying tags is mutating the same run object); the idle apply path
     is unchanged.

### Verification

Three new suites (real `api.js` / `app.js` / `views.js` + `hordeworld.js`
in VM sandboxes, stubbed storage):

- `tests/stream-test.js` — 16: happy path across chunk boundaries, the
  deadline killing a hung read (50 ms via `API._setStreamTimeoutMs`, a
  test-only hook), junk-body rejection + reader cancel, frameless /
  all-malformed streams, the preserved empty-delta `''` behaviour, SSE
  metadata tolerance, a final frame without trailing newline, the
  non-stream JSON path, HTTP errors.
- `tests/sendfail-test.js` — 41: draft restore + success path of
  `App.send`; character-delete guard / idle / failed-delete; chat-menu
  delete guard + idle; finished-reply survival on save failure (kept,
  marked, not removed, no `Error:` toast, `afterReply` off, busy
  cleared); the unchanged provider-failure path; empty-abort removal;
  reroll-abort partial-save failure; burst parts not queued behind a
  down ledger.
- `tests/worldbusy-test.js` — 13: HUD button and Apply button refused
  while `worldBusy` (nothing saved, run untouched, no navigation), and
  the idle apply still corrects, logs and navigates.

Full suite: **926 passed, 0 failed** (previous 856 + 70 new; the two
Playwright suites need chromium and are skipped in the sandbox, as
before). `hordeworld.js` 353/0 unchanged.

Not ported (no mobile equivalent): HordeDB identity/cross-tab rework +
storage banner + emergency export (the banner's in-memory export path
does not exist — `exportAll` reads the IDB), multiplayer, video worlds,
MCP bridge, VH2 life-clock/worker diagnostics, embeddings, Worlds
urgency/NPC-condition fixes (no scene-draft or NPC-condition machinery),
origin-freeze and draft retention.

---

## v1.20.0 — Worlds: scene discipline (2026-10-09)

### The ask

"Stage 4" — the final, optional stage of the Worlds v2 scope: catch DM
prose that over-claims, without upstream's JSON transport.

### The change

- `js/hordeworld.js` — **`auditClaims(world, run, input, applied)`**, a
  cheap local pass (pure string work, no model round-trip) that compares
  the actions the player's message promises with the tags the referee
  actually recorded. An action that landed in prose but not in the
  ledger becomes an **advisory** — `{ claim, note, kind }`, capped at
  three per turn — never a rejection, never a blocked turn (the whole
  pass is total: any internal failure degrades to "none").
  - **Claim extraction** is verb-driven, longest phrase first
    ("take on" before "take", "throw away" before "throw"). Kinds:
    item (take/grab/pick up/steal/lift/…), drop (drop/put down/leave
    behind/…), move (go/walk/run/head/enter/leave/return/…), cash
    (pay/spend/buy/offer/bet/tip), quest (take on/agree to).
  - **Precision beats recall** — the false-positive classes are
    designed out: a negated ask ("I refuse to take the key", a 30-char
    window before the verb) is not a claim; a move fires only when its
    target **resolves to a real place** (every prefix of the captured
    words is tried, so "the reception desk" still finds Reception); a
    cash claim needs a stated amount (digits or number words to
    twenty); an item/drop/quest object must be **verifiable** —
    against the world's item registry, the run's inventory, or the
    quest registry — or be at least two significant words on a
    registry-less world. "I take one step", "I steal a glance",
    "I take on the challenge", "I buy a ticket" (no amount) and
    "Let's go." (no target) all stay silent.
  - **Phrasal verbs with the particle behind the object** —
    "leave the key behind", "put the binder down", "throw the key
    away": the object is what sits between verb and particle; if that
    object names a place it is a move after all ("leave the office
    behind").
  - **Matching** against the applied turn: `picked up X` / `lost X`
    changes via `softMatch` (substring either direction, then
    all-words-of-the-shorter, so "the key" matches "Brass key"); a
    move matches `applied.moved` by location (a move to a different
    place is its own note — "the move went to Reception instead");
    a pay matches any negative cash change (the world may set its own
    price); a quest matches a `quest:` change or an open run quest.
  - **`commit`** now persists `applied.advisories` on the run
    (`run.advisories`, capped at 50, same shape as rejections).
- `js/app.js` — in `App.worldTurn`, the audit runs on the final reply
  (so a repaired turn is judged by what it stood as); an unmatched
  claim may spend the **one** repair round, exactly like a rejection —
  the repair message gains a "The player asked for things the reply did
  not record" section ("If an action happened, add its missing tag; if
  it did not, say so in the prose"), and the rejection-only message is
  byte-for-byte the v1.17.0 one. Opted-out worlds (`ledgerV2: false`)
  are untouched, as with rejections.
- `js/views.js` + `css/app.css` — the world HUD renders advisories
  under rejections as blue **"not recorded:"** notes (`.wr-advisories`
  / `.wr-adv`), deliberately softer than the amber rejections: the
  prose may be right and the tags wrong.
- **Deliberately NOT built** (per the scope): the `scene_draft_v2`
  JSON transport — passage IDs, typed action lists, the tool-call
  channel. It needs function-calling providers and a 32k-class
  context; the tags are this app's scene draft, and Stages 1–2 made
  them honest.

### Tests

`tests/hordeworld-test.js` 309 → **353** (+44): every kind fires and
is silenced by its matching tag; wrong-object and wrong-place cases;
the world's own price; gain-is-not-a-spend; the idioms and negations
that stay silent; sentence-boundary discipline ("I pay. It was five."
and "I take. The key is stuck." are not claims); the phrasal particles
all three ways; two asks in one sentence; the cap at three; the
totality contract (null world, garbage input); and `commit`
persisting + capping advisories. Full battery: 25 node suites /
**856 checks, 0 failing** (the two Playwright suites still need a
browser).

### Ship state (this segment)

Bumped 1.20.0 / code 43 / sw v31. Built
`HordeStudio-v1.20.0.apk` (318,619 B;
1afdca5284001dacfe5d545e746daa36a64cad2e64b11dda2d6788e228f71569 —
same keystore, in-place upgrade from code 42) and in-APK verified:
`auditClaims` + `CLAIM_PARTICLE` in hordeworld.js, `not recorded` in
views.js, `wr-adv` in app.css, sw v31, VERSION 1.20.0. Superseded
v1.19.0 root APK removed. Committed locally. Publish only on explicit
ask. This closes the Worlds v2 program: v1.17 ledger honesty, v1.18
checks, v1.19 knowledge gating, v1.20 scene discipline.

---

## v1.19.0 — Worlds: the world knows what NPCs know (2026-10-09)

### The ask

"Stage 3" — third stage of the Worlds v2 scope: knowledge gating. Lore
entries gain `knownBy`, NPC `secrets` stop being dead text, lore
matching gets scoring + a byte budget. Backward compatible: no
`knownBy` → `anyone`, exactly as before.

### The change

- `js/hordeworld.js`:
  - **parse** keeps the new fields: lorebook entries carry
    `knownBy` / `unlockQuest` / `unlockNpc`; entities carry
    `secretUnlock`.
  - **`loreVisible(world, run, entry)`** — the gate: `anyone`
    (default) | `faction:<id>` (player has standing with the faction —
    any score, being in the loop is what matters) | `npc:<id-or-name>`
    (present at the run's location) | `secret` (unlock via
    `unlockQuest` — the quest is open or done — or `unlockNpc` — the
    witness is present; no unlock condition = stays locked). Unknown
    gate words show rather than silently hide.
  - **`loreScore` / `loreHits`** — matching moved from
    first-come-substring to word-frequency scoring (occurrence count
    per keyword), best matches first, capped at 8 entries and a 1,536
    char budget (a single matching entry always gets in alone). This
    is what keeps a 120-place pack from eating the prompt. Signature
    gained the run (`loreHits(world, run, text, limit, budget)`).
  - **`secretLines(world, run, n)`** — upstream secrets are
    `{label, hint, truth}` (a plain string degrades to hint-only).
    While the NPC is present the referee gets the hint and, where a
    truth exists, an explicit "do not reveal the truth; it may only
    surface if the player earns it." When the entity's
    `secretUnlock` is met (`{quest}` flag or `{stat:{id,min}}`), the
    truth is injected marked "is revealed to the player." Secrets
    travel with the NPC, not the place.
  - **`describeLocation`** appends the secret lines per present NPC;
    **`buildPrompt`** passes the run to the gated/budgeted loreHits.
  - Policy Panic was NOT re-authored: all nine of its secrets work
    out of the box in hint-only mode (no `secretUnlock` declared),
    which is the safe default — truths still earn their telling.
- No api.js, views.js, css or index.html changes: this is pure
  prompt-engine work (the world files and engine are web-channel
  updates).

### Tests

`tests/hordeworld-test.js` 275 → **309** (+34): every gate (open,
faction with/without standing, npc present/absent, locked secret,
quest-unlock open AND done, witness-unlock present/absent); scoring
(repeated keyword outranks single, both still surface); the byte
budget (pile stops at the budget, total respected, a lone big match
still gets in); old-vs-new matcher snapshot on four Policy Panic
queries (same entry sets); the three-layer secret behaviour (hint
flows, truth out, "do not reveal" present; truth revealed at the quest
flag and at the stat threshold; secrets follow the NPC); and the
bundled world (its kept secrets now appear as hints — blinds, second
book — truths absent, in a place with a keeper, and absent where there
is no keeper). Two test bugs caught on the first run (a 1-char keyword
under the matcher's >2 rule; assuming reception had no
secret-keeper — it does). Full battery: 25 node suites / **812 checks,
0 failing** (the two Playwright suites still need a browser).

### Ship state (this segment)

Bumped 1.19.0 / code 42 / sw v30. Built
`HordeStudio-v1.19.0.apk` (310,427 B — same size as the v1.18.0
builds again, so the sha256 is the identity:
6b411a802fe70dee392943e9de266284639ef3a296bb78d545586386f108ac8c —
same keystore, in-place upgrade from code 41) and in-APK verified:
`loreVisible` + `secretLines` + budgeted `loreHits` in hordeworld.js,
sw v30, VERSION 1.19.0. Superseded v1.18.0 root APK removed. Committed
locally. Publish only on explicit ask.

---

## v1.18.0 — Worlds: checks with real consequences (2026-10-09)

### The ask

"Stage 2" — the second stage of the Worlds v2 scope: checks with real
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

"Scope the worlds idea" → scope written (4 stages; the scope doc, `WORLDSCOPE.md`, was pruned in the 2026-10-24 cleanup) →
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

Not ported (desktop-only, documented in README): mind/cognition/embodiment
subsystems, embodiment-aware routing, sleep-pressure dynamics,
money/debt model, page-builder creation form, Python live backend,
worker-encoding/packaging fixes.
