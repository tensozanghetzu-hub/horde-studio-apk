# Why long roleplay goes fuzzy — and what the field actually does about it

Research report, 2026-11-17. Sources: vendor documentation, shipped source, peer-reviewed
papers, and practitioner write-ups (all linked at the end). Written against Horde Studio's
own code so the last section is a diagnosis, not a wish list.

**Working note:** nothing here is about any particular card. Examples use invented people
(Ada, Corin, Marlow) so the patterns stay readable.

---

## 0. The short version

Three different failures get called "the AI forgot", and they need three different fixes.
Most apps conflate them, which is why the fixes usually don't hold:

| What breaks | What is actually wrong | The fix that works |
| --- | --- | --- |
| **Numbers change** (gold, level, HP, items) | The number lives *in prose*, so each turn it is re-invented rather than recalculated | Numbers owned by code. The model proposes deltas; the engine validates and applies them |
| **Facts go stale** (quest forgotten, NPC renamed, debt repaid) | There is one flat "memory" blob with no dates and no supersession | Facts with ids + a turn number; a new fact *supersedes* the old one instead of overwriting it |
| **Tone/persona drifts, and facts in the middle vanish** | Attention is not uniform across a long context | Put what must not be lost at the *ends*; keep the total small; re-inject a compact state block every turn |

The single most useful sentence in the literature, for us: *persistence is enforced by
re-injection, not hoped for from context length* ([Orchestrated Reality, 2026](https://arxiv.org/html/2606.16014v1)).

And the single most useful sentence from a shipping product: *"Everything with a number is
owned by code, not the model. HP, gold, inventory, XP… The AI can't silently reset your gold
because it never holds your gold. It gets handed your sheet every turn and narrates around
it."* ([r/Solo_Roleplaying](https://www.reddit.com/r/Solo_Roleplaying/comments/1u7m5ba/whats_the_best_ai_dungeon_master_youve_actually/))

---

## 1. Why it goes fuzzy — the four mechanisms, with numbers

### 1.1 Context rot: every model degrades as input grows, long before the window is full

Chroma's July 2025 study tested **18 frontier models** (GPT-4.1, Claude 4, Gemini 2.5, Qwen3…)
holding task difficulty constant and varying only input length. **All 18 degraded**
([Context Rot](https://research.trychroma.com/context-rot)). Two findings matter to us:

- In a conversational-memory test, the same questions with the same answer present scored
  **significantly higher on ~300-token focused prompts than on ~113,000-token full prompts**.
  Same information — one was buried.
- **One distractor passage measurably hurt; four compounded it**, and the effect grew with
  length. Structure made it *worse*: across all 18 models, a shuffled haystack beat a
  logically coherent one.

Practical read: a long chat is not a neutral container. Every extra turn of prose is a
distractor for the fact you need. "Send less, chosen better" beats "send more".

### 1.2 Lost in the middle: position decides whether a fact is seen

Liu et al. (TACL 2024, [arXiv:2307.03172](https://arxiv.org/abs/2307.03172)) moved the one
answer-bearing document through a fixed prompt. Accuracy formed a U: best at the start and
end, worst in the middle. GPT-3.5-Turbo scored **73.4% at position 0, ~50.5% in the middle**,
and in the harshest 20-document setup the middle score (**53.8%**) was *below the closed-book
baseline of 56.1%* — the model did worse with the right document present than with nothing.
Long-context variants showed the same curve; a bigger window did not fix it.

**This is the exact failure we see as "the quest changed / the level regressed".** The state
block is in the prompt — usually 4–8k tokens back, in the valley — and the model, which is
actually reading the last exchange, regenerates a plausible number instead.

### 1.3 The state-in-prose problem

A fourth mechanism is architectural rather than attentional. As Orchestrated Reality puts it,
in essentially every deployed system *"the narrative voice asserts world state in free prose
rather than reading and writing a persistent, validated representation"*, producing three
failures: statelessness across sessions, unvalidated writes (silent drift), and monolithic
agency (one prompt narrates, voices everyone, and referees the rules).

A shipping developer describes the same thing from the trenches: Gemini would *"occasionally
introduce enemies I had never spawned, add items that were never earned, or award XP for
events that had not actually occurred"* — fixed by adding a validation layer plus a repair
prompt before any state mutation ([SoloQuest](https://dev.to/austin_amento_860aebb9f55/building-soloquest-letting-gemini-be-the-dm-and-code-be-the-referee-3e89)).

The four named failure modes of AI-driven LitRPG, which match what people report to us
verbatim ([Arcanum, Aug 2026](https://arcanumrpgs.com/blog/litrpg-ai-roleplay/)):

1. **Stat drift** — Strength 14 becomes 16 with no level-up; the model regenerated a plausible number.
2. **Reward inflation** — each fight pays more than the last, because rewards are matched to narrative stakes instead of a fixed economy.
3. **Phantom skills** — a granted skill evaporates; an ungranted one appears.
4. **Quest amnesia** — open objectives vanish because the log is regenerated from recent context.

### 1.4 Persona drift, and why summarising *harder* makes it worse

> *"After 8–12 dialogue turns, persona self-consistency degrades by more than 30%. Single-turn
> agents achieve ~90% task accuracy; multi-turn agents on the same tasks fall to ~65%"*
> — [Persona Drift in Long-Running Agent Sessions](https://tianpan.co/blog/2026-05-02-persona-drift-long-horizon-agent-sessions)

Nothing there is a model-quality bug; it is a consequence of the system prompt sitting at
position 0 while the model weights the last few thousand tokens.

The non-obvious warning, and the one that matters most for our `memoryEvery`: **naive
summarisation accelerates drift**, because the summary becomes another layer of
recency-weighted text and eventually encodes the *already-drifted* behaviour as the new
baseline. The fix is an *anchored* compression: a fixed-format block whose first lines are
copied verbatim from the original (who you are, what is non-negotiable), with the summary
after it — not a summary of everything including the drift.

---

## 2. How the shipping apps actually do it

### 2.1 AI Dungeon — three boxes and a retrieval bank

Latitude's own description ([How the New Memory System Works](https://www.reddit.com/r/AIDungeon/comments/1cz1sc8/how_the_new_memory_system_works/)) is unusually explicit:

- **Plot Essentials** — "always true", sent on *every* turn. The premise, the player's
  identity, the load-bearing facts.
- **Author's Note** — a short reminder placed right before the latest action (the recency slot).
- **Story Cards** — keyword-triggered notes about people and places; cost nothing until fired.
- **Memory Bank** — an AI-generated summary of a small group of past actions (~4 exchanges),
  embedded and stored; retrieval by similarity to the current action, into a budgeted slot.
  It **deduplicates against the Story Summary** so the same text can't appear twice, and when
  the bank is full it drops **least-used** memories. Tiers: 25 / 100 / 200 / 400 / 800 memories
  (free → Ultimate), context 4k → 32k.
- **Auto Summarization** — a running Story Summary, itself re-summarised periodically so it
  tracks the arc rather than the last hour.

What to steal: **the split**, and the budget. What not to steal: the manual curation burden —
reviewers are blunt that it *"relies on you to do the bookkeeping"*
([Tavernbound](https://tavernbound.com/blog/why-ai-dungeon-forgets-your-story)).

AI Dungeon has **no dice and no character sheet** unless a scenario author scripts them. Every
2026 comparison scores it 2/5 on mechanical depth for exactly this reason
([Arcanum](https://arcanumrpgs.com/blog/ai-dungeon-vs-isekai-zero/)).

### 2.2 Voyage (Latitude's second product) — the World Engine

Latitude built a second product to fix the first one's gap. Their press material and both
trade write-ups describe the same architecture
([TechCrunch/GamesBeat coverage summarised](https://howworks.ai/blog/what-are-ai-games)):

> *"a deterministic system that governs world state, character memory, and rule enforcement…
> tracks health, inventory, currency, geography, relationships and long-term consequences
> **across thousands of turns so the AI can't hallucinate them away**."*

Nick Walton, CEO: *"A single AI model wasn't able to deliver all of this. Voyage splits those
jobs. The World Engine simulates the world and keeps track of what happens, and then the AI
turns that into the story."*

The design rule is the important part: **the narrative model never owns a number.** It reads
the engine's state and narrates it. Rewards, penalties and deaths are committed by the engine.

### 2.3 Isekai Zero — chapters, arcs, and a referee the narrator can't see

Two mechanisms worth copying, both documented:

**Compression hierarchy.** Every ~20 messages is condensed into a **chapter**; every ~10
chapters is condensed into an **arc**. Chapters are user-readable and *rewritable*. Their own
worked example takes a story from ~40,000 tokens of context to just under 16,000 with one arc.
On an independent 31-platform benchmark this is the single axis where it scores highest
(**Memory & Continuity 4/5**, joint-seventh overall) — and the reviewer's verdict is that it
*"forgot only small things, details that did not matter to the story"*
([Arcanum review](https://arcanumrpgs.com/blog/isekai-zero-review/)).

**Dungeon Mind**, the strictest published example of separating referee from narrator
([docs](https://docs.isekaizero.ai/books/creators-guides/page/dungeon-mind-dm)):

```
player message
   ↓
Story AI decides a check is needed  →  calls engage_dungeon_mind()
   ↓
DUNGEON MIND: check validity → roll d20 per character (server-side)
              → apply the storyline's rules → submit stat changes
   ↓
Story AI writes the scene from the results  … and does NOT mention numbers
   ↓
Player sees: prose, plus a roll bar: "STR attack. Roll 14+3=17 vs DEF 12. Hit. HP 40→32"
```

Note the two details: **one roll per character per action**, and the **narrative explicitly
does not mention numbers** — the numbers live in a separate UI surface. Dice are server-side
and cannot be manipulated.

### 2.4 NovelAI — the lorebook, and priority under a hard budget

([Docs](https://docs.novelai.net/en/text/lorebook/), [2026 guide](https://arcanumrpgs.com/blog/novelai-lorebook/))

- Entries fire when a **key** appears in a recent-story window (search range up to 10,000 characters).
- **Always On** entries skip the key and are always inserted — and the documentation is
  emphatic that this is a *budget*, not a default: each one is paid for in every generation.
  Guidance: two or three at most.
- **Insertion Order** — higher values reserve tokens *first*, so it doubles as priority when
  the budget is short. **Reserved Tokens** ring-fences space for an entry.
- **Token Budget** — per entry, and a value between 0 and 1 is read as a *percentage of the
  whole context*.
- **Key-Relative Insertion** — place the entry next to the last mention of its key rather
  than at a fixed depth. That is a positional-attention trick, done deliberately.

Two lessons: entries must be **short and self-contained** (titles/keys are never sent, so the
name must be inside the text), and **every always-on line costs you every turn**.

### 2.5 SillyTavern — the most complete toolkit, and what each part is for

SillyTavern is the closest thing to a reference implementation of "context engineering for
roleplay". Its parts answer different questions:

**World Info / lorebooks** ([docs](https://docs.sillytavern.app/usage/core-concepts/worldinfo/)):
- **Scan depth**, default 2 messages — i.e. the last exchange only. Entries keyed to a word
  said six turns ago will not fire. This is the #1 cause of "my lorebook does nothing".
- **Budget** — default **25% of the context window**, shared by all activated entries. When
  it is exhausted, *further matches are dropped silently*.
- **Timed effects**, which are the piece almost nobody else has:
  - **Sticky = N** — once fired, stays active for N messages without the key.
  - **Cooldown = N** — cannot fire again for N messages after sticky ends.
  - **Delay = N** — cannot fire until the chat has N messages (spoiler control).
  The documented example — `sticky 3, cooldown 2, delay 2` — gives: activate at msg 1,
  sticky 2–4, cooldown 5–6, eligible again at 7.
- **Recursion** — an activated entry's *content* can trigger other entries, with per-entry
  vetoes (`non-recursable`, `prevent recursion`, `delay until recursion`) and a global step
  cap. Recommended caps: 3–5 steps under 50 entries, 1–2 above 200.
- **Min Activations** — expand the scan depth backwards until at least N entries fire. A floor
  against the silent-nothing failure.

**Summarize extension** ([docs](https://docs.sillytavern.app/extensions/summarize/)) — a
running synopsis, regenerated every N messages, injected at a chosen position. Its own docs
are honest: *"the outputs may lose some important details or contain hallucinations, so
you're always advised to keep track of the summary state and correct it manually."*

**Vector Storage / Data Bank** ([docs](https://docs.sillytavern.app/usage/core-concepts/data-bank/))
— the other half of the trick: leave old messages *out* of the prompt entirely, embed them,
and pull back only the chunks that match. Defaults: chunk 2500 chars, retrieve 5 chunks,
inject at depth 4 as a system message, **score threshold 0.2–0.5** (below that it retrieves
noise). The community's canonical split: *"Use Summarize for the shape of the story and
Vector Storage for exact details."*

**Smart Memory** — the most complete community extension, and the closest analogue to what a
memory system should look like ([README](https://github.com/senjinthedragon/Smart-Memory/)).
Its tiers, which read like a specification:

| Tier | What it holds | Budget / position |
| --- | --- | --- |
| Long-term facts | extracted facts, **each with activation triggers** so a mentioned keyword promotes it | 500 tokens, injected near the turn |
| Short-term summary | rolling synopsis; after the first pass only *new* messages are folded in | 2000 tokens |
| **State Ledger** | entity state — the game-ish layer | close to the active turn |
| **Perspectives & Secrets** | per-character knowledge at each scene break: knows / suspects / falsely believes / unaware / hiding | 200 tokens, depth 1 |
| Arcs | scene history and story arcs, with compaction and a retired pool cap | — |

Three specific ideas worth stealing verbatim:

1. **Epistemic filtering** — a memory from a scene the responding character was not present
   for is tagged `[secondhand]`, or omitted. (Our world mode already does a version of this
   in prose with `run.companions`; Smart Memory makes it structural.)
2. **Importance + permanence + recency + confidence** decide what gets trimmed first when a
   tier overruns its budget.
3. A **continuity checker** that holds "established facts" (card fields + user persona +
   extracted memories) and flags turns that contradict them.

**The RPG tracker family** ([Tavernary library](https://tavernary.org/)) — dozens of
extensions that do exactly the thing we are discussing: *RPG Companion* (stats, inventory,
present characters, relationships, **per-swipe tracker data**), *Solo Leveling Interface*
(detects level-ups and item acquisition from chat, 8 tabs, persistent per chat), *ScenePulse*
(extracts characters, relationships, quests, mood, tension into a dashboard), *Map*
(locations and positions), *CarrotKernel* (character sheet + world info).

The general pattern is consistent: **a visible sheet, written from parsed model output,
persisted per chat, injected back next turn.** And the general failure is also consistent:
they ask the model to reprint the sheet, and a model reprinting numbers drifts exactly like
it drifts on prose.

### 2.6 DreamGen — an accidental experiment in truncation order

DreamGen has no lorebook; it has a **Scenario Codex** (characters, locations, objects, world
rules) that is fed into every scene, and **pinned turns** that get priority when the window
overflows. Its documented behaviour is the cleanest illustration of lost-in-the-middle in a
shipping product:

> *"the context window has to hold the whole scenario definition plus the role-play so far,
> and when it will not fit, the oldest parts are truncated automatically. That ordering
> explains a behaviour people otherwise find puzzling: **world rules stay reliable while
> mid-story details drift**, because the definition keeps its place while the session's early
> stretches are the first thing dropped."*
> ([DreamGen overview](https://toolso.ai/tool/dreamgen-com))

Their community's workaround is manual and telling: keep an external story bible, paste a
condensed state back into Anchor Memory every ~15 prompts
([Swifttech3](https://www.swifttech3.com/dreamgen-ai-honest-review-writers-take/),
[Ai Softing](https://aisofting.com/dreamgen-ai-review-narrative-world-building/)).

**The lesson for us is structural:** whatever we put at the *top* of the prompt survives;
whatever we leave in the middle of the history does not. State must be at the top *and*
repeated at the bottom.

### 2.7 Character.AI — the UX-driven version

As of the May 2026 "Smarter Memory" release
([summary](https://www.roborhythms.com/character-ai-adds-chat-memories/)): **Story Memory**
(a place you write backstory, and where a long-press "Pin" locks a message's exact wording),
**Facts** (c.ai+ only: auto-extracted details, split into you / the character / side
characters), and a **Memory Usage** meter that shows what is filling the space. Before that it
was a 400-character box plus 15 pins.

Why it matters: they solve it by **making the user curate**, and they are explicit that
memories, pins and recent messages draw on **one shared budget** — so a long chat trims
context rather than your notes. That is an acceptable trade for a chat app; it is not good
enough for a game, because the player should not have to be the database.

### 2.8 The purpose-built AI DMs — state in a database, dice in code

Every product that scores well on long campaigns has the same architecture, and says so:

- **TableForge** — *"The engine runs the game and the AI DM narrates on top of it: dice and
  every outcome are settled in code, not by the language model… no persistent campaign state,
  no real dice, no character sheet that updates itself is exactly what ChatGPT-as-DM is
  missing"* ([FAQ](https://tableforge.gg/faq)). Characters carry gear, gold and level between
  campaigns.
- **RoleForge** — *"when you fail, you fail — the AI doesn't decide you win because it's
  dramatic"*; world state in a database, not the log; separate records per quest thread so
  "info-bleed" between threads collapses ([drift essay](https://roleforge.ai/blog/the-drift-problem-why-ai-game-masters-forget/)).
- **Quest Keeper** — *"LLM describes, engine validates. All game state comes from SQLite, not
  hallucination. The AI can narrate finding a sword, but the sword must exist in the database
  first"* ([site](https://questkeeperai.com/)).
- **Dungeon Mind / Isekai Zero** — see above: server-side d20, roll bars separate from prose.
- **Branching Skies** — quest milestones are **checks against recorded state** ("this item now
  exists in your inventory record", "N in-game days have passed"), run after every turn;
  *"the narrator describing something is never the trigger, because a storyteller can describe
  things that did not mechanically happen"* ([post](https://branchingskies.com/blog/ai-rpg-that-tracks-quests)).
- A community summary of the winning pattern: *"Everything with a number is owned by code, not
  the model… It gets handed your sheet every turn and narrates around it."*

---

## 3. The research on memory, ranked by how much it helps us

### 3.1 Generative Agents (Park et al., UIST 2023) — the retrieval triple

Every observation is stored as a timestamped sentence. Retrieval scores each memory:

```
score = recency + importance + relevance      (each min-max normalised, weights all 1)

recency    = 0.995 ^ (hours since the memory was last *retrieved*)   ← not since created
importance = LLM-rated 1–10 at write time ("ate breakfast" 1, "broke up" 9)
relevance  = cosine(embedding(memory), embedding(query))
```

Then **reflection**: when the summed importance of recent events passes 150 (~2–3 times a
game day), the agent takes its 100 most recent memories, asks for the 3 most salient questions
they could answer, retrieves evidence for each, and writes 5 insights *with citations to the
memories they rest on* back into the stream. Reflections can be reflected on, forming a tree.

Three transferable details:

- **Recency is measured from last *use*, not creation.** A memory that keeps being relevant
  stays fresh. That is a free reinforcement signal.
- **Importance is scored once, at write time.** It is the cheap way to make a marriage
  proposal outrank breakfast months later without re-scoring everything each turn.
- **Retrieval failures are specific**: agents denied knowledge they had ("I haven't been
  following the election") and retrieved *fragments* (remembering what to do at a party, not
  that the party exists). Fragment retrieval is exactly the "the quest's objective but not who
  gave it" failure.

### 3.2 MemoryBank (Zhong et al., 2023) — deliberate forgetting

`R = e^(−t/S)`: retention decays with time since last access, and **S increases by 1 every
time the memory is recalled** (t resets). Frequently used memories get harder to forget;
unused ones fade and are eventually pruned. Their production example prunes at
`retention < 0.35 && age > 7 days && strength < 8`.

Useful as a *ranking* signal. But be careful: the paper's own review notes there is **no
ablation removing the forgetting curve**, so the gains cannot be attributed to it. For a game,
"forget the tavern keeper's small talk" is good; "forget the quest" is catastrophic. So:
**decay episodic colour, never decay state.**

### 3.3 MemGPT / Letta — the OS framing

Three tiers: **core memory** (always in the prompt, as editable labelled blocks: `persona`,
`human`, ~2000 chars each), **recall memory** (the message log, searchable), **archival
memory** (vector store, searchable via tools). The agent edits its own core blocks with tool
calls (`core_memory_append`, `core_memory_replace`); when the window overflows, the system
compacts automatically.

The idea worth taking is not the machinery but the **discipline**: a named, bounded, always-
present block whose contents are *edited on purpose* — as opposed to a growing blob of prose
that happens to be recent.

### 3.4 Zep / Graphiti — facts have validity windows

Every fact is an edge with **four timestamps**: `t_valid`, `t_invalid` (when it was true in
the world) and `t'_created`, `t'_expired` (when the system knew it). A contradiction does not
delete the old edge; it **closes it** (`t_invalid := new edge's t_valid`) and records the new
one. Retrieved context is therefore "what is true now", and you can also ask "what was true in
March" ([Zep docs](https://www.getzep.com/ai-agents/temporal-knowledge-graph/),
[paper](https://arxiv.org/abs/2501.13956)).

This is the correct model for the failures people report to us: *"the level you had regressed"*
is, formally, a stale fact being served as current. Reported results: 71.2% vs 60.2% on
LongMemEval against a full-context baseline (vendor preprint — read it as vendor research),
and 94.8% vs 93.4% on the older DMR benchmark.

For us this can be implemented without a graph: `{id, text, from_turn, to_turn?}` where a
superseded fact keeps `to_turn` instead of vanishing.

### 3.5 Mem0 — store facts, not transcripts; ADD-only

The 2025 pipeline: extract candidate facts from the last exchange + summary + recent window,
retrieve similar stored facts, and have the model choose **ADD / UPDATE / DELETE / NOOP**.
LoCoMo: 66.88 J vs 72.90 for full context — but with **91% lower p95 latency and ~1,800 tokens
per query instead of ~26,000**. The paper's own honest framing is that the win is cost, and
that it *"got within about 6 points"* of full context.

The 2026 v3 rewrite is the more interesting lesson: they moved to **single-pass, ADD-only**
writes, because **write-time UPDATE/DELETE judgments can be wrong and are irreversible**.
New facts sit next to old ones with `linked_memory_ids`, and *time-aware retrieval* decides
which one to surface. Judgment moved from write time to read time.

For a game: **never let a memory job delete state.** Let it append, link, and mark superseded.

### 3.6 LongMemEval — the checklist to test ourselves against

500 curated questions over ~115k-token histories (~40 sessions; the M variant goes to ~500
sessions). It measures five abilities, and commercial assistants / long-context LLMs showed a
**~30% accuracy drop** on them ([arXiv:2410.10813](https://arxiv.org/abs/2410.10813)):

| Ability | The question it asks | Our equivalent |
| --- | --- | --- |
| Information extraction | what was the name / item / amount | straight recall of a fact from turn 12 |
| Multi-session reasoning | combine two separate events | "the debt from the market and the promise at the gate" |
| Temporal reasoning | what happened first / how long ago | world clock, "three days ago" |
| **Knowledge updates** | the *current* value of a changed fact | level, gold, quest objective, NPC in/out of the party |
| **Abstention** | say "that never happened" instead of inventing | NPC must not know what they weren't present for |

Also worth noting from the paper: **value granularity matters** (decompose into rounds, not
whole sessions), **fact-augmented keys** improve the index, and **time-aware query expansion**
helps temporal questions by 7–11%. All three are achievable without embeddings if our facts
are already atomic and dated — which ours can be.

### 3.7 RecurrentGPT — short-term + long-term, and what happens without them

At each step the model writes a paragraph, then rewrites a **short-term memory** (what matters
right now) and appends a **summary of the paragraph** to a long-term store, retrieved
semantically later. Ablation: remove the short-term memory in sci-fi and coherence drops from
**65.1% to 31.0%** ([arXiv:2305.13304](https://arxiv.org/abs/2305.13304)).

That gap is the argument for having *both* a rolling "where we are" and a durable archive —
which is exactly what a 14-message summary alone does not give us.

### 3.8 Orchestrated Reality (2026) — the state architecture, formalised

The cleanest statement of the design we should be converging on
([arXiv:2606.16014](https://arxiv.org/html/2606.16014v1)):

- The world is a **tree of JSON entities** — location, clock, player, towns, NPCs, quests,
  factions, the active thread. Inspectable, diffable, hashable *before* a model is called.
- Each turn is **Plan → Diff → Validate → Apply**. The model proposes
  `(narrative, Δ)`; each delta must pass `SchemaOK ∧ PermOK ∧ RuleOK`; valid deltas commit
  atomically and the new state is content-hashed.
- **Memory is injected, not recalled**: a bounded *context pack* (fixed seed set + ranked
  records under a small cap) is assembled from committed state each turn. *"The acting
  model's knowledge is thus a deterministic function of committed world state, not of whatever
  survived in a chat window."*
- Because of event sourcing + validation, the transition becomes Markovian: `s(t+1)` is a
  function of `(s(t), a(t))` alone, with the LLM merely proposing the delta.

Their three failure classes are literally our bug reports: statelessness, unvalidated writes,
monolithic agency.

### 3.9 Anthropic's context engineering — three techniques, one principle

([Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents))

- Compaction — summarise near the limit and restart with the summary, keeping *decisions,
  unresolved problems, identifiers*; tune for **recall first, then precision**.
- Structured note-taking — the agent maintains its own notes outside the window and reads them
  back. Their Pokémon example: exact tallies across thousands of steps ("for the last 1,234
  steps I've been training in Route 1, Pikachu has gained 8 levels toward the target of 10").
  **A tallied number in a note is exactly the pattern we need for gold/level/quests.**
- Sub-agents — specialists with clean windows returning ~1,000–2,000-token summaries.

The principle: *"find the smallest set of high-signal tokens that maximise the likelihood of
your desired outcome."*

---

## 4. Dice: the model must not be the die

This one is settled, and it is settled harder than most people realise.

### The evidence

Google DeepMind + NUS, *The Illusion of Stochasticity in LLMs* (arXiv 2604.06543, COLM 2026)
([write-up](https://cryptobriefing.com/google-deepmind-llms-random-sampling-flaws/)):

- Asked to sample from uniform and Gaussian distributions, models failed χ² and
  Kolmogorov–Smirnov tests with **near-zero p-values** across configurations.
- Systematic bias toward particular numbers — **7 and 42** — and output that shifts with the
  order of information in the prompt.
- Token-level entropy is **not** controllable sampling: varied-looking output can still be
  badly biased.
- In a game-like test where the optimal randomised strategy holds an attacker's success at
  75%, agents relying on native sampling produced **96.6%–99.9%** success rates.
- **The fix is trivial:** hand the model seeds/numbers generated by code. With an external
  random source, Gemini-3.0-Pro and Qwen3-32B sampled accurately.

Community experience matches exactly: *"The model will just pick a number it likes or that
kinda fits the situation in some funny way"*; *"it's not even attempting to be a random number
generator… it's playing make believe"*
([r/SillyTavernAI](https://www.reddit.com/r/SillyTavernAI/comments/1qtaiy6/how_exactly_does_the_ai_dice_rolls_work/)).

### The pattern that works

1. **Roll in code, with a real PRNG** (`Math.random`/`crypto` is fine; predictability only
   matters if the player can exploit it — see 3 below).
2. **Roll before prose.** The model *requests* a check; the engine resolves it; the result is
   injected as text. If the model writes the outcome first and is told the number afterwards,
   it will rationalise — and it will write success before it knows the roll.
3. **Keep the seed.** We already do this (`nextRand`, a seeded mulberry32 on the run), which
   buys three things most apps lack: replayable turns, fair retries (a re-roll is a *named*
   new roll, not a silent one), and bug reports that can be reproduced exactly.
4. **Difficulty belongs to the world, not the model.** A DC authored per check (`checkDef`)
   means the model cannot quietly move the goalposts. Where a world has no DC, derive it from
   a stat the world owns — never let the model report "that felt like a 15".
5. **One roll per actor per action**, deduplicated by name in the turn (we already do this in
   `resolveChecks`), so a model that emits the same check twice cannot fish for a better number.
6. **Show the roll, keep it out of the prose.** Isekai Zero's example is the template:
   narrative text says what happened; a separate bar says `Roll 14+3=17 vs DEF 12. Hit.
   HP 40→32`. This is both a trust feature and an attention feature — the number is on screen,
   so it does not have to survive in the prompt.
7. **Natural 20 / natural 1 must be defined by the world**, not improvised. If crits mean
   something, they are a rule the engine applies (`criticals` already exists in our code).
8. **Never let a roll be re-rolled by asking again.** If the model can re-request a check in
   the same turn, it will, and the distribution collapses toward success.

---

## 5. Synthesis: the twelve things that actually make a campaign last

Ranked by effect per unit of work. The first six are what separate a 10-turn chat from a
300-turn campaign.

1. **One owner per number.** Health, gold, level, items, time: code. The model proposes;
   the engine validates and applies. This single change removes the whole "stat drift /
   reward inflation / gold changed" class.
2. **State at both ends of the prompt, every turn.** A five-line `NOW` block (where, when,
   who is present, the vital numbers, the one active objective) at the top *and* immediately
   before the newest user turn. Cheap, deterministic, no model call. Fixes lost-in-the-middle
   at the place where it actually bites.
3. **An append-only event log, not just a summary.** "Turn 41: Ada agreed to clear the east
   room for 20 coin, before the frost." A summary can be re-summarised into vagueness; an
   event with a turn id cannot. Feed the last N events verbatim, and promote only what ages out.
4. **Facts get ids, dates, and a supersede pointer.** Nothing is deleted. `{id, text, from,
   to?}`. Retrieval shows current facts; history is still answerable. (Zep's bi-temporal model,
   Mem0 v3's ADD-only lesson.)
5. **Milestones checked against state, not against narration.** A quest advances when a fact
   in the record becomes true — the item is in the inventory, the NPC is in the party, the
   clock has passed a date — never because the narrator said so.
6. **Compress in layers with explicit lifetimes.** Recent turns verbatim → scene summary →
   chapter → arc. Each layer has a budget and a trigger, and the *anchor* lines (identity,
   premise, non-negotiables) are copied verbatim from the top, never re-summarised.
7. **Retrieval, not stuffing — but only when the log is big.** Under ~100 turns, an entity
   index (names, items, places, quests) over the event log gets most of the benefit with no
   embeddings. Vectors earn their keep past that. Mem0's lesson applies: retrieve *facts*, not
   transcript chunks.
8. **A separate reflection pass.** Not "summarise the chat" — "what changed this scene that
   the state doesn't know yet, and what is now no longer true?" One cheap call, every N turns,
   gated by importance (Generative Agents' threshold trigger).
9. **Per-character knowledge, not global omniscience.** Who witnessed what; `[secondhand]` tags;
   NPCs who cannot know what they were not there for. This is the single biggest *quality*
   upgrade to NPC behaviour and it is also what makes secrets and reveals possible.
10. **Consequence and pressure outside the model.** The world clock advances, NPCs pursue goals
    off-screen, factions react. A campaign that lasts has things *at stake* between turns; this
    is content design, not memory engineering.
11. **Instrument the drift.** A continuity check that compares each turn's claims (numbers,
    items, places, quests, dead characters) against state and flags contradictions, with a
    counter surfaced to the player ("3 corrections this session"). You cannot fix drift you
    cannot see.
12. **Do not fix it with a bigger window, and do not fix it by summarising harder.** Chroma:
    all 18 models degrade with length. Persona-drift work: aggressive summarisation *encodes*
    the drift as the new baseline.

---

## 6. Against Horde Studio: what we already do, and where our fuzziness comes from

### 6.1 What is already right (and better than most of the field)

This is worth saying plainly, because it changes the plan: **our world mode is already closer
to the Voyage/TableForge architecture than the chat-only apps are.**

- `hordeworld.js` keeps the run in a structured object: clock, stats, cash, inventory, quests,
  companions, conditions, factions, log, seeded PRNG (§ ledger v2, `applyTags`, `commit`).
- The model's output is **tag-proposed and engine-applied**: `[[move:…]] [[stat:…]] [[cash:…]]
  [[item:…]] [[quest:…]] [[rep:…]]`. Unknown items, unreachable moves, out-of-bound numbers and
  unknown tasks are **rejected with a reason fed back** (`ledgerV2`, `reject()`).
- **Dice are already in code** — `roll(spec, sides, rnd)` with a **seeded mulberry32 per run**
  (`nextRand`), reproducible. Checks are deduplicated per turn in `resolveChecks`, crits are
  rule-driven, and malformed rolls are refused before commit.
- `describeState` is re-injected every turn as a compact ledger (Time / Season / Stats / Money /
  Carrying / Wearing / present people / tasks), and the prompt explicitly forbids the model from
  restating it.
- `buildPrompt` already separates **ledger** from **story memory** and says so: *"Story memory —
  what the past scenes established in prose (the ledger above outranks it)"*.
- Lore is keyword-fired with a warm window (`loreFired`, 3 turns) and a **byte cap** (1536).
- Companions carry witness semantics; the pulse (`pulseDue`/`worldBeat`) makes off-screen
  factions act; `.goalAutonomy` gives NPCs their own agendas.
- A one-turn undo exists (`lastTurnPre`), and memory built on a rerolled reply is invalidated.

That covers items 1, 5 (partly), 10 and part of 11 above. The gap is in the four places below.

### 6.2 Where the fuzziness actually comes from

**Gap 1 — the prompt has no bottom-end state anchor.**
`buildPrompt` order is: dmPrompt → description → authorNote → player → location → **state** →
"never restate this" → story-forward rules → pulse → companions → **story memory** → lore →
rules. On a 6000-token history budget, the state block ends up several thousand tokens before
the newest user message — i.e. **inside the attention valley**. This is precisely DreamGen's
documented symptom (world rules reliable, mid-story details drift) and Liu et al.'s U-curve.
**Fix:** append a 4–6 line `NOW:` block immediately before the newest turn (time, place, who
is present, the two or three numbers that matter, the active objective). Same strings, no new
data, no model call.

**Gap 2 — story memory has no ids, no dates, and no supersession.**
`summarize()` returns `{summary, facts[]}` — at most 8 facts, durable by instruction, merged
into whatever was there before. `memoryEvery` defaults to **14 messages**, and `facts` is a
flat array of strings. Consequences:

- A fact from turn 3 and its replacement from turn 40 can both be present, with **no ordering
  signal at all** — the model picks. That is the "the quest changed" bug, mechanically.
- There is no record of *why* a number changed, only the new number.
- 14 messages at ~600 tokens each is ~8,000 tokens of drift window in the worst case.
- When facts overflow, `slice` drops the oldest silently — which may be the load-bearing one.

**Fix:** facts as `{id, text, from, to?}`; newest-wins rendered as `now` vs `no longer`; and a
deterministic cap that drops by *importance and age*, not arrival order.

**Gap 3 — the checkpoint has no check below the summary.**
Between verbatim history and the 14-message summary there is nothing. A turn that falls out of
the window is compressed once and then compressed again next time (summaries of summaries),
which is exactly the cumulative-drift failure the literature warns about. There is also no arc
layer.

**Fix:** three lifetimes — **event log** (every turn, one line, kept for the run) → **scene
summary** (current behaviour) → **arc** (every ~8–10 scenes, merged). Feed the last ~10 events
verbatim in place of prose history; promote only what leaves that window.

**Gap 4 — the model retains authority over *whether* a check happens and *which* stat.**
`checkRequests` come from the model, `checkDef` supplies the rule. That is the right shape for
dice (rolls are in code) but the difficulty and the trigger are still model-chosen and
post-hoc: the model decides a check is needed *after* it has written a scene in which it knows
what it wants to happen. That is the "the rolls always seem to favour the story" complaint, and
it is the one place where our dice are still functionally model-controlled.

**Fix (cheap):** a two-phase turn for checks — model emits only `[[roll:1d20:check:DEX]]`
(plus intent), engine rolls, result is injected as `You rolled 14 vs 12 — success by 2`, then
the model writes the scene. Keep a per-turn bound (1–3 rolls) so it cannot fish.

### 6.3 What the best-in-class have that we do not (short list)

| Capability | Who has it | Cost to us |
| --- | --- | --- |
| Rolling summary at a **token** threshold, not a message count | SillyTavern, Smart Memory (80%) | Small — we have `historyBudgetTokens` already |
| **Arc** layer above the session summary | Isekai Zero | Medium — one extra merge every ~10 summaries |
| Facts with **validity windows** | Zep/Graphiti | Small (no graph needed): `from`/`to` on a fact |
| **Sticky / cooldown** on lore | SillyTavern | Small — we already have `loreFired` + 3-turn window; a per-entry cooldown is a few lines |
| **Per-character knowledge** as data | Smart Memory, our `companions` (prose) | Medium — the biggest quality win available |
| **Continuity checker** over claims vs state | Smart Memory (`continuity.js`), our `auditClaims` (partial) | Small — extend `auditClaims` to numbers/items/quests |
| **State shown in the UI**, separate from prose | Isekai Zero, Voyage | Small — we have the sheet; show the last roll and last changes inline |
| **Two-phase checks** (roll before prose) | Dungeon Mind, TableForge | Medium — touches the turn pipeline |
| **Epistemic tags** (`[secondhand]`) | Smart Memory | Small, given companions already track witnesses |
| Retrieval over the log (entity index, then vectors) | AI Dungeon, SillyTavern, Mem0 | Large — do not start here |

---

## 7. How to know it worked (and keep it generic)

Build the test first; it is the only defence against "it feels better now".

**A scripted drift campaign on a fixture, no cards involved.** One synthetic world, one
invented cast, 60 turns of generated play with **planted facts**:

- a name introduced only at turn 8 and mentioned again at turn 55,
- an item acquired at 12 and used at 44,
- a debt incurred at 20 and repaid at 50 (the *current* value must be "repaid"),
- a quest accepted at 15 with a specific objective, advanced at 31, completed at 47,
- a level-up at 33 and gold figures that only ever change by a logged delta,
- a character who leaves the party at 26 and must not know what happens at 30.

Then probe at turns 20 / 40 / 60 with LongMemEval's five question types
(extract / combine / temporal / *update* / *abstain*). Assert on the engine's own record, not
on prose: "the state block the model received at turn 60 contains the repaid value", "no
superseded fact appears in the prompt", "the missing character is not addressed as present".

That is a deterministic, card-free, fast test we can add to the 106-file suite, and it is the
direct analogue of what the memory benchmarks measure.

**Plus three cheap runtime counters** surfaced in Diagnostics:

- facts currently in memory, of which superseded;
- tokens spent on state / memory / lore / history this turn (the budget, made visible);
- rejections and advisories this session ("the world corrected 4 things"), which is both a
  quality signal and a great "the world is watching" feel.

---

## 8. If I had to pick three changes

1. **A `NOW` block at the bottom of the prompt** (5 lines, already-known values, no model call).
   Highest ratio of stability to effort in the entire report. Attacks lost-in-the-middle at the
   exact position where it costs the most.
2. **Facts with ids and dates, supersede instead of overwrite, and never delete.** Turns
   "the level regressed / the quest changed" from a prompt problem into a data problem with a
   correct answer.
3. **Roll before prose, with the result injected.** Closes the last place where dice are still
   quietly model-driven — and makes the rolls worth caring about, which is most of what makes a
   campaign feel like it is going somewhere.

Everything else — arcs, retrieval, per-character knowledge — is additive and can follow in that
order.

---

## Sources

**Papers**
- Park et al., *Generative Agents: Interactive Simulacra of Human Behavior*, UIST 2023 — memory stream, recency/importance/relevance, reflection. (Summaries used: [1](https://www.agentpatterns.ai/patterns/agent-design/generative-agents-memory-stream/), [2](https://vibeengines.com/paper/generative-agents))
- Packer et al., *MemGPT: Towards LLMs as Operating Systems*, arXiv:2310.08560 — [PDF](https://arxiv.org/pdf/2310.08560)
- Zhong et al., *MemoryBank: Enhancing LLMs with Long-Term Memory*, arXiv:2305.10250 — [HTML](https://arxiv.org/html/2305.10250v2)
- Rasmussen et al., *Zep: A Temporal Knowledge Graph Architecture for Agent Memory*, arXiv:2501.13956 — [summary](https://memorypapers.org/papers/zep-a-temporal-knowledge-graph-architecture-for-agent-memory)
- Chhikara et al., *Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory*, arXiv:2504.19413 — [analysis](https://aiagentmemory.org/articles/mem0-building-production-ready-ai-agents/)
- Wu et al., *LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory*, arXiv:2410.10813 — [abstract](https://arxiv.org/abs/2410.10813)
- Zhou et al., *RecurrentGPT: Interactive Generation of (Arbitrarily) Long Text*, arXiv:2305.13304 — [repo](https://github.com/aiwaves-cn/RecurrentGPT)
- Liu et al., *Lost in the Middle: How Language Models Use Long Contexts*, TACL 2024, arXiv:2307.03172 — [PDF](https://arxiv.org/abs/2307.03172)
- Hong, Troynikov, Huber, *Context Rot: How Increasing Input Tokens Impacts LLM Performance*, Chroma, Jul 2025 — [report](https://research.trychroma.com/context-rot)
- Gu et al., *The Illusion of Stochasticity in LLMs*, arXiv:2604.06543 (COLM 2026) — [write-up](https://cryptobriefing.com/google-deepmind-llms-random-sampling-flaws/)
- Huang, Li, Fang, *Orchestrated Reality: From Role-Play to Living, Playable Game Worlds*, arXiv:2606.16014 — [HTML](https://arxiv.org/html/2606.16014v1)

**Product / engineering documentation**
- AI Dungeon memory system — [Latitude post](https://www.reddit.com/r/AIDungeon/comments/1cz1sc8/how_the_new_memory_system_works/), [settings help](https://help.aidungeon.com/understanding-settings)
- Voyage / World Engine — [Latitude press](https://latitude.io/press), [TechCrunch/GamesBeat synthesis](https://howworks.ai/blog/what-are-ai-games)
- Isekai Zero Dungeon Mind — [guide](https://docs.isekaizero.ai/books/creators-guides/page/dungeon-mind-dm); chapters/arcs — [review](https://arcanumrpgs.com/blog/isekai-zero-review/)
- SillyTavern — [World Info](https://docs.sillytavern.app/usage/core-concepts/worldinfo/), [Summarize](https://docs.sillytavern.app/extensions/summarize/), [Data Bank](https://docs.sillytavern.app/usage/core-concepts/data-bank/), [World Info internals](https://deepwiki.com/SillyTavern/SillyTavern/6.2-quick-reply-system)
- [Smart Memory](https://github.com/senjinthedragon/Smart-Memory/) (tiers, state ledger, epistemic filtering)
- NovelAI — [Lorebook docs](https://docs.novelai.net/en/text/lorebook/), [2026 guide](https://arcanumrpgs.com/blog/novelai-lorebook/)
- DreamGen — [overview](https://toolso.ai/tool/dreamgen-com), [practitioner take](https://www.swifttech3.com/dreamgen-ai-honest-review-writers-take/)
- Character.AI — [Story Memory / Facts, May 2026](https://www.roborhythms.com/character-ai-adds-chat-memories/)
- [TableForge FAQ](https://tableforge.gg/faq), [Quest Keeper](https://questkeeperai.com/), [RoleForge on drift](https://roleforge.ai/blog/the-drift-problem-why-ai-game-masters-forget/), [Branching Skies on quest tracking](https://branchingskies.com/blog/ai-rpg-that-tracks-quests)
- [SoloQuest: Gemini narrates, code referees](https://dev.to/austin_amento_860aebb9f55/building-soloquest-letting-gemini-be-the-dm-and-code-be-the-referee-3e89)
- [Anthropic, Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Persona drift in long-running sessions](https://tianpan.co/blog/2026-05-02-persona-drift-long-horizon-agent-sessions)
- [LitRPG drift failure modes](https://arcanumrpgs.com/blog/litrpg-ai-roleplay/), [Tavernary extension library](https://tavernary.org/)
- [Why LLMs forget / AI Dungeon memory critique](https://tavernbound.com/blog/why-ai-dungeon-forgets-your-story)
