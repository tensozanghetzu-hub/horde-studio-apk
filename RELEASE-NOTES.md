**You do not need to uninstall for this one.** v1.46.0 is signed with the same key as
v1.42.0 through v1.45.0, so Android installs it over the top and every chat, character
and setting stays where it is. Install from inside the app: **Settings → App updates →
Check for update**, or run the APK file itself. Everything in this release is
JavaScript, so a phone on v1.42.0 or newer also picks it up as a small download and
needs no APK at all.

The exception is six releases old, and it is still true: a phone on **v1.41.1 or
older** has no update path across the signing-key rotation done in v1.42.0. That one
still needs **Settings → Data → Backup**, uninstall, install, **Restore**, and a
re-typed API key. `MIGRATION-signing-key.md` is that walk-through.

## The recap now reads the transcript the model was actually shown

Story memory summarizes the chat so old turns can leave the window and still be known.
Until now it did that work on its own copy of the chat: the request was built from a
budget, the recap from a slice of forty messages. When your history budget is smaller
than forty — and on a free route it usually is — the summariser was handed a
transcript that included turns the model had never seen and left out turns it had. Its
output was then filed as what the model "knows". Two wrongs, one of them quiet.

The recap now takes the **same window the chat took**: one budget, one selection, read
by both. The slider is honoured rather than argued with — if your window is eight
messages, the recap is built from those eight (with a floor of twelve so a recap is not
a snapshot of a single exchange, and a byte cap so the request still fits the model that
has to answer it). Nothing here raises a limit anywhere: the fix is that the two views
of the chat are the same view, which is the only version of "what the model saw" that
can be true.

## Recall: fetch the turn the window dropped, when it fits this one

**Settings → Memory → Recall**, off until you turn it on.

The window is a budget, not a memory. When it pushes a turn out, the model does not
forget it — it never received it, and it will happily invent a replacement. Recall
scores the messages the window left out against your last line and appends the handful
that match, on the phone, with no model, no dependency and nothing uploaded: BM25-lite,
term frequencies, a length norm, inverse document frequency.

What it deliberately will not do:

- **It does not move anything.** The block goes *after* the transcript, first in the
  trailing instructions, so the prompt prefix is byte-for-byte what it was and the cache
  discount on the free routes stays. Reordering history into relevance order is how a
  recall feature costs more than it saves; this is append-only on purpose.
- **It does not fetch on one shared word.** A passage has to share two of your words to
  be fetched at all, and a word the whole chat repeats — *the lamp*, in a story about a
  lighthouse — is not one of your words. Without that rule the fourteenth near-copy of
  the turn you just read ranks above the fact you asked about, and the model weaves it
  in. A single rare word is enough on its own, which is the turn where all you typed was
  a name.
- **It does not quote the whole message.** A recalled line is the stretch around the
  match, not its opening: a four-thousand-character post is useless if the sentence that
  matters is at the far end.
- **It does not settle anything.** The block arrives under a heading that says these are
  real lines from outside the window, that they are background rather than the present
  moment, and that where one contradicts something newer, the newer one wins.

Up to twelve passages per reply (six by default), and the whole block is capped at about
700 tokens, so it cannot spend the turn's own window. Below the cap it keeps the
strongest matches; what it left out is counted, not quietly missing. The Memory screen
prints what the last request did — how many messages were looked through, how many
passages were kept, what they cost — and past the search cap it names how many were never
read, because "nothing matched" about lines nobody examined would be a lie.

**The limit worth knowing:** this matches *words*, not meanings. Ask
*"is the Sorrow of Dunmore still rotting at the pier?"* and the turn where you named her
comes back. Ask *"how did that all end for us?"* and nothing is fetched — no guess, no
invented recollection. It is a lookup, not a model.

One turn costs 9 ms on a 240-message chat and 50 ms on a 2 000-message one the first
time; after that the message shapes are cached and the same scan takes 2 ms. The scan is
bounded to the newest 1 500 out-of-window messages so no chat, however long, can spend
a turn on arithmetic. That bound is also why it reads the newest lines first: on a chat
older than the cap, the oldest episodes are out of reach.

## Checks

`tests/recall-bm25-test.js` (95 checks) and `tests/recap-window-test.js` (22). The
recall suite is not a set of string matches: it ranks a 60-turn campaign through the
LongMemEval question types (extract, combine, temporal, update, abstain) and asserts on
the request the app would send, including one check that documents the limit above. The
mutation harness grew from twelve breaks to twenty-four, every one of them in this
release's two paths: dropping the two-word gate, the rarity floor, the token budget, the
search cap, the append-after-transcript position, the single speaker label, the window
exclusion, the snippet's centring, the tie-break, the off-by-default switch, the
plain-text shape, and giving the recap its own slice back. Each one turns a suite red,
and each was added by breaking the code on purpose and watching what stayed green.
