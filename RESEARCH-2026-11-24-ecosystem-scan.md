# Ecosystem scan — what the field has that Horde Studio does not

**Date:** 2026-11-24 · **Against:** v1.43.0 (code 199) · **Scope:** research only, no code changed
**Asked for:** all three directions (engine / app engineering / card tooling), no ambition limit.

## Erratum — four "absent" claims in this report were wrong (checked 2026-11-24)

Each of these was concluded by grepping for a literal string and finding nothing. All
four features exist. The method was the bug, not the hunting.

| claim here | truth, in the code |
|---|---|
| §E1 "Chat search — grep is empty" | `Views.chats` filters on `App.state.chatSearch` over card name + group names + title + summary. What is genuinely missing is searching **inside message bodies** — which is the useful half, and is what 1.45.0 now does. |
| §B3 "Export beyond JSON — only .json paths exist" | `App.exportSheet` already offers two formats: `.txt` for reading (`App.exportTranscript`, incl. memory, live facts and retired facts) and `.hordechat.json` for restore. Markdown is a third option in an existing sheet, not a new capability. |
| §F1 "the prompt inspector … is what is missing" | `App.promptInspector` exists and is in the chat menu, already showing each block with role, ~tokens and the exact text. What was missing is the **cuts** — how much never made it, and why — and the request body. 1.44.0 added those two. |
| §A6/§E8 "an injection-reasons panel is a display job" | `views.js:631` already calls `API.loreDiagnostics` on the Lore screen. The addition here was the *per-request* skip reasons for the real window, carried out of the same admission pass (`lastAssembly.lore.skipped`). |

One more inventory miss, in the same direction: `tests/prompt-inspector-test.js` already
existed, and `speechSynthesis` is already wired (app.js:1693), so read-aloud needed no
introduction. The claims that survived re-checking are the ones measured rather than
grepped: the V3 token diff (§A5), §A2, §A3 and the licensing note.

What the scan still got right, and what it actually bought: the field's numbers for
protect windows and chunk sizing (§A2), the relocation/caching trade (§A3), the V3
token diff (§A5), the licensing constraint, and §C's test-admission rule — which this
release applied to itself, in the honest direction: two assertions that pinned the bug
were rewritten to pin the requirement, and three assertions that could not fail were
strengthened until they could.


## How to read this

Horde Studio is a zero-dependency vanilla-JS roleplay client in an Android WebView wrapper,
talking to AI Horde **and** direct OpenAI-compatible APIs, with offline-first storage. I could
not find a second project that is that combination. A GitHub search for `roleplay PWA offline`
returned one repo with ★0. So everything below is **idea transfer**, not "someone built this for
you." Projects checked (stars / last push, via the GitHub API, all today):

| repo | ★ | pushed | licence | why it was in scope |
|---|---|---|---|---|
| SillyTavern/SillyTavern | 36 038 | 2026-11-22 | AGPL-3.0 | the field's de-facto feature ceiling |
| Darkatse/TauriTavern | 2 424 | 2026-11-24 | AGPL-3.0 | rewrite of that frontend for native/phone hosts |
| kwaroran/Risuai | 1 866 | 2026-11-22 | GPL-3.0 | card-driven alt-genre UI, node-based |
| nevaeh5379/HaejeokRisuai | 12 | 2026-11-16 | GPL-3.0 | a fork whose whole point is low memory |
| PocketRisu/PocketRisu | 454 | 2026-11-01 | GPL-3.0 | self-hosted, multi-user |
| agnaistic/agnai | 796 | 2026-11-24 | AGPL-3.0 | multi-user/multi-bot, group semantics |
| LostRuins/lite.koboldai.net | 208 | 2026-11-24 | AGPL-3.0 | **closest architectural sibling** (one file, zero deps) |
| kwaroran/character-card-spec-v3 | 116 | 2024-07-20 | MIT | the card spec we implement |
| malfoyslastname/character-card-spec-v2 | 203 | 2023-06-22 | none | same, V2 |
| tavernary.org (ext index) | — | 2026-11 | — | 584 extensions indexed by category |

**Licensing:** all of the above are AGPL/GPL except the card spec (MIT) and some extensions (MIT).
Nothing below can be *ported* — no code, no assets, no prompt text lifted. Read for behaviour,
then write it fresh. That is the only thing about this list that is not optional.

---

## A. RP engine

### A1. User regex scripts — the biggest structural absence
SillyTavern treats regex as a first-class system with **stages** (`MessageFormatter` transforms
content *before* regex, *after* regex, and *after* Markdown — 1.19.0 release notes), per-scope
scripts (global / preset / character), named capture groups in the replacement (1.13.4), a
**debug visualiser** plus saveable order and state (1.13.4), and order-sensitivity detection.
TauriTavern's extension ecosystem exists largely because that pipeline is stable.

Horde Studio has: thinking-tag stripping (`api.js:2410`), label stripping (`cleanReply`), and an
import-time defence that *rejects* a lorebook key which is regex source (`api.js:1148-1159` region).
There is **no user-facing regex at all** — `new RegExp(` appears nowhere in the shipped code except
hard-coded internal patterns.

Why it matters more here than in SillyTavern: v1.43.0's whole `msg.raw` feature exists because the
app edits a reply and the reader cannot see the pre-edit text. Regex scripts are the general form of
that problem: **everyone wants different edits**, and right now the only edits available are the ones
I hard-coded. A regex list (find / replace / flags / stage: display-only vs also-prompt / enabled
per character) would turn three shipped special-cases into one mechanism plus presets.

Cost: medium. The stage distinction (display vs prompt) is the part that must be right or it becomes
a footgun; SillyTavern got there over several releases.

### A2. Two facts from Vector Storage worth stealing, and one worth refusing
Its documented defaults (`public/scripts/extensions/vectors/index.js`, via deepwiki):
`score_threshold 0.25`, `insert 3`, `query 2` (last two messages form the search), `protect 5`
(recent messages never relocated), chunk `400` chars for chat vs `2 500` for documents, and it is
**off for chats by default**. The asymmetry between a line of dialogue and a reference document is
the considered part; the numbers are the published result of tuning.

Two transfers that cost nothing:
- **`protect N`** — never let a memory/retrieval mechanism touch the last N messages. Horde Studio's
  `memoryDue` / `applyMemory` (`hordeworld.js:547`, `:765`) rewrite what the model is told happened;
  a protect window is the reason a memory system stops fighting the transcript.
- **Chunk by kind.** If a fact is stored, store it at a size appropriate to a fact, not to a
  document. `currentFacts`/`pastFacts` (`hordeworld.js:641-665`) already implicitly do this; naming it
  would let the budget maths say so.

Refuse: the vector DB itself, for now (see C1 for the cheaper version).

### A3. Retrieval that *relocates* rather than appends — and what it costs
ST's `rearrangeChat()` **removes** matched messages from their original position and re-inserts them
as a block under a "Past events:" heading. Community docs note the consequence plainly: a moving
memory block **breaks prompt-cache discounts**, because the prefix changes every turn.

That is directly relevant to this app: 90 % of Horde Studio's friendliest behaviour is that the
prompt is assembled to a stable prefix (the honest-legend + `pushCost` work in v1.42.2 made the
budget visible). Any future recall feature that shuffles history forfeits caching — which, on the
free routes with `cache hit rate 90.55 %` / `93.21 %` (OpenRouter model pages, 2026-11-24), is real
money and real latency. **Decision to make before building, not after.**

### A4. Group chats: Agnai's speaking rules
`agnaistic/agnai` is built around multi-user/multi-bot rooms. Horde Studio has `speakerMode`
(`app.js:3963` region) and a manual "choose the next speaker", which is the simple version. The
field's richer parts are *reply-when-mentioned*, *queue with per-member budget*, and *a bot answering
another bot without the user*. Worth a look before the Worlds engine grows more group assumptions.

### A5. Lorebook corners the field converged on that we do not honour
Diff of backtick-quoted tokens in `SPEC_V3.md` against `store.js` + `app.js`: 40 are named in our
code, **20 are never mentioned**: `use_regex`, `recursive_scanning`, `first_msg`, `group_only_greetings`,
`creation_date`, `modification_date`, `creator_notes`, `creator_notes_multilingual`, `additional_keys`,
`exclude_keys`, `assets`, `asset`, `uri`, `user_icon`, `background`, `comment`, `selective`-adjacent
`angry/happy/sad/neutral` (expression names, not spec), `source`, `forest`, `main`.

Three that are decisions, not oversights:
1. **`use_regex` per lore entry.** We *reject* regex-looking keys at import (deliberately — a card's
   `keys` are user data, not code). But a card that sets `use_regex: true` is asking for the opposite,
   and we silently treat its patterns as literals. Honesty option: honour it behind a global "allow
   regex from cards" switch, off by default, and *say so in the import note* when a book sets it.
2. **`recursive_scanning`.** Whether an injected entry's text can trigger a second entry. This is the
   one lorebook behaviour that changes *what the model sees* the most, and we currently do a single
   pass with no statement of that anywhere in the UI. `MEMORY-AND-STATE-RESEARCH.md` is the place to
   decide it.
3. **`creation_date` / `modification_date` / `creator_notes`.** Import-time provenance. We already
   built `Store.cardSource` (v1.39.113) and `card.__png` (v1.42.2) for exactly this kind of thing, so
   the pipe exists. Cheap, and it makes "which version of this card did I import?" answerable.

Also: `first_msg` is a real spec key (V3), so a card that ships it and no `first_mes` should still
have a greeting; `group_only_greetings` should not appear as a normal swipe.

### A6. Prompt inspector — the one tool the field proves people want
ST's `1.19.0` gained a `/pm-render` command and a MessageFormatter pipeline; the community
"Prompt Manager" and third-party tools (Marinara Extender, CharaMemory's **Injection Viewer**: "which
memories were injected for any message, with per-source token estimates and a stacked bar") exist
because people cannot otherwise see why a reply went wrong.

Horde Studio is **closer to having this than anyone**: `buildPrompt` already returns a `costs` object
with `{state, memory, lore, history, other}` (v1.42.2, `hordeworld.js`), and the HUD renders
`wr-counters`. What is missing is the step from "budget by bucket" to "**the exact string, per
section, for this chat**" — which is one render of `buildPrompt`'s output with section labels, no
new machinery. For an app whose users hit 429s, empty replies and cut lore, this is the highest
diagnostic value per line in the whole list.

### A7. Quick Replies / slash commands
ST's Quick Reply system = user-defined buttons that run macros, bound per character (1.13.3 added
sets bound to characters and a "before message generation" auto-execute). The whole `vhuman.js`
"life" system is this app's home-grown version of the same idea. The transferable bit is the
**binding and the trigger** (before-generation vs after), not a macro language.

### A8. Expression sprites and image prompting
ST's Character Expressions + ComfyUI integration, and the Creative Studio extension's "Pictures →
Expressions — same character, different moods" flow. Horde Studio has `msg.speakerPortrait` +
`App.expressionPortraitFor` (added for v1.42.x) driven by `speakerMood` — i.e. the *slot* exists.
What it lacks is the *authoring* side: a way to attach several portraits to a character and map moods
to them, instead of one avatar.

---

## B. App & platform engineering

### B1. `beforeunload` for "unsaved" — and the field still cares
`lite.koboldai.net`'s most recent commit (2026-11-24, four hours before this scan) is literally
`warn more unsaved`. Kobold Lite has had split/join scripts (`utils/`, PR #127) so a 300 KB
`index.html` stays editable — the same problem as `app.js` at ~305 KB.

Horde Studio's answer to that shape is stronger than a warning: v1.41.1 ("the editor may not lose
what you typed"). Worth a sweep for the *remaining* places where typed text can die: the fields
outside the card editor (lorebook entry body? persona edit? world `stage`/`location` inputs at
`app.js:2013`) — and whether each one is dirty-checked before the view changes.

### B2. A single-file philosophy is viable at this size — evidence
The closest sibling runs a whole multi-backend UI in one HTML file and pushes daily after three
years. Two habits worth copying: (a) **split for editing, join for shipping** (they generate
`index.html` from parts); this repo's `horde-studio-mobile/js/*.js` is already split and `build-channel.py`
already joins — we're on the good side of that. (b) **no build step at runtime**, which we keep.
Conclusion: no framework pressure exists; the architecture is not the constraint. The constraint is
per-file size in review, and we already manage it.

### B3. Offline/UX pieces the field ships that this app has no hook for yet
- **Chat search.** Verified absent (`Search the chat` → no match). ST has it; on a phone with a
  400-message campaign it is the fastest way to find "what did we name the boat".
- **Export beyond JSON.** Only `.json` export paths exist in `app.js`. Markdown/txt export is
  table-stakes in the field and trivially derivable from the message array.
- **Notifications.** Verified absent (`grep notification` → 0 files). The `vhuman.js` outreach
  system generates messages while the app is backgrounded — which is exactly what Android
  notifications exist for. This needs a native hook, so see D2.
- **`BroadcastChannel`.** Verified absent (0 files). Multiple open chats in multiple webviews
  currently cannot hear each other; a channel is one line to create.

### B4. HaejeokRisuai's whole reason for existing
A 12-star fork whose description is: *"Even if bugs occur, I prioritize memory optimization (low
memory)"*. That is the phone threat model stated plainly, and this app already behaves it
(session caps, `run.tally` 50-item display arrays, the 2 MiB `cardSource` cap, gitignored build
scratch). The transferable idea is **a measured number in the UI**: ST shows token breakdowns, we
show prompt buckets — a "this app is holding X MB" line in Settings → Storage with the biggest
offenders named would make a bad month debuggable by the user rather than by me.

### B5. Tauri as the ceiling, not the next step
`TauriTavern` (★2 424, pushed today, 1 655 commits) is SillyTavern's frontend on a Rust host: real
filesystem, native windowing, and it ships an **OpenHarmony HAP** (`ohos.yml`) as an *optional*
artefact — its release notes state an OHOS failure "leaves it out without blocking the other
platforms". Two lessons for this project: the wrapper can carry native capability without the web app
caring, and **make each native extra non-blocking in CI or it will hold releases hostage**. That is
directly relevant to `apk-build/` and Pages being one pipeline today.

---

## C. Test and tooling practice (this is where I think this repo learns the most)

`Darkatse/TauriTavern` publishes a maintenance philosophy in `CONTRIBUTING.md` plus an agent skill
(`.agents/skills/maintain-conceptual-integrity/`). Its **test admission rule**, translated:

> Tests guard observable behaviour, non-trivial invariants, and specific defects that happened and
> were fixed. Code change or coverage growth is not by itself a reason to add a test. Do not test
> source text, literals, obvious control flow, direct delegation, implementation details, or removed
> features. Prefer reusing the highest-level existing behavioural coverage. Concurrency tests use
> deterministic coordination, never sleep.

Two of its seven principles are also pointed at this repo's habits:

- **"General over special-casing"** — *提出新功能时，先看看仓库是否已有相近能力* (before adding a
  feature, check whether a nearby capability already exists and extend that mechanism instead).
  That is exactly the `isOpenRouterFreeNemotron` story: four releases of model-name-shaped patches
  for a budget-shaped problem, which v1.43.0 finally generalised into a setting.
- **60/95** — 60 % of the complexity to cover 95 % of the edges; rare scenarios wait until they are
  real. This repo's drift campaign (40 assertions over a scripted 60-turn run) is comfortable
  sitting near that line; the `generic-check` style sweeps are not obviously on the right side of it.

**Applied honestly to the last release: I violated its first rule twice.** `openrouter-quota-test`
asserts exact display strings (`'OpenRouter account rate limit' + ' — 40/window · 0 left · resets in 9m'`),
and `reply-resilience-test` greps source text for `text.length <= 12000` and for the literal
`if (!msg.rawKept || !msg.raw)`. That is testing source text and literals. They were written under
the house convention (several shipped tests pin wording on purpose, e.g. `facthistory-test.js:211`),
and pinning *user-facing* wording is defensible; pinning an internal numeric limit is not. If we
adopt a rule, the ones worth adopting are: **no new source-text assertion where a behavioural one is
reachable**, and **no test added for a scenario that has not happened** (the "don't add regression
tests prematurely" line, which cuts against my instinct).

Also worth stealing, independent of licence: their **PR rule for AI-assisted work** — the human writes
the visible summary and states what they personally verified; the AI's write-up goes in a collapsed
block naming the tool and model. Cheap process, and it prevents the failure where a confident
third-party summary replaces a checked claim.

---

## D. No-limit tier (what exists, and what it would cost)

1. **Local embeddings without a server.** `transformers.js` runs in-browser (ST's default
   embedding source is `transformers`, "runs locally in the browser and needs no API key"). In this
   app that means a ~25 MB wasm dependency, a model file, and a build step — i.e. the three things
   the architecture says no to. **Cheaper equivalent that fits:** TF-IDF-ish or BM25-lite scoring in
   100 lines of JS over the message array (no model, no deps), which gives "find the old scene that
   resembles this one" — the actual thing people want from Vector Storage — and can run inside the
   existing worker-less budget. Ranked here as *the* memory upgrade.
2. **Native notifications + a foreground service** for `vhuman.js` outreach while backgrounded.
   Needs a real Android class in `apk-build/` and a JS↔Java bridge, so it is the only item on this
   list that breaks "web update only". It is also the only item that makes the Life feature mean
   something when the screen is off.
3. **Persisting images in IndexedDB** with the object store keyed by hash, so a card's portraits and
   expression sprites survive a webview cache eviction. The IDB layer exists (`idb.js`).
4. **A `sw.js` that pre-caches the update bundle** so an update can install offline. (Relevant
   because the update channel is one fetch and this app ships to people with bad connections.)
5. **Tauri-style split host** — rewrite the shell, keep the web app. Not recommended; the WebView
   wrapper already gets the store, the keystore discipline, and the Pages channel, and the cost is
   every hard-won release process at once.

---

## E. Deliberately NOT doing

| idea | from | why not |
|---|---|---|
| Plugin/extension system | ST, TauriTavern | needs sandboxing, a manifest format, and a community. Three jobs, one of which is social. |
| STscript macro language | ST | a scripting surface in a phone app that also holds API keys is the wrong trust shape here. |
| ComfyUI / local SD image generation | ST | the app already uses AI Horde for images; a local pipeline is a different product. |
| Prompt-cache-friendly memory shuffling | ST Vector Storage | see A3 — it trades a real 90 % cache hit for a recall gain we can get from keyword-plus-BM25. |
| A vector DB | ST | see D1. |
| Persona CRUD via script commands | ST 1.18 | the app's persona model is deliberately smaller. |
| Anything AGPL | all of B and C | idea transfer only, per the note up top. |

---

## F. Recommended order (my opinion, one list)

1. **A6 Prompt inspector** — it is 80 % built already (`costs` + `run.tally` + `wr-counters`), it is
   the tool every other item on this list would be debugged with, and it is honest-by-construction
   in a way this repo already values.
2. **A5.3 card provenance fields** (`creation_date` / `modification_date` / `creator_notes`) into the
   existing `cardSource`/`__png` pipeline — small, no behaviour risk, ends a whole class of "which
   card was this?"
3. **A1 User regex, display-stage only** — solve the general case of the thing v1.43.0 special-cased,
   and stop there before touching prompt-affecting stages.
4. **B3 chat search + Markdown export** — two absent basics, both derived from data already in Store.
5. **D1 BM25-lite recall** behind `protect N` semantics (A2) — the memory upgrade, without a model.
6. **A5.1/A5.2 `use_regex` / `recursive_scanning`**, as a documented decision + import note, not a
   silent change.
7. **C test-admission rule**, as a repo doc + `generic-check` addition — cheap, and it would have
   prevented two of my own worst additions this month.
8. **D2 native notifications** — only after the list above, because it is the one that costs the
   update channel.

## Open questions for you

1. **Regex: display-only, or allowed to rewrite what the model is sent?** The second is what makes
   it powerful and what makes it able to break a chat invisibly. (My recommendation: display-only
   first.)
2. **Recursive lore scanning** — allow an injected entry to activate another entry, or keep the
   single pass and say so in the HUD? Single pass is cheaper and predictable; recursive is what
   big-world cards increasingly assume.
3. **Should the prompt inspector show the *outgoing request body* (with API key redacted) or the
   assembled prompt sections only?** The first is more useful for provider bugs and more dangerous in
   a screenshot; this app already redacts `sk-or-v1-…` in error text (`app.js:33`), so the machinery
   exists.
4. **Is `vhuman.js` outreach supposed to reach the user when the app is closed?** If yes, D2 moves
   up the list and everything else shifts down.
5. **Which of the 20 unimplemented V3 fields do you care about**, if any? `assets`/`uri` (external
   avatar references) is the one I'd guess about, and it is the one I'd refuse on security grounds —
   a card that fetches a remote image tells you who reads your chats.

## Verification notes

- Star counts, push dates, licences: GitHub REST API, 2026-11-24.
- Vector Storage defaults and settings table: deepwiki mirror of `public/scripts/extensions/vectors/index.js`
  (line refs included there); treated as documentation, not as source.
- SillyTavern feature claims: the repo's own Releases page (1.13.3 → 1.19.0).
- `use_regex` / `recursive_scanning` / `first_msg` etc. as "not in our code": a token diff of
  `kwaroran/character-card-spec-v3/SPEC_V3.md` against `store.js` + `app.js`, plus direct greps
  (`new RegExp`, `use_regex`, `notification`, `BroadcastChannel`, `Worker(`, `speechSynthesis`,
  `Search the chat`) whose zero/one results are quoted inline above.
- **Not checked:** whether any of these features exist in a fork I did not open, and TauriTavern's
  `docs/Agent/TestingStrategy.md` (referenced by its CONTRIBUTING, not fetched).
