#!/usr/bin/env python3
# Serves the docs/ channel (version.json, web.zip, the web files, and the
# APK at /app - the path the baked-in build hands to Android) on :8010.
# Used by tests/update-test.js against the local build on :8000.
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse

PORT = 8010
DOCS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'docs')
APK = 'HordeStudio-latest.apk'


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=DOCS, **kw)

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ('/app', '/app.apk'):
            self.path = '/' + APK
        return super().do_GET()

    def end_headers(self):
        # the app page loads from :8000 in the test (different origin) - the
        # real channel server answers cross-origin the same way
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write('%s - %s\n' % (self.address_string(), fmt % args))


Handler.extensions_map['.apk'] = 'application/vnd.android.package-archive'


if __name__ == '__main__':
    httpd = HTTPServer(('0.0.0.0', PORT), Handler)
    sys.stderr.write('channel on http://0.0.0.0:%d (%s)\n' % (PORT, DOCS))
    httpd.serve_forever()
