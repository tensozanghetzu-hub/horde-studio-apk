**You do not need to uninstall for this one.** v1.44.0 is signed with the same key as
v1.42.0 through v1.43.0, so Android installs it over the top and every chat, character
and setting stays where it is. Install from inside the app: **Settings → App updates →
Check for update**, or run the APK file itself. Everything in this release is
JavaScript, so a phone on v1.42.0 or newer also picks it up as a small download.

The exception is four releases old, and it is still true: a phone on **v1.41.1 or
older** has no update path across the signing-key rotation done in v1.42.0. That one
still needs **Settings → Data → Backup**, uninstall, install, **Restore**, and a
re-typed API key. `MIGRATION-signing-key.md` is that walk-through.

## "Messages in context" now means the messages in context

This is the release's real finding, and nothing about it was visible from outside.
Settings → Generation has had a **Messages in context** slider (default 40, up to 120)
for a long time. The prompt builder took the history, cut it to **six turns** for its
own convenience — that being the window the *lorebook keyword scan* uses — and only
then looked at your setting. So the slider could lower the number and could never raise
it: a 160-message campaign talked to a model that had been shown twelve messages, while
the screen said forty. Measured against the real builder before any edit: 80 messages
in, 13 on the wire, oldest message sent the 35th of 80.

From now on the setting governs the transcript, and the **history budget** (default
6 000 tokens, itself capped by the model's window) is what decides the size — which is
what the wording beside it has always claimed. What to expect:

- Long chats carry far more of the story to the model instead of relying on the summary
  and the stored facts to stand in for it.
- Prompts get bigger, so a reply costs more input tokens and may take a moment longer to
  start. Nothing is sent past the budget: a small-window model gets a smaller
  transcript, not a rejected request.
- The lorebook's keyword scan did **not** widen along with it. How far back a keyword
  may fire is a separate, per-character control (Lore → scan depth) and stays that way
  on purpose: it changes which entries get injected, not how much story is sent.
- Want the old behaviour back? Set it to **12**. That is approximately what you have
  been getting; the old window was counted in turns, so a chat whose replies arrive in
  several bubbles was shown a little more than 12 messages.

The hint under the slider was wrong in two ways — it called itself the lorebook's
window, and it hedged that raising the number "may change nothing", for a number that
could not be raised at all. It now describes what happens.

## The prompt inspector shows what was left out

A setting that silently did nothing is a bug; a bug you could not see is worse. Chat menu
→ **Prompt & context inspector** now opens with **What this request left out**: how
many of the chat's messages were not offered and because of what, how many more the
history budget removed, whether the card's example dialogue had to be dropped to fit,
and which lorebook entries matched and were then turned away — by the entry ceiling, by
the byte budget, or by both — named by their own keywords. Those numbers are written by
the prompt builders as they work, not calculated afterwards about them, which is the
only way to guarantee the panel cannot describe a request that was never built.

Tap **Request body** for the JSON that goes to your provider: model, sampling, reply
budget, fallback chain, thinking flag, with the messages collapsed to a count because
they are already on screen above it. Your key is not in there — it rides in a header —
and the copy button runs the credential redactor over the whole body before the
clipboard sees it. The AI Horde assembles its request elsewhere, so the panel says where
rather than inventing a body it does not send.

## A card's own dates and author note, on screen

Character Card V3 carries `creation_date`, `modification_date` and `creator_notes` for
exactly the question "which copy of this card is this, and what did its author say about
it". The app already kept all three — inside the file copy it preserves for lossless
export, and never read. Card menu → **From the card file** shows them now: the dates the
card declares, read as the spec defines them (Unix seconds; a `0` is the author saying
"unknown", not 1970; a stamp written in milliseconds is interpreted *and* named as a
spec break), the author's note in the language order the spec spells out, and a mention
of any translation the file holds that this app has one interface language to display.
It is text from a file someone downloaded, so it is escaped, flattened to one line,
clipped, never sent to the model, and never written back into the card.

## Underneath, so the next one of these is cheaper

- **One function builds the request body.** The streaming call used to assemble it and
  any preview would have had to guess; now both read the same function. Lifting it out
  caught a bug on the way in: the reply handler also needed to know whether the thinking
  guard had been asked for, and that answer now travels out with the body instead of
  being re-derived from somewhere else.
- **One number for the context ceiling.** The window and the trimmer each carried their
  own `contextMessages || 40`, which is how an unset value could mean "everything" to
  one and "40" to the other.
- **One credential redactor**, shared by the failure log and the inspector, instead of
  two copies of one rule where either can fall behind.

- `tests/context-window-test.js` (new, 52 checks) and `tests/card-file-notes-test.js`
  (new, 28) pin the above. `tests/prompt-inspector-test.js` grew from 5 checks to 23 and
  now presses the copy button rather than trusting its label. Two older assertions — in
  `labels-and-window-test.js` and `history-budget-test.js` — had been pinning the
  six-turn coupling and the old hint as though they were the requirement; they are
  rewritten against the two separate windows and would fail again if either were folded
  back together. Every behaviour this release changed was mutation-checked: break it on
  purpose and a named test says so, which is the only proof an assertion counts.

Nothing in this release touches **Life** (the virtual-human schedule). It is last in
line, as agreed, and it is unchanged.
