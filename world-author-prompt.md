# Authored-world prompt for Horde Studio

Hand-written worlds usually "come short" for the same three reasons, and the
prompt below is built to attack exactly them:

1. **The referee is never told to ledger.** The engine only records what the
   referee reports in `[[tags]]`. If your `dmPrompt` is pure style talk, you
   get pretty prose where nothing registers: no items in inventory, no money
   spent, no quests, the clock frozen.
2. **Dangling references.** An NPC homes at `loc_tavern` that does not exist,
   a life starts at a location with no id, a skill trains a stat named
   differently in `hudConfig`. The engine drops unknown shapes silently —
   the world just feels empty.
3. **Static design.** No schedules, no goals, no faction wants, no lore
   gates: the cast parks at home and waits, so the world reads as a museum.

## How to use

Copy **everything inside the box** into a fresh chat (Claude/GPT/etc.),
replace the `<<...>>` line at the bottom with your actual world idea, and
send. Import the JSON it answers with (Worlds → import / guided creator).
If it answers in more than one message, merge the JSON into one document.

```text
You are authoring a machine-readable world for a mobile text-adventure engine
("Horde Studio"). You are not writing prose about a world; you are building
the machine the game runs on. Output a SINGLE valid JSON document — no
markdown fences, no trailing commas, no comments — with "_format": "horde-world".

=================================================================
CONTRACT (every key the engine reads)
=================================================================

TOP LEVEL
{ "_format": "horde-world", "name", "description", "startLocationId",
  "locations": [...], "entities": [...], "factions": [...],
  "relationships": [...], "lorebook": [...], "startingLives": [...],
  "startingQuests": [...], "goalPrograms": [...], "worldAgent": {...},
  "dmPrompt", "authorNote", "intro",
  "gameRules": {...}, "hudConfig": {...},
  // optional: "classes": [...], "skillsCatalog": [...], "sandboxConfig": {...}, "kernel": {...} }

LOCATIONS  — id (snake_case, e.g. "loc_tavern"), name, mapType
("region"|"route"|"building"|"room"|"outdoor"), region, description,
hiddenDescription (what inspection reveals), parentLocationId (or null),
prosperity (0-10), danger (0-10), exits: [ { "text": "described direction,
e.g. 'east along the wall'", "travelTime": minutes-or-null,
"isOneWay": false } ].
Mirror every exit in the opposite room unless one-way. startLocationId
MUST equal an existing location id. Aim for 8–20 connected locations.

ENTITIES  — the cast. Each: id ("ent_bram"), name, type ("npc"), isMajor
(true for plot drivers), factionId (existing faction id or null),
startLocation and homeLocation (existing location ids), description,
persona (voice, fears, quirks — this is what the referee roleplays),
goal (one concrete sentence, present tense), secrets (the truth only the
author knows), secretUnlock (when that truth may surface),
schedule: [ { "time": "07:00", "locationId": existing id, "activity":
"what they do", "days": ["mon","tue"] } ] — give every believable NPC 2–4
schedule blocks across the day so the cast moves and the player can
actually find people. 5–12 NPCs is a healthy cast.

FACTIONS  — at minimum { "id": "fac_...", "name", "description" } and what
they want. 2–5 factions; tension between at least one pair.

RELATIONSHIPS — { "a": entityId, "b": entityId, "label": "clear human
reason, e.g. 'owes her back pay'", "score": -10..10 } — who leans on whom.
Every major NPC should lean on at least one other entry.

LOREBOOK — entries that surface when their keyword comes up in play:
{ "id": "lore_...", "keyword": "short lowercase phrase", "text": "the
lore itself, 2–4 sentences", "knownBy": "" , "unlockQuest": "",
"unlockNpc": "" }.
Rules of the book: keywords are short exact phrases likely to be typed;
an entry gated by unlockQuest/unlockNpc hides until that thread opens.
Author 8–20 entries: history, slang, prices, rumors, the big secret —
and gate a third of them.

STARTINGLIVES — the roles the player may begin as:
{ "id": "life_...", "role": "Apprentice smith",
"description": "a paragraph of who they are", "startLocationId": existing
location id, "statOverrides": { "<stat id>": 2 }, "inventory":
["bent chisel", "3 coins"], "obligations": ["pay 5 coins rent each week"] }.
Offer 3–6 lives with genuinely different starting positions, stats and kits.

STARTINGQUESTS — 2–4 open threads, plain strings ("Find out why the
warehouses lock at night"). One must be playable in the first ten minutes.

GOALPROGRAMS + WORLDAGENT — how the world moves without the player:
goalPrograms: [ { "id": "plan_...", "name", "actor": an entityId or
factionId, "steps": ["3–6 beat-by-beat strings it intends to do"] } ],
plus "worldAgent": { "enabled": true, "intervalTurns": 15 }. Author at
least 2 programs; cast members WITHOUT a program still need schedules.

GAMERULES + HUDCONFIG — the mechanics:
"gameRules": { "currencyName": "coins", "dice": "2d6", "modules":
{ "inventory": true, "dice": true, "quests": true } },
"hudConfig": { "stats": [ { "id": "performance", "name": "Performance" },
{ "id": "health", "name": "Health" } ] }.
Every stat id is a handle used elsewhere: statOverrides and skillsCatalog
MUST use these exact ids. 3–6 stats is enough.

CLASSES + SKILLSCATALOG (optional but interesting) —
skillsCatalog: [ { "id": "skill_lore", "name": "Pike lore",
"description": "what the training covers", "stat": "<a hudConfig stat id>" } ];
classes: [ { "id": "cls_...", "name", "description",
"statOverrides": {...}, "skills": ["skill_lore"], "obligations": [...],
"outfit": "a sentence of what they wear" } ].

DMPROMPT — the referee's standing orders, in one tight block. This field
decides whether the world WORKS. It must cover:
  a) Voice & pacing (2–4 sentences: tense, POV, sentence length, what the
     referee never does — explains rules, sums up).
  b) LEDGER DISCIPLINE, verbatim idea: "After EVERY reply, append tags
     for what changed. The player never sees them. Report ONLY things
     that actually happened in this reply's prose."
  c) The tag grammar the engine understands, teach it exactly:
     [[move:loc_someId]]  the player walked somewhere they can see from here
     [[clock:+30]]        that many minutes passed
     [[cash:-15]]         money spent or paid (+ for received)
     [[stat:statId:-5]]   a stat permanently moved (+ for a rise)
     [[item:Brass key]]   gained something
     [[drop:training binder]]   lost something
     [[quest:Name of task]]      took on a task
     [[quest-done:Name of task]] finished one
     [[roll:2d6+1]]              rolled dice, show the result and honor it
     [[skill:skillId]]           gained a training level from skillsCatalog
     [[rep:factionId:+2]]        a faction's opinion shifted
     [[condition:name]]          a lasting condition applied
  d) Honor boundaries: no new locations/people out of thin air; unknown
     places exist in the lorebook or do not exist; if the exit list has no
     way west, west cannot be walked.
  e) Time: the clock only moves through [[clock:+N]], big actions cost
     minutes, sleep costs hours.

AUTHORNOTE — 1–2 sentences of intent for future-you ("horror should climb
slowly; comedy stays dry").

INTRO — the actual opening message, 100–250 words, IN WORLD, putting the
player in their chosen life with an immediate small choice. No exposition
dump; no tutorial voice.

=================================================================
HARD RULES (violations silently break the world)
=================================================================
1. Every startLocation, homeLocation, startLocationId, schedule.locationId
   references an id that exists in locations.
2. Every factionId references an id in factions; every relationship a/b,
   goalPrograms' actor, lorebook's unlockNpc, skillsCatalog's stat
   reference ids that exist.
3. statOverrides keys exist in hudConfig.stats ids.
4. No data: URIs, base64, image fields — art is stripped on import anyway.
5. ids are short snake_case, unique, and NEVER renamed later in the doc.
6. Valid JSON only: double quotes, no trailing commas, no // comments.

SELF-CHECK — after the JSON, print (NOT inside it): the counts (locations/
NPCs/factions/lore entries), your reference check ("all ids resolved ✓"),
and three example openings for three different lives. If any id does not
resolve, FIX the JSON and reprint it in full.

WORLD TO AUTHOR: <<describe your idea here: setting, mood, scale, and any
must-haves — name names where you care>>
```

## After you get the world back

- Import it, start a run as each life once, and read the HUD: did money,
  items and the clock actually change after you pay, pick up, walk? If
  prose claims happen but ledgers don't, the dmPrompt tag discipline is
  the knob to sharpen.
- Watch the skimmed knowledge: type a lore keyword you authored — the
  Lore tab should light up. If everything is always visible, you forgot
  the gates (or authored none).
- Then iterate in ONE small change per test, and let the in-app guided
  creator bench ideas (`Policy Panic` is the worked reference: 23
  locations, 8 people, 6 factions).
