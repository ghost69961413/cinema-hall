#!/usr/bin/env python3
"""
Simple HTTP Server to launch the District Cinema Web Application
Usage: python3 serve.py [port]
"""

import http.server
import socketserver
import os
import sys
import webbrowser
import json
import tempfile
import threading
import time

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")
MOCK_DB_PATH = os.path.join(tempfile.gettempdir(), f"cinema_mock_db_{PORT}.json")
MOCK_DB_LOCK = threading.Lock()
MOCK_DB_REVISION = time.time_ns()

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/api/mock-db":
            with MOCK_DB_LOCK:
                data = None
                if os.path.exists(MOCK_DB_PATH):
                    with open(MOCK_DB_PATH, "r", encoding="utf-8") as database_file:
                        data = json.load(database_file)
                self._json_response({"revision": MOCK_DB_REVISION, "data": data})
            return
        super().do_GET()

    def do_POST(self):
        global MOCK_DB_REVISION
        if self.path.split("?", 1)[0] != "/api/mock-db":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length))
            data = payload.get("data")
            if not isinstance(data, dict):
                raise ValueError("Expected a database object")
            with MOCK_DB_LOCK:
                temp_path = f"{MOCK_DB_PATH}.tmp"
                with open(temp_path, "w", encoding="utf-8") as database_file:
                    json.dump(data, database_file)
                os.replace(temp_path, MOCK_DB_PATH)
                MOCK_DB_REVISION = time.time_ns()
                revision = MOCK_DB_REVISION
            self._json_response({"revision": revision})
        except (ValueError, json.JSONDecodeError) as error:
            self.send_error(400, str(error))

    def _json_response(self, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        # Quiet standard request logs, display clean message
        if "404" in args[1]:
            print(f"[404 Not Found] {args[0]}")

def run():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("", PORT), Handler) as httpd:
        print("\n" + "=" * 60)
        print("  DISTRICT CINEMA - WEB APPLICATION SERVER")
        print("=" * 60)
        print(f" -> Local Server URL:  http://localhost:{PORT}")
        print(f" -> Serving Directory: {PUBLIC_DIR}")
        print(" -> Press Ctrl+C to stop the server\n")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server...")

if __name__ == "__main__":
    run()
