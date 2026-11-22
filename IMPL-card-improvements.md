# Implementation report — `FOR-APK-DEV-card-improvements.md`

**Against:** v1.39.112 (APK code 191) · **Shipped as:** v1.40.0 (APK code 192) ·
**Dates:** report opened 2026-11-21 with item 1 only, closed 2026-09-10 with all six.
**Follow-up:** the review of that release (`FOR-APK-DEV-v1.40.0-review.md`) is answered
in §9, shipped as v1.41.0 (APK code 193).

**Status:** items 1 to 6 implemented, tested and released. Item 1 was written up and
held for review first (`11266df`); items 2 to 6 followed in the same release, so this
report now covers the letter end to end. `CARDS.md` is the user-facing reference for
every field, placement, limit and default; this file is the record of what was found,
what was chosen, and the two places this app knowingly departs from the spec (§7).

---

## 1. Baseline observations: all six verified, two additions

Checked against the source the 1.39.112 APK was built from, not against the APK.

| letter's claim | result |
|---|---|
| `cardToCharacter` merges `data` over the top level, joins `description` + `personality` into one persona, keeps `scenario` separate; `characterToCard` exports the merged persona as `description` with an empty `personality` | **confirmed** — `store.js:781` (merge), the join at `store.js:806` and `837`, and `personality: ''` in the export at `store.js:1051`; the empty field is deliberate (a comment says why: joining tools would otherwise see the text twice) |
| `bookFromCard` retains `keys`, `content`, `enabled`, `constant`, Horde `stage`, and little else | **confirmed** — `store.js:542` |
| the imported card's `system_prompt` does not populate `systemPrompt`; the global prompt is used | **confirmed** — `systemPrompt: ''` on both import branches |
| `post_history_instructions` is read, but `charSheet` places it inside the earlier system message, before examples and history | **confirmed** — `api.js:711`, appended to the sheet parts. **There is no enable/disable setting for it** — the letter asked to check for one; the only placement setting in the app is `scenePlacement` for scene notes, which is a usable precedent for item 2 |
| `examplesToMessages` handles line-by-line speaker prefixes and `<START>`; macros are a subset; `{{original}}` added at prompt-build time in v1.39.112 | **confirmed** — implemented macros are `{{char}} {{user}} {{sub}} {{obj}} {{poss}} {{poss_p}} {{ref}} {{original}}` |
| lore uses a six-user-turn scan window, a 10-entry limit, a 5,000-byte budget; one first-ranked oversized entry is admitted | **confirmed** — `LORE_LIMIT = 10, LORE_BUDGET = 5000` (`api.js:275`), `LORE_SCAN_TURNS = 6` (`api.js:306`), and the special case is real: `if (out.length && bytes + r.cost > cap) return;` in `loreAdmit` (`api.js:421`) — the `out.length &&` guard is what lets the first entry through over budget |

Two things the letter did not state, found while implementing:

- **The card-prompt override already exists.** `api.js:1020` and `1223` both read
  `character.systemPrompt || s.systemPrompt`, so "use the card's prompt" is one
  assignment away at import time; what is missing is only the user's choice and the
  display. Item 3 is cheaper than it looks.
- **The editor described the post-history field wrongly.** Its placeholder said
  "Appended last, right before the reply is generated" — the sheet puts it *above*
  the examples and the transcript. Fixed as part of this change (`views.js:1798`),
  because item 2 is precisely about that placement and the wrong promise would have
  been load-bearing.

---

## 2. Shipped: item 1, non-destructive import and export

`cardSource` is kept per character (`store.js:668`, built by `_srcClone` at 624):
a JSON-safe copy of what the file said, in both places it said it, plus the
lorebook's own properties and one raw record per entry keyed by the id this app
minted for that entry. Export is `store.js:889`; the previous export survives
unchanged as `characterToCardBare` (`store.js:1047`) for characters with no source.

### The rule

"Unedited" cannot mean "equal to the raw field", because import does not copy
fields: it sanitises text with `plainText`, joins `description` + `personality`,
falls back to the first entry of `scenario_list`, trims and dedupes alternate
greetings. So the export **re-runs that same derivation over the preserved
source** and compares. Equal → the field goes back out as the card wrote it, type
included. Different → the live value is written into both the top level and
`data`, so no reader can prefer a stale copy.

### Behaviour, field by field

| case | result |
|---|---|
| unknown top-level / `data` keys, nested, arrays, numbers, booleans, nulls | survive with value **and type** (`talkativeness: "0.9"` stays a string; `fav: true` stays a boolean) |
| `description` and `personality` | kept as two fields while the persona box is untouched; an edit writes the merged text to `description` and empties `personality` (the app cannot split a single box back into two, and the old text is not lost — it is inside the string being edited) |
| `data.system_prompt` | preserved in the file, still not applied here |
| other clients' `extensions.*` namespaces | untouched; only `horde_studio` is rewritten, and non-`horde_studio` keys inside it survive |
| lorebook entry extras (`position`, `priority`, `insertion_order`, `scan_depth`, `use_regex`, `selective`, `secondary_keys`, `comment`, source `id`, entry `extensions`) | preserved per entry, **not honoured by the matcher** |
| entries reordered, deleted, added | unknown properties follow the entry; a new entry gets no invented author fields; a re-minted id loses preservation for that entry and never adopts a neighbour's fields |
| duplicate or absent source `id`s | no effect — the mapping does not use the source's ids |
| book-level settings (`scan_depth`, `token_budget`, `recursion_depth`, `name`, `description`, `extensions`) | preserved |
| a self-contradicting card (top level ≠ `data`) | imports `data`-wins and exports that one value in both places rather than preserving the disagreement |
| V1 card | fields kept at the top level and mirrored into `data`, exported as V2 (as this app always has, so top-level-only readers still find them) |
| V2 / V3 card | keeps its own `spec` and `spec_version` |
| pictures | see below |
| a character from before this version | exports exactly as before; nothing is invented to look preserved |

### Pictures and size

A `data:` URL is a megabyte in a string, and the app already carries the avatar
and the gallery, so the preserved copy leaves those leaves out and records where
they were (`store.js:747`). Export writes the app's copies back **at the card's
own key names** (`image_2` stays `image_2`). A picture the app never modelled —
a background, an image inside a lorebook entry — cannot come back, so the export
reports it (`store.js:770`, surfaced as a toast at `app.js:271`) instead of
claiming a lossless conversion. Sources over 2 MB are not kept at all, and the
import notes then say plainly that the listed fields are real losses on export
(`app.js:502`), so no reassurance is left standing that does not hold. Nothing
is truncated silently.

### Not claimed

`.charx` is not supported and was not made a requirement; exports are JSON. A
card imported from a PNG therefore comes back out as a `.json` file — the text
and structure are complete, the container is not. That is a known limitation,
not a silent one.

---

## 3. Shipped first: the note wording item 5 asked for

The notes had to change the moment fields stopped being lost, since they said the
app "does not carry" them — which reads as "the export will drop them too". They
now distinguish **kept but unused** from **cannot be kept**, in four places
(`app.js:413`): secondary keys, `insertion_order`, the other discarded book
fields, and the card's system prompt. Warn-only throughout; no import is blocked
and no card text is rewritten.

This was the wording for a build where those fields were kept and nothing more.
Items 2 to 6 changed what the app does with them, so the notes moved again — §5
lists the current inventory. The distinction the rewrite introduced is the one
that survived: a note never says a field was lost when it was only left alone, and
never says a field is used when it is not.

---

## 4. Tests

`tests/card-roundtrip-test.js` — 105 checks, invented cards only, synthetic V1/V2/V3
with unknown nested fields, extensions, a mixed-field lorebook, duplicate and absent
entry ids, image leaves, and a prompt-equality check that the preserved copy never
becomes prompt text (the letter's item 1 acceptance tests 1–5).

`tests/card-placement-lore-test.js` — 109 checks for items 2 to 6: the three
post-history placements in both request shapes and the never-twice rule, the three
system-prompt modes with `{{original}}` in each, `case_sensitive` / `selective` /
`secondary_keys` / `selectiveLogic` in the matcher, compat-mode ordering and
budget-trimming, the bounded scan window, unresolved-macro and malformed-field
import notes, the six instruction fields end to end (import, prompt, cap, export)
and the example-label parsing. Run against `API._charSheet`, `API.buildPrompt` and
`API.buildChat` rather than a stub, so a placement change has to move the real text.

`tests/lore-stage-test.js` (27) and the older import-note, round-trip and
speaker/example tests were extended rather than replaced; see §6 for the four whose
expectations were restated.

Full suite: **118 files, 0 failing**, plus `tools/generic-check.js` (the rule that no
real card content may sit in this repo) clean. `tmp/editor-smoke.js`, a fake-DOM
harness for the editor pane, is 18 checks green. It stays in the workspace and out of
the repo — `/tmp/` is gitignored, and the suite has no use for it: it exists to catch
markup that would otherwise only be noticed on a phone.

Two assertions in existing tests were rewritten because the behaviour they pinned is
now better, not because they were awkward:

- `altintros-test.js` expected the export to write the app's deduped 2 greetings. It
  now writes the card's own 3, untrimmed, and the app still *shows* 2 because it
  applies the same normalisation on the way in. Round-trip stability is asserted at
  both levels now.
- `import-warnings-test.js` needed its stub `Store` to attach a `cardSource`, or it
  was testing its own stub as "every card too large to preserve".

Two ad-hoc property runs during development, not checked in because they generate
fixtures at runtime: 300 random untouched cards (4,595 field comparisons — every
source field returned identical) and 250 single-edit cases (no edit disturbed any
other field).

---

## 5. Shipped: items 2 to 6

Each item below lists what the letter asked, what this build does, and where the
choice can be seen. The shared field home is `data.extensions.horde_studio`; every
one is optional and off by default, so a card written for another client behaves
exactly as it did in v1.39.112 unless it says otherwise.

**2 — `post_history_instructions` placement.** Three positions per character:
end of the character sheet (`'sheet'`, the historic behaviour, still the default),
after the history (`'tail'`), or not sent (`'off'`), stored as
`extensions.horde_studio.post_history_placement` and mirrored in the card on export.
In `'tail'` mode the text rides in the trailing system turn, *before* the app's own
continuation instruction, so a card cannot outvote the line that has to survive a
reroll; in the text-completion request it is appended after `Chat history:`. No
message is invented for the player, and the Prompt inspector shows the request as
actually sent — that is the check for "never twice", since a duplicated block is
visible rather than inferred. The old editor placeholder that promised "appended
last" was corrected in §2's note about the same field.

**3 — the card's own `system_prompt`.** Imported verbatim (subject to the
4,000-character carry bound), shown in full on the character, and applied through a
per-character three-way choice: your prompt, the card's, or both
(`system_prompt_source`: `''` / `'app'` / `'card'` / `'combine'`). `''` means "the
card said nothing", and takes the app's prompt. In `'combine'` the app's prompt goes
first and the card's copy has `{{original}}` removed — including a separator the
author left where the substitution used to be — because leaving it in would paste the
same paragraph twice; if nothing of the card's text survives that, the app's prompt
alone is used. `{{original}}` resolves to the global prompt at build time in every
mode, which keeps the definition the player set rather than letting a card redefine
it. An empty card field falls back to the global prompt, as the spec's own exception
allows.

**4 — the lorebook matcher reads its fields.** `case_sensitive` matches the casing
the author wrote, with word edges and the plural allowance kept for insensitive keys.
`selective` plus `secondary_keys` follow the V2 entry comment: a key from each list
has to be found — the letter's "AND of both lists" reading is what the spec's
boolean describes — and `secondary_keys` is ignored when `selective` is not `true`. A
`selective` or `case_sensitive` that is neither `true` nor `false` is treated as
absent and reported as malformed; a `selectiveLogic` is preserved, named on the entry
row and in the import note, and not honoured (§7).

`insertion_order`, `position`, `priority` and the book's `token_budget` are applied
only when the character's *Follow the card's lore order* switch is on, and only as
**where an admitted entry sits and what a tight budget discards** — who was admitted
stays relevance-ranked, because a book written for a client that scans the whole
history should not start losing entries to ordering here. Priority admits the
**highest** number first (V3 removes lowest-priority entries when trimming), with
recency as the tiebreak. `before_char` and `after_char` are the placements honoured;
the rest stay on the entry. The keyword window became a per-character number, 1 to 24
turns against the measured default of 6, and under compat mode a card's own
`scan_depth` (counted in messages) may narrow it but never widen it — the editor shows
the player's number and names the effective one beside it, so the narrowed value is
never silently written back.

**5 — silent text becomes a named warning; examples stop losing their shape.**
Unresolved macros are reported at import with the macro's name, the field carrying it
and up to eight names, generated from the resolver's own list, so the note cannot fall
behind the code. In the prompt itself the documented set is unchanged
(`char, user, persona, description, personality, scenario, original` plus the pronoun
macros); an unknown one is left literal and *named*, rather than emptied. Example
dialogue recognises a speaker label that is bulleted or emphasised (`<START>`,
`- {{char}}:`, `**{{char}}:**`), and slicing starts at the author's own colon so no
emphasis inside the turn is rewritten; an unrecognised line still joins the turn above
it. Nothing is discarded on the way in.

**6 — six instructions a card may leave for this app.** *Player agency*, *narration
and style*, *canon boundaries*, *story progression*, *stage controls*, *essential
information* under `agency`, `style`, `canon`, `progression`, `stages`, `priority`.
All off: no field, no added prompt text. Each one that is set becomes a labelled line
under `CARD INSTRUCTIONS FOR HORDE STUDIO:` at the end of the character sheet — inside
the sheet so the token count includes it — with macros expanded, cut at 600
characters where it enters the prompt and marked in the text when it is, while the
character and the card keep the whole text up to the 4,000-character carry bound. The
two numbers are different on purpose and both are said out loud: the import names the
bound when it bites, the editor says how much of the field reaches the model. They
round-trip through other clients as this app's extension keys. Entry-level
`extensions.horde_studio.essential` is this app's word for "a tight budget must keep
this", because neither spec defines one.

---

## 6. Four existing expectations that were restated

Not loosened — each was pinned to the old behaviour, or to a proxy.

- The tail-order assertions compared `msgs[0].content` and `msgs[1].content` joined
  together, which is true no matter where a trailing instruction is put, since that
  turn is itself `role: 'system'`. They now assert on the first system message only,
  which is the claim they meant to make.
- Two import notes used to say the app "does not carry" `selective` /
  `secondary_keys` / `position`; those fields are now modelled, so the notes name the
  ones that genuinely do nothing here instead.
- `card-roundtrip-test.js` used "no `position` on the exported entry" as a proxy for
  "no foreign fields". With `position` honoured the proxy is wrong, so the test
  asserts the real invariant: nothing from a neighbouring client's namespace comes
  back, `comment` included, and an unrecognised `post_history_placement` value rides
  out untouched while the app runs its own default.
- `altintros-test.js` and `nowbrief-test.js` needed fixture updates for the new
  character fields (`systemPromptSource`, `cardSystemPrompt`, directive text), and
  `import-warnings-test.js` / `import-notes-test.js` for the reworded notes.

---

## 7. Two places this app departs from the spec, on purpose

Both are written into `CARDS.md` rather than described as compliance.

1. **The card's `system_prompt` does not replace the global prompt by default.** V2
   asks applications to let a card's prompt override the global one; this app's
   global prompt carries the rules the mobile build runs on — output shape, continuity
   instructions, the style lock — and a downloaded card silently deleting them is the
   failure mode the letter was worried about in the other direction. The capability is
   there, per character, visible in the editor and in the Prompt inspector; what is not
   there is a default the player never opted into.
2. **`post_history_instructions` is not placed in the trailing system block by
   default.** That is where the spec's name puts it. The default keeps this app's
   historic position at the end of the character sheet so that cards imported before
   this release keep producing the same prompt; `'tail'` is the spec-shaped choice,
   and inside `'tail'` the card's text sits before the app's continuation instruction,
   for the reroll reason above.

Neither is hidden: the editor offers the choice and the inspector shows the result.

---

## 8. Migration

No migration step, and deliberately no recovery attempt. Characters saved before
this build have no `cardSource`; their fields were already dropped, and this change
does not guess at them — they export as they always did and stay fully usable. The
first re-import of the original file is what makes a character preservable, which
is what the import note says when the source is too large to keep. `cardSource`
travels in backups and duplicates, and is inert in chats: forking or exporting a
conversation never reads it.
conversation never reads it.

Items 2 to 6 need no migration either, because their defaults are the old
behaviour: `postHistoryPlacement: 'sheet'`, `systemPromptSource: ''`,
`loreCompat: false`, `loreScanTurns: 0`, `loreBookScan/Budget: 0` and six empty
directive fields (`store.js:208`). A character saved before this release therefore
prompts, places and matches exactly as it did, and an old character only picks up
a card's own choices by re-importing the card. Nothing in `Settings` was touched:
every switch here is per character, because a card is per character.

---

## 9. The follow-up review (v1.41.0): three defects and the request that stayed open

`FOR-APK-DEV-v1.40.0-review.md` came back with three defects and one unimplemented
request. All three reproduced on the release source (`3b70205`) with invented cards —
no transcript, no real card, no PNG needed — so all three were accepted and fixed
rather than argued with. `tests/card-persona-changes-test.js` (41 checks) is the
permanent pair of them, and `tests/card-placement-lore-test.js` grew the consent
half (109 checks to 114).

**Issue 1 — importing a card applied its `extensions.horde_studio.system_prompt_source`.**
`hordeCardChoices` wrote the author's value straight into `systemPromptSource`, the
field the prompt builder reads, so a card took charge of the system prompt on the
first request after import. It also quietly overwrote the player's own previous
answer, because the import path never asked whether one existed.

The fix splits one field into two. `systemPromptAsked` is what the card requested —
kept on the character, shown in the editor, exported back so the author's word
survives. `systemPromptSource` is what a *person* decided, and import leaves it
empty. `cardPromptMode` (api.js) reads the second, and falls back to the first only
through `Settings → System prompt → Cards may choose their prompt`, a preference
v1.40.0 already consulted but had no setting, no default and no documentation for —
which is also the dead `s.honorCardSystemPrompt` branch at the old `api.js:59`.
The preference means "a card that asked may have its way"; a card that never asked
is untouched by it, and a choice on a character outranks it.

Why the gate sits in `hordeCardChoices` and not in the importer: only
`cardToCharacter` turns that card key into a live field, and the other three keys
come from the same call. Placement, compat mode and the scan window decide how the
card's own content is laid out, so a card may set them; whose instructions run the
conversation is not that kind of field. The grant is never written into the card as
a new key — a key a card can set is a key a card can grant itself — so the
approval lives in this app's preferences, not in the exchange format.

*Caveat, deliberately not papered over:* a character imported by v1.40.0 keeps the
mode its card stamped, because there is no longer any way to tell that value from
one the player chose. Nothing is changed underneath it; the way out is the button
it never had — open the character, choose **Your prompt**, which now exports as an
explicit `"app"` so the refusal survives a round trip.

**Issue 2 — clearing a field could not survive an export.** `hordeCardFields`
emitted a key only when it differed from *this app's* default. A value moved back
to the default therefore wrote nothing, the preserved copy went on carrying the
author's value, and the next import restored what had just been deleted — a
cleared `post_history_instructions` came back into the prompt.

One rule now covers every key this app owns: **write the character's value when it
is not what the card said at import, write nothing when it is.** Import records
that moment as `cardAsked` (a copied snapshot, not an alias of the live
directives), and export compares against it. A card that never said anything still
exports nothing new, so the old non-default behaviour is kept for hand-made
characters and for fields the card left out, and an unrecognised author value
(`"post_history_placement": "middle"`) still rides out untouched. A character saved
by v1.40.0 has no snapshot, so the export reads the ask off its preserved copy
instead and gets the same rule.

**Issue 3 — the preserved copy discarded deep structures in silence.** `_srcClone`
returned `undefined` past 12 levels and filled arrays longer than 64 with `null`.
The `null` rule predates this release and has been the app's stated behaviour for
versions; what was wrong was the silence and the depth number.

Depth is now 200 (`Store.SRC_DEPTH`) and breadth 60 000 values (`Store.SRC_NODES`)
— bounds that exist only so a malformed or hostile file cannot use recursion to
exhaust the app's stack, far past anything a card tool has written. Anything past
either one is left out of the copy *and named*: `cardSource.gaps` holds
`path — reason` lines, `Store.cardSourceGaps` exposes them, the import notes say
the copy cannot hold part of this card and to keep the original file, and the export
says it again at the moment the user would rely on it. Arrays are copied whole. The
2 MB text bound is unchanged. `CARDS.md` states all of it next to the "never
damaged" promise, which is now scoped to the fields this app models.

**The open request — `description` and `personality` separately editable.** Import
already kept both halves (each exported as the card wrote it while the persona was
untouched), but the editor had one Persona box, and editing it merged both into
`description` and emptied `personality`.

`descText` and `persText` are now first-class fields, and the character sheet has a
two-mode switch: *one box*, exactly as before, or *the card's two fields*, which
edits each half apart. `persona` stays the joined string every prompt path reads,
so nothing downstream changed. The consequence of the merged path is now spelled out
in the editor's own hint instead of being a paragraph in a markdown file, and
`{{description}}` / `{{personality}}` resolve to their own halves when a character
is edited as two fields (both still resolve to the whole persona when it is one).
A record carrying the split flag without either field exports the merged text
rather than two empty strings — a shape that should not exist is not allowed to
cost anyone their card.

One thing worth keeping out of the next review: the first version of the gap report
printed the whole path, which for a card 200 levels deep is a kilobyte of
`.nested.nested.nested` in the middle of a sentence — correct, and useless.
`cardSourceGaps` collapses a repeated tail into a count
(`data.custom.lore.under ×200 — nested past 200 levels`) and keeps the head of the
path where the reader can find it, and the test pins the length as well as the
fact. The raw path stays on `cardSource.gaps` for anyone debugging a card.

**What the reviewer's own claims taught me to correct in the code, not the prose.**
The settings copy for the new preference first promised it would not touch cards
imported before it was switched on; the test that pinned the live semantics said
otherwise, and the live reading is the honest one, so the wording moved. And the
`honorCardSystemPrompt` fallthrough — kept from the old dead branch — applied a
card's prompt to *every* card once the switch was on; `cardPromptMode` now answers
only an ask. That one was caught by `card-persona-changes-test.js`, not by the
review, which is what a regression test is for.

---

## 10. The second review (v1.41.1): three edge cases in the editor I had just added

`FOR-APK-DEV-v1.41.0-review.md` accepted all four v1.41.0 fixes — and then found
three edge cases inside the thing I had built to answer the fourth request. All
three reproduced against the released bundle: A and B through a simulated DOM
driving the shipped handlers, C in one line of store code. None of them needed a
real card, and none of them were hypothetical: two of them destroy text.

**A — the mode switch discarded unsaved typing.** `splitFromCombined()` returned
early whenever the card had halves, so typing in the one box never reached the two
fields; switching back called `personaJoin()`, which overwrote the box with the
stale halves; saving exported the stale halves. The user's own sentence was gone
and nothing said so.

The switch now reconciles instead of re-labelling: if the box and the halves
disagree, the text in view wins, it is kept as the description, the card's
personality is set aside, and a note next to the boxes says exactly that — with
*Use the card's two fields instead* to undo it, because the pre-merge halves are
held for as long as the sheet is open. Typing in either representation keeps
appearing in the other (`personaJoin` on every input in the halves), so the box can
never show a lie about what will be saved.

**B — saving an unrelated field collapsed the split shape.** `collect()` wrote
`descText = persona, persText = ''` on every save made while the one box was
showing, edited or not. So fixing a greeting quietly undid the two fields, and the
next look at them showed a description holding both halves and an empty
personality — and *that* save exported the collapse.

An unchanged save now changes nothing about the persona: when the box says what the
halves already say, the halves are written back untouched and `personaSplit` keeps
the value it had. The documented merge only happens on a real edit of the merged
text, which is what the on-row warning describes. The reviewer's phrasing is the
rule: a save may not answer a question nobody asked.

**C — split export deleted a description equal to the scenario.** The split branch
ran `stripDuplicateScenario` over the description *before* comparing it with the
card, so a card whose `description` is verbatim its `scenario` exported
`description: ""` on merely opening the two-field editor. The fold belongs to the
merged shape — one string reciting the scenario puts it in the sheet twice — and a
field edited as itself is not that case. Both split paths (with a source copy and
without one) now write what the character holds; the merged fold is unchanged, at
its existing narrowness, and is tested at both edges.

**On the tests.** Findings A and B are handler behaviour, so no source-text
assertion could have caught them and a store-level test still cannot.
`tests/editor-smoke-test.js` grew a fake DOM that keeps one node per selector,
seeds each field from the markup the view actually wrote, and fires the shipped
listeners — `Views.editor` → click the switch → read the textareas → click
*Save character* → the object handed to `App.saveCharacter`. That is what found the
`parentNode` climb in my own switch handler (now an id lookup) and it is the
closest this repo can get to a UI test without a browser: Playwright is not
installed here, so no device-level claim is being made, and the review's
"include a full UI/browser or device test where possible" is answered with a
simulated DOM and the limitation named.

**Restated expectations.** Two of my own v1.41.0 assertions in
`card-persona-changes-test.js` were wrong about the merged fold — they expected it
to fire on a description merely *ending* with the scenario's words, which the rule
has never done (it needs a paragraph break, or nothing else at all). They now
assert the fold at the boundary it is defined at, in both modes, rather than the
boundary I had imagined. Nothing else in the suite moved.
