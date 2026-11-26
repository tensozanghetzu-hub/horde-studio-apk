**Nothing to install over, nothing to back up.** v1.48.3 is signed with the same key as
v1.42.0 through v1.48.2, and this fix is in the **interface** part of the app: **Settings
→ App updates → Check for update** and take the download — no APK needed for this one.

The exception is eight releases old and still true: a phone on **v1.41.1 or older** has no
update path across the signing-key rotation done in v1.42.0. That one still needs
**Settings → Data → Backup**, uninstall, install, **Restore**, and a re-typed API key.
`MIGRATION-signing-key.md` is that walk-through.

## A finished reply is no longer described as a broken one

If a bubble ever told you *"it stopped mid-sentence; Continue finishes it"* when the
writing plainly ended where it meant to — that was the app, not the model, and not the
card. Two things were wrong and both are fixed.

The first is small and silly. The line under a reply decides whether the text finished by
looking at its last character, and its list of "finished" characters had no `*` in it. A
reply that closes on an action beat — *she shrugs.* written in italics, the most common ending in
roleplay — therefore looked cut off. Meanwhile the part of the app that actually reacts to
truncation has accepted `*` for a long time, so the same reply was "finished" in one place
and "stopped early" in another, and only the place that talks to you was wrong. Those two
answers are now the same question asked once, and there is a test that compares them
across every ending a card produces, so they cannot quietly drift apart again.

The second is the one that mattered. **A greeting is not a reply.** The first message in a
chat was written by the card, never generated, so it has no record of why a model stopped —
and "no record" was being read as "an unexplained stop", which turned into a confident
diagnosis about text nobody had generated. A greeting now shows its word count and nothing
else. No verdict, no nudge to press Continue. Older chats that already exist get the
correct "complete" instead of silence, because the rule they are measured with is now the
right one.

If a reply really did stop early, you still hear about it, and still with the reason: a
reply that ran into your token limit says so and names the limit; one the model chose to
end says that instead; and a reply that genuinely trails off mid-thought says so. Nothing
was removed to fix this.

## Also: why the Scene bar appears for some group cards and not others

Worth ten seconds if you use cards that hold several people, because it decides whether the
app can see them. The Scene bar appears when the card shows a name **being used as a
speaker** — the clearest place is the example block, writing

```
Mira: *leans on the doorframe.* "He is late."
Vlad: "He is not late. You are early."
```

rather than `{{char}}:` on every line. A card that labels all of its people as one
`{{char}}` is telling the app there is a single person in the room, and no amount of "they
are three distinct individuals" in its description overrules that. A `Cast:` heading with
bullets works too. `[MIRA - "the tease"]` blocks in a description do not — to the app those
are prose, not a speaker list. This is written up properly in `CARDS.md` now.

And if a card structures its people in a way the app can't read: **Chat settings → Scene
cast** takes the names typed in, one per line, and the app keeps them from then on — it
never overwrites a list a person typed, even when the card changes and disagrees.

## Everything else in this version

Nothing else changed. The export-filename fix (v1.48.2, transcripts saving as
`chat.md.txt`) lives in the Android wrapper rather than the interface, so **that** one
still needs the app update rather than the download — if you have not installed v1.48.2 or
newer yet, take both now and this arrives with it.
