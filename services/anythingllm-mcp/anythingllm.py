"""
Thin HTTP client for the AnythingLLM workspace chat API.

Stdlib only (urllib + json). Designed to be mocked out in unit tests by
monkeypatching the ``_request`` function.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


DEFAULT_TIMEOUT_SECONDS = 30


class AnythingLLMError(Exception):
    """Base class for AnythingLLM client failures."""


class AnythingLLMUnreachable(AnythingLLMError):
    """Network / connection failure reaching AnythingLLM."""


class AnythingLLMAuthError(AnythingLLMError):
    """AnythingLLM rejected the API key."""


class AnythingLLMNotFound(AnythingLLMError):
    """Workspace slug unknown to AnythingLLM."""


class AnythingLLMTimeout(AnythingLLMError):
    """Request exceeded the configured timeout."""


@dataclass
class QueryResult:
    answer: str
    sources: list[str]
    model: str | None = None
    duration_ms: int | None = None


@dataclass
class Workspace:
    slug: str
    name: str
    doc_count: int


@dataclass
class ClientConfig:
    base_url: str
    api_key: str
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS

    @classmethod
    def from_env(cls) -> "ClientConfig":
        base_url = os.environ.get("ANYTHINGLLM_BASE", "http://127.0.0.1:3001").rstrip("/")
        api_key = os.environ.get("ANYTHINGLLM_KEY", "")
        if not api_key:
            raise AnythingLLMError("ANYTHINGLLM_KEY is not set")
        timeout = float(os.environ.get("ANYTHINGLLM_TIMEOUT", DEFAULT_TIMEOUT_SECONDS))
        return cls(base_url=base_url, api_key=api_key, timeout_seconds=timeout)


def _request(
    config: ClientConfig,
    method: str,
    path: str,
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Perform one HTTP request against AnythingLLM. Raises AnythingLLM* on failure."""
    url = f"{config.base_url}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {
        "Authorization": f"Bearer {config.api_key}",
        "Accept": "application/json",
    }
    if data is not None:
        headers["Content-Type"] = "application/json"

    request = urllib.request.Request(url=url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=config.timeout_seconds) as response:
            payload = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise AnythingLLMAuthError(f"AnythingLLM auth rejected ({exc.code})") from exc
        if exc.code == 404:
            raise AnythingLLMNotFound(f"Not found: {path}") from exc
        raise AnythingLLMError(f"HTTP {exc.code} from AnythingLLM: {exc.reason}") from exc
    except urllib.error.URLError as exc:
        reason = getattr(exc, "reason", exc)
        if isinstance(reason, TimeoutError) or "timed out" in str(reason).lower():
            raise AnythingLLMTimeout(f"AnythingLLM timed out after {config.timeout_seconds}s") from exc
        raise AnythingLLMUnreachable(f"AnythingLLM unreachable: {reason}") from exc
    except TimeoutError as exc:
        raise AnythingLLMTimeout(f"AnythingLLM timed out after {config.timeout_seconds}s") from exc

    try:
        return json.loads(payload)
    except json.JSONDecodeError as exc:
        raise AnythingLLMError(f"Invalid JSON from AnythingLLM: {payload[:200]}") from exc


def query(config: ClientConfig, workspace: str, question: str) -> QueryResult:
    """Run a RAG query against the named workspace. Returns answer + source titles."""
    body = {"message": question, "mode": "query"}
    data = _request(config, "POST", f"/api/v1/workspace/{workspace}/chat", body)

    answer = (data.get("textResponse") or "").strip()
    sources_raw = data.get("sources") or []
    sources: list[str] = []
    for src in sources_raw:
        title = src.get("title") or src.get("chunkSource") or src.get("id") or "unknown"
        if title not in sources:
            sources.append(title)

    metrics = data.get("metrics") or {}
    return QueryResult(
        answer=answer,
        sources=sources,
        model=metrics.get("model"),
        duration_ms=int(metrics.get("duration", 0) * 1000) if metrics.get("duration") else None,
    )


def list_workspaces(config: ClientConfig) -> list[Workspace]:
    """List all workspaces known to AnythingLLM."""
    data = _request(config, "GET", "/api/v1/workspaces")
    out: list[Workspace] = []
    for ws in data.get("workspaces") or []:
        out.append(Workspace(
            slug=ws.get("slug", ""),
            name=ws.get("name", ws.get("slug", "")),
            doc_count=len(ws.get("documents") or []),
        ))
    return out


def health(config: ClientConfig) -> dict[str, Any]:
    """Check AnythingLLM reachability. Never raises — returns a status dict."""
    try:
        _request(config, "GET", "/api/v1/auth")
        return {"status": "ok", "reachable": True, "base_url": config.base_url}
    except AnythingLLMAuthError as exc:
        return {"status": "auth_error", "reachable": True, "base_url": config.base_url, "error": str(exc)}
    except AnythingLLMError as exc:
        return {"status": "error", "reachable": False, "base_url": config.base_url, "error": str(exc)}
