**Nothing to install.** v1.48.9 is signed with the same key as v1.42.0 through v1.48.8 and every
change is in the interface layer, so **Settings → App updates → Check for update** brings it (the
app also applies it by itself on the next start). The APK is attached for a phone that has never
had Horde Studio on it.

The one-time exception is still behind you unless it is not: a phone on **v1.41.1 or older** has
no update path across the signing-key rotation done in v1.42.0, and needs **Settings → Data →
Backup**, uninstall, install, **Restore**, and a re-typed API key. `MIGRATION-signing-key.md` is
that walk-through.

## Your exported chat now shows the level ledger, not just the story

**What this fixes is a question the app could not answer about itself.** You can run forty turns of a
card with RPG status on, export the chat, and read back nothing but prose. One player did exactly
that: the card had been printing its own `[Level: 2] [Exp: 40/60]` lines all the way through — a
counter that froze for eight turns, ran to `280/40` without ever levelling, then quietly restarted —
while the app's own ledger, the real one, said 0 XP because nothing had ever been approved. The
export could not tell those two apart, because the level line lives in the story and the ledger lives
somewhere the exporter never looked.

**Now the transcript says what was recorded.** At the foot of the exported file (Markdown *or* plain
text, wherever you export to) there is a **RPG ledger** block: the curve that chat was running on,
exactly as you typed it, the level, the total, what is left to the next one, your cap per turn, and
the four counts that matter — how many changes you approved, how many proposals are still waiting for
you, how many you dismissed, how many moved no XP at all.

**And each reply says what happened to it.** A reply whose approval earned XP carries a line under it:
the amount, what the story said it was for, who granted it, and the total and level the log adds up to
at that point. A reply holding a proposal you never reviewed says so, and names what it was offering —
which is usually the answer to *why is my bar not moving*. An approval that changed a skill or an
attribute and no XP says that too, instead of looking like nothing happened.

**Two sentences that settle card trouble on the spot.** If the story text is printing level or XP
lines of its own while the ledger says something different, the export counts them and says plainly
which number is the app's — that is what a card that demands its own status block does, and it used to
be invisible from outside. And if a reply still carries a raw `<rpg_update>` block, the export names
it: the app only reads that tag in a generated reply, so a leftover one came from a greeting, a hand
edit or an import.

**Quiet where it should be.** A chat that never turned RPG status on gets no ledger block at all. If
you switched it off partway, the export says that too, and whether any awards are still sitting on the
replies.
