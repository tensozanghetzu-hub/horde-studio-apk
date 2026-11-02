# Cloudflare Workers AI image proxy

This small Worker lets the app use your own Cloudflare Workers AI account. The app cannot call the Cloudflare REST endpoint directly from a browser/WebView because its API rejects browser CORS preflight requests. This proxy answers preflight requests and keeps your Cloudflare API credentials out of the APK.

## Requirements

- A Cloudflare account with Workers AI available.
- Node.js/npm and Wrangler (`npm install -g wrangler`).
- The app's image provider set to **Cloudflare Workers AI**.

## Deploy

From this directory:

```sh
wrangler login
wrangler deploy
```

Wrangler will print the deployed Worker URL, typically `https://horde-studio-image-proxy.<your-subdomain>.workers.dev`. Keep the generated app-access token private. Make a random token, configure it as a Worker secret, and enter the same value in the app's **Worker access token** field:

```sh
openssl rand -hex 32
wrangler secret put APP_TOKEN
```

Paste the random value into the secret prompt and into the app. Do not use a Cloudflare account API token here. This is a separate secret that only authorizes requests to your own proxy. If it is exposed, rotate it with `wrangler secret put APP_TOKEN` and update the app setting.

In Horde Studio Settings, choose **Cloudflare Workers AI**, enter the Worker URL, then enter the `APP_TOKEN` value. The app calls the Worker at `/generate`; it does not need your Cloudflare account ID or Cloudflare API token.

## Security and limits

- The Worker checks `APP_TOKEN` before calling Workers AI. Do not share the token or Worker URL+token pair.
- The app stores the Worker URL and access token locally. The token is excluded from app backups/exports.
- The Worker runs `@cf/black-forest-labs/flux-1-schnell` with four steps. That model controls output dimensions and safety behavior; the app's size/NSFW controls do not change Cloudflare's model behavior.
- Cloudflare's published Workers AI Free allocation is 10,000 Neurons per day, resetting at 00:00 UTC. Free-plan requests beyond the allocation fail; paid usage may incur charges. Check current Cloudflare pricing before relying on it.
- Anyone who obtains your `APP_TOKEN` can spend your Workers AI allocation. Keep it private and rotate it if needed.

The Worker intentionally has no broad prompt/image logging and returns JSON with base64 image data. Its CORS policy permits browser clients; access still requires the secret bearer token.
