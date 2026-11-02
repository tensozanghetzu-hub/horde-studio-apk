/* Chat image bubbles expose a download action that saves image bytes to the
 * Android Downloads bridge (or the browser download path), with a viewer
 * fallback when a remote host blocks CORS reads. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.join(__dirname, '..');

const views = {
  console, JSON, Math, Date, Promise, Object, Array, String, Number, RegExp,
  Error, isNaN, parseFloat, parseInt,
  fetch: () => Promise.resolve({ ok: false }),
  UI: {
    esc: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    md: s => String(s || ''),
    icon: name => '<svg data-icon="' + name + '"></svg>'
  },
  Store: { settings: { userName: 'Tester' } },
  document: { querySelector: () => null, querySelectorAll: () => [] }
};
views.window = views;
vm.runInNewContext(fs.readFileSync(path.join(root, 'horde-studio-mobile/js/views.js'), 'utf8'), views);
const char = { id: 'c1', name: 'Rhea', avatar: '' };
const imageHtml = views.Views.messageHtml({ id: 'img-1', role: 'assistant', text: 'Generated.', image: 'data:image/jpeg;base64,AA==' }, char, views.Store.settings);
assert(imageHtml.includes('data-act="download-image"'));
assert(imageHtml.includes('Download image'));
const plainHtml = views.Views.messageHtml({ id: 'txt-1', role: 'assistant', text: 'No image.' }, char, views.Store.settings);
assert(!plainHtml.includes('data-act="download-image"'));

async function main() {
  const captured = {};
  const context = {
    App: {}, Date, Promise, Blob,
    fetch: async () => ({ ok: true, blob: async () => new Blob(['jpegbytes'], { type: 'image/jpeg' }) }),
    UI: {
      toast: message => { captured.toast = message; },
      download: (name, blob, mime) => { captured.download = { name, blob, mime }; },
      lightbox: src => { captured.lightbox = src; }
    }
  };
  context.window = context;
  const appSrc = fs.readFileSync(path.join(root, 'horde-studio-mobile/js/app.js'), 'utf8');
  assert(appSrc.includes("act === 'download-image'"), 'chat click delegation must call the image downloader');
  const start = appSrc.indexOf('  App.downloadChatImage = function (message) {');
  const end = appSrc.indexOf('  App.imageProviderLabel = function', start);
  assert(start >= 0 && end > start, 'download helper source must exist');
  vm.runInNewContext(appSrc.slice(start, end) + '\nglobalThis.downloadChatImage = App.downloadChatImage;', context);
  const saved = await context.downloadChatImage({ image: 'data:image/jpeg;base64,AA==' });
  assert.strictEqual(saved, true);
  assert(captured.download, 'a successful image fetch should call the save/download bridge');
  assert(captured.download.name.endsWith('.jpg'));
  assert.strictEqual(captured.download.mime, 'image/jpeg');
  assert.strictEqual(captured.download.blob.size, 9);

  context.fetch = async () => { throw new TypeError('CORS blocked'); };
  const fallback = await context.downloadChatImage({ image: 'https://images.example/image.jpg' });
  assert.strictEqual(fallback, false);
  assert.strictEqual(captured.lightbox, 'https://images.example/image.jpg');
  console.log('chat-image-download-test: image-only button, Downloads save path, and CORS fallback pass');
}

main().catch(error => { console.error(error); process.exit(1); });
