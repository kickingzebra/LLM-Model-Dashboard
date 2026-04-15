# LLM-Model-Dashboard

Small local dashboard for switching the active OpenClaw Ollama model without editing `openclaw.json` by hand.

## Why This Exists

Editing `~/.openclaw/openclaw.json` by hand is slow and risky when you are switching between local Ollama models for different OpenClaw tasks.

This dashboard gives you a safer local control panel for:

- changing the active primary model
- keeping a separate chat model when you only want to change the tool/agent model
- validating JSON before save
- creating an automatic backup before every write
- checking OpenClaw and Ollama health
- restarting the OpenClaw gateway deliberately

## MVP Features

- Read the OpenClaw config from disk
- Show the current primary model and configured Ollama model catalog
- Show installed Ollama models from `http://127.0.0.1:11434/api/tags`
- Switch the primary model safely without clobbering a dedicated chat model
- Add an installed model to `models.providers.ollama.models` if it is missing
- Validate JSON before writing
- Create a timestamped backup before every write
- Restart `openclaw-gateway` with explicit confirmation
- Show OpenClaw and Ollama health status
- Mask secrets before returning config data to the browser

## Tech Stack

- Node.js standard library only
- Simple HTML/CSS/JS frontend
- Built-in `node:test` test runner
- No database
- No cloud dependency

## Quick Start

```bash
git clone https://github.com/kickingzebra/LLM-Model-Dashboard.git
cd LLM-Model-Dashboard
npm test
OPENCLAW_CONFIG_PATH=/home/zia-basit/.openclaw/openclaw.sandbox.json npm start
```

The default dashboard port is `3024`. Set `PORT` if you want a different one.

Then open `http://127.0.0.1:3024`.

For a safe local dry run without touching a live OpenClaw config:

```bash
npm run start:test-config
```

That uses [local-data/openclaw.test.json](/Users/ziabasit/Documents/New project/openclaw-dashboard/local-data/openclaw.test.json) as a sandbox copy.
The reset button restores that file from [local-data/openclaw.test.seed.json](/Users/ziabasit/Documents/New project/openclaw-dashboard/local-data/openclaw.test.seed.json).
Recent sandbox model changes are logged to `local-data/model-history.log.json`.
Direct Ollama probe results are logged to `local-data/model-probe-results.json`.
If you set `OPENCLAW_MODEL_LIVE_LOG_PATH`, the dashboard also shows a human-readable Markdown model log.

## GEEKOM Deploy

On the GEEKOM machine, clone the repo and run:

```bash
git clone https://github.com/kickingzebra/LLM-Model-Dashboard.git
cd LLM-Model-Dashboard
chmod +x scripts/deploy-geekom.sh
./scripts/deploy-geekom.sh
```

That deploy helper will:

- verify the live OpenClaw config exists
- create `/home/zia-basit/.openclaw/openclaw.sandbox.json` if it is missing
- create `/home/zia-basit/.openclaw/openclaw.sandbox.seed.json` if it is missing
- run `npm run test:regression`
- write a user-level systemd env file
- install a `systemd --user` service
- enable and restart the dashboard service

By default, the GEEKOM deployment is now sandbox-only:

- writes go to `/home/zia-basit/.openclaw/openclaw.sandbox.json`
- reset restores from `/home/zia-basit/.openclaw/openclaw.sandbox.seed.json`
- live writes to `/home/zia-basit/.openclaw/openclaw.json` are blocked unless `OPENCLAW_ENABLE_LIVE_WRITES=true` is explicitly set
- the dashboard UI includes `Use Sandbox` and `Use Live` mode controls; switching to live requires confirmation and stays read-only unless live writes are explicitly enabled

Useful GEEKOM commands:

```bash
systemctl --user status openclaw-dashboard
systemctl --user restart openclaw-dashboard
journalctl --user -u openclaw-dashboard -n 200 --no-pager
```

By default, the deploy script sets:

```bash
HOST=0.0.0.0
```

That makes the dashboard reachable from another machine on your LAN, such as your MacBook, using the GEEKOM IP:

```text
http://192.168.86.30:3024
```

If you want the dashboard to be GEEKOM-local only, set:

```bash
HOST=127.0.0.1
```

in `/home/zia-basit/.config/systemd/user/openclaw-dashboard.env`, then restart the service.

If you ever need to opt back into live writes after the schema fix is complete, set:

```bash
OPENCLAW_ENABLE_LIVE_WRITES=true
OPENCLAW_CONFIG_PATH=/home/zia-basit/.openclaw/openclaw.json
OPENCLAW_RESET_SOURCE_PATH=/home/zia-basit/.openclaw/openclaw.seed.json
```

Until then, leave live writes disabled.

The included templates are:

- `systemd/openclaw-dashboard.service`
- `systemd/openclaw-dashboard.env.example`

## Safety Guarantees

- Invalid JSON is rejected before any write
- A timestamped backup is created before each config save
- Restart actions require explicit confirmation
- Secrets are masked before config data is returned to the UI

## Testing

Current automated coverage includes:

- config loading and parsing
- model switching and JSON structure preservation
- backup creation
- JSON validation
- missing-model insertion into the Ollama catalog
- secret masking
- health checks
- restart behavior
- direct Ollama capability probe parsing and persistence
- HTTP handler integration for the MVP flows

After each model change in the sandbox dashboard, the app can run the documented direct Ollama capability probe from [../scripts/ollama_tool_probe.sh](../scripts/ollama_tool_probe.sh). That covers:

- plain chat check
- tools payload acceptance
- structured tool-call return

The broader OpenClaw confirmation pass from the test matrix is still a second-stage check rather than part of this local dashboard automation.

## Optional Live Log

To surface the Markdown model notebook in the dashboard, set:

```bash
OPENCLAW_MODEL_LIVE_LOG_PATH=/absolute/path/to/openclaw-dashboard/docs/OPENCLAW_MODEL_LIVE_LOG_2026-04-15.md
```

The dashboard will then load and display the file contents in a dedicated `Live Model Log` panel.

Run the suite with:

```bash
npm test
```

Run the full local regression pass, including a smoke test that boots the app against a temporary sandbox config and exercises the save flow:

```bash
npm run test:regression
```

## CI/CD

GitHub Actions now runs a full regression workflow on every push and pull request.

- `Regression` runs unit tests plus an end-to-end smoke regression on Node 22 and 24
- `Delivery` packages a release artifact automatically after a successful `main` regression run

To make this strict in GitHub, set branch protection on `main` and require the `Regression` workflow to pass before merge.

## Roadmap

- save confirmation modal with backup filename surfaced in the UI
- restore previous backup action
- richer model metadata editing
- preset-based model switching
- audit/history panel
- optional browser-level UI tests

## License

MIT. See [LICENSE](./LICENSE).
