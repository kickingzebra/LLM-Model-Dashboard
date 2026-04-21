const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  createSystemService,
  parseModelProbeOutput
} = require('../src/system-service');

test('health checks return clear success states', async () => {
  const service = createSystemService({
    fetchImpl: async (url) => {
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ models: [{ name: 'qwen3:8b' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  const result = await service.checkHealth();

  assert.equal(result.ok, true);
  assert.deepEqual(result.failedChecks, []);
  assert.equal(result.openclaw.ok, true);
  assert.equal(result.ollama.ok, true);
  assert.deepEqual(result.ollama.models, ['qwen3:8b']);
});

test('health checks return clear failure states', async () => {
  const service = createSystemService({
    fetchImpl: async (url) => {
      if (url.endsWith('/health')) {
        throw new Error('gateway down');
      }

      return new Response('bad gateway', { status: 502 });
    }
  });

  const result = await service.checkHealth();

  assert.equal(result.ok, false);
  assert.deepEqual(result.failedChecks, [
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
  assert.equal(result.openclaw.ok, false);
  assert.match(result.openclaw.message, /gateway down/);
  assert.equal(result.ollama.ok, false);
});

test('restart behavior is explicit and uses the expected command', async () => {
  const calls = [];
  const service = createSystemService({
    runCommand: async (command, args) => {
      calls.push([command, args]);
      return { code: 0, stdout: '', stderr: '' };
    }
  });

  const result = await service.restartGateway();

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [['systemctl', ['--user', 'restart', 'openclaw-gateway']]]);
});

test('parseModelProbeOutput extracts documented Ollama probe fields', () => {
  const parsed = parseModelProbeOutput(`-----
MODEL=qwen3:8b
CHAT_HTTP=200
CHAT_OK=yes
CHAT_SUMMARY=CHAT_OK
TOOLS_HTTP=200
TOOLS_OUTCOME=tool_calls_returned
TOOLS_SUMMARY=add_numbers {'a': 2, 'b': 2}`);

  assert.deepEqual(parsed[0], {
    model: 'qwen3:8b',
    chatHttp: '200',
    chatOk: 'yes',
    chatSummary: 'CHAT_OK',
    toolsHttp: '200',
    toolsOutcome: 'tool_calls_returned',
    toolsSummary: "add_numbers {'a': 2, 'b': 2}"
  });
});

test('runModelProbe persists the latest direct Ollama capability result', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-probe-'));
  const probeResultsPath = path.join(tempDir, 'probe-results.json');
  const service = createSystemService({
    modelProbeScriptPath: '/tmp/fake-probe.sh',
    probeResultsPath,
    now: () => '20260414T170000',
    runCommand: async (command, args) => {
      assert.equal(command, '/bin/bash');
      assert.deepEqual(args, ['/tmp/fake-probe.sh', 'qwen3:8b']);
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
  });

  const result = await service.runModelProbe('qwen3:8b');
  const saved = JSON.parse(await fs.readFile(probeResultsPath, 'utf8'));

  assert.equal(result.ok, true);
  assert.equal(result.entries[0].model, 'qwen3:8b');
  assert.equal(result.entries[0].timestampIso, '2026-04-14T17:00:00Z');
  assert.equal(saved.entries[0].toolsOutcome, 'tool_calls_returned');
  assert.equal(saved.entries[0].timestamp, '20260414T170000');
  assert.equal(saved.entries[0].timestampIso, '2026-04-14T17:00:00Z');
});

test('runModelProbeBatch probes each requested model once', async () => {
  const calls = [];
  const service = createSystemService({
    modelProbeScriptPath: '/tmp/fake-probe.sh',
    now: () => '20260414T171000',
    runCommand: async (command, args) => {
      calls.push([command, args]);
      const modelId = args[1];
      return {
        code: 0,
        stdout: `-----
MODEL=${modelId}
CHAT_HTTP=200
CHAT_OK=yes
CHAT_SUMMARY=CHAT_OK
TOOLS_HTTP=200
TOOLS_OUTCOME=tool_calls_returned
TOOLS_SUMMARY=add_numbers {"a":2,"b":2}`,
        stderr: ''
      };
    }
  });

  const result = await service.runModelProbeBatch(['qwen3:8b', 'llama3.1:8b', 'qwen3:8b']);

  assert.equal(result.ok, true);
  assert.equal(result.entries.length, 2);
  assert.deepEqual(calls, [
    ['/bin/bash', ['/tmp/fake-probe.sh', 'qwen3:8b']],
    ['/bin/bash', ['/tmp/fake-probe.sh', 'llama3.1:8b']]
  ]);
});

test('getMemoryUsage reports running models and system memory', async () => {
  const service = createSystemService({
    fetchImpl: async (url) => {
      if (url.endsWith('/api/ps')) {
        return new Response(JSON.stringify({
          models: [
            { name: 'qwen3:8b', size: 5368709120, size_vram: 5368709120, expires_at: '2026-04-16T12:00:00Z' },
            { name: 'llama3.2:3b', size: 2147483648, size_vram: 2147483648, expires_at: '2026-04-16T12:05:00Z' }
          ]
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ models: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    },
    runCommand: async () => ({
      code: 0,
      stdout: '16384000 8192000',
      stderr: ''
    })
  });

  const result = await service.getMemoryUsage();

  assert.equal(result.ok, true);
  assert.equal(result.runningModels.length, 2);
  assert.equal(result.runningModels[0].name, 'qwen3:8b');
  assert.equal(result.runningModels[0].size, 5368709120);
  assert.match(result.runningModels[0].sizeFormatted, /5\.0 GB/);
  assert.equal(result.runningModels[1].name, 'llama3.2:3b');
  assert.equal(result.totalModelMemory, 5368709120 + 2147483648);
  assert.equal(result.system.ok, true);
  assert.equal(result.system.usagePercent, 50);
  assert.match(result.system.totalFormatted, /GB/);
});

test('getMemoryUsage handles no running models gracefully', async () => {
  const service = createSystemService({
    fetchImpl: async (url) => {
      if (url.endsWith('/api/ps')) {
        return new Response(JSON.stringify({ models: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ models: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    },
    runCommand: async () => ({
      code: 1,
      stdout: '',
      stderr: 'error'
    })
  });

  const result = await service.getMemoryUsage();

  assert.equal(result.ok, true);
  assert.equal(result.runningModels.length, 0);
  assert.equal(result.totalModelMemory, 0);
  assert.equal(result.system.ok, false);
});

test('getTestStatus normalizes legacy and ISO timestamps for display', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-test-status-'));
  const testReportPath = path.join(tempDir, 'test-report.json');
  await fs.writeFile(
    testReportPath,
    `${JSON.stringify({
      lastRunAt: '20260414T173000Z',
      overallStatus: 'passed',
      suiteCount: 2,
      passedCount: 2,
      failedCount: 0,
      suites: [
        { name: 'Unit', status: 'passed' },
        { name: 'Smoke', status: 'passed' }
      ]
    }, null, 2)}\n`,
    'utf8'
  );

  const service = createSystemService({ testReportPath });
  const result = await service.getTestStatus();

  assert.equal(result.lastRunAt, '20260414T173000Z');
  assert.equal(result.lastRunAtIso, '2026-04-14T17:30:00Z');
  assert.equal(result.overallStatus, 'passed');
});
