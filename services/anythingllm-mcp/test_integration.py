"""
Integration tests — require a live AnythingLLM instance.

Set these env vars to enable:
  ANYTHINGLLM_INTEGRATION=1
  ANYTHINGLLM_BASE=http://127.0.0.1:3001        (optional; default shown)
  ANYTHINGLLM_KEY=<valid api key>
  ANYTHINGLLM_TEST_WORKSPACE=core-memory        (optional; default shown)

Without ANYTHINGLLM_INTEGRATION=1 the module skips every test — safe to import
in the standard unit-test run.

Run locally on GEEKOM after deploy:
  ANYTHINGLLM_INTEGRATION=1 ANYTHINGLLM_KEY=... python3 -m unittest test_integration.py -v
"""
from __future__ import annotations

import io
import json
import os
import unittest
from contextlib import redirect_stdout
from typing import Any

import anythingllm
import server


SKIP_REASON = "integration tests disabled; set ANYTHINGLLM_INTEGRATION=1 to enable"
INTEGRATION_ENABLED = os.environ.get("ANYTHINGLLM_INTEGRATION") == "1"
TEST_WORKSPACE = os.environ.get("ANYTHINGLLM_TEST_WORKSPACE", "core-memory")


def dispatch_and_capture(msg: dict[str, Any], config: anythingllm.ClientConfig) -> list[dict[str, Any]]:
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        server.dispatch(msg, config)
    out: list[dict[str, Any]] = []
    for line in buffer.getvalue().splitlines():
        line = line.strip()
        if line:
            out.append(json.loads(line))
    return out


@unittest.skipUnless(INTEGRATION_ENABLED, SKIP_REASON)
class LiveAnythingLLMTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.config = anythingllm.ClientConfig.from_env()

    def test_health_reports_reachable(self) -> None:
        result = anythingllm.health(self.config)
        self.assertTrue(result.get("reachable"), f"not reachable: {result}")
        self.assertIn(result["status"], {"ok", "auth_error"})

    def test_list_workspaces_returns_something(self) -> None:
        workspaces = anythingllm.list_workspaces(self.config)
        self.assertIsInstance(workspaces, list)
        slugs = [w.slug for w in workspaces]
        self.assertIn(
            TEST_WORKSPACE,
            slugs,
            f"expected workspace '{TEST_WORKSPACE}' in {slugs}",
        )

    def test_rag_query_returns_answer_with_sources(self) -> None:
        result = anythingllm.query(self.config, TEST_WORKSPACE, "What do you know about the user?")
        self.assertTrue(result.answer, "empty answer from AnythingLLM")
        self.assertGreater(len(result.sources), 0, "no sources cited")

    def test_mcp_rag_query_end_to_end(self) -> None:
        responses = dispatch_and_capture(
            {
                "jsonrpc": "2.0",
                "id": 99,
                "method": "tools/call",
                "params": {
                    "name": "rag_query",
                    "arguments": {"workspace": TEST_WORKSPACE, "question": "who is the user"},
                },
            },
            self.config,
        )
        self.assertEqual(len(responses), 1)
        result = responses[0]["result"]
        self.assertFalse(result.get("isError", False), f"tool errored: {result}")
        text = result["content"][0]["text"]
        self.assertIn("Sources:", text)


if __name__ == "__main__":
    unittest.main()
