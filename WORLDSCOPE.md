# Worlds v2 — scope ("consequence-bearing worlds" on the phone)

_Drafted 2026-10-09 after the 18.3 review. This is a scope, not a build —
nothing here is implemented._

## 1. What the mobile port already has

The mobile Worlds are **not** static context files — the port already
runs a lightweight world engine (`js/hordeworld.js`, 585 lines):

- **World schema** — a faithful subset of upstream `.horde_world`:
  locations (exits, travel minutes, prosperity/danger, hidden
  descriptions), NPCs (persona/goal/secrets/factions), factions,
  lorebook, starting lives, game rules, sandbox config.
- **Library + creation** — import upstream world files through the
  same parser as AI creation (`App.aiCreateWorld` builds part-by-part
  and routes through `HW.parse`); bundled packs (Tempe OSM,
  Policy Panic).
- **Runs** — a run is a session with live state: `locationId`,
  clock (`extraMinutes`), `stats` (cash + custom), `inventory`,
  quests, a capped log, turn counter.
- **The tag ledger** — the DM ends replies with hidden
  `[[tag:arg]]` lines; `HW.applyTags` applies them
  (move / clock / cash / stat / item / drop / quest / quest-done /
  roll) and strips them from the visible text; `HW.commit` records
  the changes; the HUD shows what changed this turn.
- **Reactive lore** — `loreHits` keyword-searches the lorebook
  against the player's input each turn (a primitive knowledge search).
- **Tests** — `tests/hordeworld-test.js` (76 checks) covers parse,
  assemble, applyTags, buildPrompt, commit, runs.

So the idea to scope is **not** "build worlds." It is: **make the
ledger honest** — the piece upstream 18.3 just spent its release on.

## 2. The gaps (what the engine does wrong today)

| # | Gap | Concrete failure mode |
|---|-----|----------------------|
| G1 | **No validation** | `[[cash:+1000]]`, `[[item:Sword of God]]`, `[[move:ANYWHERE]]` are applied as written. The prompt *asks* the DM to move only via reachable places, but nothing enforces it — the model can teleport or mint items. |
| G2 | **No checks with consequences** | `[[roll:2d6+1]]` is recorded as flavor; there is no target, no success/failure branch, no state applied from the outcome. |
| G3 | **No knowledge gating** | The lorebook is global: keyword hit → injected. NPCs effectively know every secret in the file; `secrets` fields are never gated. |
| G4 | **No conflict detection** | Prose that contradicts the ledger ("she handed you the key" with no `[[item:key]]`) passes silently. |
| G5 | **No player correction** | A bad turn can't be fixed — only the whole run deleted. |
| G6 | **No recovery** | Malformed or missing tags are silently dropped. The DM gets no feedback that its bookkeeping was wrong. |

Upstream 18.3's whole release is G1+G2+G4+G6 (plus G5's
"Correct world state…" dialog), wrapped in a `scene_draft_v2` JSON
transport and validated against a reducer/ledger. That machinery is
tool-call + 32k-context bound; **the *principles* are what we port,
not the transport** (see §4, Stage 4).

## 3. Constraints (the "without breaking anything else" part)

1. **Backward compatibility is a hard rule.** Existing worlds, runs,
   imports and the tag format keep working. Validation may *reject*
   new tags, but a run can never get stuck: rejected tags are logged,
   the prose is kept, the turn completes.
2. **Budget.** Horde: output ≤ 2048 tokens, ~512-token anon kudos
   wall; context ≤ 120 messages; `CONTEXT_CAP` 128 KB. No
   function-calling channel on the free path. Anything added per turn
   (rules text, feedback re-prompts) must fit in a few hundred tokens.
3. **Phone UI.** New surfaces must fit the existing screen pattern
   (hub → sub-screen, back arrow) — no modals-on-modals, no desktop
   panels.
4. **The battery stays green** (25 suites / 579 checks) before any
   build; each stage extends `hordeworld-test.js` and/or adds a suite.
5. **No upstream code is copied verbatim.** The port's style is
   ES5, no modules, no DOM in engine files — upstream 18.3's
   additions are ES2022+ in a monolith. Principles, not patches.

## 4. Staged plan

Each stage is independently shippable, published on its own ask, and
reversible (feature-flagged per world where noted).

### Stage 1 — "The ledger stops lying" (validation + correction)

**Goal:** every tag is checked against the world before it lands;
the player can see rejections and fix them.

- **Validate all tag kinds** in `applyTags`:
  - `move` — only to a location that exists **and** is reachable from
    the current one via the exit graph (minutes still accrue).
    Name-fallback matching stays; unknown targets reject.
  - `item`/`drop` — pickups only from a world item registry (new
    optional `world.items` list: id, name, where found, weight for
    nothing — just existence); drop only what inventory holds.
    Worlds without an item registry keep today's behavior
    (flag: `world.ledgerV2 !== false` for AI-created + new imports;
    old bundled packs opt in per pack).
  - `cash`/`stat` — delta bounds from `gameRules` (e.g. ±100/turn
    default); out-of-bound rejects.
  - `roll` — expression syntax validated (NdM±K only); results kept
    in the run for Stage 2.
  - `quest`/`quest-done` — only registered quests.
- **Rejection record** — `run.rejections[]` (turn, tag, reason);
  HUD shows rejected tags with the reason, styled as a warning, not
  an error.
- **One bounded re-prompt** — if a reply contains an invalid tag (or
  the DM claims a change in prose with no tag at all — G4-lite),
  send one follow-up turn: *"The world rejected: [tag] — [reason].
  Keep the prose, fix the tags."* Exactly one retry per turn; then
  the prose stands and the rejection stays visible. This is upstream's
  "rescue with feedback" without their receipt contract.
- **Correct world state** — a sub-screen on the run (hub pattern):
  set location (pick from reachable-or-any with a "force" tick),
  adjust cash/stats (steppers), edit inventory (add/remove), tick
  quests. Every change logged as a `player_correction` entry in the
  run log and HUD. This mirrors upstream 18.3's new dialog 1:1 in
  *spirit* — theirs is a desktop dialog, ours is a screen.
- **No schema migration of runs.** Old runs load and continue
  unchanged; `ledgerV2` lives on the *world*.

**Acceptance (tests):** invalid move rejected + re-prompted + prose
kept; item minting impossible with a registry; teleport via name
fallback still works *only* for reachable places; out-of-bound cash
rejected; correction screen mutates state and logs; run with zero
rejections behaves byte-identically to today (regression: the 76
hordeworld checks still pass unmodified where behavior is unchanged).

**Effort:** 1–2 work segments. **Suggested version: v1.17.0.**

### Stage 2 — "Checks with real consequences"

**Goal:** the DM can request a check; the engine rolls it
deterministically and applies the outcome — the model narrates, the
ledger decides.

- **Checkable stats** — `gameRules.checks`: list of `{stat, name,
  dc}` (or per-quest DCs). The tag becomes
  `[[roll:2d6+1:check:DEX]]` (optional `:check:STAT` suffix — old
  plain rolls keep working).
- **Engine-resolved** — roll uses the run's seeded PRNG (seed stored
  on the run; same input → same outcome; no `Math.random()` in the
  engine — the battery must be reproducible).
- **Typed branches** — per check: `on_success` / `on_failure`
  effects = the existing tag vocabulary (stat deltas, item grant,
  quest state, clock), defined on the world side, **not written by
  the model** — upstream's core principle: *"the engine derives the
  outcome from applied state changes."*
- **Outcome line** — engine appends a one-line receipt to the reply
  ("DEX check: 14 vs DC 10 — success") after the DM's prose; HUD
  shows success/failure with the applied changes.
- **Fail-safe** — unknown check name or malformed branch → reject
  (Stage 1 machinery), plain-roll fallback.

**Acceptance (tests):** determinism across runs with equal seed;
success and failure branches each apply their typed effects and only
those; malformed branches reject; plain `[[roll:2d6]]` unchanged;
outcome line stripped from the stored log's model text but shown in
HUD.

**Effort:** 2–3 segments. **Suggested version: v1.18.0.**

### Stage 3 — "The world knows what NPCs know" (knowledge gating)

**Goal:** lore and secrets surface only when the situation can know
them.

- **Lore entries gain `known_by`** (optional): `anyone` (default),
  `faction:<id>`, `npc:<id>`, `secret`. `loreHits` filters by the
  present NPCs/factions and the player's quest state; secrets only
  when an unlock condition is met (quest flag or NPC present).
- **Scoring upgrade** — `loreHits` moves from substring to
  word-frequency scoring, top-N with a byte budget (e.g. 1.5 KB
  max per turn) so a 120-place Tempe pack can't blow the prompt.
- **NPC secrets** — `entity.secrets` stops being dead text: gated
  injection when that NPC is present *and* a trust condition holds
  (quest flag or stat threshold), marked to the referee as
  "the player may discover this."
- **Backward compatible** — no `known_by` → `anyone`, exactly today.

**Acceptance (tests):** secret lore absent when gate closed, present
when open; budget caps injected bytes; existing worlds (no
`known_by`) inject identically to today on the same input (snapshot
check).

**Effort:** 1–2 segments. **Suggested version: v1.19.0.**

### Stage 4 — "Scene discipline" (optional; defer by default)

**Goal:** catch DM prose that over-claims, *without* upstream's
JSON transport.

- **Claim audit (advisory)** — after a turn, a cheap local pass
  compares tag claims to the player input: input contains an
  imperative ("take the key", "open the door") with no matching tag
  → advisory note in the HUD ("the world didn't record this") + the
  Stage 1 re-prompt fires. No model round-trip needed for detection;
  the re-prompt is the only cost.
- **What we deliberately do NOT build:** the `scene_draft_v2` JSON
  transport (passage IDs, typed action lists, tool-call channel).
  It needs function-calling providers and a 32k-class context; on the
  Horde anonymous budget it would fail more than it helps. The tags
  *are* this app's scene draft — Stages 1–2 make them honest.

**Acceptance (tests):** advisory fires on unmatched imperatives;
never blocks a turn; silent when tags match.

**Effort:** 1–2 segments. **Suggested version: v1.20.0 — or cut.**

## 5. Explicitly out of scope (and why)

- **`scene_draft_v2` / tool-call receipt contract** — provider +
  budget bound (above).
- **NPC simulation / living NPCs** — upstream NPCs have schedules and
  private state; the mobile DM plays all NPCs in one prompt. A later
  feature, not part of this.
- **World Studio creator UI** — the phone gets AI creation + import;
  the desktop's 8-panel studio is not a phone surface.
- **Media, multiplayer, map rendering beyond the existing
  worldgraph view.**
- **ComfyUI/VH2** — declined, unchanged.

## 6. Decision points (need your call before Stage 1)

1. **Start at Stage 1?** It's the highest value-per-token: every
   other stage stands on its rejection/feedback machinery.
2. **Versioning:** 1.17/1.18/1.19 (conservative, current pattern) or
   make Stage 1 the **v2.0** "Worlds 2" milestone? Functionally I
   don't care; semver-wise the user-visible behavior change
   (rejections can now appear) leans toward keeping 1.x until Stage 2
   lands the flagship feature.
3. **Item registry for old bundled packs:** opt them in per pack
   (recommended — Tempe has no item economy; Policy Panic does) or
   leave all pre-existing packs on legacy behavior until re-imported?
4. **Re-prompt on Horde:** the free queue is slow; one extra round
   per *bad* turn is acceptable, but should the re-prompt be
   skippable in settings (some will hate the wait)?

## 7. Risks

- **Model compliance on the free Horde pool** — smaller models are
  less reliable at tag discipline; the rejection→re-prompt loop is
  the mitigation, and the HUD makes failures visible instead of
  silent. Mitigation is already in the design; no way around
  provider variance.
- **Prompt growth** — validation rules + item registry + check
  table add per-turn bytes. Budget: keep the total system-prompt
  delta under ~1.5 KB (item registry capped at top-N by relevance,
  same mechanism as Stage 3's lore budget).
- **Scope creep toward upstream** — the single biggest risk is
  "while we're in there…". The §5 list is load-bearing; each stage's
  acceptance list is the whole stage.

## 8. Total

| Stage | Content | Segments | Version |
|-------|---------|----------|---------|
| 1 | Validation + rejections + re-prompt + correction screen | 1–2 | v1.17.0 |
| 2 | Checks with engine-resolved branches | 2–3 | v1.18.0 |
| 3 | Knowledge gating + scored lore budget | 1–2 | v1.19.0 |
| 4 | Advisory claim audit (optional) | 1–2 | v1.20.0 |

~6–9 work segments for the full program, each independently
shippable and testable, none touching the chat/persona/settings
surfaces.
