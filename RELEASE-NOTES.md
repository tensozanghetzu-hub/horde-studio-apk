**Nothing to install.** v1.48.6 is signed with the same key as v1.42.0 through v1.48.5 and every
change is in the interface layer, so **Settings → App updates → Check for update** brings it (the
app also applies it by itself on the next start). The APK is attached for a phone that has never
had Horde Studio on it.

The one-time exception is still behind you unless it is not: a phone on **v1.41.1 or older** has
no update path across the signing-key rotation done in v1.42.0, and needs **Settings → Data →
Backup**, uninstall, install, **Restore**, and a re-typed API key. `MIGRATION-signing-key.md` is
that walk-through.

## The number on a chat is now counted, not remembered

You asked why a chat of thirty turns said **"1 message"**. Here is what it was. That figure is
not read from your messages when you look — it is a number the app keeps *alongside* them, and it
was maintained by a single "add one" written next to the code that files a new message. Nothing
ever subtracted, and worse: most places that want a chat load the whole chat into memory, do some
slow work with the model, and then write the whole chat back. If a message landed while that work
was running, the write put the *old* number back over the new one. A background job that started
when your chat held one message could leave it saying one message forever.

**The label was the small half.** That number is also how the app decides when to write a summary
of the chat — it does so once enough turns have passed since the last one. So when the count was
written backwards, the "turns since the last summary" figure became zero and stayed there, and
your chat **stopped building a memory of itself**. No error, no warning: it just quietly stopped
remembering, and the number you happened to see in the list was the only trace.

**What changed.** Opening a chat now compares the remembered number with the messages it just
loaded — which it had in hand anyway, so there is nothing extra to wait for — and adopts the
truth. That means a chat damaged in the last weeks is repaired the first time you open it, with
no reset, no reinstall and nothing to switch on. Deleting turns subtracts now too: an
*edit and resend*, which throws away everything after the edited line, used to leave the count
pointing at the transcript you deleted. And a background save can no longer move that number at
all, so the race that caused this cannot come back from any of the thirty-odd places it could
have come from — while still saving everything else it came to save.

One more piece, because fixing the count alone would not have finished the job: if a chat's
memory bookmark ended up pointing *past* the end of its transcript, that was left alone, and a
bookmark ahead of the messages means "already up to date" forever. The bookmark is now pulled
back to the end when the count is corrected, which is what actually lets a stalled chat start
summarising again.

## Everything else in this version

- **What this does not do.** It repairs the count, not a summary that was never written. If a
  chat's memory looks thin or stale after updating, open it → ⋮ → *Memory* → **Regenerate with
  AI**; that path always worked and now it will keep working on its own.
- **Measured, not asserted.** A new test file runs the app's real storage layer against an
  in-memory stand-in that behaves like the real one — every read hands back a copy, because that
  is what IndexedDB does, and a stale-snapshot test that mutates the live row instead proves
  nothing. It reproduces the bug from your report (12 messages on disk, count 1), shows the save
  cannot move the number any more, shows deletes subtract, shows opening a chat heals a number
  that was already wrong, and shows a healthy chat is *not* rewritten just to check it. 42
  checks; nine deliberate breakages were tried against them and all nine were caught, so the file
  fails if any of this quietly comes undone. The whole suite is now 140 files, 0 failures, with
  74 registered breakages all killed.
- **Why the number was ambiguous in the first place.** "How many messages is this chat" had two
  answers in the app: a "they are busy right now" notice is a bubble in the thread but not a
  turn, and the code that counted them incrementally and the code that recounted them on import
  disagreed about whether to include it. There is one rule now, and the prompt history that
  already excluded those notices asks it the same question — so the figure you see, the figure
  the memory cadence uses and the figure the export describes cannot drift apart again.
