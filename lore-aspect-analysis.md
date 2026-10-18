# The lore aspect of the APK — what's there, and what could be better

Surveyed 2026-10-18 against the actual code paths (`js/hordeworld.js`,
`js/api.js`, `js/app.js`, `js/views.js`) and the shipped world
(Policy Panic, 16-entry lorebook). Everything below is verified in
code; nothing is extrapolated from docs.

---

## 1. What "lore" is in this app — three distinct surfaces

### A. Character lorebooks (persona chats)

- **Shape:** per character, `lorebook: [{keys:[], content, enabled}]`.
  Cards that carry world-info entries are normalized into this on
  import (`app.js`).
- **Selection (`api.js loreHits`):** an entry fires when **any** of its
  keys appears as a case-insensitive substring in `recent` = the text
  of the **last 6 messages**. Disabled entries are skipped. Cap: 6
  entries, no byte budget.
- **Injection:** `Relevant world facts:` block in the character sheet,
  macros already resolved (`{{char}}`, `{{user}}`).
- **UI ("Lorebook & memory" per character):** list with add / edit /
  per-entry delete; disabled entries render dimmed.

### B. World lorebook (authored `.horde_world` files)

- **Shape:** `[{id, keyword:"a,b,c", text, knownBy, unlockQuest,
  unlockNpc}]`. Upstream ships only `id/keyword/text`; the three gating
  fields are **our** extension (v1.19.0 knowledge gating).
- **Gating (`loreVisible`):**
  - `anyone` (default/empty) — always visible
  - `faction:<id>` — only once the player *has standing* with the
    faction (any `run.reputation` entry; since v1.33.0 the `[[rep:…]]`
    tag can actually create one, so these gates became reachable in
    play)
  - `npc:<id|name>` — only while that NPC is present
  - `secret` — stays locked until `unlockQuest` text appears among the
    run's quests (contains-match, done or not) **or** `unlockNpc` is
    present; with no unlock condition it never opens. Unknown gate
    words *show* rather than silently hide (fail-open, deliberate).
- **Selection (`loreScore`/`loreHits`):** score = total substring
  hits of the entry's comma-separated keywords (keywords of length ≤ 2
  are ignored) in **the player's current input line only**. Entry text
  is *never* macro-expanded (worlds have no `{{user}}` convention).
  Injection: `Established lore:` block in the referee's system prompt.
- **Budget:** top 8 by score (stable by author order), cumulative text
  ≤ 1536 bytes; a single matching entry always gets in regardless of
  size.
- **UI:** none for editing; the v1.35.0 read-only viewer reports only
  the entry *count*.

### C. Story memory (persona chats only)

- Per conversation: `session.summary` ("Story so far") + `facts[]`
  ("Established facts"), auto-summarised every `memoryEvery` messages
  (a real setting), editable in a dedicated sheet (summary textarea,
  per-fact delete), injected into every prompt.
- **World runs have none of this.** Their long-term context is the
  last **12** log lines plus the ledger (stats/tasks/standing/tasks).
  Beyond 12 turns, everything the referee learned only in prose is
  gone.

---

## 2. What is genuinely good (keep as-is)

1. **The world-side gate model is richer than upstream's** — gated,
  unlockable, npc-conditional lore is something SillyTavern-style
  lorebooks express clumsily; here it rides the run's actual state.
2. **The byte budget with a "one always gets in" floor** keeps a big
  book from eating the prompt while never starving it entirely.
3. **Character-side tolerance:** macros resolved, enabled toggles,
  per-conversation memory with a real editing surface.
4. **Everything reaches the model as plain `-` lines** — no JSON in
  prompts, no schema for models to echo.
5. **Lore by trigger, not by dump:** both systems only surface what
  the current context touches — the design instinct is right; the
  weaknesses are in the *trigger*, not the idea.

## 3. The real gaps, ranked

| # | Gap | Weight | Size |
|---|-----|--------|------|
| 1 | **World runs have no story memory.** A 60-turn plot's early turns evaporate; only the ledger persists. The persona side solved this exact problem per conversation — the machinery exists and knows how to summarise. | Coherence over distance | M |
| 2 | **World lore trigger window is one line long.** Scored on the player's current input only. If the referee names a thing and the player replies "tell me about it", the lore never fires. The character side already scores against the last 6 messages. | Recall feels random | S |
| 3 | **Matching is raw substrings.** `countHits` is `indexOf`-counting: "bell" fires on "middlesbrough", "mark" on "market". Stems like "gossip→gossips" currently work *by accident* of the same rule. | False positives | S |
| 4 | **The AI author drafts no lore** — and even if it did, `assemble()` would drop it: `lorebook` is not in its key list. Drafted worlds start with an empty book. | Authored-world parity with the series | S |
| 5 | **World lore is invisible to players.** The v1.35.0 viewer knows the *count*, not the book. A lore browser turns an authored file into something you can trust before installing — with a spoiler policy (secret-gated entries must stay sealed). | Discoverability/trust | S |
| 6 | **Character-side cap is a flat `slice(0,6)`** with no byte discipline; six 500-char entries sail through while the world side budgets. | Prompt hygiene | S |
| 7 | **No book hygiene for authors.** A dead keyword (one that never occurs in any place name, entity, quest…) imports silently. A "this key never fires" hint at import or in the viewer would raise the floor on third-party books. | Author tooling | S |

Soft risks to respect when fixing:
- **Stickiness bloat:** if lore lingers after triggering (a candidate
  fix under #2), a chatty keyword keeps its entry pinned forever. Cap
  stickiness at 1–2 turns and keep the byte budget as the ceiling.
- **Secrets are non-negotiable.** Any viewer or browser that leaks
  the *content* of `knownBy: secret` entries spoils the worlds it was
  built to showcase. Show seals, not contents.
- **Memory ≠ ledger.** World-run memory must be marked as the
  story's understanding of itself, or models will start reading fuzzy
  summaries as fact where the ledger (stats/tasks/standing) is the
  truth. Prose = memory, numbers = ledger, and the prompt should say so.

## 4. How a fix series could look (same playbook as the worlds gap)

1. **v1.36.0 "recall"** — gap #1 (world-run story memory: per-run
   summary + facts, auto-maintenance on the existing `memoryEvery`
   cadence or a world-scoped default, injected as *memory*, not ledger)
   + gap #2 (trigger window: score against the player's line plus the
   last assistant reply; optional 1-2 turn stickiness for the current
   turn's hits).
2. **v1.36.1 (foldable)** — gap #3 word-boundary matching (regex at
   match time, stored data untouched) + gap #4 lore in the AI author
   schema (`assemble()` gains `lorebook`; rules draft asks for 3–6
   entries with real keywords).
3. **v1.37.0 "the open book"** — gap #5 lore browser in the world
   viewer (keys visible; `secret`-gated entries sealed; gates named so
   players learn the mechanism without the content) + gap #6 byte
   budget character-side. Gap #7's linter folds into this viewer as
   import/viewer hints.

Each version ships the same way the worlds series did: tests against
the real fixture first, battery green, build, verify, channel, docs,
tag, publish.
