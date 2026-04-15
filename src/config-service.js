const fs = require('node:fs/promises');
const path = require('node:path');

function getOllamaCatalog(config) {
  const catalog = config?.models?.providers?.ollama?.models;
  if (!catalog || typeof catalog !== 'object') {
    throw new Error('OpenClaw config is missing models.providers.ollama.models');
  }

  return catalog;
}

function getCatalogModelId(entry) {
  if (typeof entry === 'string') {
    return entry;
  }

  if (!entry || typeof entry !== 'object') {
    return null;
  }

  return entry.id || entry.name || entry.model || null;
}

function listConfiguredModelIds(config) {
  const catalog = getOllamaCatalog(config);

  if (Array.isArray(catalog)) {
    return catalog
      .map(getCatalogModelId)
      .filter(Boolean);
  }

  return Object.keys(catalog);
}

function getCatalogEntry(config, modelId) {
  const catalog = getOllamaCatalog(config);

  if (Array.isArray(catalog)) {
    return catalog.find((entry) => getCatalogModelId(entry) === modelId) || null;
  }

  return catalog[modelId] || null;
}

function upsertCatalogEntry(config, modelId, catalogEntry) {
  const catalog = getOllamaCatalog(config);

  if (Array.isArray(catalog)) {
    const existingIndex = catalog.findIndex((entry) => getCatalogModelId(entry) === modelId);
    const normalizedEntry =
      catalogEntry && typeof catalogEntry === 'object'
        ? { name: modelId, ...catalogEntry }
        : { name: modelId };

    if (existingIndex === -1) {
      catalog.push(normalizedEntry);
      return normalizedEntry;
    }

    catalog[existingIndex] = {
      ...catalog[existingIndex],
      ...normalizedEntry
    };
    return catalog[existingIndex];
  }

  catalog[modelId] = catalogEntry;
  return catalog[modelId];
}

function listToolCapableConfiguredModels(config) {
  const catalog = getOllamaCatalog(config);
  const entries = Array.isArray(catalog)
    ? catalog
    : Object.entries(catalog).map(([id, entry]) => ({ name: id, ...entry }));

  return entries
    .filter((entry) => entry?.compat?.supportsTools === true)
    .map((entry) => getCatalogModelId(entry))
    .filter(Boolean);
}

function validateConfigText(text) {
  try {
    const parsed = JSON.parse(text);
    return {
      ok: true,
      formatted: JSON.stringify(parsed, null, 2)
    };
  } catch (error) {
    return {
      ok: false,
      error: `Invalid JSON: ${error.message}`
    };
  }
}

function buildProviderModelRef(modelId, existingValue = null) {
  if (typeof existingValue === 'string' && existingValue.includes('/')) {
    const [provider] = existingValue.split('/', 1);
    return `${provider || 'ollama'}/${modelId}`;
  }

  return `ollama/${modelId}`;
}

function getPrimaryModelId(config) {
  const model = config?.agents?.defaults?.model;
  if (typeof model === 'string') {
    return model.includes('/') ? model.split('/').slice(1).join('/') : model;
  }

  if (model && typeof model === 'object') {
    if (typeof model.primary === 'string') {
      return model.primary.includes('/') ? model.primary.split('/').slice(1).join('/') : model.primary;
    }
    if (typeof model.model === 'string') {
      return model.model.includes('/') ? model.model.split('/').slice(1).join('/') : model.model;
    }
  }

  return null;
}

function updateModelReference(existingValue, modelId) {
  if (typeof existingValue === 'string') {
    return buildProviderModelRef(modelId, existingValue);
  }

  if (existingValue && typeof existingValue === 'object') {
    if (typeof existingValue.primary === 'string') {
      return {
        ...existingValue,
        primary: existingValue.primary.includes('/')
          ? buildProviderModelRef(modelId, existingValue.primary)
          : modelId
      };
    }

    if ('provider' in existingValue || 'model' in existingValue) {
      return {
        ...existingValue,
        provider: existingValue.provider || 'ollama',
        model: modelId
      };
    }

    if (typeof existingValue.id === 'string') {
      return {
        ...existingValue,
        id: existingValue.id.includes('/') ? buildProviderModelRef(modelId, existingValue.id) : modelId
      };
    }
  }

  return existingValue;
}

function switchPrimaryModelMapKey(modelsMap, previousModelId, nextModelId) {
  if (!modelsMap || typeof modelsMap !== 'object' || Array.isArray(modelsMap)) {
    return;
  }

  const keys = Object.keys(modelsMap);
  const previousProviderRef = previousModelId ? buildProviderModelRef(previousModelId) : null;
  const nextProviderRef = buildProviderModelRef(nextModelId);
  const matchingKey =
    keys.find((key) => key === previousProviderRef || key === previousModelId) ||
    (keys.length === 1 && keys[0].includes('/') ? keys[0] : null);

  if (!matchingKey || matchingKey === nextProviderRef || matchingKey === nextModelId) {
    return;
  }

  const currentValue = modelsMap[matchingKey];
  delete modelsMap[matchingKey];
  modelsMap[nextProviderRef] = currentValue;
}

function switchPrimaryModel(config, options) {
  const { modelId, addToCatalog = false, catalogEntry = null } = options;
  const existingCatalogEntry = getCatalogEntry(config, modelId);
  const previousPrimaryModelId = getPrimaryModelId(config);

  if (!existingCatalogEntry) {
    if (!addToCatalog || !catalogEntry) {
      throw new Error(`Model "${modelId}" is not configured in models.providers.ollama.models`);
    }

    upsertCatalogEntry(config, modelId, catalogEntry);
  }

  if (!config.agents) {
    config.agents = {};
  }

  if (!config.agents.defaults) {
    config.agents.defaults = {};
  }

  if (typeof config.agents.defaults.model === 'string') {
    config.agents.defaults.model = buildProviderModelRef(modelId, config.agents.defaults.model);
  } else if (config.agents.defaults.model && typeof config.agents.defaults.model === 'object') {
    config.agents.defaults.model = updateModelReference(config.agents.defaults.model, modelId);
  } else {
    config.agents.defaults.model = {
      provider: 'ollama',
      primary: modelId
    };
  }

  if (!config.agents.defaults.models || typeof config.agents.defaults.models !== 'object') {
    config.agents.defaults.models = {};
  }

  if ('primary' in config.agents.defaults.models) {
    const updatedPrimary = updateModelReference(config.agents.defaults.models.primary, modelId);
    config.agents.defaults.models.primary =
      updatedPrimary === undefined
        ? config.agents.defaults.models.primary
        : updatedPrimary;
  } else if (Object.keys(config.agents.defaults.models).length === 0) {
    config.agents.defaults.models.primary = {
      provider: 'ollama',
      model: modelId
    };
  } else {
    switchPrimaryModelMapKey(config.agents.defaults.models, previousPrimaryModelId, modelId);
  }

  if (config.agents.defaults.routing && typeof config.agents.defaults.routing === 'object') {
    config.agents.defaults.routing = {
      ...config.agents.defaults.routing,
      primaryModel: modelId
    };
  }

  return config;
}

function maskValue(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return '***';
  }

  if (value.length <= 6) {
    return '***';
  }

  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function maskSecrets(input) {
  if (Array.isArray(input)) {
    return input.map(maskSecrets);
  }

  if (!input || typeof input !== 'object') {
    return input;
  }

  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (['authToken', 'botToken', 'token', 'apiKey'].includes(key)) {
      output[key] = maskValue(value);
      continue;
    }

    output[key] = maskSecrets(value);
  }

  return output;
}

function createConfigService({
  configPath,
  resetSourcePath = null,
  auditLogPath = null,
  now = defaultTimestamp
}) {
  async function loadConfigText() {
    return fs.readFile(configPath, 'utf8');
  }

  async function loadConfig() {
    return JSON.parse(await loadConfigText());
  }

  async function createBackup() {
    const backupPath = path.join(
      path.dirname(configPath),
      `${path.basename(configPath)}.bak.${now()}`
    );
    await fs.copyFile(configPath, backupPath);
    return backupPath;
  }

  async function loadHistory() {
    if (!auditLogPath) {
      return [];
    }

    try {
      const text = await fs.readFile(auditLogPath, 'utf8');
      const parsed = JSON.parse(text);
      return Array.isArray(parsed.entries) ? parsed.entries : [];
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }

      throw error;
    }
  }

  async function appendHistory(entry) {
    if (!auditLogPath) {
      return;
    }

    const entries = await loadHistory();
    entries.unshift(entry);
    const payload = {
      entries: entries.slice(0, 50)
    };
    await fs.writeFile(auditLogPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  async function resetConfig() {
    if (!resetSourcePath) {
      throw new Error('Reset is not configured for this dashboard.');
    }

    const currentConfig = await loadConfig();
    const sourceText = await fs.readFile(resetSourcePath, 'utf8');
    const validation = validateConfigText(sourceText);
    if (!validation.ok) {
      throw new Error(validation.error);
    }

    const backupPath = await createBackup();
    await fs.writeFile(configPath, `${validation.formatted}\n`, 'utf8');
    await appendHistory({
      timestamp: now(),
      action: 'resetConfig',
      previousPrimaryModel: getPrimaryModelId(currentConfig),
      nextPrimaryModel: getPrimaryModelId(JSON.parse(validation.formatted)),
      backupPath
    });

    return {
      config: JSON.parse(validation.formatted),
      validation: {
        ok: true,
        message: 'Validation passed.'
      },
      backup: {
        path: backupPath
      },
      restored: true
    };
  }

  async function writeValidatedText(text) {
    const validation = validateConfigText(text);
    if (!validation.ok) {
      throw new Error(validation.error);
    }

    await createBackup();
    await fs.writeFile(configPath, `${validation.formatted}\n`, 'utf8');
    return validation.formatted;
  }

  return {
    loadConfig,
    loadConfigText,
    getMaskedConfig: async () => maskSecrets(await loadConfig()),
    getHistory: loadHistory,
    savePrimaryModel: async (options) => {
      const config = await loadConfig();
      const previousPrimaryModel = getPrimaryModelId(config);
      const updated = switchPrimaryModel(config, options);
      const text = JSON.stringify(updated, null, 2);
      const validation = validateConfigText(text);
      if (!validation.ok) {
        throw new Error(validation.error);
      }

      const backupPath = await createBackup();
      await fs.writeFile(configPath, `${validation.formatted}\n`, 'utf8');
      await appendHistory({
        timestamp: now(),
        action: 'savePrimaryModel',
        previousPrimaryModel,
        nextPrimaryModel: options.modelId,
        backupPath
      });

      return {
        config: updated,
        validation: {
          ok: true,
          message: 'Validation passed.'
        },
        backup: {
          path: backupPath
        },
        saved: true
      };
    },
    writeRawConfig: writeValidatedText,
    validateText: validateConfigText,
    createBackup,
    resetConfig
  };
}

function defaultTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

module.exports = {
  createConfigService,
  validateConfigText,
  switchPrimaryModel,
  maskSecrets,
  listConfiguredModelIds,
  listToolCapableConfiguredModels
};
