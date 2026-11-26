**You do not need to uninstall for this one.** v1.48.1 is signed with the same key as
v1.42.0 through v1.48.0, so Android installs it over the top and every chat, character
and setting stays where it is. Install from inside the app: **Settings → App updates →
Check for update**, or run the APK file itself. And you will not need to: this is a small
fix to the interface, so a phone on v1.42.0 or newer picks it up as a download with no
reinstall. The APK is here for new installs and so the numbers on this page describe the
file they point at.

The exception is eight releases old, and it is still true: a phone on **v1.41.1 or
older** has no update path across the signing-key rotation done in v1.42.0. That one
still needs **Settings → Data → Backup**, uninstall, install, **Restore**, and a
re-typed API key. `MIGRATION-signing-key.md` is that walk-through.

## The Scene bar comes back for cards whose people aren't written as dialogue

If your card holds several people and the Scene strip above the keyboard had gone
missing, this is for you. It was not removed — but for a card that lists its cast as
headings or prose instead of `Vlad: …` lines, the app decided the card had one person in
it and deleted the list of names, including **the list you had typed in yourself**, every
time you opened the chat. And because the ✎ that edits the cast sits inside that strip,
once the strip was gone there was no way to bring it back.

The app still only counts a name as a person when the card actually uses it to speak, or
the writing vouches for it — a `Relationship:` heading is not someone standing in the
room, and that rule is what stopped the strip filling up with section titles. What has
changed is what beats that guess: **a cast you typed in is yours now**. It is not
re-scanned away, and the card is not consulted over your head again unless you clear the
list yourself.

**And there is a second way in: Chat settings → Scene cast.** Open a chat's settings and
you'll see the field there, one name per line. It tells you what the app could read from
your card — "Read from this card: 3 people (Vlad, Mira, Ivan)" — or says plainly that it
could not, and that two names typed here will bring the strip back. Whoever is in the
room now follows the list you wrote: tap names in the strip to send them away or bring
them back, and pick who your next message is addressed to.

Two things it deliberately does not do. A chat with **several characters** in it still
has no Scene bar: that's what *Next speaker* above the keyboard is for, and each of them
brings their own card. The field says so rather than offering you a list the app would
never show. And **Reset to defaults** in chat settings does not empty your scene — who is
standing in the room is not a style setting.

## Everything else in this version

Nothing. This is a patch on v1.48.0, which arrived the same day with the two away
switches (Settings → Generation: *Keep their life running when backgrounded*, *Notify me
when they write*) and the unread counts on the Life screen and in Chats.
