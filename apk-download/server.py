#!/usr/bin/env python3
"""Serves the app — and the pieces it needs to update itself.

  /                 the download page
  /app  (or *.apk)  the APK, with a real Android MIME type and filename
  /version.json     what is current: app version + a revision for the web files
  /web.zip          the HTML/CSS/JS bundle the installed app can swap in

Everything is read from disk on each request, so a rebuild — or just editing a
file in horde-studio-mobile/ — shows up here without restarting the server.
"""
import glob
import hashlib
import html
import io
import json
import os
import re
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOME = "/home/user"
APP_DIR = os.path.join(HOME, "horde-studio-mobile")
MANIFEST = os.path.join(HOME, "apk-build", "AndroidManifest.xml")
PORT = int(os.environ.get("PORT", "8010"))

CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*"}


def newest_apk():
    """The newest HordeStudio-*.apk, skipping the update copy in Downloads."""
    cands = [p for p in glob.glob(os.path.join(HOME, "HordeStudio-*.apk"))]
    cands = [p for p in cands if "update" not in os.path.basename(p).lower()]
    cands.sort()
    return cands[-1] if cands else None


def app_version():
    """versionName / versionCode straight from the manifest the APK is built with."""
    name, code = "0.0.0", 0
    try:
        src = open(MANIFEST, encoding="utf-8").read()
        m = re.search(r'android:versionName="([^"]+)"', src)
        if m:
            name = m.group(1)
        m = re.search(r'android:versionCode="(\d+)"', src)
        if m:
            code = int(m.group(1))
    except OSError:
        pass
    return name, code


def bundle_files():
    """Every file that makes up the web app, relative to its root."""
    out = []
    for top in ("index.html", "manifest.webmanifest", "sw.js"):
        if os.path.exists(os.path.join(APP_DIR, top)):
            out.append(top)
    for sub in ("css", "js", "icons"):
        root = os.path.join(APP_DIR, sub)
        if not os.path.isdir(root):
            continue
        for dirpath, _, files in os.walk(root):
            for f in files:
                rel = os.path.relpath(os.path.join(dirpath, f), APP_DIR)
                if rel.replace("\\", "/") == "icons/icon-source.png":
                    continue
                out.append(rel)
    return sorted(out)


def newest_mtime(rel_paths):
    newest = 0
    for rel in rel_paths:
        try:
            newest = max(newest, int(os.path.getmtime(os.path.join(APP_DIR, rel))))
        except OSError:
            pass
    return newest


_zip_cache = {"stamp": None, "bytes": b""}


def web_bundle():
    """Zip the web app. Cached until any source file changes."""
    names = bundle_files()
    stamp = newest_mtime(names)
    if _zip_cache["stamp"] == stamp and _zip_cache["bytes"]:
        return _zip_cache["bytes"], stamp, names
    buf = io.BytesIO()
    name, code = app_version()
    stamp = newest_mtime(names)
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in names:
            z.write(os.path.join(APP_DIR, rel), rel)
        # so an update applied from a file still knows which revision it is
        z.writestr("version.json", json.dumps({
            "apk": name, "apkCode": code, "web": name, "webRev": stamp,
            "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(stamp)),
        }, indent=2) + "\n")
    data = buf.getvalue()
    _zip_cache["stamp"] = stamp
    _zip_cache["bytes"] = data
    return data, stamp, names


def version_json():
    apk = newest_apk()
    name, code = app_version()
    data, stamp, names = web_bundle()
    info = {
        "apk": name,
        "apkCode": code,
        "web": name,
        "webRev": stamp,
        "apkSize": os.path.getsize(apk) if apk else 0,
        "webSize": len(data),
        "files": len(names),
        "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(stamp)),
        "note": "Fixes to the interface arrive as a small download — no reinstall. "
                "Only a change to the app wrapper itself needs Android to install it.",
    }
    return json.dumps(info, indent=2).encode() + b"\n"


def kb(n):
    return f"{n/1024:.0f} KB"


def page():
    apk = newest_apk()
    name = os.path.basename(apk) if apk else "HordeStudio.apk"
    size = os.path.getsize(apk) if apk else 0
    sha = ""
    if apk:
        h = hashlib.sha256()
        with open(apk, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        sha = h.hexdigest()
    ver, _code = app_version()
    try:
        info = json.loads(version_json().decode())
        sub = (f"web revision {info['webRev']} · {info['files']} files · "
               f"{kb(info['webSize'])} bundle")
    except Exception:
        sub = ""
    return f"""<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Horde Studio — download</title>
<style>
 *{{box-sizing:border-box}}
 body{{margin:0;padding:24px;font:16px/1.5 -apple-system,system-ui,"Segoe UI",Roboto,sans-serif;
      background:#12131a;color:#e8e8f0;max-width:34rem;margin:0 auto}}
 h1{{font-size:1.35rem;margin:0 0 4px}}
 .sub{{color:#9a9ab0;margin:0 0 24px}}
 a.btn{{display:block;text-align:center;padding:16px 20px;border-radius:12px;font-weight:600;
       font-size:1.05rem;text-decoration:none;background:#6c5ce7;color:#fff;margin-bottom:10px}}
 a.btn:active{{background:#5a4bd6}}
 .meta{{font-size:.82rem;color:#8a8aa0;margin:18px 0 0;word-break:break-all}}
 code{{background:#1d1f2b;padding:1px 5px;border-radius:4px;font-size:.9em}}
 ol{{padding-left:1.2rem;margin:18px 0 0}}
 li{{margin-bottom:8px;color:#c8c8d8}}
 .note{{margin-top:22px;padding:12px 14px;border-radius:10px;background:#1a2233;
       border:1px solid #2c3a52;color:#c8d8ee;font-size:.85rem}}
</style></head><body>
<h1>Horde Studio {html.escape(ver)}</h1>
<p class="sub">Character roleplay studio · runs on the free AI Horde · Android 7.0+</p>
<a class="btn" href="/app" download="{html.escape(name)}">Download APK ({kb(size)})</a>
<div class="meta">SHA-256 <code>{sha}</code></div>
<div class="note">Already installed? You do not need this again. Open the app →
<b>Settings → App updates → Check for update</b>. Interface fixes download into the
app; only a new wrapper needs Android to install it. <br><br>{html.escape(sub)}</div>
<ol>
  <li>Tap <b>Download</b>. If your browser asks, confirm.</li>
  <li>Open the downloaded <code>{html.escape(name)}</code>.</li>
  <li>Allow <b>Install unknown apps</b> for your browser/files app, then install.</li>
  <li>Updating? Just install over the top — your chats and characters are kept.</li>
</ol>
</body></html>"""


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "HordeStudio"

    def _send(self, body, ctype, extra=None, head_only=False):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if not head_only:
            self.wfile.write(body)

    def do_HEAD(self):
        self.route(head_only=True)

    def do_GET(self):
        self.route(head_only=False)

    def route(self, head_only=False):
        path = self.path.split("?")[0]
        try:
            if path in ("/", "/index.html", "/download"):
                self._send(page().encode("utf-8"), "text/html; charset=utf-8", CORS, head_only)
            elif path in ("/version.json", "/version"):
                self._send(version_json(), "application/json; charset=utf-8", CORS, head_only)
            elif path in ("/web.zip", "/bundle"):
                data, _stamp, _names = web_bundle()
                extra = dict(CORS)
                extra["Content-Disposition"] = 'attachment; filename="horde-studio-web.zip"'
                self._send(data, "application/zip", extra, head_only)
            elif path.endswith(".apk") or path in ("/app", "/get"):
                apk = newest_apk()
                if not apk:
                    raise OSError("no APK built yet")
                with open(apk, "rb") as f:
                    body = f.read()
                name = os.path.basename(apk)
                extra = dict(CORS)
                # The whole point: a real Android package type AND a filename.
                extra["Content-Disposition"] = (
                    f'attachment; filename="{name}"; filename*=UTF-8\'\'{name}'
                )
                self._send(body, "application/vnd.android.package-archive", extra, head_only)
            else:
                self.send_response(404)
                self.send_header("Content-Length", "0")
                self.end_headers()
        except OSError as e:
            msg = f"not available: {e}".encode()
            self.send_response(404)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(msg)))
            self.end_headers()
            if not head_only:
                self.wfile.write(msg)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    apk = newest_apk()
    print(f"serving {os.path.basename(apk) if apk else 'nothing yet'} on 0.0.0.0:{PORT}")
    ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
