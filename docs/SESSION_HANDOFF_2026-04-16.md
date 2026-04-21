# Session Handoff — 2026-04-16

## Session goals

1. Review the OpenClaw dashboard project
2. Push changes to GitHub and deploy
3. Design and build a Context Orchestration & Memory System
4. Enable multiple-thread memory for Noor on Telegram
5. Set up OpenClaw native memory features

## Completed

### Dashboard
- Reviewed repo (both branches: `main` and `codex/dashboard-probe-and-ui`)
- Merged feature branch into `main` (all 24 commits brought in)
- Pushed both branches to GitHub (`kickingzebra/LLM-Model-Dashboard`)
- Pulled and deployed latest `main` on GEEKOM via `deploy-geekom.sh`
- 38/38 tests passing on deploy
- Service confirmed healthy on Tailscale (`http://100.99.231.1:3024`) and LAN (`http://192.168.86.30:3024`)

### Context Oracle — new private repo
- Created new standalone service at `/Users/ziabasit/Documents/New project/context-oracle/`
- Phase 1 complete: chat storage, context retrieval, HTTP API
- 34 tests passing
- Zero external dependencies (Node stdlib only)
- Pushed to GitHub as private repo: `kickingzebra/context-oracle`
- Not yet wired into OpenClaw/Telegram flow

### OpenClaw tuning (on GEEKOM)
- Diagnosed qwen3:8b context overflow from session 2026-04-15 (compaction failed → session wipe)
- Switched primary model back to `ollama/llama3.2:3b` (128K native, 32K effective)
- Set `agents.defaults.contextTokens: 32768` (up from ~24K default)
- Set `agents.defaults.compaction.reserveTokensFloor: 20000`
- Set `agents.defaults.compaction.memoryFlush.enabled: true`
- Enabled `agents.defaults.memorySearch.enabled: true`
- Ran memory index — 2 files indexed on FTS, vector disabled (no embedding provider)
- Ran `openclaw configure` wizard
  - Workspace section confirmed
  - Web tools: enabled `web_fetch` (keyless)
  - Web search (Brave) — skipped, $5/month not justified yet
  - Plugins section offered didn't include memory plugins
  - Skills section skipped (weather deferred)

### Noor identity
- `~/.openclaw/workspace/IDENTITY.md` — name, role, constraints
- `~/.openclaw/workspace/USER.md` — Zia's profile, projects (dashboard, context-oracle, HR/Time-Tracker), working style, TDD requirements
- `openclaw agents set-identity --agent main --name "Noor" --emoji "🌟"` applied

### Requirements review
- Reviewed Context Orchestration & Memory System requirements document
- Agreed on:
  - JSONL for storage (not MD)
  - No per-turn summarisation in Phase 1 (defer to batch/on-demand)
  - Hook into OpenClaw (Option B) rather than build separate orchestrator
  - Tool execution layer parked as separate workstream

## The core problem — explained

### What we wanted

Give Noor (the Telegram bot) two things:

1. **Persistent memory about Zia** — his name, projects, working style, etc. — that survives session resets and is automatically available in every conversation.
2. **Multi-thread conversation memory** — so different discussion topics can run in parallel without losing context.

### What we found

OpenClaw ships with a full memory system (bundled plugins: `memory-core`, `active-memory`, `memory-lancedb`, `memory-wiki`) and a workspace convention (`USER.md`, `IDENTITY.md`, `AGENTS.md`, `SOUL.md`) specifically designed for this. On paper, it looks like exactly what we need.

### What's broken

**Despite enabling `memorySearch`, indexing files, filling in USER.md, and restarting the gateway — Noor still doesn't know who Zia is.**

Specifically:
- FTS-based memory search **works** when queried directly from the CLI (`openclaw memory search "session"` returns results)
- But that same memory doesn't get **auto-injected** into Noor's prompts
- So even after `/new`, she greets you as a stranger: "I don't have any specific information about you yet"
- She occasionally replies with a cryptic error: `⚠️ 📊 Session Status: USER.md failed`

### Why this is confusing

OpenClaw has **multiple overlapping mechanisms** for memory and context, and the boundaries between them aren't obvious:

| Mechanism | What it's for | Status |
|---|---|---|
| `memorySearch.enabled` | Makes memory files searchable via `memory_search` tool | ✅ Enabled, working |
| `startupContext` | Loads daily memory files on `/new` or `/reset` | Default on, but scope unclear |
| Workspace bootstrap files (USER.md etc.) | System-prompt-level context | ⚠️ Expected to inject, apparently not |
| `active-memory` plugin | Auto-injects relevant memory before every reply | ❌ Disabled by default, can't find enable path |
| `bootstrap-extra-files` hook | Glob-pattern injection of extra files | ✅ Ready, configuration unknown |
| Session JSONL | Current conversation history | ✅ Working (with 32K context) |

The settings for the first five overlap, and documentation on which one actually controls USER.md injection is not obvious from the CLI schema. We went deep into each one and still don't have a definitive answer.

### Two candidate theories

1. **"Main session" scope mismatch** — AGENTS.md says MEMORY.md and user-sensitive files only load in the "main session" (direct chat with the owner). Telegram sessions may not count as "main" by OpenClaw's definition, so workspace files are being withheld for security reasons.

2. **`active-memory` plugin is the missing piece** — the description explicitly says it "runs a bounded blocking memory sub-agent before eligible conversational replies and injects relevant memory into prompt context." That's exactly the behaviour we want. But it's bundled-disabled and the enable path is unclear.

Either of these could be the root cause, and the fix likely takes ~30 minutes of focused investigation — but we'd been at it for several hours already and the signal-to-noise was dropping.

### Secondary issue: tool-call leakage

Even when Noor does reply, she sometimes outputs raw JSON (`{"name": "skill-creator", "parameters": {}}`) instead of natural language. This is a **separate** problem from memory — it's about how OpenClaw parses the small model's output. We parked it as its own workstream.

---

## Outstanding issues

### 1. USER.md not auto-injecting into Noor's context (blocker)
- Symptoms: even after `/new`, Noor says "I don't have any specific information about you yet"
- Triggers "Session Status: USER.md failed" error in Telegram
- Config values `skipBootstrap` / `contextInjection` are not explicitly set (should use defaults)
- `bootstrap-extra-files` hook is Ready
- **Next step:** investigate hook configuration, try enabling `active-memory` plugin

### 2. Tool-call JSON leakage
- Noor outputs raw JSON like `{"name": "skill-creator", "parameters": {}}` instead of natural responses
- Happens on simple queries like "hello" or "what do you know about me?"
- Likely llama3.2:3b's tool-calling trained pattern, OpenClaw not parsing the output correctly
- **Next step:** parked workstream — separate from memory work

### 3. active-memory plugin disabled
- Would auto-inject memory into prompts before every reply
- Bundled but disabled by default
- Plugin wizard doesn't expose enable/disable for memory plugins
- **Next step:** investigate how to enable (may need config key or separate CLI)

### 4. Embedding provider not configured (tech debt)
- Logged in `docs/TECH_DEBT.md`
- Vector search disabled, only FTS keyword search works
- **Next step:** pull `nomic-embed-text` via Ollama, configure OpenClaw to use it

### 5. Weather skill not enabled
- Deferred during configure wizard
- **Next step:** revisit Skills section of configure wizard when ready

### 6. Context Oracle not yet integrated with OpenClaw
- Phase 1 service exists and works standalone
- Need to decide: hook into OpenClaw before/after agent reply to write to Oracle
- **Next step:** research OpenClaw hook events (`before_agent_reply` etc.)

## Important file/system locations

### On MacBook
- Dashboard repo: `/Users/ziabasit/Documents/New project/openclaw-dashboard/`
- Context Oracle repo: `/Users/ziabasit/Documents/New project/context-oracle/`
- Tech debt: `/Users/ziabasit/Documents/New project/openclaw-dashboard/docs/TECH_DEBT.md`

### On GEEKOM
- OpenClaw config: `~/.openclaw/openclaw.json`
- Live config backups: `~/.openclaw/openclaw.json.bak.*`
- Workspace files: `~/.openclaw/workspace/{USER,IDENTITY,SOUL,AGENTS,TOOLS,BOOTSTRAP}.md`
- Memory indexed files: `~/.openclaw/workspace/memory/*.md`
- Memory sqlite store: `~/.openclaw/memory/main.sqlite`
- Agent sessions: `~/.openclaw/agents/main/sessions/*.jsonl`
- Dashboard repo: `~/LLM-Model-Dashboard/`

### GitHub
- `kickingzebra/LLM-Model-Dashboard` (public)
- `kickingzebra/context-oracle` (private)

## Recommended next session starter

1. Re-test if `/new` on Telegram now picks up USER.md (may need a fresh session after config changes)
2. If still missing, investigate enabling `active-memory` plugin
3. Once memory is proven working, design the OpenClaw hook → Context Oracle integration
4. Consider pulling `nomic-embed-text` to enable vector search
