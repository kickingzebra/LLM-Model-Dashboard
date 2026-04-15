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
  assert.equal(saved.entries[0].toolsOutcome, 'tool_calls_returned');
  assert.equal(saved.entries[0].timestamp, '20260414T170000');
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
