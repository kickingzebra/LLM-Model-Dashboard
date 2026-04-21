#!/usr/bin/env python3
"""
Minimal MCP stdio server used as a smoke test.

Purpose: prove the OpenClaw MCP bridge end-to-end before writing the real
AnythingLLM wrapper. Exposes one tool, `echo`, that returns its input unchanged.

Protocol: JSON-RPC 2.0 over line-delimited stdin/stdout, per MCP spec.
Dependencies: Python 3.8+ stdlib only.
"""
import json
import sys

PROTOCOL_VERSION = "2024-11-05"
SERVER_INFO = {"name": "mcp-echo-smoke", "version": "0.1.0"}


def send(message):
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def reply(request_id, result):
    send({"jsonrpc": "2.0", "id": request_id, "result": result})


def fail(request_id, code, message):
    send({"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}})


def handle(msg):
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
        reply(request_id, {
            "tools": [{
                "name": "echo",
                "description": (
                    "Smoke-test tool. Returns the input message unchanged, "
                    "prefixed with 'echo: '. Use this to verify the MCP bridge is working."
                ),
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "message": {
                            "type": "string",
                            "description": "Any text. Will be echoed back.",
                        },
                    },
                    "required": ["message"],
                },
            }],
        })
    elif method == "tools/call":
        tool_name = params.get("name")
        tool_args = params.get("arguments") or {}
        if tool_name == "echo":
            text = tool_args.get("message", "")
            reply(request_id, {
                "content": [{"type": "text", "text": f"echo: {text}"}],
            })
        else:
            fail(request_id, -32601, f"Unknown tool: {tool_name}")
    elif request_id is not None:
        fail(request_id, -32601, f"Method not found: {method}")


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        try:
            handle(msg)
        except Exception as exc:
            request_id = None
            try:
                request_id = msg.get("id")
            except AttributeError:
                pass
            if request_id is not None:
                fail(request_id, -32603, f"Internal error: {exc}")


if __name__ == "__main__":
    main()
