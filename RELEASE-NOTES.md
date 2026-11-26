**This one needs the APK.** v1.48.4 is signed with the same key as v1.42.0 through v1.48.3,
so there is nothing to back up and nothing to lose: install it over the app you have. Checking
for an update is still worth doing — **Settings → App updates → Check for update** brings the
interface build with it — but the bar that went missing lives inside the installed app's own
window, so the copy of the interface the APK carries has to be rebuilt to change what you see.

The exception is eight releases old and still true: a phone on **v1.41.1 or older** has no
update path across the signing-key rotation done in v1.42.0. That one still needs
**Settings → Data → Backup**, uninstall, install, **Restore**, and a re-typed API key.
`MIGRATION-signing-key.md` is that walk-through.

## The bottom bar stays on screen when you switch to Chats

You described it exactly right: after tapping to Chats, the Cast/Life/Chats/Lore/Worlds/Settings
row was simply not there — and scrolling to the bottom brought it back, and a tap in the empty
space where it had been still worked.

That combination is the whole diagnosis. A bar that something *hid* cannot be tapped where it
used to be. A bar that has only stopped being **painted** can: the buttons never moved, the
scroll that forced a redraw made the picture reappear. Nothing in the app hides the bar — no
code path touches it at all — so what remained was the one thing about it that needs a layer of
its own to draw: a blur behind it, sitting on a colour that was barely opaque. A bar that the
page already makes room for has nothing meant to be read through it, so the blur was buying a
smudge and the risk of losing the row. It now paints from a solid colour, tinted by your theme
exactly as before, and the top bar follows the same rule. The blur stays where content really is
meant to show through it — the panels that slide up, and the composer.

The scroll you needed was a second, separate bug, and it is fixed too. The page measured itself
against the *tallest* viewport your phone ever offers it — browser bar gone, keyboard away — so
it was habitually longer than what you can actually see, by about the height of the bar at the
bottom. The chat screen had been switched to measuring the viewport as it is right now some
versions ago; the rest of the app never was. Now it is, on every screen, with the old
measurement kept as a fallback for anything that does not understand the new one.

## The import control was being pushed off the screen

Your screenshot had one icon where two belonged. The row of tools on the Chats screen had no way
to shrink: its search field refused to get narrower than its own text, so the row overflowed and
whatever sat at the end of it — *Import a chat backup*, the only way back into a chat archive —
was pushed past the edge of the screen. Pushed, not hidden: there was no scroll to reveal it.
The field can shrink now and the row can wrap, so the tools stay reachable whatever the phone
does with its keyboard. The same fix went to the two other rows that had that shape, and the
count on a chat's line finally reads *1 message*.

## Everything else in this version

- **What was tested, and how far that goes.** There is no phone in the workshop and no browser
  in this build environment, so nothing above was measured on a device — it was reasoned from the
  stylesheet, and the reasoning is written down in `NOTES.md` next to the change so a later
  reader can disagree with it. What was tested is the *rule*: a new suite reads the stylesheet and
  fails if any bar that reserves space in the page ever grows a blur again, if a bar's colour turns
  translucent, if any theme ships a translucent bar colour, or if any screen sizes itself to the
  tall viewport without the fix. Nine deliberate breakages were tried against it and all nine were
  caught.
- **The chat count is still open, on purpose.** Your restored chat listing 1 message out of 30
  was not this version's to fix, and the explanation you were given earlier — an archive restored
  over a live app — turned out not to fit a chat created after the restore. The likelier cause,
  found while writing this up, is that the app saves a whole chat record wherever a background
  job finishes, and the last writer wins: a job that started when the chat held one message can
  land after thirty and write the old number back over the new one, silently, taking the memory
  bookmark with it. That would look one-off, because it only happens when the timing falls wrong.
  The right fix is a guard in the save itself rather than a patch at any one of the thirty-odd
  places that call it, and that is the next thing this project owes you.
