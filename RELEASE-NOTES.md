**You do not need to uninstall for this one.** v1.42.3 is signed with the same key as
v1.42.0, v1.42.1 and v1.42.2, so Android installs it over the top and every chat,
character and setting stays where it is. Install from inside the app:
**Settings → App updates → Check for update**, or run the APK file itself. Everything in
this release is JavaScript, so a phone on v1.42.0 or newer also picks it up as a small
web download.

The exception is three releases old, and it is still true: a phone on **v1.41.1 or
older** has no update path across the signing-key rotation done in v1.42.0. That one
still needs **Settings → Data → Backup**, uninstall, install, **Restore**, and a
re-typed API key. `MIGRATION-signing-key.md` is that walk-through. If you are on
v1.42.0 or newer you are past it — do not uninstall a working app to "make room" for an
update it accepts normally.

## A 429 now says which limit it hit

Settings → Connection was correct and unhelpful at the same time. A phone with 772
free-model requests left in the day read "OpenRouter reports an account/key rate limit.
Check the quota panel for requests remaining and reset time", twelve minutes apart, twice —
and the panel it was sent to said 772. Both numbers were true. OpenRouter answers a 429
with `X-RateLimit-Limit` / `-Remaining` / `-Reset` naming the limiter it actually hit,
and the app was testing one of them for existence (`!!headers.get(...)`) to decide the
label, never reading the value. So the number that explained the refusal arrived, was
walked past, and was not stored.

Those three figures now ride on the error and appear in the place you are already
looking: the connection-test line names the limiter and says out loud that the daily
counter is a separate allowance, instead of pointing you at a panel that cannot report a
per-minute cap; and the Recent route results entry keeps `40/day · 0 left · resets in
9m` as its own note, so a refusal is still explicable an hour later. The period —
`/min`, `/window`, `/day` — is read off the reset window rather than guessed from how
big the limit number looked, and the sentence stops telling you to go look where the
answer is not.

What gets written to local history is only this app's own explanation, never the
provider's message text. That is a leak fix, not tidiness: a provider echo cannot put
your key or your prompt into stored diagnostics, and a test now proves it.

- The model test logs the limiter figures it measured (it used to log the diagnosis only).
- `tests/openrouter-quota-test.js` grows 12 → 21 assertions. Mutation-checked: dropping
  the header figures fails 4, labelling a nine-minute limiter as per-minute fails 3, and
  storing the raw provider line is caught by the fixture that puts your key in it.
- Web-only: `js/api.js` + `sw.js`. No manifest or native change, so the APK is republish-
  ing the same shell at a new version number.

- App version: 1.42.3 (code 198)
- Signed with certificate `a1b0e42310b63444…` (`keytool -list` form
  `A1:B0:E4:23:…`; verify any build of ours against it with
  `apksigner verify --print-certs`)
- Android 7.0 (API 24) and up
