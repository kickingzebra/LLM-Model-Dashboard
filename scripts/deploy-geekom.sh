#!/usr/bin/env bash

set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/LLM-Model-Dashboard}"
OPENCLAW_DIR="${OPENCLAW_DIR:-$HOME/.openclaw}"
SERVICE_NAME="${SERVICE_NAME:-openclaw-dashboard}"
PROBE_SCRIPT_PATH="${PROBE_SCRIPT_PATH:-$HOME/scripts/ollama_tool_probe.sh}"
PORT="${PORT:-3024}"
HOST="${HOST:-0.0.0.0}"
ALLOW_LIVE_WRITES="${ALLOW_LIVE_WRITES:-false}"

LIVE_CONFIG_PATH="$OPENCLAW_DIR/openclaw.json"
LIVE_SEED_PATH="${LIVE_SEED_PATH:-$OPENCLAW_DIR/openclaw.seed.json}"
CONFIG_PATH="${CONFIG_PATH:-$OPENCLAW_DIR/openclaw.sandbox.json}"
SEED_PATH="${SEED_PATH:-$OPENCLAW_DIR/openclaw.sandbox.seed.json}"
AUDIT_LOG_PATH="$OPENCLAW_DIR/model-history.log.json"
PROBE_RESULTS_PATH="$OPENCLAW_DIR/model-probe-results.json"
TEST_REPORT_PATH="$OPENCLAW_DIR/test-regression-report.json"

SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SERVICE_DIR/$SERVICE_NAME.service"
ENV_FILE="$SERVICE_DIR/$SERVICE_NAME.env"
TEMPLATE_FILE="$APP_DIR/systemd/openclaw-dashboard.service"

echo "==> Preparing OpenClaw dashboard deployment on GEEKOM"

if [[ ! -d "$APP_DIR" ]]; then
  echo "error: app directory not found: $APP_DIR" >&2
  echo "clone the repo first, for example:" >&2
  echo "  git clone https://github.com/kickingzebra/LLM-Model-Dashboard.git $APP_DIR" >&2
  exit 1
fi

if [[ ! -f "$LIVE_CONFIG_PATH" ]]; then
  echo "error: live OpenClaw config not found: $LIVE_CONFIG_PATH" >&2
  exit 1
fi

if [[ ! -f "$PROBE_SCRIPT_PATH" ]]; then
  echo "warning: probe script not found at $PROBE_SCRIPT_PATH" >&2
  echo "the dashboard will still run, but post-save model probes will fail until the script exists." >&2
fi

mkdir -p "$OPENCLAW_DIR" "$SERVICE_DIR"

if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "==> Creating sandbox copy: $CONFIG_PATH"
  cp "$LIVE_CONFIG_PATH" "$CONFIG_PATH"
else
  echo "==> Sandbox copy already exists: $CONFIG_PATH"
fi

if [[ ! -f "$SEED_PATH" ]]; then
  echo "==> Creating sandbox seed copy: $SEED_PATH"
  cp "$LIVE_CONFIG_PATH" "$SEED_PATH"
else
  echo "==> Sandbox seed copy already exists: $SEED_PATH"
fi

echo "==> Running regression suite"
(
  cd "$APP_DIR"
  npm run test:regression
)

echo "==> Writing environment file: $ENV_FILE"
cat >"$ENV_FILE" <<EOF
HOST=$HOST
PORT=$PORT
OPENCLAW_CONFIG_PATH=$CONFIG_PATH
OPENCLAW_RESET_SOURCE_PATH=$SEED_PATH
OPENCLAW_SANDBOX_CONFIG_PATH=$CONFIG_PATH
OPENCLAW_SANDBOX_RESET_SOURCE_PATH=$SEED_PATH
OPENCLAW_LIVE_CONFIG_PATH=$LIVE_CONFIG_PATH
OPENCLAW_LIVE_RESET_SOURCE_PATH=$LIVE_SEED_PATH
OPENCLAW_AUDIT_LOG_PATH=$AUDIT_LOG_PATH
OPENCLAW_MODEL_PROBE_SCRIPT_PATH=$PROBE_SCRIPT_PATH
OPENCLAW_PROBE_RESULTS_PATH=$PROBE_RESULTS_PATH
OPENCLAW_TEST_REPORT_PATH=$TEST_REPORT_PATH
OPENCLAW_ENABLE_LIVE_WRITES=$ALLOW_LIVE_WRITES
EOF

echo "==> Installing systemd user service: $SERVICE_FILE"
sed \
  -e "s|__APP_DIR__|$APP_DIR|g" \
  -e "s|__ENV_FILE__|$ENV_FILE|g" \
  "$TEMPLATE_FILE" >"$SERVICE_FILE"

echo "==> Reloading systemd user daemon"
systemctl --user daemon-reload

echo "==> Enabling and restarting $SERVICE_NAME"
systemctl --user enable "$SERVICE_NAME"
systemctl --user restart "$SERVICE_NAME"

echo "==> Current service status"
systemctl --user --no-pager --full status "$SERVICE_NAME" || true

echo
echo "Dashboard should now be available at: http://127.0.0.1:$PORT"
if [[ "$HOST" == "0.0.0.0" ]]; then
  echo "LAN access should be available on the GEEKOM machine IP as well."
fi
echo "Environment file: $ENV_FILE"
echo "Service file: $SERVICE_FILE"
echo "Config target: $CONFIG_PATH"
echo "Live writes enabled: $ALLOW_LIVE_WRITES"
