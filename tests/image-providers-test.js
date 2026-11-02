/* Provider adapters, Worker contract, and app wiring regression coverage. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..', 'horde-studio-mobile');
const workerRoot = path.join(__dirname, '..', 'tools', 'cloudflare-image-worker');

async function main() {
  const requests = [];
  const ctx = {
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    Promise,
    Math,
    Blob,
    fetch: async (url, options) => {
      requests.push({ url: String(url), options });
      if (String(url).includes('/generate')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ image: 'aGVsbG8=', mimeType: 'image/jpeg', model: 'test-model' }) };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'image/jpeg' : null },
        blob: async () => new Blob(['image-bytes'], { type: 'image/jpeg' })
      };
    },
    FileReader: class {
      readAsDataURL(blob) {
        blob.arrayBuffer().then((buf) => {
          this.result = 'data:' + blob.type + ';base64,' + Buffer.from(buf).toString('base64');
          this.onload();
        }, () => this.onerror());
      }
    },
    console
  };
  ctx.window = ctx;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js', 'imagegen.js'), 'utf8'), ctx);
  const ImageGen = ctx.ImageGen;

  const cf = await ImageGen.generate('cloudflare', { prompt: 'A blue bird', width: 512 }, {
    cloudflareWorkerUrl: 'https://my-worker.example.workers.dev/', cloudflareWorkerToken: 'private-app-token'
  });
  assert.strictEqual(cf.dataUrl, 'data:image/jpeg;base64,aGVsbG8=');
  assert.strictEqual(requests[0].url, 'https://my-worker.example.workers.dev/generate');
  assert.strictEqual(requests[0].options.headers.Authorization, 'Bearer private-app-token');
  assert.strictEqual(JSON.parse(requests[0].options.body).prompt, 'A blue bird');
  assert(!requests[0].url.includes('private-app-token'), 'secret must not appear in request URL');
  assert.throws(() => ImageGen.generate('cloudflare', { prompt: 'x' }, {
    cloudflareWorkerUrl: 'http://insecure.example', cloudflareWorkerToken: 'x'
  }), /HTTPS/);
  assert.throws(() => ImageGen.generate('cloudflare', { prompt: 'x' }, {
    cloudflareWorkerUrl: 'https://worker.example', cloudflareWorkerToken: ''
  }), /Worker access token/);

  const poll = await ImageGen.generate('pollinations', { prompt: 'bright red fox', width: 1024, nsfw: false });
  const pollRequest = requests[1];
  assert(pollRequest.url.startsWith('https://image.pollinations.ai/prompt/'));
  const pollUrl = new URL(pollRequest.url);
  assert.strictEqual(pollUrl.searchParams.get('width'), '768');
  assert.strictEqual(pollUrl.searchParams.get('height'), '768');
  assert.strictEqual(pollUrl.searchParams.get('safe'), 'true');
  assert.strictEqual(poll.provider, 'pollinations');
  assert(poll.dataUrl.startsWith('data:image/jpeg;base64,'));
  assert.throws(() => ImageGen.generate('pollinations', { prompt: 'second image' }), /45 seconds/);

  const worker = fs.readFileSync(path.join(workerRoot, 'worker.js'), 'utf8');
  assert(worker.includes("request.method === 'OPTIONS'"), 'Worker must answer CORS preflight');
  assert(worker.includes("'Access-Control-Allow-Headers': 'Authorization, Content-Type'"));
  assert(worker.includes("request.headers.get('Authorization') !== 'Bearer ' + env.APP_TOKEN"));
  assert(worker.includes("env.AI.run(MODEL"));
  assert(worker.includes("@cf/black-forest-labs/flux-1-schnell"));
  assert(!worker.includes('CLOUDFLARE_API_TOKEN'));
  const workerContext = { Response, URL, JSON, String };
  vm.runInNewContext(worker.replace('export default', 'globalThis.worker ='), workerContext);
  const workerApi = workerContext.worker;
  const preflight = await workerApi.fetch(new Request('https://worker.example/generate', { method: 'OPTIONS' }), {});
  assert.strictEqual(preflight.status, 204);
  assert.strictEqual(preflight.headers.get('Access-Control-Allow-Origin'), '*');
  let aiCalls = 0;
  const env = { APP_TOKEN: 'app-secret', AI: { run: async (model, input) => {
    aiCalls++;
    assert.strictEqual(model, '@cf/black-forest-labs/flux-1-schnell');
    assert.strictEqual(input.prompt, 'test image');
    return { image: 'aGVsbG8=' };
  } } };
  const unauthorized = await workerApi.fetch(new Request('https://worker.example/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong' },
    body: JSON.stringify({ prompt: 'test image' })
  }), env);
  assert.strictEqual(unauthorized.status, 401);
  assert.strictEqual(aiCalls, 0);
  const authorized = await workerApi.fetch(new Request('https://worker.example/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer app-secret' },
    body: JSON.stringify({ prompt: 'test image' })
  }), env);
  assert.strictEqual(authorized.status, 200);
  assert.strictEqual((await authorized.json()).image, 'aGVsbG8=');
  assert.strictEqual(aiCalls, 1);

  const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
  assert(app.includes("ImageGen.generate(provider, options, Store.settings)"));
  assert(app.includes("provider === 'cloudflare'"));
  assert(app.includes("provider === 'pollinations'"));
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert(index.includes('js/imagegen.js'));
  const store = fs.readFileSync(path.join(root, 'js', 'store.js'), 'utf8');
  assert(store.includes("imageProvider: 'horde'"));
  assert(store.includes('delete s.cloudflareWorkerToken'));
  console.log('image-providers-test: Cloudflare Worker proxy, Pollinations limits, provider routing, and token backup exclusion pass');
}

main().catch((error) => { console.error(error); process.exit(1); });
