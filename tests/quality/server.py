"""Loopback-only, fail-closed browser quality fixture. Never opens a device."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import argparse
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=8806)
parser.add_argument('--reports', type=Path, default=ROOT.parent/'work/a1-quality-20261114')
args = parser.parse_args()
args.reports.mkdir(parents=True, exist_ok=True)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Permissions-Policy', 'serial=(), usb=(), hid=(), microphone=(), camera=(), bluetooth=()')
        super().end_headers()

    def emit(self, body, kind):
        self.send_response(200)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        route = self.path.split('?')[0]
        if route in ('/bundle-test.html', '/preview.html'):
            try:
                html = (ROOT/'ESP32-A1-Audio-Lab.html').read_text(encoding='utf-8')
                mock = (ROOT/'tests/mock-device.mjs').read_text(encoding='utf-8')
                core = (ROOT/'core.mjs').read_text(encoding='utf-8')
                required = json.loads('['+re.search(r'export const REQUIRED=\[([^]]+)\]', core)[1].replace("'", '"')+']')
                assert html.count('<script type="module">') == 1
                assert "import {REQUIRED} from '../core.mjs';" in mock
                assert "await import('../app.mjs');" in mock
                mock = mock.replace("import {REQUIRED} from '../core.mjs';", 'const REQUIRED='+json.dumps(required)+';')
                mock = mock.replace("await import('../app.mjs');", '')
                digest = hashlib.sha256(html.encode()).hexdigest()
                html = html.replace('<head>', '<head><meta name="qa-bundle-sha" content="'+digest+'">', 1)
                html = html.replace('<script type="module">', '<script type="module">{\n'+mock+'\n}\n', 1)
                if route == '/bundle-test.html':
                    html = html.replace('</body>', '<script src="/__qa/axe.js"></script><script src="/__qa/gremlins.js"></script><script src="/__qa/audit.js"></script></body>')
                else:
                    html = html.replace('</head>', '<style>#simulationBadge{top:98px;bottom:auto!important;right:16px!important;padding:5px 9px!important;border-radius:5px;background:#294d40!important;font:11px monospace!important;pointer-events:none}#commandCount{display:none}</style></head>')
                return self.emit(html.encode(), 'text/html; charset=utf-8')
            except (AssertionError, AttributeError, OSError, ValueError):
                return self.send_error(500, 'Fixture bootstrap unavailable; application was not served')
        assets = {'/__qa/axe.js': ROOT/'node_modules/axe-core/axe.min.js',
                  '/__qa/gremlins.js': ROOT/'node_modules/gremlins.js/dist/gremlins.min.js',
                  '/__qa/audit.js': ROOT/'tests/quality/browser-audit.js'}
        if route in assets:
            try:
                return self.emit(assets[route].read_bytes(), 'text/javascript; charset=utf-8')
            except OSError:
                return self.send_error(500, 'Run npm ci before browser quality checks')
        if route.endswith('.html'):
            return self.send_error(403, 'Only the isolated bundle-test.html entry is enabled')
        if route == '/favicon.ico':
            return self.emit(b'', 'image/x-icon')
        return super().do_GET()

    def do_POST(self):
        if self.path != '/__test/report':
            return self.send_error(404)
        if self.headers.get('Origin') != f'http://127.0.0.1:{args.port}':
            return self.send_error(403)
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 4000000:
                return self.send_error(413)
            data = json.loads(self.rfile.read(length))
            kind = data.get('kind', 'browser')
            if not re.fullmatch(r'[a-z0-9_-]{1,40}', kind):
                return self.send_error(400)
            (args.reports/(kind+'-report.json')).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
        except (ValueError, TypeError, AttributeError):
            return self.send_error(400)
        return self.emit(b'OK', 'text/plain')


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'MOCK ONLY http://127.0.0.1:{args.port}/bundle-test.html', flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()
