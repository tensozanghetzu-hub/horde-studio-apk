**Nothing to install.** v1.48.7 is signed with the same key as v1.42.0 through v1.48.6 and every
change is in the interface layer, so **Settings → App updates → Check for update** brings it (the
app also applies it by itself on the next start). The APK is attached for a phone that has never
had Horde Studio on it.

The one-time exception is still behind you unless it is not: a phone on **v1.41.1 or older** has
no update path across the signing-key rotation done in v1.42.0, and needs **Settings → Data →
Backup**, uninstall, install, **Restore**, and a re-typed API key. `MIGRATION-signing-key.md` is
that walk-through.

## Your level is now computed, not suggested

The RPG status ledger has been in the app for a while, and the honest summary is that you could
not rely on it. Two things were wrong, and they were wrong together.

**The model could set your level.** It was asked not to, and nothing stopped it. A reply could
propose "level 999" — or "level ∞" — and if you pressed Apply, the app stored that as your level,
in your ledger, written by its own hand. Now the level is *computed*. You choose an XP curve once,
in the same place you already edit your status — **⋮ → RPG status → Level curve** — and the level
follows your XP total: `100` for one hundred XP a level, `100 x1.5` for a ladder that grows by half
again each step, `100,150,300` for steps you name yourself. A proposal that tries to set a level is
refused, and the refusal is shown to you rather than swallowed, so you can see what was asked for.

**Your bar never moved.** The "XP target for next level" was a number you typed once and nothing
subtracted from it, so a chat at 12 XP, at 88 XP and at 188 XP each kept telling the model "target
100" — and the model, being told a target, wrote a level to match it. The target is derived from
the curve now, on every change, and the chat list and the ⋮ row read it off the same arithmetic, so
what you see is what the rules say and not what a sheet remembered from the first week.

Choosing **manual** (which is what every chat is on today) keeps it exactly as it was: your own
level words, your own target, nothing computed over what you typed. Nothing in this update touches
a chat until you set a curve in it, and progression stays per chat — a character does not carry one
campaign's numbers into another, and two chats with the same character can run on different systems.

**A cap that exists.** Alongside the curve there is a per-turn ceiling, and it is the same number
the model is told. Left alone it means "one level's worth of XP a turn", which is what stops a bar
lurching forward while the scene described nothing worth that much; write `max:20` if you want a
different rule. If a reply asks for more than the cap, only the cap is applied and you are shown
both figures — before you press Apply and after. Two rewards in one message draw on one budget, not
two, so the cap means what it says.

**When you say no, that is now on the record.** Proposals are stripped out of the reply before the
reply is kept, which meant a dismissal left no trace at all: the same "+10 XP for the errand"
would come back the next turn, and the turn after that, politely, forever. **Dismiss** now records
what you refused and tells the model it was refused, so it stops asking; the refused list is visible
in your status sheet and in the review, so you can see what the app is holding on your behalf.
**Later** still means later — nothing is written, the row stays in the chat, and if you change your
mind the proposal is exactly where you left it.

## Everything else in this version

- **The rules you see are the rules that run.** This is the third time this month the app has had
  the same bug in a different costume: something is stated to the model in one place, enforced (or
  not) in another, and the two drift. The curve, the cap and the refusals are computed once and
  read from that one place by the prompt, the review sheet, the status sheet and the save, so the
  sentence the model is given and the number you are shown are the same number.
- **Your old chats read exactly as before.** No migration, no recompute, nothing adopted on your
  behalf: a curve only ever applies to a chat where you asked for one.
- **What this still does not do.** The ledger is still a running total, not a history. So an
  *edit and resend* that deletes the turn which granted an award leaves the award in place, and a
  group chat cannot be audited back to the message that earned a level. Keeping a record per award,
  and checking the total against it when a chat opens, is the next release; it is deliberately not
  squeezed into this one.
- **Measured, not asserted.** The two test files driving this put the real sheets through their
  paces — typing a curve, saving, re-opening, seeing the field come back in the shape the parser
  reads, then pressing **Apply** and reading what actually got stored. 43 checks on the UI path and
  the maths, and 11 deliberate breakages aimed at exactly the promises made above (a trusted model
  level, an enforced cap nobody mentions, a per-line budget, a dismissal that says nothing): all 11
  are caught. The whole suite is 140 files, 0 failures, with 87 registered breakages all killed.
