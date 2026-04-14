# LLM-Model-Dashboard

Small local dashboard for switching the active OpenClaw Ollama model without editing `openclaw.json` by hand.

## Why This Exists

Editing `~/.openclaw/openclaw.json` by hand is slow and risky when you are switching between local Ollama models for different OpenClaw tasks.

This dashboard gives you a safer local control panel for:

- changing the active primary model
- validating JSON before save
- creating an automatic backup before every write
- checking OpenClaw and Ollama health
- restarting the OpenClaw gateway deliberately

## MVP Features

- Read the OpenClaw config from disk
- Show the current primary model and configured Ollama model catalog
- Show installed Ollama models from `http://127.0.0.1:11434/api/tags`
- Switch the primary model safely
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
OPENCLAW_CONFIG_PATH=/home/zia-basit/.openclaw/openclaw.json npm start
```

The default dashboard port is `3024`. Set `PORT` if you want a different one.

Then open `http://127.0.0.1:3024`.

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
- HTTP handler integration for the MVP flows

Run the suite with:

```bash
npm test
```

## Roadmap

- save confirmation modal with backup filename surfaced in the UI
- restore previous backup action
- richer model metadata editing
- preset-based model switching
- audit/history panel
- optional browser-level UI tests

## License

MIT. See [LICENSE](./LICENSE).
