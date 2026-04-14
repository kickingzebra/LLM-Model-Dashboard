const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

async function main() {
  const workspaceDir = path.resolve(__dirname, '..');
  const sourceConfigPath = path.join(workspaceDir, 'local-data', 'openclaw.test.seed.json');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-dashboard-regression-'));
  const configPath = path.join(tempDir, 'openclaw.regression.json');
  const resetSourcePath = path.join(tempDir, 'openclaw.regression.seed.json');
  const auditLogPath = path.join(tempDir, 'model-history.log.json');
  const probeResultsPath = path.join(tempDir, 'model-probe-results.json');
  const fakeProbeScriptPath = path.join(tempDir, 'fake-probe.sh');
  const port = 3131;

  await fs.copyFile(sourceConfigPath, configPath);
  await fs.copyFile(sourceConfigPath, resetSourcePath);
  await fs.writeFile(
    fakeProbeScriptPath,
    `#!/usr/bin/env bash
set -euo pipefail
model="$1"
cat <<EOF
-----
MODEL=$model
CHAT_HTTP=200
CHAT_OK=yes
CHAT_SUMMARY=CHAT_OK
TOOLS_HTTP=200
TOOLS_OUTCOME=tool_calls_returned
TOOLS_SUMMARY=add_numbers {"a":2,"b":2}
EOF
`,
    'utf8'
  );
  await fs.chmod(fakeProbeScriptPath, 0o755);

  const server = spawn(
    process.execPath,
    ['src/index.js'],
    {
      cwd: workspaceDir,
      env: {
        ...process.env,
        OPENCLAW_CONFIG_PATH: configPath,
        OPENCLAW_RESET_SOURCE_PATH: resetSourcePath,
        OPENCLAW_AUDIT_LOG_PATH: auditLogPath,
        OPENCLAW_MODEL_PROBE_SCRIPT_PATH: fakeProbeScriptPath,
        OPENCLAW_PROBE_RESULTS_PATH: probeResultsPath,
        PORT: String(port)
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );

  let stdout = '';
  let stderr = '';

  server.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });

  server.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForServer(`http://127.0.0.1:${port}/api/state`);

    const initialState = await getJson(`http://127.0.0.1:${port}/api/state`);
    assert.equal(initialState.ok, true);
    assert.ok(initialState.summary.availableConfiguredModels.includes('qwen3:8b'));

    const saveResult = await postJson(`http://127.0.0.1:${port}/api/config/primary-model`, {
      modelId: 'qwen3:8b'
    });

    assert.equal(saveResult.ok, true);
    assert.equal(saveResult.validation.ok, true);
    assert.ok(saveResult.backup.path.includes('.bak.'));
    assert.equal(saveResult.probe.ok, true);
    assert.equal(saveResult.probe.entries[0].toolsOutcome, 'tool_calls_returned');

    const savedConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
    assert.equal(savedConfig.agents.defaults.model.primary, 'qwen3:8b');
    assert.equal(savedConfig.agents.defaults.models.primary.model, 'qwen3:8b');
    assert.equal(savedConfig.agents.defaults.models.chat.model, 'qwen3:8b');
    assert.equal(savedConfig.agents.defaults.routing.primaryModel, 'qwen3:8b');

    const backupStat = await fs.stat(saveResult.backup.path);
    assert.ok(backupStat.isFile());

    const validateResult = await postJson(`http://127.0.0.1:${port}/api/config/validate`, {
      text: '{"valid":true}'
    });
    assert.equal(validateResult.ok, true);

    const resetResult = await postJson(`http://127.0.0.1:${port}/api/config/reset`, {
      confirm: true
    });
    assert.equal(resetResult.ok, true);

    const resetConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
    assert.equal(resetConfig.agents.defaults.model.primary, 'llama3.2:3b');

    const history = JSON.parse(await fs.readFile(auditLogPath, 'utf8'));
    assert.equal(history.entries.length, 2);
    const probeResults = JSON.parse(await fs.readFile(probeResultsPath, 'utf8'));
    assert.equal(probeResults.entries[0].model, 'qwen3:8b');
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => server.once('exit', resolve));
  }

  if (stderr.trim()) {
    process.stderr.write(stderr);
  }

  if (!stdout.includes('OpenClaw dashboard running')) {
    throw new Error('Regression server did not start correctly.');
  }
}

async function waitForServer(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`Unexpected status ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await delay(200);
  }

  throw lastError || new Error('Server did not become ready in time.');
}

async function getJson(url) {
  const response = await fetch(url);
  return response.json();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  return response.json();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
