**You do not need to uninstall for this one.** v1.48.0 is signed with the same key as
v1.42.0 through v1.47.0, so Android installs it over the top and every chat, character
and setting stays where it is. Install from inside the app: **Settings → App updates →
Check for update**, or run the APK file itself. And you will not need to: everything in
this release is JavaScript, so a phone on v1.42.0 or newer picks it up as a small
download with no reinstall. The APK is here for new installs and so the version numbers
on this page describe the file they point at.

The exception is eight releases old, and it is still true: a phone on **v1.41.1 or
older** has no update path across the signing-key rotation done in v1.42.0. That one
still needs **Settings → Data → Backup**, uninstall, install, **Restore**, and a
re-typed API key. `MIGRATION-signing-key.md` is that walk-through.

## They can write while the app is in your pocket

Virtual humans have always run on real time, and always by catch-up: open the app after
four hours and their day has moved on, because the app works out what happened rather
than pretending it was watching. Until now that was the only option — the clock stopped
the moment the app was not in front of you, so a message they had to send went out when
you unlocked the phone, not when they thought of it.

**Settings → Generation → Keep their life running when backgrounded**, off. With it on,
the app keeps checking — once a minute, and still only for humans you have switched on —
while the app is open but not visible. An arrival is then something waiting for you
rather than something generated on your return.

Two things it does not do, both on purpose. It does not run after the app is closed:
that would be a different kind of app, with a service permanently resident and a
permission to ask for, and this one does not have either. And Android may stop the timer
while the app is hidden anyway, in which case the catch-up on opening the app covers for
it, as it always did — nothing is lost, and nothing is double-counted.

It is off because it spends model calls you are not watching. The budget you already set
still applies: the autonomous-message slider, one outreach per person per real hour, and
the daily cap on the Life card are all still the ceiling, so this cannot fan out into a
hundred requests after a weekend. Both switches are put back to off by
**Settings → Generation → Reset generation settings**, because the one that costs
something should not survive a reset by accident.

## What came back is counted, in one place

If they wrote while you were not looking, you now see it where you would look for it:

- **The Life screen** says how many people have written since you were last there, and
  names them, with each person's card carrying *2 messages since 02:14 · open the chat*.
- **Chats** puts `2 new` on the newest chat of the person who wrote, and only there —
  not on every chat you have with them.
- **Opening their chat is the reading of it.** There is no mark-as-read button to hunt
  for and nothing to forget to tap; the count goes away because you looked.

What counts is only what *they* sent you without being asked: a message, a photo, several
messages in one go counted as the several they are, and a reply of yours that was still
being written when you left. What they did in their own day — a diary beat, a post,
something happening in the world — stays on their Life and Feed screens, where it always
was. Those are not messages to you, and the app does not start treating them as one.

The count is this app's own note about what it delivered. It is not worked out from the
message list, so tidying a chat by hand will not quietly move a number you already saw,
and a human exported as a card or shared with someone else starts with nothing waiting —
someone else's unread state is not part of their life.

## One notice, if your browser offers it

**Settings → Generation → Notify me when they write** is for people who run this in a
browser — desktop, or a home server page added to a phone's home screen. It asks for
permission when you switch it on, and stays off if you say no: the switch never shows
itself as on next to a notification that will never arrive. When a platform has no
notifications at all, the row says so and does not offer the choice.

Where it works: one notice per person, updated rather than repeated if they send three
things, and only while the app is in the background — a message you are looking at does
not also buzz. It needs the switch above it on too, because otherwise there is nothing
arriving to notify you about.

In the Android app there is nothing to switch: this release adds no notification
channel, no permission and no background service to the wrapper, so on a phone the count
is the signal. That is a deliberate line rather than an oversight — the notification
belongs to the browser that offers it, and the app has no way to promise one it has not
asked the platform for.
