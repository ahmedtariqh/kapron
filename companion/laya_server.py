"""Loopback-only decision adapter for Kapron."""
import argparse
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from laya import Router


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", action="append", required=True)
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    origins = frozenset(args.origin)
    router = Router()
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, _format, *args):
            pass

        def allowed(self):
            return self.headers.get("Origin") in origins and self.headers.get("Host") in {
                f"localhost:{args.port}", f"127.0.0.1:{args.port}"
            }

        def respond(self, status, payload=None):
            self.send_response(status)
            if self.allowed():
                self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "content-type")
                self.send_header("Access-Control-Allow-Private-Network", "true")
            body = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else b""
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if body:
                try:
                    self.wfile.write(body)
                except BrokenPipeError:
                    pass

        def do_OPTIONS(self):
            self.respond(204 if self.allowed() and self.path == "/decide" else 403)

        def do_POST(self):
            if self.path != "/decide" or not self.allowed():
                return self.respond(403)
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 16000 or self.headers.get_content_type() != "application/json":
                    return self.respond(400)
                body = json.loads(self.rfile.read(length))
                task = body["state"]["task"]
                questions = body["questions"]
                if not isinstance(task, str) or len(task) > 1400 or not isinstance(questions, dict) or not 1 <= len(questions) <= 9:
                    return self.respond(400)
                if any(q.get("type") not in {"choice", "noul"} for q in questions.values()):
                    return self.respond(400)
            except (KeyError, ValueError, AttributeError, TypeError):
                return self.respond(400)
            if not lock.acquire(blocking=False):
                return self.respond(429)
            try:
                checkpoint = "multilingual" if any("\u0600" <= ch <= "\u06ff" for ch in task) else None
                result = router.predict({"task": task[:950]}, questions, **({"model": checkpoint} if checkpoint else {}))
                self.respond(200, result)
            except Exception:
                self.respond(502, {"error": "Laya inference failed"})
            finally:
                lock.release()

    for origin in origins:
        parsed = urlsplit(origin)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.path or parsed.query or parsed.fragment or parsed.username:
            parser.error("--origin requires an exact application origin without a path")
    print(f"Laya listening on http://127.0.0.1:{args.port}/decide", flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
