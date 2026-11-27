**Nothing to install.** v1.48.8 is signed with the same key as v1.42.0 through v1.48.7 and every
change is in the interface layer, so **Settings → App updates → Check for update** brings it (the
app also applies it by itself on the next start). The APK is attached for a phone that has never
had Horde Studio on it.

The one-time exception is still behind you unless it is not: a phone on **v1.41.1 or older** has
no update path across the signing-key rotation done in v1.42.0, and needs **Settings → Data →
Backup**, uninstall, install, **Restore**, and a re-typed API key. `MIGRATION-signing-key.md` is
that walk-through.

## Your XP now has a history, and it follows the reply that earned it

The last update made the ledger's arithmetic trustworthy. What it could still not do was answer a
question you are bound to ask eventually: *why does this chat say 305 XP?* A total is a sum, and a
sum with no addends can't be checked, argued with, or cleaned up. In a group chat it was worse —
an award Sera's turn earned and an award the narrator invented were the same event with the same
claim on your number.

**Every approved change is now logged on the reply that earned it.** Approve a proposal and the
reward becomes part of that message, along with what it was for and who said it. Open your status
— **⋮ → RPG status** — and under *Progress log* you get one line per change: `+100 XP`, the reason
the reply gave, the speaker, the turn, and what the cap cut down. Long histories fold to the recent
end with a count of what is older.

**Which means removing the reply removes the award.** Edit and resend a message and its reward goes
with the words that earned it; reroll it, or swipe to another take, and the same. This was the hole
the last release named out loud — an award outliving the sentence it was for, your total drifting
upward for turns that no longer exist. It is closed by the obvious rule rather than by bookkeeping:
the number in your status is *what the replies add up to*, recomputed when you open the chat and
every time the chat changes under you. If a total and its log ever disagree — an interrupted
generation, a restored backup, a file you edited by hand — the log wins and the number is repaired,
with a line in the sheet telling you what it said before.

**Your own numbers stay yours.** Type `50` into the XP field and that becomes the floor the log
sits on: your total is your typed figure plus what the replies earned, so your correction is never
quietly walked back down by a recompute, and the log doesn't erase itself because you edited the
sum by hand. If you type a number *below* what the log adds up to, that's treated as a correction
rather than clipped to zero. A chat that has never approved anything is untouched by all of this:
no history, no rebase, no write, and a curve you never chose still computes nothing over what you
typed.

## Everything else in this version

- **A chat that has never seen the ledger is not changed by this update.** No migration, no
  recompute, nothing adopted on your behalf — the log starts the first time you approve something,
  in that chat, and nothing travels between chats.
- **Backups carry the history with them.** Export a chat and the awards come out in the file; import
  it and they go back in, checked on the way in, so a hand-edited file cannot smuggle a billion XP
  into your status or a log line that is really a script.
- **The refusals still stick.** Dismissing a proposal keeps the model from offering it again in that
  chat, and a refusal is logged on the reply it belongs to rather than dropped on the floor.
- **What this still does not do.** The log records what the app approved — it cannot reconstruct
  history for a chat that has been running for months, and it does not try to read your prose to
  decide what a turn was *worth*. If you hand-edit an approved reply into something that no longer
  earns its award, the award is withdrawn rather than re-priced. Progression remains per chat: no
  character sheet carries a level from one campaign into the next.
