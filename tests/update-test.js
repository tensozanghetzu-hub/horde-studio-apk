/* Self-update: the JS flow, the Settings screen, and the real server contract.
 * The native bridge is simulated; the HTTP is not — version.json and web.zip are
 * fetched for real.
 *
 *   python3 -m http.server 8000 --directory /home/user/horde-studio-mobile
 *   python3 /home/user/apk-download/server.py          # :8010
 *   node update-test.js
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const BASE = 'https://8010-i7nlfw0lsd86vnlhldpcm.e2b.app/';   // baked into the build
const LOCAL = 'http://127.0.0.1:8010';                        // the same server, reachable in here

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

/* A stand-in for the Java bridge: same method names, same job polling. */
const bridge = (apk, code, rev) => `
(() => {
  const jobs = new Map(); let next = 1; let overlay = ${rev ? `{ rev: '${rev}' }` : 'null'};
  window.__u = { applied: [], cleared: 0, opened: [], installed: [], confirmed: 0, checks: [] };
  window.HSAndroid = {
    updateInfo: () => JSON.stringify({ apk: '${apk}', apkCode: ${code},
      overlay: !!overlay, rev: overlay ? overlay.rev : '' }),
    checkUpdate(url) {
      const id = next++; window.__u.checks.push(url);
      jobs.set(id, { state: 'running', progress: 0, message: '', result: '' });
      fetch(url).then(r => r.text())
        .then(t => jobs.set(id, { state: 'done', progress: 100, message: '', result: t }))
        .catch(e => jobs.set(id, { state: 'error', progress: 0, message: String(e), result: '' }));
      return id;
    },
    applyWebUpdate(url, rev) {
      const id = next++;
      jobs.set(id, { state: 'running', progress: 0, message: '', result: '' });
      fetch(url).then(r => r.arrayBuffer()).then(buf => {
        window.__u.applied.push({ url, rev, bytes: buf.byteLength });
        overlay = { rev: String(rev) };
        jobs.set(id, { state: 'done', progress: 100, message: '', result: String(rev) });
      }).catch(e => jobs.set(id, { state: 'error', progress: 0, message: String(e), result: '' }));
      return id;
    },
    jobStatus(id) {
      const j = jobs.get(id);
      if (!j) return JSON.stringify({ state: 'error', message: 'no such job', progress: 0, result: '' });
      return JSON.stringify(j);
    },
    confirmUpdate: () => { window.__u.confirmed++; },
    clearWebUpdate: () => { overlay = null; window.__u.cleared++; },
    installApk: (url) => { window.__u.installed.push(url); },
    openDownload: (url) => { window.__u.opened.push(url); },
    pickUpdateZip() {
      window.__u.picked = true;
      const id = next++;
      jobs.set(id, { state: 'running', progress: 0, message: '', result: '' });
      setTimeout(() => {
        overlay = { rev: 'f1700000000' };
        jobs.set(id, { state: 'done', progress: 100, message: '', result: 'f1700000000' });
      }, 250);
      return id;
    }
  };
})();`;

async function open(browser, script) {
  const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
  await page.addInitScript(script);
  await page.goto('http://127.0.0.1:8000/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  return page;
}

(async () => {
  const exe = findBrowser();
  if (!exe) { console.log('SKIP: no chromium'); process.exit(0); }
  const browser = await chromium.launch({ executablePath: exe });

  console.log('1. an old build meets the current server');
  let page = await open(browser, bridge('1.4.4', 9, ''));
  let r = await page.evaluate(async (LOCAL) => {
    const out = { supported: Updates.supported(), base: Updates.baseUrl(), info: Updates.info() };
    out.default = out.base;
    await Updates.saveUrl(LOCAL);
    out.base = Updates.baseUrl();
    const res = await Updates.check();
    out.newApk = res.newApk; out.newWeb = res.newWeb;
    out.remote = { apk: res.remote.apk, code: res.remote.apkCode, rev: res.remote.webRev, files: res.remote.files };
    out.localCode = res.local.apkCode;
    out.checkUrl = window.__u.checks[0];
    return out;
  }, LOCAL);
  ok('the updater is available', r.supported);
  ok('it defaults to the update server', r.default === BASE.replace(/\/+$/, ''), r.default);
  ok('the address can be overridden', r.base === LOCAL, r.base);
  ok('it read the installed version from the wrapper', r.localCode === 9 && r.info.apk === '1.4.4');
  ok('the server answered', !!r.remote.rev && r.remote.files > 10, `apk ${r.remote.apk} · rev ${r.remote.rev} · ${r.remote.files} files`);
  ok('it fetched version.json', /\/version\.json$/.test(r.checkUrl || ''), r.checkUrl);
  ok('a web-only update is offered', r.newWeb === true);

  console.log('\n2. applying it (no reinstall)');
  r = await page.evaluate(async () => {
    const out = {};
    const res = await Updates.check();
    const rev = await Updates.applyWeb(res.remote.webRev);
    out.rev = String(rev); out.want = String(res.remote.webRev);
    out.applied = window.__u.applied[0];
    out.info = Updates.info();
    out.pending = localStorage.getItem('hs.pendingRev');
    return out;
  });
  ok('the bundle was downloaded for real', r.applied && r.applied.bytes > 50000, (r.applied || {}).bytes + ' bytes');
  ok('/web.zip was the url', /\/web\.zip$/.test(r.applied.url || ''));
  ok('the revision is now live', r.info.overlay === true && r.info.rev === r.want, r.info.rev);
  ok('the boot watchdog is armed', r.pending === r.want);

  console.log('\n3. the same revision is not offered twice');
  r = await page.evaluate(async () => {
    const res = await Updates.check();
    return { newWeb: res.newWeb, newApk: res.newApk };
  });
  ok('no repeat offer', r.newWeb === false);

  const ver = await (await fetch(LOCAL + '/version.json')).json();
  const fresh = await open(browser, bridge(ver.apk, ver.apkCode, ver.webRev));
  r = await fresh.evaluate(async (LOCAL) => {
    await Updates.saveUrl(LOCAL);
    const res = await Updates.check();
    return { upToDate: !!res.upToDate, newApk: res.newApk, newWeb: res.newWeb };
  }, LOCAL);
  ok('a fully current install reports up to date', r.upToDate && !r.newApk && !r.newWeb);
  await fresh.close();

  console.log('\n4. reset takes it back to the shipped files');
  r = await page.evaluate(() => {
    Updates.reset();
    return { info: Updates.info(), cleared: window.__u.cleared, pending: localStorage.getItem('hs.pendingRev') };
  });
  ok('overlay is gone', r.info.overlay === false && r.info.rev === '');
  ok('the watchdog is disarmed', r.pending === null && r.cleared === 1);

  console.log('\n5. a new app version: in-app install, browser as fallback');
  r = await page.evaluate(() => {
    const out = { hasInstall: typeof Updates.installApk === 'function' };
    Updates.installApk();
    out.installed = window.__u.installed[0];
    Updates.openDownload();
    out.opened = window.__u.opened[0];
    return out;
  });
  ok('the in-app install is available', r.hasInstall === true);
  ok('it hands the APK to Android', r.installed === LOCAL + '/app', r.installed);
  ok('the browser fallback still works', r.opened === LOCAL + '/', r.opened);

  console.log('\n5b. applying from a file, with no network involved');
  r = await page.evaluate(async () => {
    const out = { has: typeof Updates.applyFile === 'function' };
    const rev = await Updates.applyFile();
    out.rev = String(rev);
    out.info = Updates.info();
    out.picked = !!window.__u.picked;
    out.stored = localStorage.getItem('hs.pendingRev');
    return out;
  });
  ok('the file route exists', r.has === true);
  ok('it opened a picker', r.picked === true);
  ok('the revision from the file is live', r.info.overlay === true && r.info.rev === 'f1700000000', r.info.rev);
  ok('the watchdog is armed for it too', r.stored === 'f1700000000');
  await page.evaluate(() => { Updates.reset(); });

  console.log('\n6. a bad address fails politely');
  r = await page.evaluate(async () => {
    await Updates.saveUrl('https://127.0.0.1:9/nothing-here/');
    try { await Updates.check(); return { threw: false }; }
    catch (e) { return { threw: true, message: e.message || String(e) }; }
  });
  ok('it reports an error rather than hanging', r.threw === true && /Could not reach/.test(r.message), r.message);

  console.log('\n7. the Settings screen drives it');
  await page.close();
  page = await open(browser, bridge('1.4.4', 9, ''));
  r = await page.evaluate(async (LOCAL) => {
    Updates.reloadFresh = function () { window.__u.reloaded = true; };
    await Updates.saveUrl(LOCAL);
    App.go('settings');
    const body = document.getElementById('settings-body');
    const out = { group: /App updates/.test(body.textContent), url: (document.getElementById('set-updurl') || {}).value };
    document.getElementById('btn-upd-check').click();
    await new Promise(r => setTimeout(r, 2500));
    out.status = (document.getElementById('upd-status') || {}).textContent || '';
    out.applyBtn = !!document.getElementById('btn-upd-apply');
    if (out.applyBtn) {
      document.getElementById('btn-upd-apply').click();
      await new Promise(r => setTimeout(r, 2500));
      out.after = (document.getElementById('upd-status') || {}).textContent || '';
      out.reloaded = !!window.__u.reloaded;
    }
    return out;
  }, LOCAL);
  ok('the App updates group is there', r.group);
  ok('the address is prefilled', /8010/.test(r.url || ''), r.url);
  ok('checking shows what is available', /without reinstalling/.test(r.status), JSON.stringify((r.status || '').slice(0, 60)));
  ok('applying reports and reloads', /Applied/.test(r.after || '') && r.reloaded, JSON.stringify((r.after || '').slice(0, 40)));

  console.log('\n8. a build that cannot self-update says so');
  await page.close();
  page = await browser.newPage({ viewport: { width: 360, height: 800 } });
  await page.addInitScript(() => { delete window.HSAndroid; });
  await page.goto('http://127.0.0.1:8000/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(900);
  r = await page.evaluate(() => {
    App.go('settings');
    return {
      supported: Updates.supported(),
      note: (document.getElementById('upd-status') || {}).textContent || ''
    };
  });
  ok('it does not pretend to work', r.supported === false);
  ok('the screen explains why', /newest APK/.test(r.note), JSON.stringify(r.note.slice(0, 60)));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
