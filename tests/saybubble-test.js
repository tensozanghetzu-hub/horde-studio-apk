/* saybubble-test — v1.39.1: spoken dialogue gets its own visible span.
   UI.md wraps straight (&quot;) and curly (“…”) speech in <span class="say">;
   app.css styles it upright against the usual italic narration. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', 'horde-studio-mobile', 'js');
const readUi = () => fs.readFileSync(path.join(ROOT, 'ui.js'), 'utf8');

function loadUI() {
  const sandbox = {
    console, JSON, Math, Date, String, Object, Array, setTimeout, clearTimeout,
    document: { getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {} }), body: { appendChild() {}, removeChild() {} } },
    navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }
  };
  sandbox.window = sandbox; sandbox.global = sandbox;
  vm.runInNewContext(readUi(), sandbox, { filename: 'ui.js' });
  return sandbox.UI;
}

(async function main() {
  let failed = 0, count = 0;
  const tests = [];
  const t = (name, fn) => tests.push([name, fn]);
  const ok = (n, c, d) => { count++; if (c) console.log('  ok ' + n); else { failed++; console.log('  FAIL ' + n + (d ? '  → ' + d : '')); } };

  try {
    console.log('A — md() marks spoken spans');

    t('a straight quote becomes a say span', () => {
      const UI = loadUI();
      const out = UI.md('"Ring the bell twice," she said.');
      return out.indexOf('<span class="say">&quot;Ring the bell twice,&quot;</span>') !== -1
          || out.indexOf('<span class="say">"Ring the bell twice,"</span>') !== -1
          || out.includes('class="say"');
    });

    t('quotes keep their mark characters (nothing hidden)', () => {
      const UI = loadUI();
      const out = UI.md('He grumbled, "Fine."');
      return /&quot;Fine.&quot;|"Fine\."/.test(out) && out.includes('class="say"');
    });

    t('two bits of speech in one line both get marked', () => {
      const UI = loadUI();
      const out = UI.md('"First door," he said, then "the second" quietly.');
      return (out.match(/class="say"/g) || []).length === 2;
    });

    t('apostrophes inside dialogue do not break the span', () => {
      const UI = loadUI();
      const out = UI.md('"You can\'t mean that." She froze.');
      return /class="say"/.test(out) && /can&#39;t/.test(out);
    });

    t('an unmatched quote marks nothing (no half-spans)', () => {
      const UI = loadUI();
      const out = UI.md('He said "something and stopped.');
      return !/class="say"/.test(out);
    });

    t('curly “smart” quotes are marked too', () => {
      const UI = loadUI();
      const out = UI.md('\u201cForward,\u201d she called.');
      return /class="say"/.test(out);
    });

    t('emphasis inside speech still renders', () => {
      const UI = loadUI();
      const out = UI.md('"Show me the *true* blade."');
      return /class="say"/.test(out) && /<em>true<\/em>/.test(out);
    });

    t('emphasis wrapping speech keeps the span inside', () => {
      const UI = loadUI();
      const out = UI.md('*He leaned in.* "Closer."');
      return /<em>He leaned in.<\/em>/.test(out) && /class="say"/.test(out);
    });

    t('quotes inside code fences are untouched', () => {
      const UI = loadUI();
      const out = UI.md('```\nprint("none marked here")\n```');
      return !/class="say"/.test(out) && /<pre>/.test(out);
    });

    t('no speech, no span, no change', () => {
      const UI = loadUI();
      const before = UI.md('Plain narration, italic *carving*, bold **boom**.');
      return !/class="say"/.test(before) && before ===
        'Plain narration, italic <em>carving</em>, bold <strong>boom</strong>.';
    });

    console.log('B — the styling exists and separates speech from narration');
    const css = fs.readFileSync(path.join(__dirname, '..', 'horde-studio-mobile', 'css', 'app.css'), 'utf8');
    ok('a .say rule exists on the bubble text', /\.mtext \.say|\.bubble[^\n]*\.say/.test(css));
    ok('speech is upright (fights the narration italics)', /\.mtext \.say\s*{[^}]*font-style:\s*normal/.test(css));
    ok('speech is heavier than narration', /\.mtext \.say\s*{[^}]*font-weight:\s*(500|600|700)/.test(css));

    for (const [n, fn] of tests) ok(n, !!fn());
  } catch (e) {
    failed++;
    console.log('  FAIL battery threw  → ' + (e && e.message || e));
  }
  console.log('\nsaybubble-test: ' + (failed ? (failed + ' FAILED, ') : '') + count + ' checks');
  process.exit(failed ? 1 : 0);
})();
