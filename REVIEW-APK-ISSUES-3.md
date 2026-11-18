# Report on `APK-ISSUES-3.md`

Read against `2e80aa0` (v1.39.110). Every claim was re-derived from the source and
measured with probes in `tmp/`; nothing here is taken on trust from the report.

**Verdict: the report is accurate on all five items.** Every line reference checks
out, every quoted snippet is real, and its two most important findings hold up as
stated. But it is incomplete in one place, overstated in another, and misses three
consequences of the very coupling it identifies. Those are below.

---

## What the report gets right

| # | claim | verified |
|---|---|---|
| 1 | examples double-label every assistant line | **confirmed** — reproduced |
| 2 | `addressedTo` is a one-shot, never persisted | **confirmed** — 9 sites, all transient |
| 3 | three windows open on one history in one call | **confirmed**, and understated |
| 4 | a message window is not a turn window | **confirmed** — 4 vs 19 turns |
| 5 | the comment describes a window that is not there | **confirmed** — 5× wrong |

### 1, reproduced

A generic three-speaker narrator card, no cast in the session:

```
You:        *I put the lantern down.*
The Keeper: Brannoc: "You made good time."
You:        "The tunnel was shorter than the map said."
The Keeper: Mera: "The map is old. The tunnel is not."
The Keeper: *Neither of them looks at the door at the end of the hall.*
```

The report's diagnosis of *why* is exact: `examplesToMessages:178` strips only the
`{{char}}:` prefix and leaves the inline label in the content; `buildChat:977`
prefixes every assistant message with `character.name`. `splitSpeaker` is called at
`1001` — thirty lines *later*, on history it was never pointed at — and at `2228`
for the summariser. Both call sites are downstream of the assembly.

`splitSpeaker` is the correct resolver and already has the hard half built: two
passes so that a label nearest the prose wins, and fuzzy matching on first token.
It cannot currently help the examples, though, and for a reason the report does not
mention — see "what the report misses".

### 3, measured and understated

On the 160-message Hogwarts transcript:

```
lore window     : 20 messages, 47,259 chars  (covers 4 player turns)
history window  :  8 messages, 21,040 chars  (covers 1 player turn)
```

The report says "2.2× more history". By characters it is **2.2×**; by *turns* it is
**4×**. And the direction matters more than the ratio: the lore selector is looking
11,815 tokens of context back through a history window the request trims to about
6,000 tokens of budget. It is choosing which facts to inject into a conversation
from a stretch of conversation that has since been discarded.

The report's framing — "three consumers answered 'what is recent' three ways" — is
right, and the measurement is right. Its stated *mechanism* ("the lore selector
reasons over 2.2× more history than the request carries") reverses the dependency:
the lore set is fixed before the history is trimmed, so it is not over-reasoning
from extra context, it is reasoning from context that will not survive. Same
defect, different consequence, and the difference decides how to fix it.

---

## What the report misses

### A. Item 1's proposed fix is good, but `splitSpeaker` cannot do it today

The report recommends labelling each example line "with the speaker the card names
for it", and points at `splitSpeaker` as the machinery. `splitSpeaker:1046` reads
its roster from `session.sceneCast` and bails to the card's own name when the cast
is empty:

```js
var cast = session && Array.isArray(session.sceneCast) ? session.sceneCast : [];
...
if (cast.length < 2) { ... return { name: fallback, text: body }; }
```

An example block is assembled **before** a chat exists — it is card data, not scene
data. In a fresh chat the cast is `[]` and `splitSpeaker` returns the card name,
which is precisely the bug. I verified the same output with a 2-name cast and with
none: identical, because the example text is never passed through it at all. So the
fix as written needs a resolver that does not depend on `session` — derive candidate
speakers from the card's own examples, or accept any `Name:` label near the start of
a line. Naming the right function is not enough; it needs a different signature and
a different source of names.

### B. The stacked label is also in the transcript path — and only for some reason

`buildChat:1001` labels assistant history with `sp.name + ': ' + sp.text`, and
`splitSpeaker` strips a *recognised* label nearest the prose. When the cast has
fewer than two names it only strips the card's own name. So a card with inline
labels reaching a chat with no cast keeps `Brannoc: "..."` inside the turn and gets
`The Keeper: ` in front of it. That is item 1 again, one layer down: it is not an
example-block bug, it is *label handling being gated on session state that may not
exist yet*. Fixing only the example assembly leaves this.

### C. The three-window split has a user-visible consequence the report does not mention

Item 3 is presented as "nothing is broken". It is, in one case. `styleLock` sizes
its evidence from the **trimmed** history, so the amount of evidence depends on
reply length. Same habit, same rate — 6 asterisks in every reply, which is under
the 12-per-reply trigger and so can only be caught by the window rule:

```
replies ~  407 chars -> 40 messages kept, 180 asterisks in window | styleLock FIRES
replies ~ 1240 chars -> 40 messages kept, 180 asterisks in window | styleLock FIRES
replies ~ 3200 chars -> 16 messages kept,  96 asterisks in window | styleLock FIRES
replies ~10900 chars ->  4 messages kept,  24 asterisks in window | styleLock QUIET  <-- habit missed
replies ~21400 chars ->  4 messages kept,  24 asterisks in window | styleLock QUIET  <-- habit missed
```

`trimHistory` has a floor of 4 messages. Once replies are long enough to hit it, the
window stops growing and the star count becomes a function of reply length. A card
that writes long replies — the exact cards v1.39.108 was built for — can carry an
identical habit and get no lock at all. On the real Hogwarts chat the margin is
real: 4 replies × 233 average asterisks = 932 against a threshold of 20.

The fix in item 3 ("one window, passed to all three") resolves this, but the report
files the bug under *consistency*. It is a correctness bug in the one consumer that
acts on what it measures.

### D. Item 4's "measure in characters" is the weaker of the two options offered

The report offers turns *or* characters. Characters is the wrong choice for the same
family of reasons as item 3: it makes coverage depend on reply length, and a
narrator's replies are the long ones — so the window would shrink exactly on the
cards that need reach. Counting back to the *n*-th user message is stable across
cards and across reply length. Of the two options, take turns.

---

## Corrections to the report's own framing

- **"2.2× more history"** is 2.2× in characters, **4× in turns**. And the causal
  direction is reversed: the lore window is not watching a longer present, it is
  watching a past the model has already been cut off from.
- **`api.js:273-276` (item 5)** — the comment is stale, yes. The constant is not
  wrong; the comment is. I chose 20 after measuring the real chat at windows 4, 10,
  20 and 40 and finding the intended entry admitted at all four; 20 was taken for
  headroom over 10. That reasoning is in `NOTES.md` for v1.39.109 and should be in
  the code, which is the report's actual point and a fair one.
- **The suite count** says 114 files; there are 115 now (`lore-selection`,
  `lore-stage` and the rewritten `lore-diagnostics` among them). Harmless, but the
  document is dated to a build and should carry that build's number.

---

## On the disclosed item that is worth more than a rename

The report lists the bytes/code-units mismatch as "not worth a patch; worth a
rename or a comment". The measurement that licenses that is ASCII-only: 10 bytes
in 10,738. For a card using typographic punctuation the ratio is ~1.26 by
character class, and UTF-8 costs 3 bytes for quotes/dashes/ellipses:

```
“Quoted” — with – dashes… and ellipses.   39 code units / 49 bytes = 1.26×
```

Because admission is *first-fit in rank order*, the overrun does not scale the
budget evenly — it lets the later, smaller entries through and evicts whichever
large one happened to land past the line. So on a curly-quoted card the same book
can admit a different set with no change to the card or the chat. The report is
right that it is not urgent and right about the rename; I would add that it is not
merely cosmetic, because the failure is non-monotonic.

---

## What I would do, in order

1. **Item 1 + B together** — one label resolver, sourced from card data rather than
   `session`, applied to both the example block and assistant history. Doing 1
   alone leaves the transcript path.
2. **Item 3, then D** — one window per request, counted in turns, passed to lore,
   trim and styleLock. This closes C as a side effect, which is the only item on
   the list that silently changes what the model is told to do.
3. **Item 2** — persist `lastSpeaker`/`addressedTo`, emit beside the roster, allow a
   standing "Everyone". Larger than it looks: nine reset sites exist to keep the
   one-shot honest and each needs a rule for what happens when the party changes.
4. **Item 5** — carry the reasoning into the comment. Five minutes.
5. **Bytes** — rename `LORE_BUDGET` to say what it measures, or measure bytes. Low
   priority, but the non-monotonicity is worth a note.

Nothing here is a card problem. All five are general and all five reproduce on
invented cards.
