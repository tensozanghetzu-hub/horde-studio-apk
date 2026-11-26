**This one is worth installing.** The fix lives in the Android wrapper, not in the
interface, so a phone that only takes the small download keeps the problem. v1.48.2 is
signed with the same key as v1.42.0 through v1.48.1, so **Android installs it over the
top** and every chat, character and setting stays exactly where it is: **Settings → App
updates → Check for update** (then tap the app update, not just the interface one), or
run the APK file below.

The exception is eight releases old, and it is still true: a phone on **v1.41.1 or
older** has no update path across the signing-key rotation done in v1.42.0. That one
still needs **Settings → Data → Backup**, uninstall, install, **Restore**, and a
re-typed API key. `MIGRATION-signing-key.md` is that walk-through.

## Exported transcripts are called what you named them

You asked for `chat.md` and got `chat.md.txt`, so every transcript you shared or opened
somewhere else started with deleting four characters. That was the app's doing on the way
into storage: Android's download store looks at the *type* of file it is being told about
and corrects a name that doesn't match it, and the app had described a markdown file as
plain text. Plain text means `.txt`, so `.txt` was appended — to a name that already ended
in `.md`.

It is fixed where it started. A transcript is now declared as markdown, and after the
write the app asks the system what the file actually ended up being called and takes back
an extension that got appended. Nothing is forced: if the store already had a file with
that name and saved yours as `chat (1).md`, that is left alone, because renaming it would
be the app tidying up its own mess into someone else's.

And when it toasts "Saved to Downloads/HordeStudio/…", it now reports the name the phone
gave the file rather than the one it asked for. If a particular Android build still insists
on changing the name, the message will tell you so instead of politely lying — which is the
difference between a bug you can report and one you have to find yourself.

Other exports were checked while we were in there: backups and character cards (`.json`,
`.png`, `.webp`) were never affected, and a world pack (`…horde_world`) keeps its name
because there was no matching extension for Android to append. Reading files back into the
app is unchanged, including how a `.md` previews as text inside the app.

## Everything else in this version

Nothing changed in the interface: v1.48.2 is this fix alone. The Scene-cast fix (v1.48.1)
and the two away switches with the unread counts (v1.48.0) are already in the web part of
this app, so you have them whichever way you updated — installing the APK does not add or
remove anything else on your phone.
