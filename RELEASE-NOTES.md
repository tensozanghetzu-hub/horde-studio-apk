**You do not need to uninstall for this one.** v1.47.0 is signed with the same key as
v1.42.0 through v1.46.0, so Android installs it over the top and every chat, character
and setting stays where it is. Install from inside the app: **Settings → App updates →
Check for update**, or run the APK file itself. Everything in this release is
JavaScript, so a phone on v1.42.0 or newer also picks it up as a small download and
needs no APK at all.

The exception is seven releases old, and it is still true: a phone on **v1.41.1 or
older** has no update path across the signing-key rotation done in v1.42.0. That one
still needs **Settings → Data → Backup**, uninstall, install, **Restore**, and a
re-typed API key. `MIGRATION-signing-key.md` is that walk-through.

## Your card's regex lore keys are read now — if you say so

Some cards write a lorebook entry whose keys are regular expressions rather than words:
`\bVlad(?:'s)?\b` catches *Vlad*, *Vlad's* and *Vlads* where the plain string would
catch one of them. Until this release the app carried `use_regex` in and out untouched
and matched the key as literal text, because the only thing an import has to go on is
the card asking. That is no longer the whole answer, and it is still not a licence: the
field is read **when the switch in Settings → System prompt is on**, and the switch
ships off.

**Settings → System prompt → Cards may use regex keys**, off. And when a card that sets
`use_regex` arrives, the import note now tells you: *this card's lore keys are regular
expressions, and this app does not run a card's pattern until you say so — switch on
"Cards may use regex keys" in Settings → System prompt.* A card cannot approve itself,
for the same reason its `system_prompt` is a choice and not a default: its keys are
user data, not code.

What "on" means, precisely:

- An entry whose `use_regex` is the boolean `true` has its keys compiled and matched
  against the recent transcript, not against your message alone. A `use_regex` written
  as `"true"` (a string) is not `true` — no coercion, no guessing at an author's typo.
- `/harbour|the port/i` is unwrapped so the **flags the author wrote** run. A key that
  merely begins with a slash keeps its slash; `/home` is not treated as a delimited
  pattern.
- A pattern that does not compile, or whose shape can cost exponential time to fail —
  `(a+)+b` — makes the entry a **non-match**, exactly as the card spec requires. It is
  refused before it is ever run, by the same check the display scripts use, because this
  runs on the phone every turn. No time limit is involved, so a slow day cannot turn a
  refusal into a hang.
- A `constant` entry stays constant even when its pattern had to be refused. The spec
  says a regex entry should ignore `constant`; obeying that would let a badly written
  key delete an always-present fact, which is the one outcome an author cannot see
  coming. `CARDS.md` says so in writing.
- `secondary_keys` is ignored while `use_regex` is true, because the spec says so, and
  the Lore screen says it too.

Patterns compile **once per key** and are cached, so the first turn pays and every later
turn does not: 400 regex entries scan in tens of milliseconds on this machine, and the
same 400 entries cost less on the second turn than the first.

## Lorebooks may chain — capped, and never at the front of the queue

`recursive_scanning` is a book asking that an entry which came in be read again, so a
second entry keyed on something *inside* it can come in too. The card spec defines the
flag and no behaviour, and SillyTavern's own documentation says unbounded recursion can
loop on a circular reference; so this is the second switch in the same settings group —
**Cards may chain lore entries**, off — and with it on:

- **three hops, whatever the book asks for.** A `recursion_depth` of 9 is clamped; 1
  means 1. A card that asks for unlimited gets the app's bound, not the number it
  wrote.
- **only what the chat matched is read**, and only its best twenty entries. A chain is
  built from the conversation, not from the whole book.
- **an entry is admitted once**, so a circular reference terminates.
- **a chained entry never displaces one the chat matched.** It fills space the
  conversation left over, and the ranking for everything the chat brought in is
  byte-for-byte what it was. That is the same rule recall ships on: reshuffling what
  the model is shown is what forfeits the stable prompt prefix and its cache discount,
  and a lorebook feature is not allowed to cost you that.

Neither switch changes anything for a card that did not ask. A book with no `use_regex`
and no `recursive_scanning` gets the prompt it got yesterday, byte for byte — the
release ships with that checked, not asserted: 16 prompt shapes across two builders,
four and forty turns and empty and full books, compared against the previous release
(`node tools/compare-lore-prompt-against-release.js`).

## The Lore screen says which way each one went

A quiet entry is only fixable if you can see why it is quiet, so every new field is
visible where it bites — on the row, and in the summary line, from the engine's own
record rather than from the screen re-deriving it:

- **regex keys, switched off** — the amber badge on an entry whose card asked for
  patterns, and the import note's own advice: switch it on, or leave it off and know
  that its keys are being read as plain text.
- **matched on a pattern**, on the rows where a compiled key is what fired.
- **chained from another entry**, on a row the conversation never mentioned.
- **secondary_keys not applied**, on the one field the spec says to ignore.
- *this entry's `[unclosed` pattern was refused, so it cannot match — it is not a
  regular expression JavaScript can compile*; and for the exponential shape, that the
  cost is the reason rather than the syntax.
- the summary counts it all: *7 entries use regex keys, switched off in Settings →
  System prompt*, or *and 2 patterns were refused*; and when chaining is on, *this
  book also chains: 2 entries came in from another entry rather than from the
  conversation (up to 2 hops, ranked behind everything the chat matched).*

## Checks

`tests/lore-card-features-test.js` (100 checks) and `tests/import-warnings-test.js`
(44). The new suite reads both ways at everything it can: the switches and what off
means, the pattern compiler and its two refusals, the chain bounds including a
two-sided check that the twenty-entry pool is a real pool, the import and export
bytes, and the rendered screens — Settings is built in a stub DOM and the two toggles
are clicked, and the World screen is rendered through the real `Views.world` so its
HTML is asserted against what `buildChat` would actually send. That rendered check found
two things a grep could not: a badge the view computed but never showed, and a
`loreDiagnostics` call that forgot to pass the player's settings — which would have
made the screen lie to exactly the reader it exists for.

The mutation harness moved out of `/tmp` and into the repo, because a quality bar that
lives in a scratch file is not a bar: **`tools/mutation-check.py`**, now 12 deliberate
breaks for this release — the gate that lets a card approve itself, the refusal of the
exponential shape, both chain bounds, chained rows out-ranking the chat's own, the
importer's `use_regex`, both off-by-default switches, the readout's settings argument,
the badge line, the pattern count and the import note. `12 killed, 0 survived, 0
anchors lost`. `tests/mutation-harness-test.js` runs on every sweep and checks the
harness itself: every anchor matches its source exactly once, every named suite still
exists, and the list covers `api.js`, `store.js`, `views.js` and `app.js`. A stale
harness would print "every break is caught" while replacing nothing, which is the
failure mode worth engineering against. Full sweep: **135 suites, 0 problems.**
