# Noor Briefing - 2026-04-15

## Executive Brief

Today’s work stabilized the OpenClaw dashboard and live model switching on the GEEKOM machine running OpenClaw `2026.4.12`.

Current confirmed state:

- Dashboard is working.
- OpenClaw gateway is healthy.
- Live writes were re-enabled deliberately.
- Live model was successfully switched to `qwen3:8b`.
- Telegram appears to work with `qwen3:8b`, though it is slower than `llama3.2:3b`.
- Access from the Mac should use the GEEKOM Tailscale URL, not the LAN URL, when the Mac is on Tailscale:
  - `http://100.99.231.1:3024`

## What Broke Earlier

The dashboard previously wrote a config shape that was invalid for OpenClaw `2026.4.12`. That caused:

- `openclaw-gateway` to fail
- OpenClaw health checks to fail
- Telegram to stop working

The invalid-config errors included:

- `agents.defaults.model: Invalid input`
- `agents.defaults.models.primary: Unrecognized keys: "provider", "model"`
- `agents.defaults: Unrecognized key: "routing"`

Recovery worked only after restoring an older valid backup:

- `/home/zia-basit/.openclaw/openclaw.json.bak.20260414T201454Z`

## Key Fixes Made

1. Added missing batch probe backend support.
2. Improved health reporting so failed checks are named explicitly.
3. Made the dashboard sandbox-first by default.
4. Added sandbox/live mode switching in the UI.
5. Added support for loading a live Markdown model log in the dashboard.
6. Fixed cache/browser issues with `no-store` headers.
7. Improved browser compatibility in inline JS.
8. Fixed OpenClaw `2026.4.12` schema handling for live writes.
9. Fixed a second live-write bug where the primary model pointer changed but the active model map did not.
10. Added consistency checks so future model writes fail loudly instead of silently writing split state.
11. Improved audit trail timestamps.
12. Documented the Tailscale-vs-LAN access rule and added Tailscale URL output to deploy logs.

## Important Technical Finding

There was a crucial mismatch bug in the live config:

- `agents.defaults.model.primary` was changed to `ollama/qwen3:8b`
- but `agents.defaults.models` still contained `ollama/llama3.2:3b`

That likely caused inconsistent OpenClaw/Telegram behavior.

This has now been fixed.

## Current Live State

Confirmed during the chat:

- Dashboard env had `OPENCLAW_ENABLE_LIVE_WRITES=true`
- Dashboard reported `Live writes enabled: yes`
- Live config showed:
  - `"primary": "ollama/qwen3:8b"`
- OpenClaw health endpoint returned `200 OK`
- Dashboard UI showed:
  - `live | live-enabled`
  - primary model `qwen3:8b`
  - healthy OpenClaw and Ollama

## Telegram / Model Notes

Current best interpretation:

- `qwen3:8b` appears usable in Telegram and OpenClaw, but slower.
- `llama3.2:3b` was faster, but earlier session/context issues may have happened under that model.
- Some Telegram screenshots mixed evidence from before and after the live switch, so not every observed error can be assigned confidently to one model.
- Bot self-reporting of its current model is not fully trustworthy. `openclaw models status` and config files are better sources of truth.

Known Telegram/OpenClaw issues to keep monitoring:

- `session_status failed`
- `Unknown sessionId`
- `ollama/object`
- `model default failed`

These may be integration/session issues rather than raw model failures.

## Access Rule

Very important operational rule:

- If the Mac and GEEKOM are on the same LAN, use:
  - `http://192.168.86.30:3024`
- If the Mac is connected via Tailscale, use:
  - `http://100.99.231.1:3024`

During this chat, a major apparent “dashboard loading failure” turned out to be this exact network-path issue, not a dashboard code issue.

## Most Relevant Commits

- `3e45a81` `Adapt model writes to existing OpenClaw schema`
- `f99ad99` `Prevent dashboard cache issues on deploy`
- `5ac4d4d` `Improve dashboard browser compatibility`
- `097fc85` `Document Tailscale dashboard access`
- `5aa2dab` `Fix live active model map updates`
- `2e20c94` `Strengthen model switch consistency and audit timestamps`
- `d4b5cd7` `Simplify audit timestamp display`

## Current Risks / Unknowns

- Telegram/session behavior still needs longer real-world observation.
- `qwen3:8b` is slower; suitability depends on whether the slower performance is acceptable.
- One browser/UI issue remained partially unverified at the end: timestamp display may still have looked stale in the browser, likely due to cached page state.
- Future deploys can reset live-write enablement unless deployed with:
  - `ALLOW_LIVE_WRITES=true`

## Suggested Next Steps

1. Continue real Telegram/OpenClaw use under `qwen3:8b`.
2. Watch for session/object-related failures in `openclaw-gateway` logs.
3. Decide whether `qwen3:8b` or `llama3.2:3b` is the better long-term live model.
4. Verify the final timestamp-display fix in a fresh browser session.

