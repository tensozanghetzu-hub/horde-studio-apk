/* User-owned CORS proxy for the Horde Studio mobile app.
 * Deploy this Worker in your own Cloudflare account. Never put your Cloudflare
 * API token into the APK or this source file.
 */
const MODEL = '@cf/black-forest-labs/flux-1-schnell';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
  'Cache-Control': 'no-store'
};

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, CORS_HEADERS)
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true });
    if (url.pathname !== '/generate' || request.method !== 'POST') return json({ error: 'Not found' }, 404);
    if (!env.APP_TOKEN) return json({ error: 'Worker is missing the APP_TOKEN secret.' }, 503);
    if (request.headers.get('Authorization') !== 'Bearer ' + env.APP_TOKEN) return json({ error: 'Unauthorized' }, 401);

    let input;
    try { input = await request.json(); }
    catch (error) { return json({ error: 'Expected a JSON request body.' }, 400); }
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
    if (!prompt) return json({ error: 'Prompt is required.' }, 400);
    if (prompt.length > 2048) return json({ error: 'Prompt must be 2,048 characters or fewer.' }, 400);

    try {
      const result = await env.AI.run(MODEL, { prompt, steps: 4 });
      if (!result || typeof result.image !== 'string' || !result.image) {
        return json({ error: 'Workers AI returned no image.' }, 502);
      }
      return json({ image: result.image, mimeType: 'image/jpeg', model: MODEL });
    } catch (error) {
      return json({ error: error && error.message ? error.message : 'Workers AI request failed.' }, 502);
    }
  }
};
