**You do not need to uninstall for this one.** v1.42.1 is signed with the same key
as v1.42.0, so Android installs it over the top and every chat, character and
setting stays where it is. Install from inside the app: **Settings → App updates →
Check for update**, or run the APK file itself. Either way, no backup step.

The exception is one release old, and it is still true: a phone on **v1.41.1 or
older** has no update path across the key rotation done in v1.42.0. That one still
needs **Settings → Data → Backup**, uninstall, install, **Restore**, and a re-typed
API key. `MIGRATION-signing-key.md` is that walk-through. If you are already on
v1.42.0 you are past it — do not uninstall a working app to "make room" for an
update it accepts normally.

**What changed:** a reply could open with the character card's own name —
`Vecinas Nudistas: Karina lets go of the bags…` — sitting there as prose directly
under a bubble header that already said `Vecinas Nudistas`. The app labels every
turn in the transcript with the speaker's name (that is what keeps a multi-character
scene from reading as an unattributed wall), so the model was being taught to write
the label and then nothing removed it on the way in. Worse, the stored line gets
labelled again when the next prompt is built, so the prefix compounded turn after
turn: `Name: Name: Name: …`.

Only the card's **own** name on the **first line** is stripped now, and the
mechanism that made the strip safe is the bubble header, which always names the
speaker: `speakerName || char.name`. Everything the earlier rule existed to protect
is pinned by tests and unchanged — another character's label is never touched (it
is the only thing naming them), a later line beginning with the card's name does
not cut a reply short, and a sentence that merely starts with the character's name
survives. This is a JS-only change, so on v1.42.0 it also arrives as a plain web
update with no APK at all.

- App version: 1.42.1 (code 196)
- Signed with certificate `a1b0e42310b63444…` (`keytool -list` form
  `A1:B0:E4:23:…`; verify any build of ours against it with
  `apksigner verify --print-certs`)
- Android 7.0 (API 24) and up
