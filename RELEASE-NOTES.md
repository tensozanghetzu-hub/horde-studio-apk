**You do not need to uninstall for this one.** v1.42.2 is signed with the same key as
v1.42.0 and v1.42.1, so Android installs it over the top and every chat, character and
setting stays where it is. Install from inside the app: **Settings → App updates →
Check for update**, or run the APK file itself. Everything in this release is
JavaScript, so a phone on v1.42.1 or v1.42.0 also picks it up as a small web download.

The exception is two releases old, and it is still true: a phone on **v1.41.1 or older**
has no update path across the key rotation done in v1.42.0. That one still needs
**Settings → Data → Backup**, uninstall, install, **Restore**, and a re-typed API key.
`MIGRATION-signing-key.md` is that walk-through. If you are already on v1.42.0 or
v1.42.1 you are past it — do not uninstall a working app to "make room" for an update it
accepts normally.

**What changed.** Four things, all of them about the app saying what it actually did.

1. **The Lore screen's excuse is now true.** An entry that was left out of the prompt
   because the *10-entry limit* was full could be reported as “matched, but over the
   5000-byte budget” — with 99 % of the budget free. Which entries went in was always
   decided correctly; only the explanation was wrong, and the explanation is what an
   author edits. The screen also stops recommending a bigger byte budget when the entry
   limit is the ceiling that is full. This is the bug a research handoff sent in,
   reproduced against the shipped build before it was fixed, and it is now pinned by a
   test that inverts the book order — plus the counter-case that rules out the obvious
   wrong fix.
2. **A PNG with more than one copy of a card tells you which one it read.** The app has
   long preferred the modern `ccv3` chunk over the older `chara` one, whatever order the
   file holds them in, so a stale V2 copy cannot shadow a V3 card. It never *said* so.
   Now the import notes name the copies it ignored, say when the ignored ones disagree
   with the one it kept, and count a damaged or undefined-keyword chunk instead of
   stepping over it. Nothing about how a card is chosen changed; nothing in your file is
   touched.
3. **A card's own oddities are reported at import, not settled in silence.** A key
   written twice inside one object (the card spec calls that undefined behaviour, and
   every reader picks a side — this app keeps the last, like `JSON.parse`) and a number
   no reader can hold (`1e999`, a 20-digit integer) are both named in the notes, with
   the path in the file. Refusing such a card would break files that are fine, so the app
   reads them and tells you what it decided.
4. **The world sheet shows what the story remembers.** In a Horde World run the HUD line
   now reads *how many facts are in memory and how many have been superseded, none
   deleted · what last turn's prompt spent on state, memory, lore and history · how many
   things the ledger refused*. It is the run's own record, so it costs no generation and
   cannot flatter itself. Alongside it, a fact's bracketed number in the referee's
   briefing is now labelled for what it is — the turn the story last relied on it, which
   is not the turn it was learned.

To keep the first three honest rather than plausible, there is a new kind of test in the
suite: a card is now read twice, once by the app and once by an independent parser
(Python's own JSON and PNG readers, not a copy of our code), and the two must agree on
which chunks exist, which carry a card, how often a key repeats, how many numbers are
really in the file, which of them a reader cannot hold, and what the card is worth field
for field — numbers compared as the 64 bits they are, since Python and JavaScript print
one double differently and both are right. Where they agree, “nothing was lost” is a
measurement.

- App version: 1.42.2 (code 197)
- Signed with certificate `a1b0e42310b63444…` (`keytool -list` form
  `A1:B0:E4:23:…`; verify any build of ours against it with
  `apksigner verify --print-certs`)
- Android 7.0 (API 24) and up
