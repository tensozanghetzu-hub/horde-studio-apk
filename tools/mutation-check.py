#!/usr/bin/env python3
"""Mutation check: prove the tests can fail.

A test that cannot be broken is not a test. Each entry below is a deliberate,
tiny break to shipped source, and the suites named beside it MUST go red with
that break in place. A break that everything passes is a check that is checking
nothing — which is how a switch that was supposed to ship off, a bound nobody
reads, and a screen that tells the author something the engine did not do all
get released.

Run from the repo root:

    python3 tools/mutation-check.py           # every entry (a couple of minutes)
    python3 tools/mutation-check.py --list    # names only
    python3 tools/mutation-check.py --only regex

An entry is (name, file, find, replace, [suites]). `file` is a name in
`horde-studio-mobile/js/`, or a repo-root path with a slash in it —
`apk-build/src/…/MainActivity.java` — for the few checks that reach the wrapper.
`find` has to occur exactly once in the file: that is also what keeps this list honest as the source moves,
because a stale anchor is reported as ANCHOR rather than the mutation quietly
replacing nothing. `tests/mutation-harness-test.js` re-runs those anchor checks
and the suite-name checks on every sweep, so this file cannot rot in silence.

Add to it with every release: for each check you write, break the thing it
guards and show it fails. That is the whole quality bar for this repo.
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS = os.path.join(ROOT, 'horde-studio-mobile', 'js')
TESTS = os.path.join(ROOT, 'tests')

MUTATIONS = [
    # ---- v1.47.0: card `use_regex`, behind the player's switch ---------------
    ("a card can approve itself (regex gate dropped)",
     'api.js',
     "var patterns = !!(o.regex && e.useRegex === true);",
     "var patterns = (e.useRegex === true);",
     ['lore-card-features-test.js']),

    ("regex keys fall back to plain text when they will not compile",
     'api.js',
     "var hay = raw, matched = keys.filter(function (k) { return k && stands(e, patterns, k, hay, text); });",
     "var hay = raw, matched = keys.filter(function (k) { return k && stands(e, false, k, hay, text); });",
     ['lore-card-features-test.js']),

    ("the exponential-shape refusal is turned off",
     'api.js',
     "if (scriptLooksEvil(src)) out = { re: null, why: 'nested repeat' };",
     "if (false) out = { re: null, why: 'nested repeat' };",
     ['lore-card-features-test.js']),

    ("the Lore readout stops counting entries that asked for patterns",
     'api.js',
     "patternAsked: (entries || []).filter(function (e) { return e && e.useRegex === true; }).length,",
     "patternAsked: 0,",
     ['lore-card-features-test.js']),

    # ---- v1.47.0: recursive_scanning, bounded -------------------------------
    ("the hop ceiling is removed",
     'api.js',
     "var LORE_CHAIN_MAX = 3;",
     "var LORE_CHAIN_MAX = 999;",
     ['lore-card-features-test.js']),

    ("the pool a hop is drawn from is unbounded",
     'api.js',
     "var LORE_CHAIN_FROM = 20;",
     "var LORE_CHAIN_FROM = 999999;",
     ['lore-card-features-test.js']),

    ("a chained entry may out-rank one the chat matched",
     'api.js',
     ": (isChain ? LORE_CHAIN_FROM + isChain : recencyOf(e, patterns, matched.length ? matched : keys)),",
     ": recencyOf(e, patterns, matched.length ? matched : keys),",
     ['lore-card-features-test.js']),

    # ---- v1.47.0: what the store keeps, and what it defaults to -------------
    ("the importer stops mirroring use_regex",
     'store.js',
     "useRegex: e.use_regex,",
     "useRegex: undefined,",
     ['lore-card-features-test.js', 'card-roundtrip-test.js']),

    ("both switches ship on instead of off",
     'store.js',
     "honorCardRegex: false, honorCardRecursion: false,",
     "honorCardRegex: true, honorCardRecursion: true,",
     ['lore-card-features-test.js']),

    # ---- v1.47.0: the screen and the import note ---------------------------
    ("the Lore readout is computed without the player's settings",
     'views.js',
     "stage, API.loreOpts(c, Store.settings));",
     "stage, API.loreOpts(c));",
     ['lore-card-features-test.js', 'lore-stage-test.js']),

    ("a row's own flags no longer earn it a badge line",
     'views.js',
     "r.useRegex || r.patterns || r.chained || r.insertionOrder !== null",
     "r.insertionOrder !== null",
     ['lore-card-features-test.js']),

    ("the import note never mentions regex keys",
     'app.js',
     "if (regexed) {",
     "if (false) {",
     ['import-warnings-test.js']),

    # ---- v1.48.0: coming back to them --------------------------------------
    ("an arrival cannot be counted, only announced",
     'app.js',
     "    VH.arrived(char, count);",
     "    /* VH.arrived(char, count); */",
     ['vhuman-away-test.js']),

    ("the badge survives opening their chat",
     'app.js',
     "if (c && c.vh && (c.vh.unread > 0 || c.vh.unreadAt)) { VH.read(c); App.persistVH(c); }",
     "if (c && c.vh) { App.persistVH(c); }",
     ['vhuman-away-test.js']),

    ("a toast is fired into a screen nobody is looking at",
     'app.js',
     "    else App.notifyAway(char, note);",
     "    else void 0;",
     ['vhuman-away-test.js']),

    ("the notification is built whether or not it was allowed",
     'app.js',
     "    if (window.Notification.permission !== 'granted') return false;",
     "",
     ['vhuman-away-test.js']),

    ("the notify switch turns itself on even when refused",
     'app.js',
     "      var granted = p === 'granted';",
     "      var granted = true;",
     ['vhuman-away-test.js']),

    ("the away switch does not actually gate the clock",
     'app.js',
     "      if ((Store.settings || {}).lifeWhileAway === true) App.lifeTick({ background: true });",
     "      App.lifeTick({ background: true });",
     ['vhuman-away-test.js']),

    ("a background tick redraws screens nobody can see",
     'app.js',
     "    if (!opts.background) {",
     "    if (true) {",
     ['vhuman-away-test.js']),

    ("a zero count becomes an arrival",
     'vhuman.js',
     "      if (!isFinite(n) || !(n > 0)) return vh;",
     "      if (!isFinite(n)) return vh;",
     ['vhuman-away-test.js']),

    ("the unread count can grow without bound",
     'vhuman.js',
     "      vh.unread = Math.min(999, (vh.unread || 0) + n);",
     "      vh.unread = (vh.unread || 0) + n;",
     ['vhuman-away-test.js']),

    ("every arrival rewrites when they first wrote",
     'vhuman.js',
     "      if (!(vh.unread > 0)) vh.unreadAt = Date.now();",
     "      vh.unreadAt = Date.now();",
     ['vhuman-away-test.js']),

    ("a published human carries the publisher's unread state",
     'vhuman.js',
     "      copy.vh.unread = 0; copy.vh.unreadAt = 0; copy.vh.seenAt = 0;",
     "      copy.vh.unreadAt = 0;",
     ['vhuman-away-test.js']),

    ("the away cost switch ships on",
     'store.js',
     "    lifeWhileAway: false,",
     "    lifeWhileAway: true,",
     ['vhuman-away-test.js', 'regex-scripts-test.js']),

    ("the Life card says the hint, and nothing about the messages",
     'views.js',
     "    var unreadLine = VH.unreadLine(vh, UI.fmtTime);",
     "    var unreadLine = '';",
     ['vhuman-away-test.js']),

    ("the Life screen's sentence about the day ignores the setting",
     'views.js',
     "    var away = (Store.settings || {}).lifeWhileAway === true;",
     "    var away = true;",
     ['vhuman-away-test.js']),

    ("every chat of theirs claims the new messages",
     'views.js',
     "        var marks = (c.vh && c.vh.unread > 0 && newestOf[s.charId] === s.id) ? c.vh.unread : 0;",
     "        var marks = (c.vh && c.vh.unread > 0) ? c.vh.unread : 0;",
     ['vhuman-away-test.js']),

    ("the away switch is on the screen but wired to nothing",
     'views.js',
     "    sc.toggle('#t-away', 'lifeWhileAway');",
     "",
     ['vhuman-away-test.js']),

    # ---- v1.48.1: a cast the player vouched for ----------------------------
    ("the one-person-card clear deletes a cast the player typed",
     'app.js',
     "if (session.sceneCast && session.sceneCast.length && !session.castEdited) {",
     "if (session.sceneCast && session.sceneCast.length) {",
     ['scenecast-test.js']),

    ("eight names is a suggestion",
     'app.js',
     "    return names.slice(0, 8);",
     "    return names;",
     ['scenecast-test.js']),

    ("a 25-character label becomes a person",
     'app.js',
     "      if (!n || n.length > 24 || seen[n.toLowerCase()]) return;",
     "      if (!n || seen[n.toLowerCase()]) return;",
     ['scenecast-test.js']),

    ("a name that left the scene is still being spoken to",
     'app.js',
     "    if (session.addressedTo && list.indexOf(session.addressedTo) === -1) session.addressedTo = '';",
     "    /* left as it was */;",
     ['scenecast-test.js']),

    ("a save that changed nothing rewrites the chat",
     'app.js',
     "    if (same) return false;",
     "    if (false) return false;",
     ['scenecast-test.js']),

    ("the cast box opens empty, whatever the chat holds",
     'app.js',
     "      var castNames = Array.isArray(s.sceneCast) ? s.sceneCast : [];",
     "      var castNames = [];",
     ['chat-settings-save-test.js']),

    ("the sheet's excuse is invented rather than read from the card",
     'app.js',
     "      var castSeen = castChar ? App.detectCast(castChar) : [];",
     "      var castSeen = [];",
     ['scenecast-test.js']),

    ("a group chat is handed a cast field its strip will not show",
     'app.js',
     "      if (groupChat) {",
     "      if (false) {",
     ['scenecast-test.js']),

    ("a living character is handed the field too",
     'app.js',
     "      } else if (castChar && castChar.vh && castChar.vh.enabled) {",
     "      } else if (false) {",
     ['scenecast-test.js']),

    ("the cast is read after the sheet has cleared its form",
     'app.js',
     "              cast: b.querySelector('#cs-cast') ? b.querySelector('#cs-cast').value : null",
     "              cast: null",
     ['chat-settings-save-test.js']),

    ("resetting a chat empties its room as well",
     'app.js',
     "          s.sceneNotePlacement = 'end';",
     "          s.sceneNotePlacement = 'end'; s.sceneCast = [];",
     ['chat-settings-save-test.js']),

    ("the strip is left showing the old cast after a save",
     'app.js',
     "          if (castChanged && App.state.session && App.state.session.id === s.id) App.renderSceneCast();",
     "          void castChanged;",
     ['chat-settings-save-test.js']),

    # ---- v1.48.2: what an export is called on the phone ---------------------
    ("a markdown export is declared as plain text again",
     'apk-build/src/com/hordestudio/mobile/MainActivity.java',
     'if (n.endsWith(".md")) return "text/markdown";',
     'if (n.endsWith(".md")) return "text/plain";',
     ['export-name-test.js']),

    ("the export path stops using the tested table",
     'apk-build/src/com/hordestudio/mobile/MainActivity.java',
     'return mimeForExport(name);',
     'return "application/octet-stream";',
     ['export-name-test.js']),

    ("the append is never recognised, so nothing is taken back",
     'apk-build/src/com/hordestudio/mobile/MainActivity.java',
     'if (wanted.equals(stored)) return false;',
     'if (true) return false;',
     ['export-name-test.js']),

    ("the saved file is never read back after the write",
     'apk-build/src/com/hordestudio/mobile/MainActivity.java',
     'String stored = queryDisplayName(uri);',
     'String stored = name;',
     ['export-name-test.js']),

    ("a person who speaks once in quoted speech is not believed",
     'app.js',
     "      if (!c.strong) {",
     "      if (true) {",
     ['scenecast-test.js']),

    # ---- v1.48.3: what the footer claims about how a reply ended ------------
    ("the footer goes back to its own list of endings",
     'views.js',
     "    if (typeof API !== 'undefined' && API && API.looksTruncated) {",
     "    if (false) {",
     ['message-footer-test.js']),

    ("an action beat is treated as a cut again",
     'api.js',
     "    if (/\\*\\s*$/.test(t)) return false;",
     "    if (false) return false;",
     ['message-footer-test.js']),

    ("a greeting gets diagnosed as a reply that stopped early",
     'views.js',
     "    if (m && m.fromGreeting) return words;",
     "    if (false) return words;",
     ['message-footer-test.js']),

    ("the greeting is no longer marked as one",
     'app.js',
     "alts: alts, altIdx: 0, fromGreeting: true }",
     "alts: alts, altIdx: 0 }",
     ['message-footer-test.js']),

    ("the toast names the file it hoped for, not the one it got",
     'apk-build/src/com/hordestudio/mobile/MainActivity.java',
     'final String shown = savedName;',
     'final String shown = name;',
     ['export-name-test.js']),

    # ---- v1.48.4: the two bars that frame every screen ----------------------
    ("a shell bar goes back onto a composited layer",
     'horde-studio-mobile/css/app.css',
     "  background-color:var(--bg-2);background-image:linear-gradient(var(--bar-bg),var(--bar-bg));",
     "  background:var(--bar-bg);backdrop-filter:blur(16px);",
     ['shell-chrome-test.js']),

    ("the bottom bar's colour turns translucent again",
     'horde-studio-mobile/css/app.css',
     "  background-color:var(--bg-2);background-image:linear-gradient(var(--bar-bg),var(--bar-bg));",
     "  background-color:rgba(11,10,18,.94);background-image:linear-gradient(var(--bar-bg),var(--bar-bg));",
     ['shell-chrome-test.js']),

    ("the top bar loses the colour behind its tint",
     'horde-studio-mobile/css/app.css',
     "  background-color:var(--bg-2);background-image:linear-gradient(to bottom,",
     "  background-image:linear-gradient(to bottom,",
     ['shell-chrome-test.js']),

    ("the top bar goes back onto a composited layer",
     'horde-studio-mobile/css/app.css',
     "background-image:linear-gradient(to bottom,rgba(11,10,18,.96),rgba(11,10,18,.72));",
     "background-image:linear-gradient(to bottom,rgba(11,10,18,.96),rgba(11,10,18,.72));backdrop-filter:blur(16px);",
     ['shell-chrome-test.js']),

    ("a theme tints its bars with alpha only",
     'themes.js',
     "t('#0b0a12','#12101c'",
     "t('#0b0a12','rgba(18,16,28,.94)'",
     ['shell-chrome-test.js']),

    ("the viewport upgrade is written for the wrong unit",
     'horde-studio-mobile/css/app.css',
     ".view{min-height:100dvh}",
     ".view{min-height:100vh}",
     ['shell-chrome-test.js']),

    ("the chats search field refuses to shrink",
     'horde-studio-mobile/css/app.css',
     '.chat-tools input[type="search"]{flex:1;min-width:0;',
     '.chat-tools input[type="search"]{flex:1;',
     ['shell-chrome-test.js']),

    ("the chats tools row cannot wrap",
     'horde-studio-mobile/css/app.css',
     '.chat-tools{display:flex;flex-wrap:wrap;',
     '.chat-tools{display:flex;',
     ['shell-chrome-test.js']),

    ("one message is counted in the plural",
     'views.js',
     "n + ' message' + (n === 1 ? '' : 's')",
     "n + ' messages' + (n === 1 ? '' : 's')",
     ['shell-chrome-test.js']),

    # ---- v1.48.5: a stored memory that is really a JSON answer --------------
    ("the warning forgets the JSON wrapper",
     'api.js',
     "    if (memoryIsWrapper(t)) return true;",
     "    if (false) return true;",
     ['memory-wreckage-test.js']),

    ("the salvage path grows a second copy of the wrapper test",
     'api.js',
     "    if (!memoryIsWrapper(t)) return t;",
     "    if (!/^\\[{/.test(t)) return t;",
     ['memory-wreckage-test.js']),

    ("the chats list prints whatever is stored",
     'views.js',
     "                  return esc(unreadable || !s.summary",
     "                  return esc(!s.summary",
     ['memory-wreckage-test.js']),

    ("recovery writes straight to the store",
     'app.js',
     "            body.querySelector('#sum').value = r.text;",
     "            s.summary = r.text; Store.putSession(s); UI.toast('Fixed');",
     ['memory-wreckage-test.js']),

    ("a failed recovery empties the field anyway",
     'app.js',
     "            if (!r.ok) { UI.toast('Nothing to recover — ' + r.reason); return; }",
     "            if (!r.ok) { body.querySelector('#sum').value = ''; UI.toast('Cleared'); return; }",
     ['memory-wreckage-test.js']),

    ("the sheet keeps the warning but drops the repair",
     'app.js',
     "? '<button type=\"button\" class=\"btn ghost sm\" id=\"recoverbad\">Recover the summary</button> '",
     "? ''",
     ['memory-wreckage-test.js']),

    # ---- v1.48.6: the message counter, its owner, and the memory gate --------
    ("a generic session save can move the counter",
     'store.js',
     "        if (cur) s.messageCount = cur.messageCount;",
     "        /* the belt is off: last writer wins, as it was */",
     ['session-counter-test.js']),

    ("the counter counts a status notice as a turn",
     'store.js',
     "        if (msg.role !== 'system') s.messageCount = (s.messageCount || 0) + 1;",
     "        s.messageCount = (s.messageCount || 0) + 1;",
     ['session-counter-test.js']),

    ("a bookmark past the end of the transcript is left there",
     'store.js',
     "    if (at > n) s.memAt = n;",
     "    /* no clamp */",
     ['session-counter-test.js']),

    ("the memory gate can answer negative",
     'store.js',
     "      return Math.max(0, seen - at);",
     "      return seen - at;",
     ['session-counter-test.js']),

    ("the pre-v1.39 bookmark name is forgotten",
     'store.js',
     "      var at = s.memAt || s.memoryAt || 0;",
     "      var at = s.memAt || 0;",
     ['session-counter-test.js']),

    ("the recount becomes a read",
     'store.js',
     "          if (!applyCount(s, n)) return n;",
     "          return n;",
     ['session-counter-test.js']),

    ("opening a chat no longer heals the cache",
     'app.js',
     "            return Store.reconcile(s, msgs);",
     "            return null;",
     ['session-counter-test.js']),

    ("an edit-and-resend deletes rows and keeps the total",
     'app.js',
     "        return Store.removeMessages(after).then(function () {",
     "        return Promise.all(after.map(function (x) { return Store.delMessage(x.id); })).then(function () {",
     ['session-counter-test.js', 'editresend-test.js']),

    ("the prompt history decides for itself which rows are turns",
     'app.js',
     "          history: Store.transcript(msgs), note: note",
     "          history: msgs, note: note",
     ['session-counter-test.js']),

    ("the channel cannot tell what an APK really is",
     'tools/build-channel.py',
     "var VERSION = '([^']+)'",
     "var NOPE = '([^']+)'",
     ['version-consistency-test.js']),

    ("a refusal that reports success",
     'tools/build-channel.py',
     "    sys.exit(main())",
     "    main()",
     ['version-consistency-test.js']),
]

TIMEOUT = 240


def run_suite(name):
    """(ok, first failure line). A suite that cannot start is a failure."""
    try:
        p = subprocess.run(['timeout', str(TIMEOUT), 'node', os.path.join(TESTS, name)],
                           cwd=ROOT, capture_output=True, text=True)
    except Exception as e:                                    # pragma: no cover
        return False, 'could not run: %s' % e
    why = ''
    for line in (p.stdout or '').split('\n'):
        if 'FAIL' in line:
            why = line.strip()[:160]
            break
    if p.returncode not in (0, 1):
        why = why or ('exit %d: %s' % (p.returncode, (p.stderr or '').strip()[:160]))
    return p.returncode == 0, why


def resolve(rel):
    """A bare name is a file in horde-studio-mobile/js; a path with a slash in it is
    relative to the repo root, which is how the Android wrapper is covered too."""
    return rel if '/' in rel else os.path.join(JS, rel)


def read(rel):
    with open(resolve(rel), encoding='utf-8') as f:
        return f.read()


def write(rel, text):
    with open(resolve(rel), 'w', encoding='utf-8') as f:
        f.write(text)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    only = ''
    if '--only' in sys.argv:
        only = args[0] if args else ''
    entries = [m for m in MUTATIONS if not only or only.lower() in m[0].lower()]

    if '--list' in sys.argv:
        for m in MUTATIONS:
            print('%-58s %s  [%s]' % (m[0], m[1], ', '.join(m[4])))
        print('\n%d mutations, each killing at least one suite.' % len(MUTATIONS))
        return 0

    print('mutation-check: %d breaks\n' % len(entries))

    # A suite that is already red proves nothing about the break, so check first.
    needed = sorted({s for m in entries for s in m[4]})
    baseline = [(s, run_suite(s)[0]) for s in needed]
    bad = [s for s, ok in baseline if not ok]
    if bad:
        print('REFUSING to run: these suites are already failing on the source as it is:')
        for b in bad:
            print('   ' + b)
        print('Fix them first — a red baseline makes every result below meaningless.')
        return 2

    killed = lost = survived = 0
    for name, rel, old, new, suites in entries:
        src = read(rel)
        n = src.count(old)
        if n != 1:
            print('ANCHOR  %-58s %s: %r found %d times, want 1' % (name, rel, old[:48], n))
            lost += 1
            continue
        try:
            write(rel, src.replace(old, new, 1))
            died = []
            for s in suites:
                ok, why = run_suite(s)
                if not ok:
                    died.append(s)
                    print('  killed by %-34s %s' % (s, why))
            if died:
                print('KILLED  %s' % name)
                killed += 1
            else:
                print('SURVIVED %s — every named suite still passes, so nothing here '
                      'tests what this break changes' % name)
                survived += 1
        finally:
            write(rel, src)

    print('\n%d killed, %d survived, %d anchors lost.' % (killed, survived, lost))
    if survived or lost:
        print('A survived break means the check is decorative; an anchor lost means this '
              'list went stale when the source moved. Both need fixing before release.')
        return 1
    print('Every break is caught by at least one suite.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
