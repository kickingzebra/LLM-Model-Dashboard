# OpenClaw Model Live Log

Use this file as the running event log for real-world model behavior across Ollama, OpenClaw, Telegram, TUI, and dashboard-driven tests.

Update this log whenever a model shows:

- success on a real workflow
- tool-calling failure
- timeout or hang
- routing mismatch
- Telegram-specific issues
- object/session access failures
- unusual latency or degraded quality

## Event Format

Copy this block for each new event:

```md
### YYYY-MM-DD HH:MM TZ
- Model:
- Surface:
- Status: pass / fail / degraded / unclear
- Prompt or action:
- Observed behavior:
- Likely classification:
- Evidence:
- Next action:
```

## Model Summary

| Model | Latest Status | Surfaces Seen | Common Failure Mode | Last Updated | Notes |
| --- | --- | --- | --- | --- | --- |
| `ollama/llama3.2:3b` | Fail for Telegram object-backed markdown retrieval | Telegram, dashboard | `ollama/object` or session/object retrieval failure | 2026-04-15 | Chat may still be usable; failure appears tool/integration-related |

---

## `ollama/llama3.2:3b`

### 2026-04-15 11:30 BST
- Model: `ollama/llama3.2:3b`
- Surface: Telegram bot (`Noor_2_bot`)
- Status: fail
- Prompt or action: Asked the bot to show or read the markdown conversation log file.
- Observed behavior: The bot replied that it was not authorized to display the markdown file directly, then reported `Session Status: object failed`, followed by `Session Status: ollama/object failed`. It also referenced a default model mismatch while attempting to access the markdown file.
- Likely classification: OpenClaw integration issue first; specifically Telegram/session/object retrieval failure, with a possible model-profile mismatch layered on top. Not enough evidence yet to call this a raw markdown parsing failure.
- Evidence:
  - Telegram screenshot shows `object failed` and `ollama/object failed`.
  - Dashboard was set to `ollama/llama3.2:3b` as the primary model.
  - Local dashboard note says Telegram path, TUI path, session behavior, and real OpenClaw tool execution are not yet automated in regression coverage.
  - Existing project notes explicitly recommend not enabling Telegram until the base OpenClaw-to-Ollama path is stable.
- Next action: Verify the same markdown/object retrieval outside Telegram, inspect OpenClaw logs for the exact `ollama/object` error, and compare behavior against a stronger tool-capable model.

## Notes

- Treat direct Ollama success and Telegram/OpenClaw failure as an integration failure first, not an automatic model rejection.
- For models that pass basic chat but fail object/tool-backed retrieval, note them as `conditional` or `chat-only` until proven otherwise.
