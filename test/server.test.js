const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../src/app');

async function withApp(options = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-dashboard-server-'));
  const fixturePath = path.join(__dirname, 'fixtures', 'openclaw.valid.json');
  const sandboxConfigFilename = options.configFilename || 'openclaw.sandbox.json';
  const sandboxResetFilename = options.resetFilename || 'openclaw.sandbox.seed.json';
  const sandboxConfigPath = path.join(tempDir, sandboxConfigFilename);
  const sandboxResetSourcePath = path.join(tempDir, sandboxResetFilename);
  const liveConfigPath = path.join(tempDir, 'openclaw.json');
  const liveResetSourcePath = path.join(tempDir, 'openclaw.seed.json');
  const auditLogPath = path.join(tempDir, 'model-history.log.json');
  const probeResultsPath = path.join(tempDir, 'model-probe-results.json');
  const modelLiveLogPath = path.join(tempDir, 'OPENCLAW_MODEL_LIVE_LOG.md');
  const testReportPath = path.join(tempDir, 'test-report.json');
  const liveConfig = options.liveConfig || options.initialConfig || null;
  const configPath = options.startInLiveMode ? liveConfigPath : sandboxConfigPath;
  const resetSourcePath = options.startInLiveMode ? liveResetSourcePath : sandboxResetSourcePath;
  if (options.initialConfig) {
    await fs.writeFile(sandboxConfigPath, `${JSON.stringify(options.initialConfig, null, 2)}\n`, 'utf8');
    await fs.writeFile(sandboxResetSourcePath, `${JSON.stringify(options.initialConfig, null, 2)}\n`, 'utf8');
  } else {
    await fs.copyFile(fixturePath, sandboxConfigPath);
    await fs.copyFile(fixturePath, sandboxResetSourcePath);
  }
  if (liveConfig) {
    await fs.writeFile(liveConfigPath, `${JSON.stringify(liveConfig, null, 2)}\n`, 'utf8');
    await fs.writeFile(liveResetSourcePath, `${JSON.stringify(liveConfig, null, 2)}\n`, 'utf8');
  } else {
    await fs.copyFile(fixturePath, liveConfigPath);
    await fs.copyFile(fixturePath, liveResetSourcePath);
  }
  if (typeof options.modelLiveLogContent === 'string') {
    await fs.writeFile(modelLiveLogPath, options.modelLiveLogContent, 'utf8');
  }

  const app = createApp({
    configPath,
    resetSourcePath,
    sandboxConfigPath,
    sandboxResetSourcePath,
    liveConfigPath,
    liveResetSourcePath,
    auditLogPath,
    probeResultsPath,
    modelLiveLogPath,
    testReportPath,
    now: () => '20260414T111500',
    ...options
  });

  return {
    app,
    configPath,
    resetSourcePath,
    sandboxConfigPath,
    sandboxResetSourcePath,
    liveConfigPath,
    liveResetSourcePath,
    auditLogPath,
    probeResultsPath,
    modelLiveLogPath,
    testReportPath
  };
}

test('dashboard state endpoint masks secrets and returns model details', async () => {
  const { app } = await withApp({
    modelLiveLogContent: '# Live Log\n\n- initial entry\n',
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
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(payload.config.gateway.authToken.includes('super-secret-auth-token'), false);
  assert.deepEqual(payload.installedModels, ['qwen3:8b', 'llama3.2:3b']);
  assert.deepEqual(payload.summary.toolCapableConfiguredModels, ['llama3.2:3b', 'qwen3:8b', 'llama3.1:8b']);
  assert.equal(payload.summary.currentMode, 'sandbox');
  assert.deepEqual(payload.history, []);
  assert.deepEqual(payload.probeResults, []);
  assert.equal(payload.modelLiveLog.available, true);
  assert.match(payload.modelLiveLog.path, /OPENCLAW_MODEL_LIVE_LOG\.md$/);
  assert.match(payload.modelLiveLog.content, /initial entry/);
  assert.equal(payload.testStatus.lastRunAt, null);
});

test('dashboard page is served with no-store cache headers', async () => {
  const { app } = await withApp();

  const response = await app.inject({ url: '/' });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.match(response.body, /Mode Control/);
});

test('mode switch endpoint swaps between sandbox and live config views', async () => {
  const liveConfig = JSON.parse(await fs.readFile(path.join(__dirname, 'fixtures', 'openclaw.valid.json'), 'utf8'));
  liveConfig.agents.defaults.model = 'ollama/qwen3:8b';
  liveConfig.agents.defaults.models.primary = 'ollama/qwen3:8b';
  delete liveConfig.agents.defaults.routing;

  const { app } = await withApp({ liveConfig });

  const switchResponse = await app.inject({
    method: 'POST',
    url: '/api/mode',
    headers: { 'content-type': 'application/json' },
    body: { mode: 'live', confirm: true }
  });
  const switchPayload = switchResponse.json();
  const stateResponse = await app.inject({ url: '/api/state' });
  const statePayload = stateResponse.json();

  assert.equal(switchResponse.statusCode, 200);
  assert.equal(switchPayload.ok, true);
  assert.equal(statePayload.summary.currentMode, 'live');
  assert.equal(statePayload.summary.primaryModel, 'qwen3:8b');
  assert.equal(statePayload.summary.writeMode, 'live-read-only');
});

test('switching to live mode requires confirmation', async () => {
  const { app } = await withApp();

  const response = await app.inject({
    method: 'POST',
    url: '/api/mode',
    headers: { 'content-type': 'application/json' },
    body: { mode: 'live' }
  });
  const payload = response.json();

  assert.equal(response.statusCode, 400);
  assert.equal(payload.ok, false);
  assert.match(payload.message, /confirmation is required/i);
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
  assert.match(payload.backup.path, /openclaw\.sandbox\.json\.bak\.20260414T111500$/);
  assert.equal(payload.probe.ok, true);
  assert.equal(payload.probe.entries[0].toolsOutcome, 'tool_calls_returned');
  assert.equal(saved.agents.defaults.model.primary, 'qwen3:8b');
});

test('saving a model switch is blocked for the live config path unless explicitly enabled', async () => {
  const { app, configPath } = await withApp({ startInLiveMode: true });
  const original = await fs.readFile(configPath, 'utf8');

  const response = await app.inject({
    method: 'POST',
    url: '/api/config/primary-model',
    headers: { 'content-type': 'application/json' },
    body: { modelId: 'qwen3:8b' }
  });
  const payload = response.json();
  const current = await fs.readFile(configPath, 'utf8');

  assert.equal(response.statusCode, 403);
  assert.equal(payload.ok, false);
  assert.match(payload.message, /live config writes are disabled/i);
  assert.equal(current, original);
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
  assert.match(payload.history[0].backupPath, /openclaw\.sandbox\.json\.bak\.20260414T111500$/);
  assert.equal(payload.probeResults[0].model, 'qwen3:8b');
});

test('restart is not triggered accidentally on page load', async () => {
  const calls = [];
  const { app } = await withApp({
    modelLiveLogContent: '# Live Log\n\n## llama3.2:3b\n',
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
  assert.match(html, /Live Model Log/);
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
  assert.match(payload.message, /active config restored/i);
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

test('dashboard state uses real model names for array-based catalogs', async () => {
  const initialConfig = {
    gateway: {
      host: '127.0.0.1',
      port: 18789,
      authToken: 'super-secret-auth-token'
    },
    agents: {
      defaults: {
        model: {
          provider: 'ollama',
          primary: 'nemotron-mini:4b'
        },
        models: {
          primary: {
            provider: 'ollama',
            model: 'nemotron-mini:4b'
          },
          chat: {
            provider: 'ollama',
            model: 'llama3.2:3b'
          }
        },
        routing: {
          provider: 'ollama',
          primaryModel: 'nemotron-mini:4b'
        },
        toolProfile: 'minimal'
      }
    },
    models: {
      providers: {
        ollama: {
          models: [
            { name: 'llama3.2:3b', compat: { supportsTools: true } },
            { name: 'qwen3:8b', compat: { supportsTools: true } },
            { name: 'nemotron-mini:4b', compat: { supportsTools: false } }
          ]
        }
      }
    },
    integrations: {
      telegram: {
        enabled: true,
        botToken: '123456:telegram-secret',
        channelId: '-10012345'
      }
    }
  };

  const { app } = await withApp({ initialConfig });
  const response = await app.inject({ url: '/api/state' });
  const payload = response.json();

  assert.equal(response.statusCode, 200);
  assert.deepEqual(payload.summary.availableConfiguredModels, [
    'llama3.2:3b',
    'qwen3:8b',
    'nemotron-mini:4b'
  ]);
  assert.deepEqual(payload.summary.toolCapableConfiguredModels, [
    'llama3.2:3b',
    'qwen3:8b'
  ]);
});

test('health endpoint reports which checks failed', async () => {
  const { app } = await withApp({
    fetchImpl: async (url) => {
      if (url.endsWith('/health')) {
        throw new Error('gateway down');
      }

      return new Response('bad gateway', { status: 502 });
    }
  });

  const response = await app.inject({ url: '/api/health' });
  const payload = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(payload.ok, false);
  assert.deepEqual(payload.failedChecks, [
    {
      id: 'openclaw',
      label: 'OpenClaw gateway',
      status: 0,
      message: 'OpenClaw gateway check failed: gateway down'
    },
    {
      id: 'ollama',
      label: 'Ollama API',
      status: 502,
      message: 'Ollama API returned HTTP 502'
    }
  ]);
});

test('batch probe endpoint runs the documented capability check for multiple models', async () => {
  const calls = [];
  const { app } = await withApp({
    modelProbeScriptPath: '/tmp/fake-probe.sh',
    runCommand: async (command, args) => {
      if (command === '/bin/bash') {
        calls.push(args[1]);
        return {
          code: 0,
          stdout: `-----
MODEL=${args[1]}
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
    url: '/api/probe/models',
    headers: { 'content-type': 'application/json' },
    body: { modelIds: ['qwen3:8b', 'llama3.1:8b'] }
  });
  const payload = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.entries.length, 2);
  assert.deepEqual(calls, ['qwen3:8b', 'llama3.1:8b']);
});

test('dashboard state returns the latest regression test summary when present', async () => {
  const { app, testReportPath } = await withApp();
  await fs.writeFile(
    testReportPath,
    `${JSON.stringify({
      lastRunAt: '2026-04-14T17:30:00Z',
      overallStatus: 'passed',
      suiteCount: 2,
      passedCount: 21,
      failedCount: 0,
      suites: [
        { name: 'Unit', status: 'passed' },
        { name: 'Smoke', status: 'passed' }
      ]
    }, null, 2)}\n`,
    'utf8'
  );

  const response = await app.inject({ url: '/api/state' });
  const payload = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(payload.testStatus.overallStatus, 'passed');
  assert.equal(payload.testStatus.passedCount, 21);
  assert.equal(payload.testStatus.lastRunAtIso, '2026-04-14T17:30:00Z');
  assert.equal(payload.testStatus.suites[1].name, 'Smoke');
});

test('dashboard page includes a TDD test status section', async () => {
  const { app } = await withApp();

  const response = await app.inject({ url: '/' });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /TDD Test Status/);
  assert.match(response.body, /Documented Test Matrix/);
  assert.match(response.body, /Probe Tool-Capable Candidates/);
  assert.match(response.body, /formatAuditTimestamp\(entry\.timestampIso \|\| entry\.timestamp\)/);
  assert.match(response.body, /formatAuditTimestamp\(testStatus\.lastRunAtIso \|\| testStatus\.lastRunAt\)/);
});

test('dashboard state includes model context windows and primary context window', async () => {
  const { app } = await withApp({
    fetchImpl: async (url) => {
      if (url.endsWith('/api/ps')) {
        return new Response(JSON.stringify({ models: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ models: [{ name: 'llama3.2:3b' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    },
    runCommand: async () => ({ code: 1, stdout: '', stderr: '' })
  });

  const response = await app.inject({ url: '/api/state' });
  const payload = response.json();

  assert.equal(response.statusCode, 200);
  assert.deepEqual(payload.summary.modelContextWindows, {
    'llama3.2:3b': 8192,
    'qwen3:8b': 32768,
    'llama3.1:8b': 32768
  });
  assert.equal(payload.summary.primaryContextWindow, 8192);
});

test('dashboard state includes memory usage with running models', async () => {
  const { app } = await withApp({
    fetchImpl: async (url) => {
      if (url.endsWith('/api/ps')) {
        return new Response(JSON.stringify({
          models: [
            { name: 'llama3.2:3b', size: 2147483648, size_vram: 2147483648 }
          ]
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ models: [{ name: 'llama3.2:3b' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    },
    runCommand: async () => ({
      code: 0,
      stdout: '32768000 16384000',
      stderr: ''
    })
  });

  const response = await app.inject({ url: '/api/state' });
  const payload = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(payload.memory.ok, true);
  assert.equal(payload.memory.runningModels.length, 1);
  assert.equal(payload.memory.runningModels[0].name, 'llama3.2:3b');
  assert.equal(payload.memory.runningModels[0].size, 2147483648);
  assert.equal(payload.memory.system.ok, true);
  assert.equal(payload.memory.system.usagePercent, 50);
});

test('dashboard page includes memory usage and context window UI elements', async () => {
  const { app } = await withApp();

  const response = await app.inject({ url: '/' });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /RAM Memory Usage/);
  assert.match(response.body, /Context Window/);
  assert.match(response.body, /running-models-list/);
  assert.match(response.body, /memory-bar-fill/);
  assert.match(response.body, /primary-context/);
  assert.match(response.body, /renderMemory/);
});

// --- /api/restart endpoint ---

test('restart endpoint rejects when confirm is not provided', async () => {
  const { app } = await withApp();

  const response = await app.inject({
    method: 'POST',
    url: '/api/restart',
    headers: { 'content-type': 'application/json' },
    body: {}
  });
  const payload = response.json();

  assert.equal(response.statusCode, 400);
  assert.equal(payload.ok, false);
  assert.match(payload.message, /restart confirmation is required/i);
});

test('restart endpoint succeeds when confirmed with a mock systemctl', async () => {
  const calls = [];
  const { app } = await withApp({
    runCommand: async (command, args) => {
      calls.push([command, args]);
      return { code: 0, stdout: '', stderr: '' };
    }
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/restart',
    headers: { 'content-type': 'application/json' },
    body: { confirm: true }
  });
  const payload = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(payload.ok, true);
  assert.match(payload.message, /restarted/i);
  assert.deepEqual(calls, [['systemctl', ['--user', 'restart', 'openclaw-gateway']]]);
});

// --- /api/config/validate endpoint ---

test('validate endpoint accepts valid JSON and returns ok', async () => {
  const { app } = await withApp();

  const response = await app.inject({
    method: 'POST',
    url: '/api/config/validate',
    headers: { 'content-type': 'application/json' },
    body: { text: '{"agents":{}}' }
  });
  const payload = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(payload.ok, true);
});

test('validate endpoint rejects invalid JSON with an error message', async () => {
  const { app } = await withApp();

  const response = await app.inject({
    method: 'POST',
    url: '/api/config/validate',
    headers: { 'content-type': 'application/json' },
    body: { text: '{broken json' }
  });
  const payload = response.json();

  assert.equal(response.statusCode, 400);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /Invalid JSON/i);
});

// --- /api/probe/models with empty array ---

test('batch probe endpoint rejects an empty model list', async () => {
  const { app } = await withApp();

  const response = await app.inject({
    method: 'POST',
    url: '/api/probe/models',
    headers: { 'content-type': 'application/json' },
    body: { modelIds: [] }
  });
  const payload = response.json();

  assert.equal(response.statusCode, 400);
  assert.equal(payload.ok, false);
  assert.match(payload.message, /at least one model/i);
});

// --- Live writes enabled path ---

test('saving a model switch succeeds on the live config path when live writes are enabled', async () => {
  const { app, liveConfigPath } = await withApp({
    startInLiveMode: true,
    allowLiveWrites: true,
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

  const response = await app.inject({
    method: 'POST',
    url: '/api/config/primary-model',
    headers: { 'content-type': 'application/json' },
    body: { modelId: 'qwen3:8b' }
  });
  const payload = response.json();
  const saved = JSON.parse(await fs.readFile(liveConfigPath, 'utf8'));

  assert.equal(response.statusCode, 200);
  assert.equal(payload.ok, true);
  assert.equal(saved.agents.defaults.model.primary, 'qwen3:8b');
});

// --- /api/health success case ---

test('health endpoint reports success when both services are healthy', async () => {
  const { app } = await withApp({
    fetchImpl: async (url) => {
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ models: [{ name: 'llama3.2:3b' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  const response = await app.inject({ url: '/api/health' });
  const payload = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.failedChecks, []);
  assert.equal(payload.openclaw.ok, true);
  assert.equal(payload.ollama.ok, true);
});

// --- Mode switch edge cases ---

test('switching to live mode is rejected when no live config path is configured', async () => {
  const { createApp } = require('../src/app');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-dashboard-nolive-'));
  const fixturePath = path.join(__dirname, 'fixtures', 'openclaw.valid.json');
  const configPath = path.join(tempDir, 'openclaw.sandbox.json');
  await fs.copyFile(fixturePath, configPath);

  const appNoLive = createApp({
    configPath,
    resetSourcePath: configPath,
    sandboxConfigPath: configPath,
    sandboxResetSourcePath: configPath,
    liveConfigPath: null,
    liveResetSourcePath: null,
    auditLogPath: path.join(tempDir, 'history.json'),
    now: () => '20260416T120000'
  });

  const response = await appNoLive.inject({
    method: 'POST',
    url: '/api/mode',
    headers: { 'content-type': 'application/json' },
    body: { mode: 'live', confirm: true }
  });
  const payload = response.json();

  assert.equal(response.statusCode, 400);
  assert.equal(payload.ok, false);
  assert.match(payload.message, /not configured/i);
});

test('switching to an invalid mode returns 400', async () => {
  const { app } = await withApp();

  const response = await app.inject({
    method: 'POST',
    url: '/api/mode',
    headers: { 'content-type': 'application/json' },
    body: { mode: 'invalid' }
  });
  const payload = response.json();

  assert.equal(response.statusCode, 400);
  assert.equal(payload.ok, false);
  assert.match(payload.message, /must be either/i);
});

// --- Internal error handler (500) ---

test('internal errors are caught and returned as 500 with a message', async () => {
  const { app, configPath } = await withApp();

  // Corrupt the config file so loadConfig throws
  await fs.writeFile(configPath, 'NOT VALID JSON', 'utf8');

  const response = await app.inject({ url: '/api/state' });
  const payload = response.json();

  assert.equal(response.statusCode, 500);
  assert.equal(payload.ok, false);
  assert.ok(payload.message.length > 0);
});

// --- 404 handler ---

test('unknown routes return 404', async () => {
  const { app } = await withApp();

  const response = await app.inject({ url: '/api/nonexistent' });
  const payload = response.json();

  assert.equal(response.statusCode, 404);
  assert.equal(payload.ok, false);
  assert.match(payload.message, /not found/i);
});

// Regression: end-to-end promotion of an Ollama model must produce a
// schema-compliant entry on disk (no `notes`, required fields present).
test('promoting a new model via /api/config/primary-model writes a schema-valid catalog entry', async () => {
  const { app, configPath } = await withApp();

  const response = await app.inject({
    method: 'POST',
    url: '/api/config/primary-model',
    headers: { 'content-type': 'application/json' },
    body: {
      modelId: 'qwen3.5:27b',
      addToCatalog: true,
      catalogEntry: {
        notes: 'Promoted from installed Ollama model',
        compat: { supportsTools: false }
      }
    }
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json();
  assert.equal(payload.ok, true);

  const saved = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const catalog = saved.models.providers.ollama.models;
  const entries = Array.isArray(catalog) ? catalog : Object.values(catalog);
  const entry = entries.find((e) => (e.id || e.name) === 'qwen3.5:27b');

  assert.ok(entry, 'promoted entry must be written to disk');
  assert.equal(entry.id, 'qwen3.5:27b');
  assert.equal(entry.name, 'qwen3.5:27b');
  assert.equal(entry.reasoning, false);
  assert.deepEqual(entry.input, ['text']);
  assert.ok(entry.cost && typeof entry.cost === 'object');
  assert.ok(typeof entry.contextWindow === 'number' && entry.contextWindow > 0);
  assert.ok(typeof entry.maxTokens === 'number' && entry.maxTokens > 0);
  assert.ok(
    !Object.prototype.hasOwnProperty.call(entry, 'notes'),
    'promoted entry must not include the non-schema `notes` field'
  );
});

