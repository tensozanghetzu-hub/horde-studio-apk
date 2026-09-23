# Tests

Browser tests need chromium; the JS-only ones need none.

```bash
# dependencies live in vendor/ so they survive a sandbox restart
cd /home/user/tests
[ -d vendor ] || { npm i playwright-core && cp -r node_modules vendor; }
export NODE_PATH=/home/user/tests/vendor

pip install playwright && python3 -m playwright install --with-deps chromium
python3 -m http.server 8000 --bind 0.0.0.0 --directory /home/user/horde-studio-mobile

node update-test.js && node typing-test.js
```

After a sandbox restart, `vendor/` and these scripts survive; the browser (it lives in
`~/.cache`, ~350 MB) and the two servers do not — reinstall the browser and restart the
servers, then run as above.

| File | What it covers |
|---|---|
| `update-test.js` | Self-update against the real server: check, apply, reset, in-app install, browser fallback, apply-from-file, Settings screen. |
| `typing-test.js` | The three-dot indicator: hidden when idle, shown while generating or mid-burst. |
