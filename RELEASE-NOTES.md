**You do not need to uninstall for this one.** v1.45.0 is signed with the same key as
v1.42.0 through v1.44.0, so Android installs it over the top and every chat, character
and setting stays where it is. Install from inside the app: **Settings → App updates →
Check for update**, or run the APK file itself. Everything in this release is
JavaScript, so a phone on v1.42.0 or newer also picks it up as a small download.

The exception is five releases old, and it is still true: a phone on **v1.41.1 or
older** has no update path across the signing-key rotation done in v1.42.0. That one
still needs **Settings → Data → Backup**, uninstall, install, **Restore**, and a
re-typed API key. `MIGRATION-signing-key.md` is that walk-through.

## Text scripts: fix what the model does on your screen, not in your chat

Some habits cannot be trained out. A model that frames every action in `*asterisks*`, a
name you always want shortened, a character that signs off with the same sentence — a
script is a find pattern and a replacement, and it now runs over each reply **as it is
drawn**. It is in **Settings → Generation**: a switch (off until you turn it on) and a
list. Add a rule, and the sheet shows you what it does to the reply you last received —
before, after, how many matches, how long it took.

The deliberate limit: **display only**. A script changes what the screen shows. It does
not touch the stored message, the prompt sent to the model, the transcript export, the
read-aloud text, or the `raw` copy behind the reply footer. SillyTavern-style scripts
also have prompt-affecting stages; this app starts without them because a display bug is
undone by switching one thing off and a prompt bug quietly rewrites your story. Your
chat, exported or re-read a year from now, is what the model actually wrote.

Two things a rule has to pass before it is saved, both about hanging. A pattern whose
shape can only be slow — a group repeated inside a repeated group, like `(a+)+` — is
refused by its shape, and a rule that takes more than half a second on one reply is
refused outright. A WebView that stalls on the UI thread has no cancel button, and an
answer that depends on how fast the phone happened to be that day is not an answer. The
same shape is skipped at render time too, so a rule put in by hand cannot take the
screen down either. Rules run top to bottom, each seeing what the one before it left;
each can be switched off without deleting it.

## The chats search can read the chats now

**Chats → the search box** filters titles, character names and summaries; from now on
it also finds the chat where the boat sank, even when the title is "New chat" and the
phrase is 140 messages deep. Message bodies live in a separate store with no text index,
so this is a scan rather than a query, and the scan is the only interesting part:

- **It does not block.** The indexed half answers while you type; the scan runs behind
  it, yields between chats, and paints itself in as it goes. A line under the list says
  *Reading 42 of 90 chats for that phrase…* and disappears when it is done.
- **It is bounded.** Three characters minimum — two letters match every chat you own —
  250 chats, the last 400 messages of each, and 25 hits per chat, which is printed as
  *24+*. A long campaign is read from its tail, and when the scan stops short the empty
  result says so, in words that tell you to try a longer phrase.
- **Words are ANDed inside one message**, the same rule titles already used, so *"boat
  dawn"* does not find every chat that mentions either word.

Each hit row carries a **Jump** button. It opens the chat on the *oldest* message
matching your words — where it happened, not where it was repeated — highlights that one
and lights every other message the phrase runs through, so you can see how far it goes.
The marks are screen-only; leaving the chat and coming back leaves nothing behind.

One more thing, because it is worth saying out loud: **the search box was invisible.**
The input has been in the chats screen since v1.39.0 with `hidden` in the markup, and
nothing ever removed it. The feature existed; you could not reach it. It now appears
whenever you have three or more chats, and stays out of the way below that.

## Exporting a chat as Markdown

**Chat → ⋮ → Export → For publishing (.md)**, alongside the existing *For reading
(.txt)* and *Backup (.json)*. Speaker names in bold, images as figures with their
captions as alt text, and the memory the chat had built — with the facts that stopped
being true kept and labelled as such, rather than quietly dropped. The two text formats
are built from one assembly now, so they cannot drift apart; neither one has display
scripts applied to it.

## Under the hood

`API.applyDisplayScripts`, `API.scriptTest`, `API.displayScripts` and
`API.scriptLooksEvil` (new, called from exactly one place in
`views.js`); `Store.DEFAULTS.regexOn` (false) and `Store.DEFAULTS.regexScripts` (`[]`).
The switch is part of a generation reset, so *Reset generation* turns the styling off;
the rules themselves are deliberately not, because they are your text and a reset that
deleted them would be data loss dressed as tidiness. `App.transcriptParts` with
`App.renderTranscriptTxt` / `App.renderTranscriptMd`; `App.setChatSearch`,
`App.searchBodies`, `App.scanForWords`, `App.searchSnippet`, `App.searchProgress` and
`App.focusMessage`; `App.openSession(id, {focusMid})`, which now returns its promise so
a jump can be sequenced after the thread is built. The `.txt` export's filename is
sanitised, so a chat titled `Harbour & Lighthouse` can no longer draw a folder.

131 test files, all green. Three are new here, 142 checks between them:
`tests/regex-scripts-test.js` covers
the engine and, more importantly, the boundary — that an armed rule with the switch on
still leaves the assembled prompt, the export and the stored message alone;
`tests/chat-body-search-test.js` covers the debounce (nothing is read at all before it
is up), the bounds, a scan superseded mid-flight, the escaping in a snippet, and a jump
target that no longer exists; `tests/export-md-test.js` covers both renderers against
the same session, including a deleted character and a store that refuses.

*Update notes: no uninstall, no re-login, no migration. Existing chats, cards, lore and
settings are untouched; nothing new is on unless you switch it on.*
