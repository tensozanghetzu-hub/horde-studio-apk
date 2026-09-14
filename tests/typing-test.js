/* The three dots must only move while something is actually happening.

 * Regression: #typing carries the `hidden` attribute and no JS ever touched it,
 * but `.typing{display:flex}` in the stylesheet beat the browser's
 * `[hidden]{display:none}` rule — so the dots bounced forever, always.
 *
 * Needs chromium (real CSS cascade) and the static server on :8000.
 *   python3 -m http.server 8000 --directory /home/user/horde-studio-mobile
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

function findBrowser() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ||
    path.join(process.env.HOME || '/home/user', '.cache', 'ms-playwright');
  if (!fs.existsSync(root)) return null;
  for (const dir of fs.readdirSync(root)) {
    const exe = path.join(root, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

let pass = 0, fail = 0;
const ok = (l, c, d) => {
  c ? (pass++, console.log('  ok   ' + l + (d ? '  → ' + d : '')))
    : (fail++, console.log('  FAIL ' + l + (d ? '  → ' + d : '')));
};

(async () => {
  const exe = findBrowser();
  if (!exe) { console.log('SKIP: no chromium.  python3 -m playwright install chromium'); process.exit(0); }

  const b = await chromium.launch({ executablePath: exe });
  const p = await b.newPage({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 2 });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:8000/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(1100);

  await p.evaluate(async () => {
    const c = Store.blankCharacter();
    c.name = 'Rachel'; c.persona = 'Ward nurse.'; c.greeting = 'You are awake.';
    await Store.putCharacter(c);
    await Store.refreshCharacters();
    App.state.char = Store.characters.find(x => x.name === 'Rachel') || c;
    await App.newChat(c.id);
    await new Promise(r => setTimeout(r, 350));
    App.go('chat');
  });
  await p.waitForTimeout(600);

  const dots = p.locator('#typing');
  const state = () => p.evaluate(() => {
    const t = document.getElementById('typing');
    const r = t.getBoundingClientRect();
    return {
      hidden: t.hidden,
      display: getComputedStyle(t).display,
      painted: r.width > 0 && r.height > 0,
      anim: getComputedStyle(t.querySelector('span')).animationName
    };
  });

  console.log('1. sitting in a chat, nothing happening');
  let s = await state();
  ok('the dots are not visible', !(await dots.isVisible()) && s.display === 'none', `display:${s.display}`);
  ok('and they are not painted', s.painted === false);

  console.log('\n2. a reply is on the way');
  await p.evaluate(() => { App.state.busy = true; App.genStart('Sending to the Horde…', null); });
  await p.waitForTimeout(150);
  s = await state();
  ok('the dots appear', (await dots.isVisible()) && s.painted, `display:${s.display}`);
  ok('they animate', s.anim === 'bounce', s.anim);

  console.log('\n3. the reply lands');
  await p.evaluate(() => { App.genStop(); App.state.busy = false; App.renderTyping(); });
  await p.waitForTimeout(150);
  s = await state();
  ok('the dots go away', !(await dots.isVisible()) && s.display === 'none');

  console.log('\n4. a virtual human mid-burst');
  await p.evaluate(() => { App.state.bursting = 1; App.renderTyping(); });
  await p.waitForTimeout(150);
  ok('they show between burst bubbles', await dots.isVisible());
  await p.evaluate(() => { App.state.bursting = 0; App.renderTyping(); });
  await p.waitForTimeout(150);
  ok('and stop when the burst ends', !(await dots.isVisible()));

  console.log('\n5. working, but on another screen');
  await p.evaluate(() => { App.state.busy = true; App.genStart('Generating…', null); App.go('settings'); });
  await p.waitForTimeout(200);
  s = await state();
  ok('no dots on other screens', !(await dots.isVisible()) && s.display === 'none', `display:${s.display}`);
  await p.evaluate(() => { App.genStop(); App.state.busy = false; App.go('chat'); });
  await p.waitForTimeout(200);
  ok('back in chat, idle, still no dots', !(await dots.isVisible()));

  console.log('\n6. the hidden attribute alone is enough to hide them');
  s = await p.evaluate(() => {
    const t = document.getElementById('typing');
    t.hidden = false; App.renderTyping();
    return getComputedStyle(t).display;
  });
  ok('hidden really means hidden', s === 'none', `display:${s}`);

  ok('no page errors along the way', errs.length === 0, errs.slice(0, 2).join(' | '));

  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
