**You do not need to uninstall for this one.** v1.43.0 is signed with the same key as
v1.42.0 through v1.42.3, so Android installs it over the top and every chat, character
and setting stays where it is. Install from inside the app: **Settings → App updates →
Check for update**, or run the APK file itself. Everything in this release is
JavaScript, so a phone on v1.42.0 or newer also picks it up as a small download.

The exception is three releases old, and it is still true: a phone on **v1.41.1 or
older** has no update path across the signing-key rotation done in v1.42.0. That one
still needs **Settings → Data → Backup**, uninstall, install, **Restore**, and a
re-typed API key. `MIGRATION-signing-key.md` is that walk-through.

## A saturated route now answers from the next one

Settings → Generation gained **If a route is saturated, try next**: up to three model
ids, sent to OpenRouter as a model chain with your chosen model first. Until now the app
retried the *same* route twice, then told you to go and change the model by hand — the
one part of a free-tier evening a machine does better. A strict self-hosted base URL and
the AI Horde never see the field, and a hand-built request body is never rewritten.

## A cut reply can be shown, and undone

The app trims a reply while cleaning it — it stops at the first line that looks like a
speaker label, which is correct when the model starts writing your turn and quietly wrong
when a character is addressed by name in the prose ("He looked up. \"Alice: get down
here,\" he shouted."). You could not tell those apart from a sentence that ended. A
bubble that lost text now carries a small **−N** chip: it shows you what the model
actually sent, and only puts it back if you press **Keep this text**. Untouched replies
store nothing extra, and a reply the model itself cut mid-sentence says so.

## Thinking is now a switch, not a special case

Some models spend the entire reply budget on invisible thinking and return nothing you
can read — which looks exactly like a refusal. **Ask for no thinking at all** sends
`reasoning:{enabled:false}` to any OpenRouter model. It is **off by default**, so no
existing behaviour changes unless you turn it on; the Nemotron free routes that started
this are still handled automatically either way.

- The reset-to-defaults button on that screen covers both new controls; a test now fails
  if a control is ever added that the reset cannot restore.
- `tests/reply-resilience-test.js` (new, 30 checks) and `openrouter-reasoning-test.js`
  (10). Each of the seven protections was broken on purpose and the suite caught it.
- Web-only: `js/api.js`, `app.js`, `views.js`, `store.js` + `sw.js`. The APK is the same
  wrapper at a new number.

- App version: 1.43.0 (code 199)
- Signed with certificate `a1b0e42310b63444…` (`keytool -list` form
  `A1:B0:E4:23:…`; verify any build of ours against it with
  `apksigner verify --print-certs`)
- Android 7.0 (API 24) and up
