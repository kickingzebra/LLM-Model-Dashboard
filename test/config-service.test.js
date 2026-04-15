const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  createConfigService,
  validateConfigText,
  switchPrimaryModel,
  maskSecrets,
  listConfiguredModelIds,
  listToolCapableConfiguredModels
} = require('../src/config-service');

async function createTempConfigFixture() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-dashboard-'));
  const fixturePath = path.join(__dirname, 'fixtures', 'openclaw.valid.json');
  const configPath = path.join(tempDir, 'openclaw.json');
  await fs.copyFile(fixturePath, configPath);
  return { tempDir, configPath };
}

test('loads and parses config from disk', async () => {
  const { configPath } = await createTempConfigFixture();
  const service = createConfigService({ configPath });

  const result = await service.loadConfig();

  assert.equal(result.agents.defaults.model.primary, 'llama3.2:3b');
  assert.equal(result.models.providers.ollama.models['qwen3:8b'].compat.supportsTools, true);
});

test('switching the primary model updates primary routing without overwriting chat', () => {
  const fixture = require('./fixtures/openclaw.valid.json');

  const updated = switchPrimaryModel(structuredClone(fixture), {
    modelId: 'qwen3:8b'
  });

  assert.equal(updated.agents.defaults.model.primary, 'qwen3:8b');
  assert.equal(updated.agents.defaults.models.primary.model, 'qwen3:8b');
  assert.equal(updated.agents.defaults.models.chat.model, 'llama3.2:3b');
  assert.equal(updated.agents.defaults.routing.primaryModel, 'qwen3:8b');
  assert.equal(updated.agents.defaults.models.fallback.model, 'llama3.1:8b');
});

test('switching the primary model preserves JSON structure after edits', () => {
  const fixture = require('./fixtures/openclaw.valid.json');

  const updated = switchPrimaryModel(structuredClone(fixture), {
    modelId: 'qwen3:8b'
  });

  assert.deepEqual(Object.keys(updated).sort(), ['agents', 'gateway', 'integrations', 'models']);
  assert.deepEqual(Object.keys(updated.agents.defaults.models).sort(), ['chat', 'fallback', 'primary']);
  assert.equal(typeof updated.models.providers.ollama.models['qwen3:8b'].compat.supportsTools, 'boolean');
  assert.equal(updated.integrations.telegram.channelId, '-10012345');
});

test('can insert a missing model into the ollama catalog while switching', () => {
  const fixture = require('./fixtures/openclaw.valid.json');

  const updated = switchPrimaryModel(structuredClone(fixture), {
    modelId: 'gemma3:12b',
    addToCatalog: true,
    catalogEntry: {
      contextWindow: 32768,
      compat: {
        supportsTools: false
      },
      notes: 'chat-only'
    }
  });

  assert.equal(updated.agents.defaults.model.primary, 'gemma3:12b');
  assert.equal(updated.models.providers.ollama.models['gemma3:12b'].notes, 'chat-only');
});

test('array-based model catalogs return real model ids instead of numeric indexes', () => {
  const config = {
    models: {
      providers: {
        ollama: {
          models: [
            { name: 'llama3.2:3b', compat: { supportsTools: true } },
            { name: 'qwen3:8b', compat: { supportsTools: true } },
            { name: 'gemma3:12b', compat: { supportsTools: false } }
          ]
        }
      }
    }
  };

  assert.deepEqual(listConfiguredModelIds(config), ['llama3.2:3b', 'qwen3:8b', 'gemma3:12b']);
  assert.deepEqual(listToolCapableConfiguredModels(config), ['llama3.2:3b', 'qwen3:8b']);
});

test('switching the primary model works when the config catalog is an array', () => {
  const config = {
    agents: {
      defaults: {
        model: {
          provider: 'ollama',
          primary: 'llama3.2:3b'
        },
        models: {
          primary: {
            provider: 'ollama',
            model: 'llama3.2:3b'
          },
          chat: {
            provider: 'ollama',
            model: 'llama3.2:3b'
          }
        },
        routing: {
          provider: 'ollama',
          primaryModel: 'llama3.2:3b'
        }
      }
    },
    models: {
      providers: {
        ollama: {
          models: [
            { name: 'llama3.2:3b', compat: { supportsTools: true } },
            { name: 'qwen3:8b', compat: { supportsTools: true } }
          ]
        }
      }
    }
  };

  const updated = switchPrimaryModel(config, { modelId: 'qwen3:8b' });

  assert.equal(updated.agents.defaults.model.primary, 'qwen3:8b');
  assert.equal(updated.agents.defaults.models.primary.model, 'qwen3:8b');
  assert.equal(updated.agents.defaults.models.chat.model, 'llama3.2:3b');
  assert.equal(updated.agents.defaults.routing.primaryModel, 'qwen3:8b');
});

test('saving creates a backup before writing the updated config', async () => {
  const { configPath } = await createTempConfigFixture();
  const service = createConfigService({ configPath, now: () => '20260414T103000' });

  const result = await service.savePrimaryModel({
    modelId: 'qwen3:8b'
  });

  const files = await fs.readdir(path.dirname(configPath));
  const backupName = files.find((file) => file === 'openclaw.json.bak.20260414T103000');
  const written = JSON.parse(await fs.readFile(configPath, 'utf8'));

  assert.ok(backupName);
  assert.equal(result.validation.ok, true);
  assert.equal(result.backup.path.endsWith('openclaw.json.bak.20260414T103000'), true);
  assert.equal(written.agents.defaults.model.primary, 'qwen3:8b');
  assert.equal(written.agents.defaults.models.primary.model, 'qwen3:8b');
  assert.equal(written.agents.defaults.models.chat.model, 'llama3.2:3b');
  assert.equal(written.agents.defaults.routing.primaryModel, 'qwen3:8b');
  assert.equal(written.agents.defaults.models.fallback.model, 'llama3.1:8b');
});

test('resetting the config restores the seed copy and creates a backup first', async () => {
  const { configPath, tempDir } = await createTempConfigFixture();
  const seedPath = path.join(tempDir, 'openclaw.seed.json');
  const auditLogPath = path.join(tempDir, 'model-history.log.json');
  await fs.copyFile(path.join(__dirname, 'fixtures', 'openclaw.valid.json'), seedPath);

  const service = createConfigService({
    configPath,
    resetSourcePath: seedPath,
    auditLogPath,
    now: () => '20260414T120000'
  });

  await service.savePrimaryModel({ modelId: 'qwen3:8b' });
  const resetResult = await service.resetConfig();
  const written = JSON.parse(await fs.readFile(configPath, 'utf8'));

  assert.equal(resetResult.validation.ok, true);
  assert.equal(resetResult.restored, true);
  assert.equal(written.agents.defaults.model.primary, 'llama3.2:3b');
  assert.equal(written.agents.defaults.models.chat.model, 'llama3.2:3b');
  assert.equal(written.agents.defaults.models.fallback.model, 'llama3.1:8b');
});

test('saving and resetting append model audit entries to the history log', async () => {
  const { configPath, tempDir } = await createTempConfigFixture();
  const seedPath = path.join(tempDir, 'openclaw.seed.json');
  const auditLogPath = path.join(tempDir, 'model-history.log.json');
  await fs.copyFile(path.join(__dirname, 'fixtures', 'openclaw.valid.json'), seedPath);

  const service = createConfigService({
    configPath,
    resetSourcePath: seedPath,
    auditLogPath,
    now: () => '20260414T121500'
  });

  await service.savePrimaryModel({ modelId: 'qwen3:8b' });
  await service.resetConfig();

  const history = JSON.parse(await fs.readFile(auditLogPath, 'utf8'));

  assert.equal(history.entries.length, 2);
  assert.equal(history.entries[0].action, 'resetConfig');
  assert.equal(history.entries[0].previousPrimaryModel, 'qwen3:8b');
  assert.equal(history.entries[0].nextPrimaryModel, 'llama3.2:3b');
  assert.equal(history.entries[1].action, 'savePrimaryModel');
  assert.equal(history.entries[1].nextPrimaryModel, 'qwen3:8b');
});

test('invalid JSON is rejected before any write', async () => {
  const { configPath } = await createTempConfigFixture();
  const service = createConfigService({ configPath, now: () => '20260414T103000' });
  const original = await fs.readFile(configPath, 'utf8');

  await assert.rejects(
    service.writeRawConfig('{"agents": invalid }'),
    /Invalid JSON/
  );

  assert.equal(await fs.readFile(configPath, 'utf8'), original);
  const files = await fs.readdir(path.dirname(configPath));
  assert.equal(files.some((file) => file.includes('.bak.')), false);
});

test('validateConfigText reports valid JSON without mutating it', () => {
  const text = '{"hello":"world"}';

  assert.deepEqual(validateConfigText(text), {
    ok: true,
    formatted: '{\n  "hello": "world"\n}'
  });
});

test('maskSecrets hides auth and telegram tokens in UI payloads', () => {
  const fixture = require('./fixtures/openclaw.valid.json');

  const masked = maskSecrets(fixture);

  assert.equal(masked.gateway.authToken.includes('super-secret'), false);
  assert.equal(masked.integrations.telegram.botToken.includes('telegram-secret'), false);
});
