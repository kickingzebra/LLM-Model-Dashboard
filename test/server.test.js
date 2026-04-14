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
  await fs.copyFile(fixturePath, configPath);

  const app = createApp({
    configPath,
    now: () => '20260414T111500',
    ...options
  });

  return { app, configPath };
}

test('dashboard state endpoint masks secrets and returns model details', async () => {
  const { app } = await withApp({
    fetchImpl: async () =>
      new Response(JSON.stringify({ models: [{ name: 'qwen3:8b' }, { name: 'llama3.2:3b' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
  });

  const response = await app.inject({ url: '/api/state' });
  const payload = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(payload.config.gateway.authToken.includes('super-secret-auth-token'), false);
  assert.deepEqual(payload.installedModels, ['qwen3:8b', 'llama3.2:3b']);
});

test('saving a model switch updates config and returns success feedback', async () => {
  const { app, configPath } = await withApp();

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
  assert.equal(saved.agents.defaults.model.primary, 'qwen3:8b');
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
  assert.deepEqual(calls, []);
});
