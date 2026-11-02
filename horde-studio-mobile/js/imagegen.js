/* Image-generation provider adapters. All provider-specific network behavior
   lives here so the chat UI can keep one consistent result shape. */
(function (global) {
  'use strict';

  var POLLINATIONS = 'https://image.pollinations.ai/prompt/';
  var POLLINATIONS_COOLDOWN = 45000;
  var POLLINATIONS_LAST_KEY = 'hs.pollinations.lastRequest';
  var CLOUDFLARE_MODEL = '@cf/black-forest-labs/flux-1-schnell';
  var lastPollinationsRequest = 0;

  function fail(message) { throw new Error(message); }

  function withTimeout(url, options, timeoutMs) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs || 180000);
    var opts = Object.assign({}, options || {}, { signal: controller.signal });
    if (options && options.signal) {
      if (options.signal.aborted) controller.abort();
      else options.signal.addEventListener('abort', function () { controller.abort(); }, { once: true });
    }
    return fetch(url, opts).finally(function () { clearTimeout(timer); });
  }

  function asDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('Could not read the generated image.')); };
      reader.readAsDataURL(blob);
    });
  }

  function workerEndpoint(raw) {
    var url;
    try { url = new URL(String(raw || '').trim()); }
    catch (e) { fail('Enter your deployed Cloudflare Worker URL in Settings.'); }
    if (url.protocol !== 'https:' || url.username || url.password) {
      fail('The Cloudflare Worker URL must be a valid HTTPS URL.');
    }
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '') + '/generate';
    return url.toString();
  }

  function generatePollinations(options) {
    var prompt = String(options.prompt || '').trim();
    if (!prompt) fail('Enter an image prompt first.');
    if (prompt.length > 2000) fail('Pollinations prompts must be 2,000 characters or fewer.');
    var now = Date.now();
    var last = lastPollinationsRequest;
    try { last = Math.max(last, Number(localStorage.getItem(POLLINATIONS_LAST_KEY)) || 0); } catch (e) { }
    if (now - last < POLLINATIONS_COOLDOWN) {
      var wait = Math.ceil((POLLINATIONS_COOLDOWN - (now - last)) / 1000);
      fail('Pollinations allows at least 45 seconds between requests from an IP. Wait about ' + wait + ' seconds and retry.');
    }
    lastPollinationsRequest = now;
    try { localStorage.setItem(POLLINATIONS_LAST_KEY, String(now)); } catch (e) { }

    var requested = Math.round(Number(options.width) || 768);
    var size = Math.max(256, Math.min(768, requested));
    var seed = Math.floor(Math.random() * 2147483647);
    var url = POLLINATIONS + encodeURIComponent(prompt) +
      '?width=' + size + '&height=' + size + '&seed=' + seed +
      '&safe=' + (options.nsfw ? 'false' : 'true');

    return withTimeout(url, { method: 'GET', headers: { Accept: 'image/*' }, signal: options.signal }, 180000)
      .then(function (response) {
        if (!response.ok) {
          return response.text().catch(function () { return ''; }).then(function (body) {
            var detail = body.replace(/\s+/g, ' ').slice(0, 180);
            fail('Pollinations returned HTTP ' + response.status + (detail ? ': ' + detail : '') +
              '. It is a rate-limited, best-effort service; wait at least 45 seconds and try again.');
          });
        }
        var type = response.headers.get('content-type') || '';
        if (type && type.indexOf('image/') !== 0) {
          return response.text().catch(function () { return ''; }).then(function (body) {
            fail('Pollinations did not return an image' + (body ? ': ' + body.replace(/\s+/g, ' ').slice(0, 180) : '.') );
          });
        }
        return response.blob().then(function (blob) {
          return asDataUrl(blob).then(function (dataUrl) {
            return { url: dataUrl, dataUrl: dataUrl, model: 'Pollinations Classic', seed: seed, provider: 'pollinations' };
          });
        });
      }).catch(function (error) {
        if (error && error.name === 'AbortError') throw error;
        /* Some mobile WebViews block CORS reads even though <img> can display
           the public image URL. Preserve that direct URL as a usable fallback. */
        if (error && /Pollinations returned HTTP|Pollinations did not return|Pollinations prompts/.test(error.message || '')) throw error;
        return { url: url, model: 'Pollinations Classic', seed: seed, provider: 'pollinations' };
      });
  }

  function generateCloudflare(options, settings) {
    var prompt = String(options.prompt || '').trim();
    if (!prompt) fail('Enter an image prompt first.');
    if (prompt.length > 2048) fail('Cloudflare FLUX prompts must be 2,048 characters or fewer.');
    settings = settings || {};
    var endpoint = workerEndpoint(settings.cloudflareWorkerUrl);
    var token = String(settings.cloudflareWorkerToken || '').trim();
    if (!token) fail('Add your Worker access token in Settings before using Cloudflare Workers AI.');

    return withTimeout(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ prompt: prompt, steps: 4 }),
      signal: options.signal
    }, 180000).then(function (response) {
      return response.text().then(function (body) {
        var data;
        try { data = JSON.parse(body); } catch (e) { data = null; }
        if (!response.ok) {
          var message = data && data.error ? String(data.error) : 'Worker returned HTTP ' + response.status;
          fail('Cloudflare image generation failed: ' + message.slice(0, 300));
        }
        if (!data || typeof data.image !== 'string' || !data.image) {
          fail('The Worker returned no image. Check that you deployed the provided image proxy.');
        }
        var mime = typeof data.mimeType === 'string' && /^image\/[a-z0-9.+-]+$/i.test(data.mimeType)
          ? data.mimeType : 'image/jpeg';
        var encoded = data.image.replace(/^data:image\/[^;]+;base64,/i, '').replace(/\s/g, '');
        var dataUrl = 'data:' + mime + ';base64,' + encoded;
        return { url: dataUrl, dataUrl: dataUrl, model: data.model || CLOUDFLARE_MODEL, seed: data.seed || null, provider: 'cloudflare' };
      });
    });
  }

  global.ImageGen = {
    generate: function (provider, options, settings) {
      options = options || {};
      if (provider === 'pollinations') return generatePollinations(options);
      if (provider === 'cloudflare') return generateCloudflare(options, settings);
      return Promise.reject(new Error('Unknown image provider.'));
    },
    pollinationsUrl: POLLINATIONS,
    cloudflareModel: CLOUDFLARE_MODEL
  };
})(window);
