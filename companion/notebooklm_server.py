"""Authenticated, read-only NotebookLM connector for a single Kapron account."""
import argparse
import asyncio
import hmac
import json
import logging
import os
import re
from http.server import BaseHTTPRequestHandler, HTTPServer

from notebooklm import NotebookLMClient
from notebooklm.exceptions import AuthError, AuthExtractionError, NotebookNotFoundError, RateLimitError

NOTEBOOK_ID = re.compile(r"[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}")


class NotebookBridge:
    def __init__(self, profile, allowed):
        self.profile = profile
        self.allowed = frozenset(key.lower() for key in allowed)

    async def run(self, operation, data):
        async with asyncio.timeout(48):
            async with NotebookLMClient.from_storage(
                profile=self.profile, timeout=12, chat_timeout=42,
                rate_limit_max_retries=0, server_error_max_retries=0
            ) as client:
                if operation == "list":
                    notebooks = await client.notebooks.list()
                    return {"notebooks": [
                        {"id": item.id, "title": item.title[:200]} for item in notebooks
                        if item.id.lower() in self.allowed
                    ][:100]}
                result = await client.chat.ask(data["notebookId"], data["question"])
                return {
                    "answer": result.answer[:8000],
                    "citations": [
                        {"sourceId": ref.source_id, "number": ref.citation_number,
                         "quote": (ref.cited_text or "")[:600]} for ref in result.references[:20]
                    ]
                }


def make_handler(bridge, token):
    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(8)

        def log_message(self, _format, *args):
            pass

        def respond(self, status, data=None):
            body = json.dumps(data or {}, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            try:
                self.wfile.write(body)
            except OSError:
                pass

        def authorized(self):
            value = self.headers.get("Authorization", "").encode()
            return hmac.compare_digest(value, b"Bearer " + token)

        def do_GET(self):
            if not self.authorized():
                return self.respond(401)
            if self.path != "/v1/notebooks":
                return self.respond(404)
            return self.execute("list", {})

        def do_POST(self):
            if not self.authorized():
                return self.respond(401)
            if self.path != "/v1/ask":
                return self.respond(404)
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 52000 or self.headers.get_content_type() != "application/json":
                    return self.respond(400)
                data = json.loads(self.rfile.read(length))
                key, question = data["notebookId"], data["question"]
                if not isinstance(key, str) or not NOTEBOOK_ID.fullmatch(key) or not isinstance(question, str) or not question.strip() or len(question) > 8000:
                    return self.respond(400)
            except (KeyError, ValueError, TypeError, OSError):
                return self.respond(400)
            if key.lower() not in bridge.allowed:
                return self.respond(404)
            return self.execute("ask", data)

        def execute(self, operation, data):
            try:
                self.respond(200, asyncio.run(bridge.run(operation, data)))
            except (AuthError, AuthExtractionError, FileNotFoundError):
                self.respond(409)
            except NotebookNotFoundError:
                self.respond(404)
            except RateLimitError:
                self.respond(429)
            except (TimeoutError, OSError):
                self.respond(504)
            except Exception as error:
                print(f"NotebookLM connector failure: {type(error).__name__}", flush=True)
                self.respond(502)

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", default="kapron")
    parser.add_argument("--allow-notebook", action="append", required=True)
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()
    token = os.environ.get("KAPRON_NOTEBOOKLM_TOKEN", "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", token):
        parser.error("Set KAPRON_NOTEBOOKLM_TOKEN to a random token of at least 32 characters.")
    if not all(NOTEBOOK_ID.fullmatch(key) for key in args.allow_notebook):
        parser.error("Provide the notebook UUID from its NotebookLM URL.")
    logging.getLogger("notebooklm").setLevel(logging.CRITICAL)
    bridge = NotebookBridge(args.profile, args.allow_notebook)
    print(f"NotebookLM companion listening on http://127.0.0.1:{args.port}", flush=True)
    with HTTPServer(("127.0.0.1", args.port), make_handler(bridge, token.encode())) as server:
        server.serve_forever()


if __name__ == "__main__":
    main()
