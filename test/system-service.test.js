const test = require('node:test');
const assert = require('node:assert/strict');

const { createSystemService } = require('../src/system-service');

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
