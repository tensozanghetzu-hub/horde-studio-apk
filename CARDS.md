# Character cards — what this app reads, keeps, and applies

How Horde Studio (v1.41.0) handles a character card, field by field. Written for
people who import cards from other frontends and export them again, and for
authors who want to know what a card may safely ask this app to do.

Three sentences of policy, then the tables.

**A field this app models is never damaged on the way through.** Anything it does
not model is kept as the card wrote it and put back on export — including unknown
extensions, book-level settings, legacy spellings and values this app would not
have chosen. Editing one field changes that field and nothing else; clearing one is
an edit too, and is written down as one (see
[what an export writes back](#what-an-export-writes-back)).

**Keeping has a shape limit, and it is not unconditional.** The copy is the card's
own JSON with two bounds on its *structure* — nothing deeper than 200 levels,
nothing past 60 000 values, 2 MB of text overall. A card beyond them keeps a
shorter copy, and the import names the paths that did not fit so you can keep the
original file; the export says it again at the moment you would rely on it. Inside
those bounds nothing is trimmed: a string of any length, an array of any length,
any depth up to the bound, all come back exactly as they went in. Picture keys are
the other exception — pictures the app has no place for stay in the copy but not
always in the export, and the export counts what it could not put back.

**Nothing is called supported just because it is kept.** Each table says which of
the two it is: *applied* means it changes what the model is sent, *preserved*
means it rides back out untouched and changes nothing here. Where a field is
preserved but not applied, the importer says so out loud, on the character, where
it can still be acted on.

## Contents of a card

| Card field | Here | Where it goes |
|---|---|---|
| `description`, `personality` | applied, together or apart | the character sheet's persona. The character sheet is one box by default; *the card's two fields* mode on the same screen keeps `description` and `personality` apart, so editing either one leaves the other as the author wrote it. Edited as one box, the merged text goes into `description` and `personality` is emptied — one string cannot be split back into two, and leaving the old half in place would send the model a persona it never saw. Switching between the two modes loses nothing either: see [the persona editor](#the-persona-editor-two-boxes-or-one). |
| `scenario` | applied | the situation line, with the `scenario_list` variant picker if the card carries one |
| `first_mes` | applied | the greeting |
| `alternate_greetings` | applied | the extra intros, swipeable in the chat (a greeting that repeats `first_mes` is not carried twice) |
| `mes_example` | applied | example dialogue, labelled as a sample and kept out of the transcript |
| `post_history_instructions` | applied, position is a choice | see [placement](#where-post_history_instructions-goes) |
| `system_prompt` | kept, shown, applied only when a person says so | see [the system prompt](#the-cards-own-system_prompt) |
| `character_book` | applied | the lorebook: see [matching](#lorebook-matching) |
| `name`, `tags`, `creatorcomment` | applied to the character record | `tags` fill the character's tagline; none of the three is sent to the model |
| `creator_notes`, `creator`, `character_version` | preserved | not sent to the model, per the spec's own instruction |
| V3 character fields with no Horde equivalent (`nickname`, `language`, `depth_prompt`, `creation_date`, `modification_date`) | preserved | returned verbatim on export; `depth_prompt` is not applied, because this app has no per-depth prompt slot |
| `extensions`, at card and entry level | preserved | every key the card had, with only `horde_studio` replaced by this app's own values |
| `char_x`, `image_1…n`, other picture keys | shown | the avatar and the card gallery; pictures the app has no place for (a background, an image inside a lore entry) are preserved in the card and the export says which ones it could not put back |
| `metadata` blobs from other clients | preserved | never rewritten, never merged into |
| `.charx` archives | not supported | no unzipper in the APK. A `.charx` cannot be imported or exported; use the `.json` or `.png` card |

## Where `post_history_instructions` goes

The text is put where the character's **Always-remember note** setting says, and
it is never sent twice:

| Choice | Position in the request | Used when |
|---|---|---|
| **End of the sheet** (default) | last inside the character sheet, above the examples and the transcript | what every version of this app has done; what a card imported before v1.40.0 keeps |
| **After the history** | after the transcript, *before* the app's own continuation/reroll instruction | a card that asks for its rule to be the last thing read, without letting it outvote the app's |
| **Not sent** | — | when the note is only there for other frontends |

Both request shapes answer the choice: the chat format puts it in the trailing
system turn, the text-completion format appends it after `Chat history:`. There is
no third path and no invented player message. The Prompt inspector shows the
request as it goes out, so the position can be checked rather than trusted.

Macros in that text (`{{char}}`, `{{user}}`, `{{original}}`, the pronouns) are
expanded at build time, not at import — so changing the global prompt changes what
`{{original}}` means, for cards imported before that macro existed too.

## The card's own `system_prompt`

Imported and kept even when unused, shown in full on the character, and applied
according to a three-way choice made **by a person**:

| Choice | The model is told |
|---|---|
| **Your prompt** (default) | the global prompt from Settings, or this character's own prompt box if it is filled in |
| **The card's** | the card's text instead, and nothing of the global prompt |
| **Both** | the global prompt, then the card's |

The V2 spec's own words are that a frontend's *default behaviour MUST be to
replace* the user's system prompt with the card's, with an empty field as the
exception. **This app deliberately does not default to that.** Its global prompt
carries the rules the mobile build runs on — plain prose, no narration written for
the player, the out-of-character convention — and a card that silently deletes
them is a worse surprise than a card whose extra rules go unread. The card's text
is imported, displayed, and one tap away; `Both` is the middle that lets an author
add without letting a card take away. This divergence is a product decision, not a
claim of compliance.

**A request in the card is a request, not a grant.** `extensions.horde_studio.system_prompt_source`
is this app's own key, so a card can carry it — and importing a card that says
`"card"` or `"combine"` does **not** set the mode. The ask is recorded on the
character as *the card asked for*, shown in the editor next to the three buttons,
named in the import notes, and carried back out on export so the author's word
survives. What applies it is a choice with a person in it:

* **the character's own mode** — picking one of the three buttons on the character;
* or **Settings → System prompt → "Cards may choose their prompt"** (off by
  default), which says *every card I import that asks gets its way, because I have
  decided that once, for myself*.

A character with its own choice never has it overridden by the setting, and a card
that never asked is untouched by it. The grant is never written into the card as a
new key: a key a card may set is a key a card may grant itself, so the setting
lives in this app's preferences and the per-character choice lives on the
character. Choosing **Your prompt** on a card that asked is also an explicit
answer — it is exported as `"app"`, so the refusal survives the round trip instead
of falling back to the card's request.

*One caveat, stated:* a character imported by v1.40.0 may already have had its mode
set by its card, because that version applied the ask on import. Nothing is
changed under it — the character keeps behaving as it has been — and the fix is
the button it never had: open the character, choose **Your prompt**, save.

`{{original}}` means "the prompt the app would have used without this card" in
every mode. In `Both` it resolves to nothing rather than repeating the global
prompt twice — the reference is satisfied by the copy already in front of the
card's text. An empty or missing `system_prompt` always falls back to the global
prompt, whatever the mode says.

## Lorebook matching

Entries are *candidates*, then *admitted*, then *placed*. Which of the card's
fields act on each stage:

| Stage | Field | Behaviour |
|---|---|---|
| candidate | `enabled` | `false` excludes the entry |
| candidate | `stage` | a staged entry appears only in a chat whose continuity stage matches exactly; `*` means always, blank means the entry is dark until the chat sets a stage — the Lore screen says which of these it is |
| candidate | `keys` | a key must stand on its own word edges ("label" does not match "labelling"), and a bare plural still counts ("gossip" matches "gossips") |
| candidate | `case_sensitive` | applied: a key written with capitals matches only those capitals. Word edges and the plural rule still apply |
| candidate | `selective` + `secondary_keys` | applied per V2's own comment: `selective: true` needs a key from `keys` **and** a key from `secondary_keys`. When `selective` is not `true`, `secondary_keys` is ignored. A secondary key alone never wakes an entry |
| admitted | `constant` | always admitted, ahead of everything else, while the budget lasts |
| admitted | `extensions.horde_studio.essential` | this app's own flag: admitted ahead of any entry that is not `constant`, so a tight budget spends itself on what the card says the story cannot do without. It does **not** lift the budget — an essential entry larger than the whole budget is sent alone, and the rest is cut and reported |
| admitted | *(nothing in the card)* | the default order is recency: a key in the message being answered beats a key from three turns back, which beats a key from six. This is the whole point of the selection and it is never replaced by book order |
| placed | `insertion_order`, `position`, `priority`, book `token_budget`, book `scan_depth` | applied **only** when the character has *Follow the card's lore order* on. See below |

**The window.** Keyword scanning reads the last **6 player turns** — in turns, not
messages, because messages-per-turn drifts as a chat runs. The same window is what
the transcript and the style lock read, and one request computes it once. A
character may widen the scan window from 1 to **24** turns; that changes only what
the scanner is allowed to *notice*, never how much history is sent. A card's own
`scan_depth` counts messages, so in compat mode it is halved into turns and is
only ever allowed to **shorten** the window.

**Compat mode** (*Follow the card's lore order*, off by default). Horde has one
place for world facts — a block inside the character sheet — so a book's ordering
has nothing to re-order unless the card's layout is asked for. With it on:
`position: before_char` / `after_char` split the admitted entries ahead of and
below the sheet, `insertion_order` sorts each group (lower number = higher up),
and when the book's `token_budget` is exceeded the entries with the lowest
`priority` are the ones that do not fit. Who is admitted does not change: the
candidates are still the entries the scan matched, ranked by relevance.

**Not honoured, and said so.** `selectiveLogic` is SillyTavern's, with four modes
that neither card spec defines; the boolean rule above is applied instead and the
import note plus the entry's own row name the field. `comment`, `display` and the
entry `id` spellings are carried and not applied — they change nothing about what
reaches the model, and they ride back out on export untouched. A `selective` or
`case_sensitive` that is neither `true` nor `false` is treated as absent, exactly as
the spec's boolean type implies, and is reported as malformed rather than guessed at.

**Honoured, but only if the player agrees.** `use_regex` on an entry, and
`recursive_scanning` (plus SillyTavern's `recursion_depth`, which the spec does not
define) on the book, are read by the matcher behind two switches in
Settings → System prompt, **both off**, beside the system-prompt one and for the same
reason: a card's keys are user data, not code, and a card cannot approve itself. A
book with those fields and a player who never opens Settings gets exactly what the
paragraph above described before they existed — keys as plain text, one pass over the
chat, the same ranking.

*Regex keys.* With the switch on, an entry whose `use_regex` is the boolean `true`
has its keys compiled and matched against the recent transcript instead of being
looked for as strings in one turn's text. Two shapes are refused, and the entry is
then a non-match rather than a fallback to plain text — that is the spec's own rule
for invalid patterns, and an entry authored as `/cat|dog/` finding the literal
characters `/cat|dog/` would be a card quietly doing something nobody wrote:
a pattern `new RegExp` rejects, and one whose shape costs exponential time to fail,
which is the display scripts' test reused deliberately, because this runs on the
phone every turn and a timeout is not a bound. `/pattern/flags` is unwrapped so the
author's flags win; a pattern that merely begins with a slash keeps its slash.
`secondary_keys` is ignored while `use_regex` is true, as the spec asks. One thing is
**not** what the spec suggests: it says an entry's `constant` *"SHOULD be ignored"*
when `use_regex` is true, and this app keeps honouring it — a MUST ("the lorebook
field MUST be considered as a match") is not overruled by a SHOULD, and a
badly-written key should not delete a fact the author marked as always present. The
row on the Lore screen says both parts: that the entry is constant, and that its
pattern was refused.

The lorebook *decorators* — `@@additional_keys`, `@@exclude_keys`, `@@depth`,
`@@scan_depth` — are the spec's other way of qualifying a match, and this app
implements none of them, in regex mode or out of it: the fields above are the whole
of what a book can ask here. (A book's own `scan_depth` is read, but only in
compatibility mode and only to narrow the window, and `token_budget` likewise only to
cap what the Lore screen shows.)

*Chaining.* With the other switch on, an entry whose text mentions another entry's key
can bring that entry in — which is what `recursive_scanning` means, and the spec
leaves the how to the application, so the bounds are this app's and they are tight:
three hops whatever the book asks for (a book asking for 1 gets 1, one asking for
unlimited gets 3), only the first twenty entries the chat matched are read for links,
an entry is admitted once however many wake it, a circular reference terminates, and
a chained entry never displaces one the conversation itself matched — it takes only
what the count and the token budget leave over. That last part matters more than the
depth: an entry that shuffles the order of what the model sees would cost the cache
discount on every turn, so chaining only ever adds to what the plain scan already
ranked.

Neither is hidden where it bites. The Lore screen's per-entry rows say *"the switch is
off, so its pattern was searched for as plain text"*, or *"its `nested repeat` pattern
was refused"*, and the summary line counts how many entries asked for patterns, how
many matched on one, and how many were chained. The import note names both asks and
points at the two switches, so a card's request is visible at the moment the card
arrives rather than only in a settings screen nobody opens.

## Instructions a card leaves for this app

`extensions.horde_studio` is this app's own namespace and it carries six optional
authoring fields, editable on the character and round-tripped through the card:

`agency` (how much the player may say about the character's head), `style` (how the
prose should read), `canon` (what counts as settled fact), `progression` (how the
story is meant to move), `stages` (slow-burn gates), `priority` (what must survive
the budget).

Every one is off by default: nothing is added to the prompt for a card that does
not set them. A card with ranks, thresholds or a skill tree should reach for
`progression` and read [the RPG status ledger](#the-rpg-status-ledger-what-a-card-can-and-cannot-drive)
before it writes a number anywhere else: that section is the whole list of what the app
will track for you, and what it will refuse to take from you.

The four per-character switches next to them — placement, prompt source, compat
mode, scan window — are not all the same kind of thing, and the app treats them
differently on purpose. Three of them decide **how the card's own content is laid
out**, so a card may set them at import. The fourth, `system_prompt_source`, decides
**whose instructions run the conversation**, so a card may ask and may not have: it
is recorded and shown, and applied only by the player or their own preference. See
[who decides what](#who-decides-what). Set, each becomes one labelled line under `CARD INSTRUCTIONS FOR
HORDE STUDIO`, inside the character sheet, above the examples. Macros expand as
elsewhere. Each line is cut at **600 characters** when it enters the prompt, and
the cut is marked in the prompt and shown in the editor — while the character and
the card keep the whole text up to the storage bound below.

## The RPG status ledger: what a card can and cannot drive

The app keeps one **player-owned RPG ledger per chat** (`⋮ → RPG status`): a level, an XP total, a
curve, an attribute map, three lists, and a history of what was approved. A card cannot create it,
seed it, or edit it — no card field is read into it, and a card that wants levels has to earn them
through replies the player approves. Everything below is the whole interface between a card and that
ledger: one tag in a reply, one authoring field, and a set of bounds the app enforces by truncating
or refusing rather than by trusting.

**Say the economy in `progression`, not the arithmetic.** `extensions.horde_studio.progression`
(heading: `Story progression`, ≤ **600 characters** into the prompt, 4000 stored) is where a card
describes what a level *means* and what is worth XP in this world: "crossing a Threshold is worth a
rank, and nothing less; a rank bought in the Guild is permanent; a failed Rite costs the rank it
was trying to buy". The curve, the per-turn cap and the level number are **not** yours to set — the
player picks them per chat, and the app already puts them in the model's head:

> `Level 3 needs 225 XP to advance; the next threshold is 475 total, so 70 to go. Curve: 100 XP per
> level, each one ×1.5 the last. The level and its threshold are computed by the app: never state, set
> or restate a level or a target of your own.` … `One turn may move at most 225 XP; more than that is
> cut to the cap and the player sees the cut.`

Quoted rather than paraphrased — that is the generated text for a chat at 405 XP on `100 x1.5`, and
`tests/card-rpg-doc-test.js` rebuilds both sentences from the generator and fails if this prose drifts
from it. Because the text is generated from the ledger, restating figures in your card builds a second authority
the model has to reconcile, and the app wins the argument while the model writes a confused sentence.
Give the card the *judgement* ("an ambush survived is worth more than a rumour repeated") and leave
it the *numbers*.

**Propose in `<rpg_update>`, and only there.** One block, after the narrative and after any `<state>`
block, JSON inside, `reason` plus `changes` — and story prose never goes in the tag:

```
The bridge holds. Sera drags you back by the collar, and the Guild clerk writes a line
against your name without being asked.
<rpg_update>{"reason":"Held the bridge through a full night against the Tide","changes":[
  {"field":"xp","op":"add","value":150},
  {"field":"attributes","op":"set","key":"Standing","value":"Tidekeeper (probationary)"},
  {"field":"skills","op":"add","value":"Bridge defence (night watch)"}
]}</rpg_update>
```

| Field in `changes[]` | Ops | Value the app keeps | Kept when |
|---|---|---|---|
| `xp` | `add` · `set` | integer, magnitude ≤ 1000000; `set` ≥ 0 | always accepted; then clamped to the turn's cap, which every `xp` row in the turn shares |
| `attributes` | `set` · `remove` | `key` ≤ 48 chars, `value` ≤ 160 chars | always; `remove` needs only the key, and an over-long key or value is cut rather than dropped |
| `skills` | `add` · `remove` | string ≤ 240 chars | always; added only if that exact string is not already there, ≤ 80 entries |
| `inventory` | `add` · `remove` | string ≤ 240 chars | as `skills` |
| `notes` | `add` · `remove` | string ≤ 240 chars | as `skills`; the player sees this list as *Player notes* |
| `level` | `set` | string ≤ 40 chars | parsed always, **applied only while the chat's curve is `manual`**; under a curve the review shows it as refused |
| `xpToNext` | — | — | **never**: the parser does not know the field, so a change naming it is dropped silently |

Bounds on the block itself: the JSON inside is ≤ **8000 characters**, `changes` has **1 to 20**
entries, and the shape has to be `{"changes":[…]}` — a block that misses any of those is dropped
whole, not repaired, and the valid rows in it go with it. If a field is unknown or a value has the
wrong type, that one row is dropped and the rest survive. The `reason` is read at ≤ **400 characters**
for the review; the permanent log keeps ≤ **200**, so put the story fact first.

**Four ways a well-formed block goes nowhere**, none of them an error the player is told about:

* the chat's ledger is off, or its **Status suggestions** switch is off — the tag is stripped from the
  reply before the reply is stored, so nothing shows and nothing is offered;
* the reply is a **reroll**, a **replace-bubble** or a **continue** — the block is stripped and no
  review is created, because the turn it would attach to is not a fresh answer;
* the player has already **dismissed** that change in this chat — it is in the prompt as
  `REFUSED BY THE PLAYER, do not offer again in this chat: …`, and offering it again reads as not
  listening;
* the reply carries **more than one** block — the last one wins and the earlier ones are ignored.

**What approval does to your words.** An accepted change is applied to the ledger *and logged on the
reply that earned it* (`msg.rpgAward` carries `xp` — the amount that was actually applied, after
the curve and the cap — `from`, the total before it, `at`, the turn index, `label`, the change's own
short name, `reason`, `speaker`, and `cut`, what the cap refused). So the `reason` is the one line of
your prose that survives into the player's *Progress log* — write it as the event, not as a rules
citation. And never write `rpgAward`, `rpgStatus`, `xpBase` or `declined` in a reply expecting the app
to read them: the reply pipeline reads one tag, `<rpg_update>`, and nothing else, so those names in
your prose or in your own JSON are simply part of the sentence. Do not claim a change was applied
either; the prompt forbids it and the player has the counter-evidence in their own sheet.

**One class, on purpose.** The ledger is one XP pool with one derived level — no tracks, no
multiclass, no subclass — because a derived level is only checkable if there is exactly one total it
comes from. A second specialisation is a `skills` string (`Smithing (journeyman)`), and if the chat
is running an **authored world** the world's own class and trainings (`run.classId`, `run.skills` with
levels 0–5, raised by `[[skill:]]`/`[[teach:]]` against the card's catalog) are a *separate* system:
the two never share XP, a level in one says nothing in the other, and a card should not narrate one
ledger's numbers as the other's progress.

**Do not** put a block in `first_mes` or an alternate greeting: the greeting is not run through the
reply pipeline, so the tag is neither parsed nor stripped and the player reads raw JSON as your
opening prose. `mes_example` is a safer demonstration if you feel the format needs one — but a card
that shows an award in its examples teaches the model to hand out awards on sight, which is the one
behaviour the ledger's whole design is built to refuse; the example worth writing is the turn where
nothing was earned and the tag is **absent**.

## The persona editor: two boxes or one

The card keeps `description` and `personality` apart; this app's prompt reads one
persona string. The character sheet therefore has a switch, and the switch is a
question of *what you are looking at*, never a licence to rewrite:

| What you do | What is saved |
|---|---|
| Open the two fields and change one | that field, under its own name. The other goes back out as the author wrote it, byte for byte |
| Type in the one box, then open the two fields | your text is kept, as the description, with a note saying the card's `personality` is set aside — and **Use the card's two fields instead** puts both halves back, so the merge is reversible while the sheet is open |
| Type in the two fields, then go back to the one box | both halves joined, in the box, exactly as it says |
| Save while the one box shows the same text the two halves say | nothing about the persona at all — the halves stay halves, so a later look at the two fields shows what the card had |
| Save an unrelated field (a greeting, a scenario) | nothing about the persona, in either mode |
| Edit the one box into something new | the merged text becomes `description` and `personality` is emptied. This is the one deliberate rewrite, and the editor says so on the row where you make it |

Two things this mode does **not** do, both deliberate:

* it never folds the scenario out of a description. `description` may repeat
  `scenario` because the author wanted the sheet to say it twice, and an app that
  deletes a field for merely agreeing with another one is not preserving, it is
  copy-editing. (The merged one-box persona keeps the fold it has always had —
  a single string that recites the scenario puts it in the sheet twice, which is
  what the fold is for. It is narrow by design: a description that merely ends with
  the scenario's words inside a sentence is left exactly as written.)
* it never treats a field this app shortened as an edit the player made — see
  [what an export writes back](#what-an-export-writes-back).

## What an export writes back

An export is the card's own JSON with this app's changes laid over it. The rule for
every key this app owns is one sentence: **the character's value is written when it
is not what the card said at import, and nothing is written when it is.**

That second half matters as much as the first. Writing only values that differ from
*this app's* default — which is what an earlier version did — means a change back
to the default is written nowhere: a cleared `post_history_instructions`, a
placement put back to the sheet, compat switched off, a window reset to 0, an
instruction emptied all left the key out of the export, the preserved copy went on
carrying the author's value, and the next import put the thing you deleted straight
back into the prompt. So a cleared field exports its emptiness on purpose
(`"lore_compat": false`, `"lore_scan_turns": 0`, `"agency": ""`), and it wins over
the preserved copy because the merge only adds.

Two consequences worth knowing:

* an untouched card exports the author's bytes, including a value this app would
  never have written (`"post_history_placement": "middle"` stays `"middle"`, and a
  `lore_scan_turns: 99` stays 99 while the app reads it as 24);
* a character saved by v1.40.0 has no record of what its card said, so the export
  reads the ask off its preserved copy instead and applies the same rule — the
  clearing fix works for cards that were already imported.

## What the app can read about who is in the room

A card that holds several people can tell the app they exist, and the Scene bar (send
one away, address the next line to one person, stop the others narrating) appears by
itself. What it takes is a name used **as a speaker**, somewhere the app looks:

| the card writes | the app sees |
|---|---|
| `Mira: *leans on the doorframe.* "He is late."` in `mes_example`, each speaker named on her own line | everyone who speaks like that |
| a `Cast:` / `Characters:` / `Who is here:` heading with `- **Name** — who they are` bullets | everyone listed, even one who has not spoken yet |
| `[MIRA - "the tease"]` blocks in `description` | nothing — a heading with no speaker attached is prose to the app |
| `{{char}}:` on every example line, whatever the prose says | **one speaker.** A card that labels its three people as a single `{{char}}` is telling the app there is one person in the room, and no amount of "they are three distinct people" overrides that |

So for a multi-person card the useful edit is in the example block: name the speaker.
`{{user}}:` and `{{char}}:` are macros the app substitutes when it builds the prompt,
and using `{{char}}:` to mean "whichever of us is talking" loses the information before
the app ever reads it.

A player can always type the list instead — Chat settings → Scene cast — and a list
typed by a person wins over the card from then on: the app never overwrites it, not
even when the card changes and disagrees. That is the door for a card that structures
its people as prose or as bracketed blocks and would rather not be edited.

## Who decides what

Three parties can say something about a card: the author, this app, and the person
holding the phone. Where they overlap, the app lets the card arrange and refuses to
let the card take over.

| A card may… | because… |
|---|---|
| place its post-history text, set compat ordering, widen its scan window | these decide **how the card's own content is laid out** |
| set the six `horde_studio` authoring fields | they add prose inside the sheet this app builds |
| carry a prompt, and *ask* for it to be used | the text is the character's; **applying** it is the player's call |
| propose XP, attributes, skills and items in one `<rpg_update>` block | that is the ledger's front door; **computing** the level and **applying** the change are the app's and the player's, in that order |
| not replace the global prompt, not write this app's preferences, not mark itself approved | a card that can silence the rules it is judged by is not a card, it is a prompt injection with artwork |

## Limits

| Bound | Value | Why it is there |
|---|---|---|
| lore entries per request | 10 | four fat chapter summaries used to fill a 6-entry budget and out-rank the character |
| lore bytes per request | 5000 | ditto; a lone entry bigger than the budget is still sent, once, rather than silently dropped |
| chat-only lorebook | 6 entries / 2048 bytes | a per-chat book supplements the card's, it does not replace it |
| keyword window | 6 turns default, 1–24 allowed | measured on a 160-message chat; wider buys nothing past a few turns |
| one instruction field into the prompt | 600 characters | keeps a sheet from squeezing the transcript out of the request |
| one RPG proposal in a reply | 8000 characters of JSON, 1 to 20 changes, one block | a block that misses either bound is dropped whole rather than half-applied, and the player is not told — see [the ledger](#the-rpg-status-ledger-what-a-card-can-and-cannot-drive) |
| text this app carries from a card | 4000 characters per instruction field, 6000 for `system_prompt` | storage bound; over it the character is shortened, the card is left whole, and the import says which fields were shortened |
| source copy kept for non-destructive export | 2 MB of JSON, 200 levels deep, 60 000 values | above the size nothing is preserved and the character is told so at import; above the shape bounds the copy is kept short and every path left out is named at import and counted at export |

## Exchanging cards with other clients

* Import: `.png` (tEXt / zTXt / iTXt chunk, base64 JSON), `.json` (V1, V2, V3, top-level or `data`), and a JanitorAI bulk export. A card that declares V3 but puts its fields at the top level is read from the top level, and told.
* Export: PNG with the card JSON in a tEXt chunk, or `.json`. Both write the V2 fields at the top level **and** under `data`, because other tools read one or the other.
* `.charx`: not supported in either direction.
* A card that was opened and never edited exports byte-for-byte identical where this app models the field, and unchanged where it does not — types included, so a `"0.9"` that arrived as a string leaves as a string. Two exceptions, both reported rather than quiet: picture keys the app has no place for, and any structure past the shape bounds in [Limits](#limits).
* Deleting a lorebook empties it; it does not restore the author's copy. Deleting a *field*'s text sets that field; a card's untouched fields are never rewritten by an edit elsewhere.

## Versions this describes

Behaviour follows `character-card-spec-v2` (`spec_v2.md`, the V2.0 lorebook entry
comments) and `character-card-spec-v3` (`SPEC_V3.md`, the Lorebook and assets
sections), read 2026-09-10. Where a field means something only in SillyTavern, it
is named as such and not implemented from memory of that client's code.
