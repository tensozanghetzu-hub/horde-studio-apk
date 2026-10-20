/* genreset-test — v1.39.3: Generation settings gain a "reset to defaults"
   button. Tinkerers can always return to the factory values with one
   confirmed tap; provider, key, model, personas and theme must NOT be
   touched (those are not generation settings). */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', 'horde-studio-mobile', 'js');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

function loadStore() {
  const sandbox = {
    console, JSON, Math, Date, Promise, Object, Array, String, Number, RegExp, Error,
    setTimeout, clearTimeout, navigator: { onLine: true },
    IDB: { get: () => Promise.resolve(null), put: () => Promise.resolve(), all: () => Promise.resolve([]) }
  };
  sandbox.window = sandbox; sandbox.global = sandbox;
  const stub = 'var UI = {}; window.UI = UI;\n' +
    'var Views = {}; var API = {}; API.aiJson = function () { return Promise.resolve(null); };\n' +
    'Sandbox = { issue: () => {} };';
  vm.runInNewContext(stub + '\n' + read('store.js'), sandbox, { filename: 'store.js' });
  return sandbox.Store;
}

/* carve one DOM-light App helper out of app.js so its logic runs for real */
function carve(name) {
  const src = read('app.js');
  const start = src.indexOf(name + ' = function ');
  if (start === -1) return null;
  const body = src.slice(start, src.indexOf('\n  };', start) + 5);
  const sandbox = {
    console, JSON, Math, Object, Array, String, Promise,
    App: { state: { screen: 'locker' } },   // 'locker' => any re-render branch stays out of reach
    Store: loadStore(),
    UI: { confirm: () => Promise.resolve(true), toast: () => {} },
    Views: {}, $: () => null
  };
  sandbox.window = sandbox;
  try { vm.runInNewContext(body, sandbox, { filename: name }); }
  catch (e) { return { error: e.message }; }
  return sandbox;
}

(async function main() {
  let failed = 0, count = 0;
  const ok = (n, c, d) => { count++; if (c) console.log('  ok ' + n); else { failed++; console.log('  FAIL ' + n + (d ? '  → ' + d : '')); } };

  try {
    const appSrc = read('app.js'), viewsSrc = read('views.js'), storeSrc = read('store.js');

    console.log('A — the Generation screen offers a way back');
    ok('the reset control is rendered on the Generation screen', /id="gen-reset"/.test(viewsSrc));
    ok('the control explains its scope in words nearby', viewsSrc.indexOf('id="gen-reset"') !== -1 &&
       /reset/i.test(viewsSrc.slice(viewsSrc.indexOf('id="gen-reset"'), viewsSrc.indexOf('id="gen-reset"') + 400)));
    ok('wiring hands the tap to the app', /gen-reset/.test(viewsSrc) && /resetGeneration/.test(appSrc + viewsSrc));

    console.log('B — the app has a reset entry point, guarded by a confirm');
    ok('App.resetGenerationSettings exists', /App\.resetGenerationSettings\s*=\s*function/.test(appSrc));
    ok('it asks before it acts', /resetGenerationSettings[\s\S]{0,300}confirm/.test(appSrc));

    console.log('C — the factory values have one named source');
    ok('store exposes the generation defaults as a unit', /generationDefaults/.test(storeSrc));

    console.log('D — the reset covers exactly this screen\'s keys');
    const Store = loadStore();
    const patch = (Store.generationDefaults && Store.generationDefaults()) || {};
    ok('temperature back to factory 0.85', patch.temperature === 0.85, JSON.stringify(patch.temperature));
    ok('max reply length back to 400', patch.maxTokens === 400, JSON.stringify(patch.maxTokens));
    ok('top P back to 0.95', patch.topP === 0.95, JSON.stringify(patch.topP));
    ok('context window back to 40', patch.contextMessages === 40, JSON.stringify(patch.contextMessages));
    ['streaming', 'autoFinish', 'stripThinking', 'bursts'].forEach(k =>
      ok('toggle ' + k + ' back to its factory default', patch[k] === true, JSON.stringify(patch[k])));
    ok('enter-sends back to factory off', patch.sendOnEnter === false, JSON.stringify(patch.sendOnEnter));

    console.log('E — nothing outside the screen is touched');
    const poison = ['apiKey', 'model', 'provider', 'baseUrl', 'theme', 'userName', 'hordeKey', 'hordeModel',
                    'activePersona', 'personaSchema', 'systemPrompt', 'hordeSize', 'hordeSteps', 'updateUrl'];
    const leaked = Object.keys(patch).filter(k => poison.includes(k));
    ok('the patch carries no identity/provider/theme keys', leaked.length === 0, leaked.join(','));
    const genKeys = ['temperature', 'maxTokens', 'topP', 'contextMessages', 'streaming',
                     'autoFinish', 'stripThinking', 'bursts', 'sendOnEnter'];
    const stray = Object.keys(patch).filter(k => !genKeys.includes(k));
    ok('...and nothing beyond the nine generation keys at all', stray.length === 0, stray.join(','));

    console.log('F — behavior proof: tinker, confirm, restored');
    const sb = carve('App.resetGenerationSettings');
    if (sb && sb.error) ok('reset runs headless', false, sb.error);
    else if (!sb || typeof sb.App.resetGenerationSettings !== 'function') {
      ok('reset runs headless', false, 'carve failed');
    } else {
      /* wreck the settings like a lost tinkerer */
      sb.Store.settings = Object.assign({}, sb.Store.generationDefaults(), { apiKey: '' });
      sb.Store.settings.temperature = 1.85;
      sb.Store.settings.maxTokens = 1333;
      sb.Store.settings.streaming = false;
      sb.Store.settings.sendOnEnter = true;
      sb.Store.settings.apiKey = 'user-key-must-survive';
      await sb.App.resetGenerationSettings();
      await new Promise(r => setTimeout(r, 10));
      ok('tweaked values restored', sb.Store.settings.temperature === 0.85 &&
         sb.Store.settings.maxTokens === 400 && sb.Store.settings.streaming === true &&
         sb.Store.settings.sendOnEnter === false,
         JSON.stringify([sb.Store.settings.temperature, sb.Store.settings.maxTokens,
                         sb.Store.settings.streaming, sb.Store.settings.sendOnEnter]));
      ok('their API key survived the reset', sb.Store.settings.apiKey === 'user-key-must-survive',
         sb.Store.settings.apiKey);
    }
  } catch (e) {
    failed++;
    console.log('  FAIL battery threw  → ' + (e && e.message || e));
  }
  console.log('\ngenreset-test: ' + (failed ? (failed + ' FAILED, ') : '') + count + ' checks');
  process.exit(failed ? 1 : 0);
})();
