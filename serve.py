"""Run the external Factory Dashboard on IPv4 localhost."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control','no-cache')
        self.send_header('X-Content-Type-Options','nosniff')
        super().end_headers()
    def list_directory(self, path):
        self.send_error(404); return None

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=17841)
    args=parser.parse_args()
    root=Path(__file__).resolve().parent/'dist'
    if not (root/'index.html').is_file(): raise SystemExit('Dashboard files are missing.')
    with ThreadingHTTPServer(('127.0.0.1',args.port),partial(Handler,directory=str(root))) as server:
        print(f'Factory Dashboard: http://127.0.0.1:{server.server_port}',flush=True)
        try:server.serve_forever()
        except KeyboardInterrupt:pass
