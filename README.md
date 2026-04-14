# LLM-Model-Dashboard

Small local dashboard for switching the active OpenClaw Ollama model without editing `openclaw.json` by hand.

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

## Run

```bash
npm test
OPENCLAW_CONFIG_PATH=/home/zia-basit/.openclaw/openclaw.json npm start
```

The default dashboard port is `3024`. Set `PORT` if you want a different one.

## Notes

- The app is dependency-light and uses the Node standard library only.
- Tests use the built-in `node:test` runner.
- Browser interactions are covered indirectly through handler-level integration tests in this MVP rather than a full browser automation stack.
