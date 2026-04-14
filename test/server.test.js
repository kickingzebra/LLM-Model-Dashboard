const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../src/app');

async function withApp(options = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-dashboard-server-'));
  const fixturePath = path.join(__dirname, 'fixtures', 'openclaw.valid.json');
  const configPath = path.join(tempDir, 'openclaw.json');
  const resetSourcePath = path.join(tempDir, 'openclaw.seed.json');
  const auditLogPath = path.join(tempDir, 'model-history.log.json');
  const probeResultsPath = path.join(tempDir, 'model-probe-results.json');
  await fs.copyFile(fixturePath, configPath);
  await fs.copyFile(fixturePath, resetSourcePath);

  const app = createApp({
    configPath,
    resetSourcePath,
    auditLogPath,
    probeResultsPath,
    now: () => '20260414T111500',
    ...options
  });

  return { app, configPath, resetSourcePath, auditLogPath, probeResultsPath };
}

test('dashboard state endpoint masks secrets and returns model details', async () => {
  const { app } = await withApp({
    modelProbeScriptPath: '/tmp/fake-probe.sh',
    fetchImpl: async () =>
      new Response(JSON.stringify({ models: [{ name: 'qwen3:8b' }, { name: 'llama3.2:3b' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      }),
    runCommand: async (command, args) => {
      if (command === '/bin/bash') {
        return {
          code: 0,
          stdout: '',
          stderr: ''
        };
      }
      return { code: 0, stdout: '', stderr: '' };
    }
  });

  const response = await app.inject({ url: '/api/state' });
  const payload = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(payload.config.gateway.authToken.includes('super-secret-auth-token'), false);
  assert.deepEqual(payload.installedModels, ['qwen3:8b', 'llama3.2:3b']);
  assert.deepEqual(payload.history, []);
  assert.deepEqual(payload.probeResults, []);
});

test('saving a model switch updates config and returns success feedback', async () => {
  const { app, configPath } = await withApp({
    modelProbeScriptPath: '/tmp/fake-probe.sh',
    runCommand: async (command, args) => {
      if (command === '/bin/bash') {
        return {
          code: 0,
          stdout: `-----
MODEL=qwen3:8b
CHAT_HTTP=200
CHAT_OK=yes
CHAT_SUMMARY=CHAT_OK
TOOLS_HTTP=200
TOOLS_OUTCOME=tool_calls_returned
TOOLS_SUMMARY=add_numbers {"a":2,"b":2}`,
          stderr: ''
        };
      }

      return { code: 0, stdout: '', stderr: '' };
    }
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/config/primary-model',
    headers: { 'content-type': 'application/json' },
    body: { modelId: 'qwen3:8b' }
  });
  const payload = response.json();
  const saved = JSON.parse(await fs.readFile(configPath, 'utf8'));

  assert.equal(response.statusCode, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.validation.ok, true);
  assert.match(payload.message, /validation passed/i);
  assert.match(payload.backup.path, /openclaw\.json\.bak\.20260414T111500$/);
  assert.equal(payload.probe.ok, true);
  assert.equal(payload.probe.entries[0].toolsOutcome, 'tool_calls_returned');
  assert.equal(saved.agents.defaults.model.primary, 'qwen3:8b');
});

test('saving a model switch exposes the latest backup path in dashboard state', async () => {
  const { app } = await withApp({
    modelProbeScriptPath: '/tmp/fake-probe.sh',
    runCommand: async (command) => {
      if (command === '/bin/bash') {
        return {
          code: 0,
          stdout: `-----
MODEL=qwen3:8b
CHAT_HTTP=200
CHAT_OK=yes
CHAT_SUMMARY=CHAT_OK
TOOLS_HTTP=200
TOOLS_OUTCOME=tool_calls_returned
TOOLS_SUMMARY=add_numbers {"a":2,"b":2}`,
          stderr: ''
        };
      }

      return { code: 0, stdout: '', stderr: '' };
    }
  });

  await app.inject({
    method: 'POST',
    url: '/api/config/primary-model',
    headers: { 'content-type': 'application/json' },
    body: { modelId: 'qwen3:8b' }
  });

  const response = await app.inject({ url: '/api/state' });
  const payload = response.json();

  assert.equal(response.statusCode, 200);
  assert.match(payload.history[0].backupPath, /openclaw\.json\.bak\.20260414T111500$/);
  assert.equal(payload.probeResults[0].model, 'qwen3:8b');
});

test('restart is not triggered accidentally on page load', async () => {
  const calls = [];
  const { app } = await withApp({
    runCommand: async (command, args) => {
      calls.push([command, args]);
      return { code: 0, stdout: '', stderr: '' };
    }
  });

  const response = await app.inject({ url: '/' });
  const html = response.body;

  assert.equal(response.statusCode, 200);
  assert.match(html, /Restart Gateway/);
  assert.match(html, /Latest Backup/);
  assert.deepEqual(calls, []);
});

test('reset endpoint restores the sandbox config to the seed state', async () => {
  const { app, configPath } = await withApp();

  await app.inject({
    method: 'POST',
    url: '/api/config/primary-model',
    headers: { 'content-type': 'application/json' },
    body: { modelId: 'qwen3:8b' }
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/config/reset',
    headers: { 'content-type': 'application/json' },
    body: { confirm: true }
  });
  const payload = response.json();
  const saved = JSON.parse(await fs.readFile(configPath, 'utf8'));

  assert.equal(response.statusCode, 200);
  assert.equal(payload.ok, true);
  assert.match(payload.message, /sandbox config restored/i);
  assert.equal(saved.agents.defaults.model.primary, 'llama3.2:3b');
});

test('dashboard state returns recent model history entries', async () => {
  const { app } = await withApp();

  await app.inject({
    method: 'POST',
    url: '/api/config/primary-model',
    headers: { 'content-type': 'application/json' },
    body: { modelId: 'qwen3:8b' }
  });

  const response = await app.inject({ url: '/api/state' });
  const payload = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(payload.history.length, 1);
  assert.equal(payload.history[0].action, 'savePrimaryModel');
  assert.equal(payload.history[0].nextPrimaryModel, 'qwen3:8b');
});
