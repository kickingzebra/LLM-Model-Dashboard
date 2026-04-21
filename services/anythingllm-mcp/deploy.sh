#!/usr/bin/env bash
# Deploy the AnythingLLM MCP server to GEEKOM and register it with OpenClaw.
#
# Run this from your MacBook. Requires ssh access to GEEKOM.
#
#   ./deploy.sh
#
# Env overrides:
#   GEEKOM_HOST=zia-basit@100.99.231.1
#   REMOTE_PATH=/home/zia-basit/.openclaw/services/anythingllm-mcp
#   REMOTE_ENV_FILE=/home/zia-basit/.config/anythingllm-mcp/env
#   ANYTHINGLLM_BASE=http://127.0.0.1:3001
#
# Setting ANYTHINGLLM_KEY in the environment skips the interactive prompt,
# which is the recommended path (no risk of paste mishaps).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GEEKOM_HOST="${GEEKOM_HOST:-zia-basit@100.99.231.1}"
REMOTE_PATH="${REMOTE_PATH:-/home/zia-basit/.openclaw/services/anythingllm-mcp}"
REMOTE_ENV_FILE="${REMOTE_ENV_FILE:-/home/zia-basit/.config/anythingllm-mcp/env}"
ANYTHINGLLM_BASE="${ANYTHINGLLM_BASE:-http://127.0.0.1:3001}"

log() { printf "[deploy] %s\n" "$*"; }
die() { printf "[deploy] error: %s\n" "$*" >&2; exit 1; }

if [[ -z "${ANYTHINGLLM_KEY:-}" ]]; then
  printf "AnythingLLM API key: "
  stty -echo
  read -r ANYTHINGLLM_KEY
  stty echo
  printf "\n"
fi

[[ -n "$ANYTHINGLLM_KEY" ]] || die "ANYTHINGLLM_KEY is empty"

# Sanity check the key shape before pushing it anywhere. AnythingLLM keys look
# like XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX (7 alphanumerics, 3 dashes, 7+7+7+7 chars).
# This catches the common failure mode where the prompt captures a shell command
# or file path instead of the actual key.
if ! [[ "$ANYTHINGLLM_KEY" =~ ^[A-Z0-9]{7}-[A-Z0-9]{7}-[A-Z0-9]{7}-[A-Z0-9]{7}$ ]]; then
  die "ANYTHINGLLM_KEY doesn't match expected shape (XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX). Got: '$ANYTHINGLLM_KEY'"
fi

log "validating key against AnythingLLM on GEEKOM"
VALIDATE=$(ssh "$GEEKOM_HOST" "curl -sS -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer $ANYTHINGLLM_KEY' '$ANYTHINGLLM_BASE/api/v1/auth'" || echo "000")
[[ "$VALIDATE" == "200" ]] || die "AnythingLLM rejected the key (HTTP $VALIDATE). Check the key and that AnythingLLM is running."

log "ensuring remote directories exist"
ssh "$GEEKOM_HOST" "mkdir -p '$REMOTE_PATH' && mkdir -p \"\$(dirname '$REMOTE_ENV_FILE')\""

log "copying server files"
scp -q \
  "$SCRIPT_DIR/server.py" \
  "$SCRIPT_DIR/anythingllm.py" \
  "$SCRIPT_DIR/test_server.py" \
  "$SCRIPT_DIR/test_integration.py" \
  "$GEEKOM_HOST:$REMOTE_PATH/"

log "writing env file (mode 0600)"
ssh "$GEEKOM_HOST" "cat > '$REMOTE_ENV_FILE' <<EOF && chmod 600 '$REMOTE_ENV_FILE'
ANYTHINGLLM_BASE=$ANYTHINGLLM_BASE
ANYTHINGLLM_KEY=$ANYTHINGLLM_KEY
EOF"

log "running remote unit tests"
ssh "$GEEKOM_HOST" "bash -lc 'set -eo pipefail; cd \"$REMOTE_PATH\" && python3 -m unittest test_server.py 2>&1 | tail -25'"

log "running remote integration tests against live AnythingLLM"
ssh "$GEEKOM_HOST" "bash -lc 'set -eo pipefail; cd \"$REMOTE_PATH\" && \
  ANYTHINGLLM_INTEGRATION=1 \
  ANYTHINGLLM_BASE=\"$ANYTHINGLLM_BASE\" \
  ANYTHINGLLM_KEY=\"$ANYTHINGLLM_KEY\" \
  python3 -m unittest test_integration.py -v 2>&1 | tail -20'"

log "registering MCP server with OpenClaw"
SERVER_PATH="$REMOTE_PATH/server.py"
MCP_CONFIG=$(cat <<JSON
{"command":"python3","args":["$SERVER_PATH"],"env":{"ANYTHINGLLM_BASE":"$ANYTHINGLLM_BASE","ANYTHINGLLM_KEY":"$ANYTHINGLLM_KEY"}}
JSON
)
ssh "$GEEKOM_HOST" "bash -lc \"openclaw mcp set anythingllm '$MCP_CONFIG'\""

log "restarting gateway"
ssh "$GEEKOM_HOST" "systemctl --user restart openclaw-gateway"
sleep 3
ssh "$GEEKOM_HOST" "systemctl --user is-active openclaw-gateway"

log "verifying registration"
ssh "$GEEKOM_HOST" "bash -lc 'openclaw mcp list && echo && openclaw mcp show anythingllm'"

cat <<DONE

Next steps on Telegram:
  1. /new
  2. /context list      -> look for anythingllm__rag_query, anythingllm__list_workspaces, anythingllm__health
  3. Ask Noor something that needs workspace knowledge.

If tools don't appear, on GEEKOM:
  journalctl --user -u openclaw-gateway -n 50 --no-pager | tail -30

DONE
