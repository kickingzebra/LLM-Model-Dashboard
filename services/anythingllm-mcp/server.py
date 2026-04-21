#!/usr/bin/env python3
"""
MCP stdio server exposing AnythingLLM RAG to OpenClaw (and any MCP host).

Protocol: JSON-RPC 2.0 over line-delimited stdin/stdout.
Tools:
  - rag_query(workspace, question) -> grounded answer with source citations
  - list_workspaces() -> [{slug, name, doc_count}]
  - health() -> AnythingLLM reachability report

Stdlib only. Configuration via env: ANYTHINGLLM_BASE, ANYTHINGLLM_KEY.
"""
from __future__ import annotations

import json
import sys
import traceback
from typing import Any, Callable

import anythingllm


PROTOCOL_VERSION = "2024-11-05"
SERVER_INFO = {"name": "anythingllm-mcp", "version": "0.1.0"}


def send(message: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def reply(request_id: Any, result: dict[str, Any]) -> None:
    send({"jsonrpc": "2.0", "id": request_id, "result": result})


def fail(request_id: Any, code: int, message: str) -> None:
    send({"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}})


def tool_error(message: str) -> dict[str, Any]:
    """Per MCP spec: tool errors are a successful result with isError=true."""
    return {
        "content": [{"type": "text", "text": message}],
        "isError": True,
    }


def tool_text(text: str) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": text}]}


TOOL_DEFINITIONS = [
    {
        "name": "rag_query",
        "description": (
            "Search one of the user's AnythingLLM workspaces and return a grounded answer "
            "with source citations. Use this whenever the user asks about their own documents, "
            "projects, notes, or knowledge that isn't already in your system prompt."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "workspace": {
                    "type": "string",
                    "description": (
                        "Workspace slug. Call list_workspaces first if you don't know which to use. "
                        "Common slugs: core-memory, project-content-repurposer, personal."
                    ),
                },
                "question": {
                    "type": "string",
                    "description": "Natural-language question to answer from the workspace documents.",
                },
            },
            "required": ["workspace", "question"],
        },
    },
    {
        "name": "list_workspaces",
        "description": (
            "List all AnythingLLM workspaces available to query, with slug and document count. "
            "Call this when you're unsure which workspace contains the information the user is asking about."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "health",
        "description": "Check whether AnythingLLM is reachable and the API key is valid.",
        "inputSchema": {
            "type": "object",
            "properties": {},
        },
    },
]


def format_query_result(result: anythingllm.QueryResult) -> str:
    lines = [result.answer or "(empty response from AnythingLLM)"]
    if result.sources:
        lines.append("")
        lines.append("---")
        lines.append("Sources:")
        for source in result.sources:
            lines.append(f"- {source}")
    return "\n".join(lines)


def format_workspace_list(workspaces: list[anythingllm.Workspace]) -> str:
    if not workspaces:
        return "No workspaces configured in AnythingLLM."
    lines = ["Available workspaces:"]
    for ws in workspaces:
        lines.append(f"- {ws.slug} ({ws.doc_count} docs) — {ws.name}")
    return "\n".join(lines)


def handle_rag_query(config: anythingllm.ClientConfig, args: dict[str, Any]) -> dict[str, Any]:
    workspace = (args.get("workspace") or "").strip()
    question = (args.get("question") or "").strip()
    if not workspace:
        return tool_error("Missing required argument: workspace")
    if not question:
        return tool_error("Missing required argument: question")
    try:
        result = anythingllm.query(config, workspace, question)
    except anythingllm.AnythingLLMNotFound:
        return tool_error(
            f"Workspace '{workspace}' not found. Call list_workspaces to see available slugs."
        )
    except anythingllm.AnythingLLMAuthError as exc:
        return tool_error(f"AnythingLLM auth failed — check ANYTHINGLLM_KEY. ({exc})")
    except anythingllm.AnythingLLMTimeout as exc:
        return tool_error(f"AnythingLLM timed out: {exc}")
    except anythingllm.AnythingLLMUnreachable as exc:
        return tool_error(f"AnythingLLM unreachable: {exc}")
    except anythingllm.AnythingLLMError as exc:
        return tool_error(f"AnythingLLM error: {exc}")
    return tool_text(format_query_result(result))


def handle_list_workspaces(config: anythingllm.ClientConfig, args: dict[str, Any]) -> dict[str, Any]:
    try:
        workspaces = anythingllm.list_workspaces(config)
    except anythingllm.AnythingLLMAuthError as exc:
        return tool_error(f"AnythingLLM auth failed — check ANYTHINGLLM_KEY. ({exc})")
    except anythingllm.AnythingLLMUnreachable as exc:
        return tool_error(f"AnythingLLM unreachable: {exc}")
    except anythingllm.AnythingLLMError as exc:
        return tool_error(f"AnythingLLM error: {exc}")
    return tool_text(format_workspace_list(workspaces))


def handle_health(config: anythingllm.ClientConfig, args: dict[str, Any]) -> dict[str, Any]:
    status = anythingllm.health(config)
    return tool_text(json.dumps(status, indent=2))


TOOL_HANDLERS: dict[str, Callable[[anythingllm.ClientConfig, dict[str, Any]], dict[str, Any]]] = {
    "rag_query": handle_rag_query,
    "list_workspaces": handle_list_workspaces,
    "health": handle_health,
}


def dispatch(msg: dict[str, Any], config: anythingllm.ClientConfig) -> None:
    method = msg.get("method")
    request_id = msg.get("id")
    params = msg.get("params") or {}

    if method == "initialize":
        reply(request_id, {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": SERVER_INFO,
        })
    elif method == "notifications/initialized":
        return
    elif method == "tools/list":
        reply(request_id, {"tools": TOOL_DEFINITIONS})
    elif method == "tools/call":
        tool_name = params.get("name") or ""
        tool_args = params.get("arguments") or {}
        handler = TOOL_HANDLERS.get(tool_name)
        if handler is None:
            fail(request_id, -32601, f"Unknown tool: {tool_name}")
            return
        reply(request_id, handler(config, tool_args))
    elif request_id is not None:
        fail(request_id, -32601, f"Method not found: {method}")


def main() -> None:
    try:
        config = anythingllm.ClientConfig.from_env()
    except anythingllm.AnythingLLMError as exc:
        sys.stderr.write(f"[anythingllm-mcp] configuration error: {exc}\n")
        sys.stderr.flush()
        sys.exit(2)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        try:
            dispatch(msg, config)
        except Exception as exc:
            request_id = msg.get("id") if isinstance(msg, dict) else None
            traceback.print_exc(file=sys.stderr)
            if request_id is not None:
                fail(request_id, -32603, f"Internal error: {exc}")


if __name__ == "__main__":
    main()
