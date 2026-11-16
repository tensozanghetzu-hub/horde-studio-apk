# How fixes are written in this project

## The rule

**A fix targets a class of problem, never a card.**

Every change must satisfy all four, or it is the wrong change:

1. **It names no card.** No character name, no card title, no line of card prose,
   no fandom term — in code, in a prompt, in a comment, in a test fixture.
2. **It fixes the cause, not the symptom.** If a card produced a bad chip, the
   question is "what made this shape produce a bad chip", not "how do I stop
   this chip".
3. **It leaves every other card as it was.** A card that worked before must work
   after. If the fix changes behaviour for a card that was already fine, that is
   a regression, not a trade.
4. **It helps anyone, not only the reporter.** The same bug is in every card of
   that shape — every import of that format, every chat of that kind. Fix all of
   them or the fix is incomplete.

Corollaries the user has stated directly:

- **Import problems are fixed for all imports.** Never special-case one file
  format, one provider's export, or one card's quirks.
- **Chat problems are fixed for all chats.** Never patch one conversation's
  state; change the thing that produced it.
- **Present and future cards both count.** A fix that works for today's cards
  but would break a card written next month is a failure.

## How it is enforced

`tests/generic-check.js` is the gate. It runs before every release and fails on:

- **Derived card names.** Every card on disk — `.json`, `.png` and `.charx` —
  is read for its name, its author and the names in its own cast rota. Any of
  those words appearing in shipped code fails the release. The list is derived,
  not maintained by hand, so dropping a new card in for testing forbids its
  names from that moment.
- **Card prose.** Every string of 80+ characters in a card is compared against
  the shipped source in 60-character windows; a match fails.
- **A manual list** of names from past testing, kept as a second net.
- **Card-word false positives.** A word the app itself uses constantly is
  vocabulary, not a name — "Your Wife (Mara)" must not forbid the word "your".
  The shipped code is its own dictionary for this.
- **Build isolation.** The build pipeline may not read a card folder at all.

The test suite is the second half of the gate: every bug that was reported is
reproduced from the *shape* of the card that produced it — a field block, a
rota, a quoted label, a sample-then-opening order — with invented names.

## What this means when a bug is reported

1. Reproduce it with a shape, not with the card.
2. Find the general cause in the code.
3. Write the fix so the same shape is handled everywhere it can occur.
4. Add a test built from the shape.
5. Run `tests/generic-check.js` and the full suite; both must be clean.
6. Only then bump, build, publish.

If a fix cannot be made general — if it genuinely only works by knowing one
card — then it is not a fix, and it does not ship.
