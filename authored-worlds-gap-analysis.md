# Authored Worlds — concept vs. the APK today, and the gap list

Researched 2026-10-17 against upstream `ddkhan24/hordestudio` (README, the real
`Policy Panic at Bramble and Pike.horde_world`, the `worlds2-rpg-live` fixture,
`world-packs/tempe-core.json`) and this repo's `js/hordeworld.js` + `js/app.js`,
with checks counted directly in source.

---

## 1. The concept (what authored worlds are designed to be)

Upstream's pitch: **"Living Worlds — settings with locations, rooms, routes,
NPCs, factions, quests, inventories, time, weather and persistent consequences.
Author starting lives, homes and social ties."** Plus an optional RPG layer:
**Off** (narrative) / **Light** (equipment and checks) / **Full** (progression,
requirements, resources and persistent effects).

The format backs that pitch up. A real authored world carries:

| Section | What an author can declare |
|---|---|
| Locations | description **and hiddenDescription** (referee-only facts), exits with travel minutes and one-way flags, region/mapType/parent hierarchy, **prosperity and danger ratings** |
| Entities (NPCs) | persona, **goal as a program** (goal + goalSteps[] + goalDifficulty + goalAutonomy + goalDeadlineTurns), secrets with unlock conditions, **home + daily schedule (time, place, activity, weekdays)**, faction membership |
| Factions | goal, goalPool, influence, resources, reputation, territory, relations, status |
| Starting lives | role, socialRank, legalStatus, privileges, home, inventory, **holdings, obligations, outfit, statOverrides, starting faction reputation** |
| gameRules | profile (Off/Light/Full + custom), currency stat + name, **vital stat + zeroHpMode**, dice config (sides, defaultDifficulty, per-stat modifiers, criticals), named checks with DCs, module switches: stats, **health, conditions**, checks, inventory, **equipment**, commerce, quests, relationships, **schedules**, livingWorld |
| hudConfig | which panels show, clock start/step/weekday, the stat sheet (64 stats in Policy Panic) |
| sandboxConfig | politics, law, **seasons + seasonDays + calendar**, growth, scale, and the world's own "what moves the world" principles |
| worldAgent | **an off-screen simulation tick: enabled, intervalTurns (18), lastRunTurn** |
| kernel | sceneLocationLimit, memoryMode (ledger), repairMode, compactTools — a compaction/runtime config |
| Kernel-adjacent | kernel-adjacent checks: the dmPrompt itself binds the referee: "Use world tools for durable movement, cast, time, relationships, stats, inventory, quests, **schedules, conditions and events**. Commit one complete world-turn receipt." |

The core promises, stated in the world's own referee prompt: *no reset to
status quo — promotions, firings, romances, grudges persist*; *NPCs pursue
goals off-screen*; *honor the clock, exits, work schedules, homes and who is
actually present — nobody teleports*.

## 2. The state now (this APK)

The port is genuinely strong at the turn itself — better than a naive
implementation — and thinner around it.

**Solid (keep, don't regress):**
- The turn transaction (v1.29.1): clones, optimistic line, refuse-and-repair,
  fail-closed commit, receipt. The ledger can no longer disagree with the story.
- Ledger v2: every tag validated against the world (reachable moves, bounded
  stat/cash changes, known items/tasks), rejections reported back with reasons.
- Tag grammar: move with travel minutes, clock, cash, stat, item/drop,
  quest/quest-done, roll (d20 side honored from the world's dice config),
  with/part party ledger.
- Named checks with DCs from `gameRules.checks`, rolled by the world, never
  narrated by the model.
- Knowledge gating (v1.19.0): lore visibility by faction standing / NPC
  presence / quest unlock; secret reveals with unlock conditions.
- Referee discipline: state-anti-echo (v1.30.2), OOC understanding (v1.30.3),
  tag-artifact cleanup (v1.30.4), thinking/planning filters, echo guards.
- World banner kept + dieted (v1.30.0); 512px image pipeline throughout.
- Correct-state screen (player fixes the ledger by hand), status sheet, party
  sheet, clock with weekday support, companions who "know what they witnessed".
- Hosted catalogue support (world packs) + 2 bundled worlds; AI-assisted world
  creator; se polish.

**Thin (declared in the format, parsed-but-unused, or dropped at import):**

| Area | Reality in the APK |
|---|---|
| NPC schedules | Dropped at parse (`entity.schedule` never mapped). `npcsAt()` is static start/home — the referee is told who is "present" from where NPCs live, forever. |
| NPC goals | Only the one-line `goal` string survives. goalSteps, difficulty, autonomy, deadline — all dropped. Nothing advances goals off-screen. |
| worldAgent | Kept in storage, never executed. No world tick at any interval. The world only moves when the player does. |
| kernel | Kept, never read. No scene-location compaction, no memory mode, no repair mode config honored. |
| Relationships | Parsed, `relationshipsFor()` even exported — and **called nowhere**. Never in the referee prompt, never on screen, no standing changes. |
| Factions | One seed: starting life's `factionReputation`. No standing/[[rel]] tags, no influence/resources movement, nothing on the status sheet. |
| RPG Full | vitalStatId + zeroHpMode ignored (0 HP means nothing), conditions module absent, equipment module absent, `startingQuests` and `groups` unparsed. |
| Dice config | Sides honored; **defaultDifficulty, per-stat modifiers, criticals ignored** (roll() parses spec strings only). |
| Life start | Applies inventory + factionReputation. **statOverrides, obligations, outfit, holdings, socialRank, privileges, legalStatus — all dropped.** |
| Place texture | **prosperity + danger parsed, never shown or fed to the referee.** |
| Weather/seasons | sandboxConfig kept-but-unused; no weather or calendar drift. |
| AI creator | Produces a deliberately thin subset: 3–4 NPCs (no schedules, no goal steps), 1–3 factions (description only), **no stat registry, no items/quests seeds** — a world that starts out far from the concept. |
| Editing | No on-phone world editing beyond ledger correction mid-run. |

## 3. What it needs — analysis

**"Closer to the concept" is chiefly about the world moving when the player
isn't looking.** The format is a living-world spec: schedules, goal programs,
faction state, an agent tick. The port currently runs worlds as a very
disciplined *static* scene-graph referee — excellent bookkeeping, no life
between turns. The three upstream covenants that break are "NPCs pursue goals
off-screen", "honor schedules and who is actually present", "promotions and
grudges persist" (they persist only if the referee remembers to tag them —
nothing nudges it).

**"Better" (more truthful)** is about feeding the referee what the file already
knows: relationships, danger/prosperity, faction standing, the full starting
life. Most of this costs milliseconds — the data is already in storage.

**"More optimized"**: the current prompt rebuilds the whole state + present-NPC
personas + lore hits every turn. The format even ships its own compaction hint
(kernel.sceneLocationLimit=28, memoryMode:ledger). As richer sections land
(relationships, schedules, standing), the prompt budget needs a policy or it
will grow linearly with world size.

---

## 4. The gap list, with suggestions

Priority order: P1 = closest to concept per token/turn cost, P2 = depth,
P3 = breadth (RPG Full + authoring). Sizes: S < 100 LOC + tests, M ~100–300,
L = new subsystem.

### P1 — bring the world to life, cheaply

1. **NPC schedules honored.** Format already declares `schedule[{time, locationId, activity, days}]`.
   *Suggestion (M):* at parse keep the schedule; build a `scheduleAt(world, clock)` resolver; `npcsAt()` becomes
   "scheduled if within window, else home/start". Prompt's "Present:" line follows the clock. The referee can finally
   honor "who is actually present" — the single most-violated upstream covenant today.
   *Test:* clock-8am Denton is at his office, 12:20 he's in the break room; weekends fall back to home.
2. **A world pulse instead of the full agent.** Upstream's worldAgent fires every N turns; a full second AI call is
   expensive on the Horde. *Suggestion (L, staged):* v1 = every `intervalTurns` (default from worldAgent, else ~15),
   the turn prompt gains one line: "The world has advanced: tick the state that time alone would change (one
   goalStep at most, weather if seasons on)" — zero extra API calls, model-sized work. v2 (optional setting):
   a real compact agent pass after the commit, writing a dated "world log" line (promotions, faction moves) that
   the next prompt's state block includes; reuses the same fail-closed transaction.
   *Test:* at turn 18 the prompt gains the pulse line; world log entries appear in state.
3. **Relationships in the prompt.** `relationshipsFor()` exists unused; shipping worlds carry 14 scored pairs.
   *Suggestion (S):* for NPCs flagged Present, append one line: "Denton ↔ Gloria: depends on her competence;
   pretends otherwise (32)". Cap at 3 lines per NPC, strongest |score| first.
   *Test:* Denton present → his Gloria line in the system prompt; absent NPCs contribute nothing.
4. **Full starting life applied.** statOverrides, obligations→starting quests, outfit (first "You wear…" line),
   socialRank/legalStatus as one identity line at intro. The fields are already stored. *Suggestion (S–M):*
   extend `HW.start()` — stats merge onto hudConfig defaults, obligations seed the quest list as accepted tasks.
   *Test:* New Hire starts at Performance 40 with the 3 onboarding obligations open.
5. **Danger/prosperity surfaced.** Parsed and dropped on the floor today. *Suggestion (S):* ratings show on the
   location header line of the status sheet, and enter `describeLocation` when extreme (danger ≥ 4:
   "the referee should remember this place is dangerous").
6. **Faction standing, minimal.** reputation exists as run state (seeded) but nothing changes it.
   *Suggestion (M):* two tags `[[rep:FACTION:±N]]` bounded like stats, shown on the status sheet, fed to the
   prompt when nonzero; reuse the ledgerV2 rejection path for unknown factions. (Skips influence/resources
   movement — P3 material.)

### P2 — depth inside the turn

7. **Dice config honored.** defaultDifficulty as the refusal hint in rules ("untagged DCs run at N"),
   per-stat fixedModifier applied from hudConfig stats' `roll.fixedModifier` to named checks, criticals
   (natural max/min) reported in the check line. *Suggestion (M):* extend resolveChecks; all three fields are
   already parsed.
8. **Goal programs kept (read-only at first).** Instead of dropping steps/deadlines, keep them and expose the
   *current* step in the prompt for Present NPCs — no simulation needed for the referee to play goals
   consistently. Composes with #2's pulse, which is what *advances* steps. *Suggestion (S):* parse + one prompt line.
9. **Prompt budget policy (optimization).** *Suggestion (M):* token-aware trimming in buildPrompt with stable
   priority (state > present NPCs > rules > lore hits > distant cast), persona text of NPCs already talked to
   cut to a 200-char synopsis, hiddenDescription elided after it's been revealed, kernel.sceneLocationLimit
   honored for how many locations the grammar line enumerates. Include a debug-only counter so tests can
   assert "≤ N chars for the 23-location world".
10. **Weather/seasons lite.** *Suggestion (S–M):* if sandboxConfig.seasons, compute the season from the world
    clock (seasonDays/calendar already defined) and add one state line; no live API needed on-device.

### P3 — breadth: RPG Full + authoring + catalogue

11. **Health & zeroHp.** vitalStatId highlighted on the sheet; at 0, the run sets a `downed` flag the prompt
    enforces (fail_forward: "the next scene starts from consequences, not game over"). *Suggestion (M).*
12. **Conditions, minimum viable.** `[[condition:NAME]] / [[clear:NAME]]` tags, a state line, prompt listing,
    sheet chips. *Suggestion (M).*
13. **Equipment on top of inventory.** equipment module: named slots per world in gameRules, `[[equip]]/[[unequip]]`
    tags moving items between worn/carried. *Suggestion (M–L).*
14. **RPG fixture fields.** parse `startingQuests` (seed at start/#4) and `groups` (party sheets later).
    *Suggestion (S).*
15. **AI creator upgraded.** Its schema already proves 3-stage generation works; extend stage 2 (people) to emit
    one schedule (2–4 entries) + one goal steps array per major NPC, and stage 3 to emit a small stat registry
    (3–6 stats) + 2 starter items/tasks. *Suggestion (M)* — strictly additive to the prompt JSON; parser already
    tolerates extras.
16. **On-phone world viewer.** Read-only structured view of an installed world (places with exits, cast with
    goals/secrets redacted-hidden, factions) — debugging aid for authors and players alike. *Suggestion (M).*
17. **Catalogue.** upstream `world-packs/catalog.json` shipped packs can be listed in the hosted section like
    tempe-core already is. *Suggestion (S).*
18. **(Deferred earlier, on the record) classes & skills:** no format keys exist upstream either — this is a
    net-new format extension (would need author-facing design first). Keep parked until asked.

### Explicitly out of scope (already strong / don't rebuild)
- Turn transaction, ledger v2, tag validation/rejection, checks, knowledge gating, party ledger, correct-state,
  prompt-hygiene rules (anti-echo, OOC, artifact strip) — keep, extend only.
- Media stripping except banner: correct on a phone (2.4MB world → 150KB).

---

*Counts cited are grep-verified 2026-10-17 on horde-studio-mobile/js: hordeworld.js 0 hits for
schedule/goalSteps/worldAgent-as-runtime/statOverrides/obligations; relationshipsFor defined+exported, 0 callers.*
