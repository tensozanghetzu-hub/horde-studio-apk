**Nothing to install.** v1.48.5 is signed with the same key as v1.42.0 through v1.48.4 and
this is an interface change, so **Settings → App updates → Check for update** is enough — the
app applies it by itself on the next start too. (v1.48.4's notes told you a fix like this
needed the APK reinstalled. That was over-cautious and it is corrected below; the APK is only
for a phone that has never had Horde Studio on it, and it is attached to this release anyway.)

The one-time exception is still behind you unless it is not: a phone on **v1.41.1 or older**
has no update path across the signing-key rotation done in v1.42.0, and needs
**Settings → Data → Backup**, uninstall, install, **Restore**, and a re-typed API key.
`MIGRATION-signing-key.md` is that walk-through.

## A chat that remembered its past in JSON now reads like one

Your screenshot of the Chats list had a row that said, as its description:

```
THE DEATH T…        11/12/2026
{ "summary": "Blu …
```

That was not a display glitch. The chat genuinely stores the model's raw answer as its memory,
and prints it everywhere: in the list, and back into every prompt as "the story so far". So the
row told you nothing about the chat, and the model has been paying attention to braces.

**There is a button for it now.** Open that chat's memory — the ⋮ on its row, *Memory* — and
instead of a warning that leaves you to it, the sheet names what is in there ("the model's raw
answer") and offers **Recover the summary**. That pulls the prose out of the wrapper, and the
facts too if the answer ever finished, and puts them in the fields you are already editing.
Nothing is saved until you tap Save, so you can read it first; if there is genuinely nothing
inside, the button says so and touches nothing you had typed. Older memories that were a
*refusal* rather than a wrapper keep the old, still-accurate wording and the Clear button.

**The list stops showing wreckage.** A chat whose memory the app calls unreadable now shows
its message count with `· memory needs a look` — the same line a chat with no summary gets, so
nothing is invented, and the nag only appears where there is something to recover.

Underneath, the fix is one question instead of two. The part that rescues a cut-off memory has
known what this shape looks like since v1.39.106; the part that warns *you* had a narrower rule
and never noticed, which is how it reached the screen. Both now call the same test, and the
summary field is still safe to type in: `Here is a summary: the mill burned` is prose, and prose
is never nagged about.

## Everything else in this version

- **Recovery from an unfinished answer is its own thing.** A memory answer cut off by the token
  ceiling keeps its summary — that is written first — and drops the half-written facts list, and
  the toast says it came from an unfinished answer rather than pretending it is complete.
- **What keeps it fixed.** A new suite checks the pairing as a rule, not a list: anything the
  rescue path would rewrite has to be something the warning flags. It renders the real Chats
  list to prove the row no longer prints JSON, loads the same engine the app does so the view
  cannot pass by disagreeing with it, and reads the memory sheet's wiring out of the source: the
  recover button has to ask the engine, fill the field, and hold no store write in it. Six
  deliberate breakages were tried and all six were caught; the full sweep is 139 test files,
  0 failures.
- **How the in-app update actually works, since I got it wrong last time.** The app opens its
  interface from the update overlay and falls back to the copy built into the APK only if that
  overlay is missing, and a new bundle is switched in with one rename plus a watchdog that rolls
  back if the result will not load. So a fix to the interface is a download, not a reinstall;
  a change to the Android wrapper around it is the only thing that needs the APK.
- **Still open, and now the only thing on the list:** the count. Saving a chat record rewrites
  the whole thing and the last writer wins, so a background job that started when a chat held one
  message can land after thirty and write the old number back. Your "just the greeting" chat
  proved the number you saw was correct, so nothing is currently miscounting on your phone — the
  guard is still worth having, and it is next unless you tell me otherwise.
