"""
Unit tests for the AnythingLLM MCP server.

Upstream AnythingLLM is mocked via monkeypatched module functions.
Run: python3 -m unittest test_server.py -v
"""
from __future__ import annotations

import io
import json
import sys
import unittest
from contextlib import redirect_stdout
from typing import Any
from unittest import mock

import anythingllm
import server


def fresh_config() -> anythingllm.ClientConfig:
    return anythingllm.ClientConfig(base_url="http://test", api_key="test-key", timeout_seconds=1)


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


class ProtocolTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = fresh_config()

    def test_initialize_returns_protocol_and_server_info(self) -> None:
        responses = dispatch_and_capture(
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
            self.config,
        )
        self.assertEqual(len(responses), 1)
        result = responses[0]["result"]
        self.assertEqual(result["protocolVersion"], server.PROTOCOL_VERSION)
        self.assertEqual(result["serverInfo"]["name"], "anythingllm-mcp")
        self.assertIn("tools", result["capabilities"])

    def test_notifications_initialized_produces_no_output(self) -> None:
        responses = dispatch_and_capture(
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            self.config,
        )
        self.assertEqual(responses, [])

    def test_tools_list_returns_three_tools(self) -> None:
        responses = dispatch_and_capture(
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
            self.config,
        )
        tools = responses[0]["result"]["tools"]
        names = {t["name"] for t in tools}
        self.assertEqual(names, {"rag_query", "list_workspaces", "health"})

    def test_rag_query_schema_requires_workspace_and_question(self) -> None:
        responses = dispatch_and_capture(
            {"jsonrpc": "2.0", "id": 3, "method": "tools/list", "params": {}},
            self.config,
        )
        tools = {t["name"]: t for t in responses[0]["result"]["tools"]}
        schema = tools["rag_query"]["inputSchema"]
        self.assertEqual(set(schema["required"]), {"workspace", "question"})

    def test_unknown_tool_returns_method_not_found(self) -> None:
        responses = dispatch_and_capture(
            {
                "jsonrpc": "2.0",
                "id": 4,
                "method": "tools/call",
                "params": {"name": "does_not_exist", "arguments": {}},
            },
            self.config,
        )
        self.assertIn("error", responses[0])
        self.assertEqual(responses[0]["error"]["code"], -32601)

    def test_unknown_method_returns_method_not_found(self) -> None:
        responses = dispatch_and_capture(
            {"jsonrpc": "2.0", "id": 5, "method": "made_up_method"},
            self.config,
        )
        self.assertEqual(responses[0]["error"]["code"], -32601)


class RagQueryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = fresh_config()

    def _call(self, arguments: dict[str, Any]) -> dict[str, Any]:
        responses = dispatch_and_capture(
            {
                "jsonrpc": "2.0",
                "id": 10,
                "method": "tools/call",
                "params": {"name": "rag_query", "arguments": arguments},
            },
            self.config,
        )
        return responses[0]["result"]

    def test_missing_workspace_returns_tool_error(self) -> None:
        result = self._call({"question": "hi"})
        self.assertTrue(result.get("isError"))
        self.assertIn("workspace", result["content"][0]["text"].lower())

    def test_missing_question_returns_tool_error(self) -> None:
        result = self._call({"workspace": "core-memory"})
        self.assertTrue(result.get("isError"))
        self.assertIn("question", result["content"][0]["text"].lower())

    def test_happy_path_formats_answer_and_sources(self) -> None:
        fake_result = anythingllm.QueryResult(
            answer="Zia runs OpenClaw on a GEEKOM A9 Max.",
            sources=["USER.md", "IDENTITY.md"],
            model="llama3.2:3b",
            duration_ms=1234,
        )
        with mock.patch.object(anythingllm, "query", return_value=fake_result) as patched:
            result = self._call({"workspace": "core-memory", "question": "who is Zia"})
        patched.assert_called_once()
        self.assertFalse(result.get("isError", False))
        text = result["content"][0]["text"]
        self.assertIn("Zia runs OpenClaw", text)
        self.assertIn("USER.md", text)
        self.assertIn("IDENTITY.md", text)
        self.assertIn("Sources:", text)

    def test_workspace_not_found_surfaces_friendly_hint(self) -> None:
        with mock.patch.object(anythingllm, "query", side_effect=anythingllm.AnythingLLMNotFound("nope")):
            result = self._call({"workspace": "ghost", "question": "hi"})
        self.assertTrue(result["isError"])
        self.assertIn("list_workspaces", result["content"][0]["text"])

    def test_auth_error_surfaces_key_hint(self) -> None:
        with mock.patch.object(anythingllm, "query", side_effect=anythingllm.AnythingLLMAuthError("401")):
            result = self._call({"workspace": "core-memory", "question": "hi"})
        self.assertTrue(result["isError"])
        self.assertIn("ANYTHINGLLM_KEY", result["content"][0]["text"])

    def test_timeout_is_reported(self) -> None:
        with mock.patch.object(anythingllm, "query", side_effect=anythingllm.AnythingLLMTimeout("30s")):
            result = self._call({"workspace": "core-memory", "question": "hi"})
        self.assertTrue(result["isError"])
        self.assertIn("timed out", result["content"][0]["text"].lower())

    def test_unreachable_is_reported(self) -> None:
        with mock.patch.object(anythingllm, "query", side_effect=anythingllm.AnythingLLMUnreachable("ECONNREFUSED")):
            result = self._call({"workspace": "core-memory", "question": "hi"})
        self.assertTrue(result["isError"])
        self.assertIn("unreachable", result["content"][0]["text"].lower())

    def test_empty_answer_has_placeholder_not_crash(self) -> None:
        fake_result = anythingllm.QueryResult(answer="", sources=[])
        with mock.patch.object(anythingllm, "query", return_value=fake_result):
            result = self._call({"workspace": "core-memory", "question": "hi"})
        self.assertFalse(result.get("isError", False))
        self.assertIn("(empty response", result["content"][0]["text"])


class ListWorkspacesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = fresh_config()

    def _call(self) -> dict[str, Any]:
        responses = dispatch_and_capture(
            {
                "jsonrpc": "2.0",
                "id": 20,
                "method": "tools/call",
                "params": {"name": "list_workspaces", "arguments": {}},
            },
            self.config,
        )
        return responses[0]["result"]

    def test_lists_workspaces_with_slug_and_doc_count(self) -> None:
        fake = [
            anythingllm.Workspace(slug="core-memory", name="Core Memory", doc_count=7),
            anythingllm.Workspace(slug="personal", name="Personal", doc_count=0),
        ]
        with mock.patch.object(anythingllm, "list_workspaces", return_value=fake):
            result = self._call()
        text = result["content"][0]["text"]
        self.assertIn("core-memory (7 docs)", text)
        self.assertIn("personal (0 docs)", text)

    def test_empty_list_is_explicit(self) -> None:
        with mock.patch.object(anythingllm, "list_workspaces", return_value=[]):
            result = self._call()
        self.assertIn("No workspaces", result["content"][0]["text"])

    def test_unreachable_is_reported(self) -> None:
        with mock.patch.object(anythingllm, "list_workspaces", side_effect=anythingllm.AnythingLLMUnreachable("x")):
            result = self._call()
        self.assertTrue(result["isError"])
        self.assertIn("unreachable", result["content"][0]["text"].lower())


class HealthTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = fresh_config()

    def test_health_returns_reachability_json(self) -> None:
        with mock.patch.object(anythingllm, "health", return_value={"status": "ok", "reachable": True}):
            responses = dispatch_and_capture(
                {
                    "jsonrpc": "2.0",
                    "id": 30,
                    "method": "tools/call",
                    "params": {"name": "health", "arguments": {}},
                },
                self.config,
            )
        text = responses[0]["result"]["content"][0]["text"]
        parsed = json.loads(text)
        self.assertTrue(parsed["reachable"])
        self.assertEqual(parsed["status"], "ok")


class ClientConfigTests(unittest.TestCase):
    def test_from_env_requires_key(self) -> None:
        with mock.patch.dict("os.environ", {}, clear=True):
            with self.assertRaises(anythingllm.AnythingLLMError):
                anythingllm.ClientConfig.from_env()

    def test_from_env_defaults_base_url(self) -> None:
        with mock.patch.dict("os.environ", {"ANYTHINGLLM_KEY": "abc"}, clear=True):
            config = anythingllm.ClientConfig.from_env()
        self.assertEqual(config.base_url, "http://127.0.0.1:3001")
        self.assertEqual(config.api_key, "abc")

    def test_from_env_strips_trailing_slash(self) -> None:
        with mock.patch.dict("os.environ", {"ANYTHINGLLM_KEY": "abc", "ANYTHINGLLM_BASE": "http://foo/"}, clear=True):
            config = anythingllm.ClientConfig.from_env()
        self.assertEqual(config.base_url, "http://foo")


if __name__ == "__main__":
    unittest.main()
