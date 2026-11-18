import json
import threading
import unittest
from http.server import HTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch
from types import SimpleNamespace

from notebooklm_server import NotebookBridge, make_handler

KEY = "a64a7a73-3f65-4cd6-8ca7-ceb725e77e0a"
OTHER = "431817a2-32e9-4c10-831c-942df033d3e2"
TOKEN = "mock-token"


class FakeClient:
    def __init__(self):
        self.notebooks = self
        self.chat = self
        self.asked = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        pass

    async def list(self):
        return [SimpleNamespace(id=KEY, title="Approved"), SimpleNamespace(id=OTHER, title="Private")]

    async def ask(self, notebook_id, question):
        self.asked.append((notebook_id, question))
        return SimpleNamespace(answer="Example [1]", references=[
            SimpleNamespace(source_id=KEY, citation_number=1, cited_text="Evidence")
        ])


class BridgeTest(unittest.TestCase):
    def test_approved_notebooks_and_queries(self):
        fake = FakeClient()
        with patch("notebooklm_server.NotebookLMClient.from_storage", return_value=fake):
            bridge = NotebookBridge("kapron", [KEY])
            with HTTPServer(("127.0.0.1", 0), make_handler(bridge, TOKEN.encode())) as server:
                thread = threading.Thread(target=server.serve_forever)
                thread.start()
                try:
                    url = f"http://127.0.0.1:{server.server_port}/v1/"

                    def call(path, body=None, token=TOKEN):
                        return json.load(urlopen(Request(
                            url + path, data=json.dumps(body).encode() if body else None,
                            headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"}
                        ), timeout=5))

                    with self.assertRaises(HTTPError) as invalid:
                        call("notebooks", token="wrong")
                    self.assertEqual(invalid.exception.code, 401)
                    self.assertEqual(call("notebooks"), {"notebooks": [{"id": KEY, "title": "Approved"}]})
                    with self.assertRaises(HTTPError) as private:
                        call("ask", {"notebookId": OTHER, "question": "Show me"})
                    self.assertEqual(private.exception.code, 404)
                    self.assertEqual(call("ask", {"notebookId": KEY, "question": "What happened?"})["citations"],
                                     [{"sourceId": KEY, "number": 1, "quote": "Evidence"}])
                    self.assertEqual(fake.asked, [(KEY, "What happened?")])
                finally:
                    server.shutdown()
                    thread.join()


if __name__ == "__main__":
    unittest.main()
