# OpenClaw 2026.4.12 — USER.md loads at `/new` but is inconsistent across turns; persistent tool-call leakage

**For posting on:** OpenClaw GitHub issues / discussions / Reddit / X

---

## Title options

- "USER.md partially loads on `/new` in Telegram but drops on follow-up turns; plus model outputs raw tool JSON as text"
- "OpenClaw 2026.4.12 + llama3.2:3b + Telegram: bootstrap injection inconsistent, `session_status object failed` errors"

## Status as of 2026-04-17

**Fixed (documenting for the next person):**

- Sandbox `workspaceAccess` was `none` by default → changed to `rw`
- Sandbox `workspaceRoot` was pointing at `~/.openclaw/sandboxes` → changed to the real `~/.openclaw/workspace`

After those two fixes, Noor (Telegram bot) now greets me by name on the first reply of `/new` — she says "Good morning, **Zia**!" This is a real improvement from yesterday where she had no idea who I was.

**Still broken:**

1. Inconsistent context use across turns
2. Raw tool-call JSON leaking into user-facing replies
3. Recurring `⚠️ 📊 Session Status: object failed` errors

## Setup

- **OpenClaw:** 2026.4.12 (1c0672b), user-level systemd service on Ubuntu
- **Hardware:** GEEKOM A9 Max — Ryzen AI 9 HX 370, 64GB RAM, iGPU only
- **Model:** `ollama/llama3.2:3b` via local Ollama (128K native context, capped to 32K in OpenClaw)
- **Channel:** Telegram bot (`@Noor_geekom_bot`), direct DM (`agent:main:telegram:direct:<userId>`)
- **Agent:** `main` (default, no explicit routing rules)

## Current relevant config

```bash
$ openclaw sandbox explain
Effective sandbox:
  agentId: main
  sessionKey: agent:main:main
  mainSessionKey: agent:main:main
  runtime: direct
  mode: off  scope: agent
  workspaceAccess: rw  workspaceRoot: /home/zia-basit/.openclaw/workspace

$ openclaw config get agents.defaults.memorySearch
{ "enabled": true, "sources": ["memory"] }

$ openclaw config get agents.defaults.contextTokens
32768

$ openclaw config get agents.defaults.compaction.reserveTokensFloor
20000

$ openclaw memory status
Memory Search (main)
Provider: none (requested: auto)
Indexed: 2/2 files · 10 chunks
FTS: ready
Vector: unknown  (sqlite-vec unavailable)
```

## What's in the workspace

`~/.openclaw/workspace/USER.md` contains my name (Zia), timezone, list of projects, and working-style notes — about 30 lines.

## Reproducer — transcript from Telegram

```
> Me: /new

> Noor: }
{"name": "show-text-to-speech", "parameters": {"text": "Good morning, Noor...", "voice": "Nova"}}

> Noor: Good morning, Zia! 😊 I'm Noor, your friendly AI assistant. Hope you're having a great start to the day. What's on your agenda today?
```

Good — she uses my name. USER.md content has reached her for the greeting turn.

```
> Me: /new

> Noor: }
{"name": "read", "parameters": {"s": "SOUL.md"}}
{"name": "read", "parameters": {"s": "USER.md"}}
{"name": "session_status", "parameters": {"model": "default"}}
{"name": "read", "parameters": {"s": "IDENTITY.md"}}
{"name": "greet", "parameters": {"p": "Noor"}}
{"name": "ask", "parameters": {"q": "What would you like to do today?"}}

> Noor: Good morning, Zia! 😊 It's nice to be back online. What's on your agenda today? 📅 Do you need any help or just want to chat?
```

Still greets me by name — but also outputs five raw JSON tool calls as visible text to the user. AGENTS.md says *"Do not manually reread startup files unless the user explicitly asks"* — the model is ignoring that.

```
> Me: Hello, what do you know about me?

> Noor: I apologize for the confusion, but it seems I was trying to access a model that's not available. Let me check again.
If you'd like to know something specific about yourself or your surroundings, feel free to ask, and I'll do my best to help!

> Noor: ⚠️ 📊 Session Status: object failed
```

She's forgotten. Just greeted me as Zia a few messages earlier, but can't answer a direct question about me. The `Session Status: object failed` marker appears again.

```
> Me: /new
> Me: what do you know about me?

> Noor: Hello Account. I don't know much about you yet, but I'm here to help with anything you'd like to discuss...
```

After the second `/new`, she no longer knows me at all. She calls me "Hello Account" (the Telegram sender label, not the USER.md name). Bootstrap injection appears to have dropped on subsequent `/new`.

## What I've tried

1. Set `agents.defaults.memorySearch.enabled: true`
2. Ran `openclaw memory index --force` — 2 files indexed on FTS
3. Set `agents.defaults.contextTokens: 32768`, `compaction.reserveTokensFloor: 20000`, `compaction.memoryFlush.enabled: true` to avoid context overflow
4. Ran `openclaw agents set-identity --agent main --name "Noor" --emoji "🌟"`
5. Filled USER.md with profile (name, timezone, projects, style notes)
6. Walked through `openclaw configure` — Workspace, Web tools (enabled `web_fetch` keyless), Plugins, Skills sections
7. Based on community advice: `agents.defaults.sandbox.workspaceAccess → "rw"`
8. Based on community advice: `agents.defaults.sandbox.workspaceRoot → ~/.openclaw/workspace` (was `~/.openclaw/sandboxes`)
9. Restarted gateway repeatedly (`systemctl --user restart openclaw-gateway`)

## Specific questions

1. **Why does USER.md injection work on the first reply of `/new` but drop on follow-up turns and subsequent `/new`?** Is this expected behaviour of `contextInjection: "continuation-skip"`? If so, how do I keep USER.md sticky across the whole session?

2. **What causes the recurring `⚠️ 📊 Session Status: object failed` error?** It appears in Telegram replies but I don't see it in `journalctl --user -u openclaw-gateway`. Is this a known bug, or is there somewhere else to look for the underlying error?

3. **Why does `ollama/llama3.2:3b` consistently leak raw tool-call JSON (e.g. `{"name": "read", "parameters": {...}}`) into user-facing replies?** Is this a known llama3.2 tool-calling issue when OpenClaw presents its tool schema? Any workaround short of switching models?

4. **How do I enable the `active-memory` plugin from the CLI?** It's shown as `disabled (bundled)`. The `openclaw configure` wizard doesn't expose it. `plugins.entries.active-memory.enabled` in config?

5. **Is there a known-good reference config for Telegram DM + persistent USER.md + small local model (3B–8B)?** Even a minimal working example would help me sanity-check my setup.

## Other context

- OpenClaw ships with Active Memory (`stock:active-memory/index.js`), Memory Core (loaded by default), Memory LanceDB (disabled), Memory Wiki (disabled)
- Hooks ready: `boot-md`, `bootstrap-extra-files`, `command-logger`, `session-memory`, `memory-core-short-term-dreaming-cron`
- Gateway healthy: `curl http://127.0.0.1:18789/health` → `{"ok":true,"status":"live"}`
- Memory search from CLI works correctly: `openclaw memory search "session"` returns indexed content
- Ollama is serving llama3.2:3b on GPU with 32768 context (`ollama ps` confirms)

## Version info

- Ubuntu (`zia-basit-A9-Max-openclaw`)
- Node 22.22.2 via nvm
- OpenClaw 2026.4.12 (1c0672b) installed globally via npm
- Ollama serving: nemotron-mini:4b, llama3.1:8b, llama3.2:3b, codegemma:7b, gemma3:27b, qwen3:8b, gemma3:12b, gemma3:4b

Thanks in advance — happy to provide full `~/.openclaw/openclaw.json` (redacted) or any additional logs.
