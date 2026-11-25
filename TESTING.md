# How a check earns its place in this repo

135 files in `tests/`, run one at a time:

```
timeout 150 node tests/lore-card-features-test.js     # one suite
for f in tests/*.js; do timeout 150 node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done
```

The loop above — **0 problems / 135** — is the release gate. It is not run by CI:
`.github/workflows/release.yml` builds the APK, publishes the release, trims old
assets, and runs no tests at all. Nothing between "the suite is red" and "the phone
has it" except the person doing the release, so the checks have to be worth the
seconds they take, and a check that cannot fail is worse than no check: it buys the
release a green line that means nothing.

## The bar, four rules

**1. Break the thing it guards, and show the suite going red.** That is the whole
mechanism, and it is a committed tool now: `tools/mutation-check.py` holds a list of
deliberate, tiny breaks to shipped source, each naming the suites that must fail with
it in place.

```
python3 tools/mutation-check.py                    # every break (seconds, not minutes)
python3 tools/mutation-check.py --list             # what it currently covers
python3 tools/mutation-check.py --only chain       # one of them
```

`12 killed, 0 survived, 0 anchors lost` is the pass condition. A **survived** break is
the interesting result: it means the check written for that behaviour is decorative, and
the fix is a better check, never the removal of the break from the list. Two rules the
output depends on:

- The harness **refuses to run against a red baseline**. A suite that is already failing
  reports "killed" for every break in the file, so the number would be a lie. Fix the
  suite first.
- A break that makes the source **fail to parse** counts as detection but proves nothing.
  Write breaks that keep the file valid — flip a constant, drop a guard, remove an
  argument — so the failure arrives as a named assertion.

`tests/mutation-harness-test.js` runs every sweep and keeps the harness honest: each
entry's `find` string must occur exactly once in its file, each named suite must exist,
the list must cover `api.js`, `store.js`, `views.js` and `app.js`. When the source moves
and an anchor goes stale, the sweep says so instead of the harness quietly replacing
nothing while printing "every break is caught".

**2. A view is tested by rendering it.** Grepping `views.js` proves the string is in the
file, not that the screen writes it out, and this repo has been bitten by exactly that
gap: a Lore badge the engine computed and the view never displayed (the row's badge line
was gated on a set of flags that did not include the new ones), and a `loreDiagnostics`
call that dropped the settings argument, so the screen would have told a player who had
just switched regex keys on that their keys were plain text. Both are invisible to a
source check; both are obvious once the real function is called.

`tests/lore-card-features-test.js` section F/H is the pattern to copy: `viewEnv()` loads
`views.js` in a `vm` against a document made of objects (nodes with `innerHTML`, a
`classList` that behaves like the DOM's, `addEventListener` that records handlers), calls
`Views.settingsSystem` or `Views.world`, and asserts on the HTML that came out. One
stub, shared by both sections, because a second copy drifts — and a stub DOM that
disagrees with the real one is worse than no test at all. Where the claim is about what
the model receives, the same section then calls `API.buildChat` and checks that the text
the screen pointed at is on the wire. That cross-check is the only thing that keeps a
readout honest.

**3. Two-sided bounds, and no fixtures that quote the constant they test.** "Only 20
rows are read" is not established by a fixture built as `LORE_CHAIN_FROM + 2`, because
such a test still passes at 999 999 — which is precisely the break that survived this
release's first harness draft. Write the pair at a literal size (row #4 in, row #40 out)
*and* the parameterised one (the bound is honoured at all), and name which failure each
catches.

**4. Say "skipped", never "ok", when nothing was checked.** A condition of `true` is a log
line. Where a suite depends on a file that may not exist yet (`docs/version.json` before
the channel is built), say so in the name and do not count it as a pass — that pattern is
in `version-consistency-test.js`, and it is the one place a suite is allowed to be quiet
rather than assertive.

## Comparing against the previous release

`node tools/compare-lore-prompt-against-release.js [rev]` builds prompts with the
shipped `api.js` at a named rev and with the working tree, over a fixture book that
exercises every field the release started reading, in all four switch combinations, and
prints which of the 64 cases differ. "Off means nothing changed" cannot be shown by a
test written after the change — such a test can encode the new behaviour and still pass.
This compares the two implementations instead. Any future feature behind a default-off
switch gets the same treatment; a `DIFFERS` line in the switches-off group, or a change
where the card asked but the player did not agree, is the finding.

## Cost, and what not to measure

Suites must stay a sweep, not a build: each under a couple of seconds, and anything that
scans a big fixture does it once. Perf-style checks here assert an order of magnitude
(400 pattern entries scan in tens of milliseconds, not seconds) and, where the point is
that work is repeated, assert the second run is cheaper — those catch the class of bug
where a cache is missing, without depending on how fast this machine happens to be. Never
use a timeout as the safety property in shipped code: a guard whose strength depends on
the device is not a guard, which is why a runaway pattern is refused by shape
(`scriptLooksEvil`) rather than by killing it after N milliseconds.

## Known oddities, so a sweep run is read correctly

- Three suites **print `Error:` on purpose** — `lifework-test.js`, `sendfail-test.js`,
  `wakelock-test.js` — they exercise failure paths and log what they caught. Exit code
  decides; the word does not.
- `tests/generic-check.js` scans **comments** for card names and fandom vocabulary, so
  naming a test fixture after a card you were debugging fails the release. Use neutral
  names in shipped code; test files are not scanned.
- Source-shape guards (regexes over `api.js`/`views.js`) are legitimate for things that
  must not exist — `o.maxMessages || 40`, a second `function requestWindow` — but they
  rot the moment code moves. Re-anchor them in the same change that moved the code, in
  the same commit, and keep the comment that says what the shape is protecting. Do not
  delete one to get to green.
- `Store.DEFAULTS`, `app.js`'s `$`/`$$` and the lore engine's `loreAdmit` are
  module-private: test the exported surface (`Store.cardToCharacter`, `API._loreHits`,
  `API.loreDiagnostics`) rather than reaching for an internal that cannot be imported.

## Adding to it, each release

Write the check. Break the source in the way the bug would actually happen. Run the
suite; if it stays green, the check is not finished — fix it, not the break. Then add
that break to `tools/mutation-check.py` with the suite's name, run
`python3 tools/mutation-check.py`, and only then stamp. That is the entire ritual, and
the reason the list keeps growing instead of the tests getting shorter.
