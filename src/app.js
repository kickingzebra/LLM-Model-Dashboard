const http = require('node:http');

const {
  createConfigService,
  listConfiguredModelIds,
  listToolCapableConfiguredModels
} = require('./config-service');
const { createSystemService } = require('./system-service');

function createApp(options) {
  const {
    configPath,
    resetSourcePath,
    sandboxConfigPath = configPath,
    sandboxResetSourcePath = resetSourcePath,
    liveConfigPath = null,
    liveResetSourcePath = null,
    auditLogPath,
    modelProbeScriptPath,
    probeResultsPath,
    modelLiveLogPath,
    testReportPath,
    now,
    fetchImpl,
    runCommand,
    allowLiveWrites = false,
    host = '127.0.0.1',
    port = 3000
  } = options;

  const systemService = createSystemService({
    fetchImpl,
    runCommand,
    modelProbeScriptPath,
    probeResultsPath,
    modelLiveLogPath,
    testReportPath,
    now
  });
  let currentMode = determineInitialMode({
    initialConfigPath: configPath,
    sandboxConfigPath,
    liveConfigPath
  });

  function getModePaths(mode = currentMode) {
    if (mode === 'live') {
      return {
        configPath: liveConfigPath,
        resetSourcePath: liveResetSourcePath,
        protected: Boolean(liveConfigPath) && !allowLiveWrites
      };
    }

    return {
      configPath: sandboxConfigPath,
      resetSourcePath: sandboxResetSourcePath,
      protected: isProtectedLiveConfigPath(sandboxConfigPath) && !allowLiveWrites
    };
  }

  function getConfigService(mode = currentMode) {
    const paths = getModePaths(mode);
    return createConfigService({
      configPath: paths.configPath,
      resetSourcePath: paths.resetSourcePath,
      auditLogPath,
      now
    });
  }

  const handler = async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/') {
        return sendHtml(response, renderDashboardHtml());
      }

      if (request.method === 'GET' && request.url === '/api/state') {
        const configService = getConfigService();
        const modePaths = getModePaths();
        const [config, health, history, probeResults, modelLiveLog, testStatus] = await Promise.all([
          configService.getMaskedConfig(),
          systemService.checkHealth(),
          configService.getHistory(),
          systemService.getProbeResults(),
          systemService.getModelLiveLog(),
          systemService.getTestStatus()
        ]);

        return sendJson(response, 200, {
          ok: true,
          config,
          installedModels: health.ollama.models,
          health,
          summary: summarizeConfig(config, {
            configPath: modePaths.configPath,
            currentMode,
            liveAvailable: Boolean(liveConfigPath),
            liveWritesEnabled: allowLiveWrites
          }),
          history,
          probeResults,
          modelLiveLog,
          testStatus
        });
      }

      if (request.method === 'GET' && request.url === '/api/health') {
        return sendJson(response, 200, await systemService.checkHealth());
      }

      if (request.method === 'POST' && request.url === '/api/config/validate') {
        const configService = getConfigService();
        const body = await readJsonBody(request);
        const result = configService.validateText(body.text || '');
        return sendJson(response, result.ok ? 200 : 400, result);
      }

      if (request.method === 'POST' && request.url === '/api/mode') {
        const body = await readJsonBody(request);
        const nextMode = body.mode;
        if (!['sandbox', 'live'].includes(nextMode)) {
          return sendJson(response, 400, {
            ok: false,
            message: 'Mode must be either "sandbox" or "live".'
          });
        }

        if (nextMode === 'live') {
          if (!liveConfigPath) {
            return sendJson(response, 400, {
              ok: false,
              message: 'Live mode is not configured for this dashboard.'
            });
          }

          if (!body.confirm) {
            return sendJson(response, 400, {
              ok: false,
              message: 'Live mode confirmation is required.'
            });
          }
        }

        currentMode = nextMode;
        const modePaths = getModePaths();
        return sendJson(response, 200, {
          ok: true,
          message: `Dashboard mode switched to ${currentMode}.`,
          currentMode,
          configPath: modePaths.configPath
        });
      }

      if (request.method === 'POST' && request.url === '/api/config/primary-model') {
        const modePaths = getModePaths();
        if (modePaths.protected) {
          return sendJson(response, 403, {
            ok: false,
            message: 'Live config writes are disabled. Point the dashboard at a sandbox config or explicitly enable live writes after the schema fix is complete.'
          });
        }

        const configService = getConfigService();
        const body = await readJsonBody(request);
        const result = await configService.savePrimaryModel({
          modelId: body.modelId,
          addToCatalog: body.addToCatalog,
          catalogEntry: body.catalogEntry
        });
        const probe = await systemService.runModelProbe(body.modelId);

        return sendJson(response, 200, {
          ok: true,
          message: `Validation passed. Backup created. Primary model saved as ${body.modelId}.`,
          validation: result.validation,
          backup: result.backup,
          saved: result.saved,
          probe
        });
      }

      if (request.method === 'POST' && request.url === '/api/probe/models') {
        const body = await readJsonBody(request);
        const modelIds = Array.isArray(body.modelIds) ? body.modelIds : [];
        if (modelIds.length === 0) {
          return sendJson(response, 400, {
            ok: false,
            message: 'At least one model is required.'
          });
        }

        const probe = await systemService.runModelProbeBatch(modelIds);
        return sendJson(response, probe.ok ? 200 : 500, probe);
      }

      if (request.method === 'POST' && request.url === '/api/config/reset') {
        const modePaths = getModePaths();
        if (modePaths.protected) {
          return sendJson(response, 403, {
            ok: false,
            message: 'Live config writes are disabled. Reset is only available when the dashboard is pointed at a sandbox config.'
          });
        }

        const configService = getConfigService();
        const body = await readJsonBody(request);
        if (!body.confirm) {
          return sendJson(response, 400, {
            ok: false,
            message: 'Reset confirmation is required.'
          });
        }

        const result = await configService.resetConfig();
        return sendJson(response, 200, {
          ok: true,
          message: 'Active config restored from seed copy.',
          validation: result.validation,
          backup: result.backup,
          restored: result.restored
        });
      }

      if (request.method === 'POST' && request.url === '/api/restart') {
        const body = await readJsonBody(request);
        if (!body.confirm) {
          return sendJson(response, 400, {
            ok: false,
            message: 'Restart confirmation is required.'
          });
        }

        const result = await systemService.restartGateway();
        return sendJson(response, result.ok ? 200 : 500, result);
      }

      sendJson(response, 404, {
        ok: false,
        message: 'Not found'
      });
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        message: error.message
      });
    }
  };

  const server = http.createServer(handler);

  return {
    baseUrl: null,
    async inject({ method = 'GET', url = '/', headers = {}, body = null }) {
      const chunks = [];
      let statusCode = 200;
      let responseHeaders = {};

      const request = createMockRequest({ method, url, headers, body });
      const response = {
        writeHead(code, nextHeaders) {
          statusCode = code;
          responseHeaders = nextHeaders;
        },
        end(chunk = '') {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        }
      };

      await handler(request, response);

      const responseBody = Buffer.concat(chunks).toString('utf8');
      return {
        statusCode,
        headers: responseHeaders,
        body: responseBody,
        json() {
          return JSON.parse(responseBody);
        }
      };
    },
    async start(startPort = port, startHost = host) {
      await new Promise((resolve) => server.listen(startPort, startHost, resolve));
      const address = server.address();
      const resolvedHost =
        typeof address === 'object' && address.address
          ? (address.address === '::' ? startHost : address.address)
          : startHost;
      this.baseUrl = `http://${resolvedHost}:${typeof address === 'object' ? address.port : startPort}`;
    },
    async stop() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  };
}

function createMockRequest({ method, url, headers, body }) {
  const chunks = body ? [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))] : [];

  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    }
  };
}

function summarizeConfig(config, options = {}) {
  const defaults = config?.agents?.defaults || {};
  const telegram = config?.integrations?.telegram || {};
  const {
    configPath = null,
    currentMode = 'sandbox',
    liveAvailable = false,
    liveWritesEnabled = false
  } = options;
  const writeMode =
    currentMode === 'live'
      ? (liveWritesEnabled ? 'live-enabled' : 'live-read-only')
      : 'sandbox-only';

  return {
    primaryModel: defaults?.model?.primary || null,
    activeModels: defaults?.models || {},
    availableConfiguredModels: listConfiguredModelIds(config),
    toolCapableConfiguredModels: listToolCapableConfiguredModels(config),
    telegramEnabled: Boolean(telegram.enabled),
    telegramChannelConfigured: Boolean(telegram.channelId),
    toolProfile: defaults.toolProfile || null,
    configPath,
    writeMode,
    currentMode,
    liveAvailable,
    liveWritesEnabled
  };
}

function determineInitialMode({ initialConfigPath, sandboxConfigPath, liveConfigPath }) {
  if (initialConfigPath && liveConfigPath && initialConfigPath === liveConfigPath) {
    return 'live';
  }

  if (initialConfigPath && sandboxConfigPath && initialConfigPath === sandboxConfigPath) {
    return 'sandbox';
  }

  return isProtectedLiveConfigPath(initialConfigPath) ? 'live' : 'sandbox';
}

function isProtectedLiveConfigPath(configPath) {
  if (!configPath) {
    return false;
  }

  const normalized = String(configPath).toLowerCase();
  return normalized.endsWith('/openclaw.json') || normalized === 'openclaw.json';
}

function renderDashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LLM managament and orchestration</title>
  <style>
    :root {
      --bg: #0f1720;
      --panel: rgba(16, 25, 36, 0.88);
      --panel-strong: rgba(18, 31, 46, 0.98);
      --ink: #edf2f7;
      --accent: #ef8354;
      --accent-soft: #f7b267;
      --accent-cool: #6dd3c7;
      --muted: #9fb0c3;
      --ok: #4fd1a5;
      --error: #f87171;
      --line: rgba(159, 176, 195, 0.18);
      --shadow: 0 22px 80px rgba(0, 0, 0, 0.34);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(239, 131, 84, 0.28) 0, transparent 26%),
        radial-gradient(circle at top right, rgba(79, 209, 165, 0.16) 0, transparent 24%),
        linear-gradient(140deg, #07111b 0%, #0b1622 45%, #132131 100%);
      min-height: 100vh;
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      background-image:
        linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px);
      background-size: 32px 32px;
      mask-image: linear-gradient(to bottom, rgba(0,0,0,0.5), transparent 88%);
      pointer-events: none;
    }
    .shell {
      position: relative;
      max-width: 1280px;
      margin: 0 auto;
      padding: 34px 20px 56px;
    }
    .hero {
      margin-bottom: 22px;
      padding: 30px;
      border: 1px solid var(--line);
      border-radius: 28px;
      background:
        linear-gradient(135deg, rgba(239, 131, 84, 0.14), rgba(17, 28, 40, 0.74) 38%, rgba(109, 211, 199, 0.1));
      backdrop-filter: blur(10px);
      box-shadow: var(--shadow);
      overflow: hidden;
      position: relative;
    }
    .hero::after {
      content: "";
      position: absolute;
      width: 360px;
      height: 360px;
      right: -120px;
      top: -80px;
      background: radial-gradient(circle, rgba(109, 211, 199, 0.18), transparent 68%);
      pointer-events: none;
    }
    .hero-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.85fr);
      gap: 24px;
      align-items: end;
      position: relative;
      z-index: 1;
    }
    @media (max-width: 900px) {
      .hero-grid {
        grid-template-columns: 1fr;
      }
    }
    .eyebrow {
      display: inline-block;
      padding: 8px 12px;
      margin-bottom: 14px;
      border-radius: 999px;
      background: rgba(239, 131, 84, 0.12);
      border: 1px solid rgba(239, 131, 84, 0.25);
      color: var(--accent-soft);
      font-size: 0.78rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .hero h1 {
      margin: 0 0 10px;
      font-size: clamp(2.1rem, 4.5vw, 4rem);
      line-height: 0.95;
      max-width: 11ch;
      text-wrap: balance;
    }
    .hero p {
      margin: 0;
      color: var(--muted);
      max-width: 58ch;
      font-size: 1rem;
      line-height: 1.6;
    }
    .hero-panel {
      padding: 20px;
      border-radius: 22px;
      border: 1px solid rgba(109, 211, 199, 0.16);
      background: rgba(8, 16, 25, 0.54);
    }
    .hero-panel h3 {
      margin: 0 0 12px;
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--accent-cool);
    }
    .hero-panel p {
      margin: 0 0 16px;
      font-size: 0.95rem;
      line-height: 1.6;
      color: #d7e2ec;
    }
    .overview {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }
    .metric {
      padding: 16px 16px 18px;
      border: 1px solid var(--line);
      border-radius: 20px;
      background: linear-gradient(180deg, rgba(13, 23, 36, 0.94), rgba(10, 18, 29, 0.82));
      box-shadow: var(--shadow);
      position: relative;
      overflow: hidden;
      min-height: 108px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .metric::before {
      content: "";
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      height: 3px;
      background: linear-gradient(90deg, var(--accent), transparent 70%);
    }
    .metric-label {
      margin: 0 0 10px;
      color: var(--muted);
      font-size: 0.82rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .metric-value {
      margin: 0;
      font-size: 1.28rem;
      font-weight: 700;
      line-height: 1.3;
      word-break: break-word;
    }
    .metric-value.small {
      font-size: 0.9rem;
      color: #d8e1ea;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(12, minmax(0, 1fr));
      gap: 18px;
      align-items: start;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 24px;
      padding: 22px;
      box-shadow: var(--shadow);
      position: relative;
      overflow: hidden;
    }
    .card::before {
      content: "";
      position: absolute;
      inset: 0 0 auto 0;
      height: 1px;
      background: linear-gradient(90deg, rgba(239, 131, 84, 0.44), transparent 72%);
    }
    .card-mode { grid-column: span 4; }
    .card-primary { grid-column: span 4; }
    .card-health { grid-column: span 4; }
    .card-recovery { grid-column: span 4; }
    .card-validation { grid-column: span 4; }
    .card-summary { grid-column: span 4; }
    .card-history { grid-column: span 6; }
    .card-live-log { grid-column: span 12; }
    .card-probe { grid-column: span 6; }
    .card-tests { grid-column: span 6; }
    .card-matrix { grid-column: span 12; }
    @media (max-width: 1024px) {
      .card-mode, .card-primary, .card-health, .card-recovery,
      .card-validation, .card-summary, .card-history, .card-live-log, .card-probe, .card-tests, .card-matrix {
        grid-column: span 12;
      }
    }
    h2 {
      margin: 0 0 10px;
      font-size: 1.2rem;
      letter-spacing: 0.01em;
    }
    .card-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
    }
    .card-kicker {
      display: inline-flex;
      align-items: center;
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid rgba(159, 176, 195, 0.18);
      background: rgba(255, 255, 255, 0.04);
      color: var(--muted);
      font-size: 0.75rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .card-mode {
      background:
        linear-gradient(180deg, rgba(18, 31, 46, 0.98), rgba(13, 24, 37, 0.92)),
        radial-gradient(circle at top right, rgba(109, 211, 199, 0.1), transparent 45%);
    }
    label, button, select, textarea { font: inherit; }
    select, textarea {
      width: 100%;
      margin-top: 8px;
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: rgba(7, 15, 24, 0.92);
      color: var(--ink);
    }
    button {
      border: none;
      border-radius: 999px;
      padding: 11px 16px;
      margin: 8px 8px 0 0;
      background: linear-gradient(135deg, var(--accent), var(--accent-soft));
      color: #07111b;
      font-weight: 700;
      cursor: pointer;
      transition: transform 120ms ease, filter 120ms ease;
    }
    button:hover { transform: translateY(-1px); filter: brightness(1.05); }
    button.secondary {
      background: rgba(159, 176, 195, 0.16);
      color: var(--ink);
      border: 1px solid rgba(159, 176, 195, 0.24);
    }
    button.ghost {
      background: transparent;
      color: var(--ink);
      border: 1px solid rgba(159, 176, 195, 0.24);
    }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .actions button { margin: 0; }
    .mode-actions button {
      flex: 1 1 150px;
    }
    .status {
      margin-top: 14px;
      min-height: 24px;
      font-weight: 700;
      line-height: 1.5;
      word-break: break-word;
    }
    .ok { color: var(--ok); }
    .error { color: var(--error); }
    .meta { color: var(--muted); font-size: 0.95rem; line-height: 1.6; }
    .subtle-strong { color: #dce7f2; font-weight: 700; }
    .stack { display: grid; gap: 12px; }
    .pill-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 14px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.05);
      color: var(--muted);
      font-size: 0.9rem;
    }
    .health-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      margin-top: 12px;
    }
    .health-tile {
      padding: 14px;
      border-radius: 18px;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.03);
    }
    .health-tile strong {
      display: block;
      margin-bottom: 6px;
      font-size: 0.82rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .health-state { font-size: 1rem; font-weight: 700; }
    .backup-path {
      margin-top: 12px;
      padding: 14px;
      border-radius: 18px;
      border: 1px dashed rgba(239, 131, 84, 0.34);
      background: rgba(239, 131, 84, 0.08);
    }
    .backup-path strong {
      display: block;
      margin-bottom: 8px;
      color: var(--accent-soft);
      font-size: 0.82rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .backup-path code {
      display: block;
      padding: 0;
      background: transparent;
      color: #fff2e9;
      white-space: normal;
      word-break: break-word;
      font-size: 0.92rem;
      line-height: 1.5;
    }
    .mode-shell {
      display: grid;
      gap: 12px;
      margin-top: 14px;
    }
    .mode-banner {
      padding: 14px 16px;
      border-radius: 18px;
      border: 1px solid rgba(109, 211, 199, 0.18);
      background: linear-gradient(135deg, rgba(109, 211, 199, 0.12), rgba(255, 255, 255, 0.03));
    }
    .mode-banner strong {
      display: block;
      margin-bottom: 6px;
      font-size: 0.82rem;
      color: var(--accent-cool);
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .mode-banner code {
      display: block;
      margin-top: 8px;
      white-space: normal;
      word-break: break-word;
      line-height: 1.5;
    }
    .mode-note {
      color: var(--muted);
      font-size: 0.9rem;
      line-height: 1.6;
    }
    .list {
      list-style: none;
      padding: 0;
      margin: 14px 0 0;
      display: grid;
      gap: 10px;
    }
    .list li {
      padding: 14px 16px;
      border-radius: 18px;
      border: 1px solid var(--line);
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.02));
      line-height: 1.5;
      color: #dde7f0;
    }
    .history-action {
      display: inline-block;
      margin-bottom: 6px;
      padding: 5px 9px;
      border-radius: 999px;
      background: rgba(79, 209, 165, 0.12);
      color: var(--ok);
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .history-meta {
      display: block;
      color: var(--muted);
      font-size: 0.88rem;
      margin-top: 6px;
    }
    .empty {
      color: var(--muted);
      font-style: italic;
    }
    .summary-note {
      margin-top: 12px;
      padding: 14px 16px;
      border-radius: 18px;
      background: rgba(109, 211, 199, 0.08);
      border: 1px solid rgba(109, 211, 199, 0.18);
      color: #d9f7f0;
      line-height: 1.5;
    }
    .matrix-wrap {
      margin-top: 14px;
      border: 1px solid var(--line);
      border-radius: 20px;
      overflow: hidden;
      background: rgba(8, 14, 23, 0.72);
    }
    .matrix-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.92rem;
    }
    .matrix-table th,
    .matrix-table td {
      padding: 12px 14px;
      border-bottom: 1px solid rgba(159, 176, 195, 0.12);
      vertical-align: top;
      text-align: left;
    }
    .matrix-table th {
      background: rgba(255, 255, 255, 0.04);
      color: var(--muted);
      font-size: 0.78rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .matrix-table tr:last-child td {
      border-bottom: none;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      padding: 5px 9px;
      border-radius: 999px;
      font-size: 0.8rem;
      font-weight: 700;
      letter-spacing: 0.03em;
      white-space: nowrap;
    }
    .chip.pass {
      background: rgba(79, 209, 165, 0.14);
      color: var(--ok);
    }
    .chip.fail {
      background: rgba(248, 113, 113, 0.14);
      color: var(--error);
    }
    .chip.pending {
      background: rgba(247, 178, 103, 0.14);
      color: var(--accent-soft);
    }
    .matrix-note {
      margin-top: 14px;
      color: var(--muted);
      line-height: 1.6;
    }
    .log-path {
      margin-top: 14px;
      color: var(--muted);
      font-size: 0.9rem;
      line-height: 1.5;
      word-break: break-word;
    }
    .log-viewer {
      margin-top: 14px;
      padding: 16px;
      border-radius: 18px;
      border: 1px solid var(--line);
      background: rgba(6, 12, 20, 0.88);
      color: #e5eef7;
      font-family: "SFMono-Regular", "SF Mono", Consolas, "Liberation Mono", Menlo, monospace;
      font-size: 0.88rem;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 520px;
      overflow: auto;
    }
    code { background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 6px; }
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <div class="hero-grid">
        <div>
          <span class="eyebrow">Local control plane</span>
          <h1>LLM managament and orchestration</h1>
          <p>Switch the active Ollama-backed model safely, validate and back up the OpenClaw config before writes, and keep a visible audit trail of every sandbox change.</p>
        </div>
        <aside class="hero-panel">
          <h3>Control Focus</h3>
          <p>Use the sandbox to test model changes first, inspect the generated backup path, then decide whether the same pattern should be applied to your live OpenClaw config.</p>
          <div class="pill-row">
            <span class="pill">Safe sandbox flow</span>
            <span class="pill">Recovery ready</span>
            <span class="pill">Regression tested</span>
          </div>
        </aside>
      </div>
    </section>
    <section class="overview">
      <article class="metric">
        <p class="metric-label">Mode</p>
        <p class="metric-value small" id="mode-badge">Loading...</p>
      </article>
      <article class="metric">
        <p class="metric-label">Primary Model</p>
        <p class="metric-value" id="primary-model">Loading...</p>
      </article>
      <article class="metric">
        <p class="metric-label">Configured Models</p>
        <p class="metric-value" id="configured-count">0</p>
      </article>
      <article class="metric">
        <p class="metric-label">Installed Models</p>
        <p class="metric-value" id="installed-count">0</p>
      </article>
      <article class="metric">
        <p class="metric-label">Latest Probe</p>
        <p class="metric-value small" id="latest-probe">No probe results yet.</p>
      </article>
      <article class="metric">
        <p class="metric-label">Regression Status</p>
        <p class="metric-value small" id="test-overall-status">Not run yet.</p>
      </article>
      <article class="metric">
        <p class="metric-label">Latest Backup</p>
        <p class="metric-value small" id="latest-backup">No backups yet.</p>
      </article>
    </section>
    <section class="grid">
      <article class="card card-mode">
        <div class="card-head">
          <h2>Mode Control</h2>
          <span class="card-kicker">Sandbox vs Live</span>
        </div>
        <p class="meta">Switch the dashboard target between the sandbox config and the live OpenClaw config. Live mode stays read-only until live writes are explicitly enabled.</p>
        <div class="mode-shell">
          <div id="mode-summary" class="mode-banner">
            <strong>Current Target</strong>
            <div id="mode-summary-text">Loading...</div>
            <code id="mode-path-text">Loading...</code>
          </div>
          <div class="mode-note" id="mode-note-text">Sandbox is the default safe editing surface. Live mode is for inspection first, then deliberate writes later.</div>
        </div>
        <div class="actions mode-actions">
          <button id="mode-sandbox-button" class="ghost">Use Sandbox</button>
          <button id="mode-live-button" class="secondary">Use Live</button>
        </div>
        <div id="mode-status" class="status"></div>
      </article>
      <article class="card card-primary">
        <div class="card-head">
          <h2>Primary Model</h2>
          <span class="card-kicker">Switch</span>
        </div>
        <p class="meta">Choose the model you want OpenClaw to treat as the active primary in the active config. Save will validate the updated JSON and create a recovery backup first.</p>
        <label for="model-select">Choose configured or installed model</label>
        <select id="model-select"></select>
        <div class="actions">
          <button id="save-button">Save Model</button>
          <button id="refresh-button" class="ghost">Refresh</button>
          <button id="reset-button" class="secondary">Reset Active Config</button>
        </div>
        <div class="pill-row">
          <span class="pill">Configured catalog</span>
          <span class="pill">Backup before write</span>
          <span class="pill">Audit log enabled</span>
        </div>
        <div id="save-status" class="status"></div>
      </article>
      <article class="card card-health">
        <div class="card-head">
          <h2>Health</h2>
          <span class="card-kicker">Status</span>
        </div>
        <p class="meta">Gateway and Ollama status are shown separately so you can tell whether a problem is the config layer or the model runtime.</p>
        <div id="health-summary" class="health-grid">Loading...</div>
        <div class="actions">
          <button id="health-button" class="ghost">Check Health</button>
          <button id="restart-button" class="secondary">Restart Gateway</button>
        </div>
        <div id="health-status" class="status"></div>
      </article>
      <article class="card card-recovery">
        <div class="card-head">
          <h2>Recovery</h2>
          <span class="card-kicker">Backups</span>
        </div>
        <p class="meta">Every save or reset creates a backup file first so you can roll back quickly if something looks wrong.</p>
        <div class="backup-path">
          <strong>Latest Backup</strong>
          <code id="latest-backup-path">No backups yet.</code>
        </div>
        <div class="backup-path">
          <strong>Audit Log</strong>
          <code id="audit-log-path">local-data/model-history.log.json</code>
        </div>
      </article>
      <article class="card card-validation">
        <div class="card-head">
          <h2>Validation</h2>
          <span class="card-kicker">Check JSON</span>
        </div>
        <p class="meta">Paste JSON here to validate without writing it.</p>
        <textarea id="validation-input" rows="10" spellcheck="false"></textarea>
        <div class="actions">
          <button id="validate-button">Validate JSON</button>
        </div>
        <div id="validation-status" class="status"></div>
      </article>
      <article class="card card-summary">
        <div class="card-head">
          <h2>Config Summary</h2>
          <span class="card-kicker">Overview</span>
        </div>
        <ul id="config-summary" class="list"></ul>
        <div class="summary-note">Tip: use <span class="subtle-strong">Save Model</span> to test a change, then use <span class="subtle-strong">Reset Active Config</span> to get back to the known-good seed state.</div>
      </article>
      <article class="card card-matrix">
        <div class="card-head">
          <h2>Documented Test Matrix</h2>
          <span class="card-kicker">Model capability plan</span>
        </div>
        <p class="meta">This mirrors the documented approach from <code>OPENCLAW_MODEL_TOOL_TEST_MATRIX_2026-04-13.md</code>. The dashboard can fill in the direct Ollama capability checks from the probe script. The broader OpenClaw agent confirmation pass is still a second-stage check.</p>
        <div class="actions">
          <button id="probe-candidates-button">Probe Tool-Capable Candidates</button>
        </div>
        <div class="matrix-wrap">
          <table class="matrix-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Chat OK</th>
                <th>Tools Payload Accepted</th>
                <th>Structured Tool Call Returned</th>
                <th>OpenClaw Agent Pass</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody id="matrix-body"></tbody>
          </table>
        </div>
        <p class="matrix-note">Direct probe automation covers plain chat, tools payload acceptance, and structured tool-call return via <code>ollama_tool_probe.sh</code>. Telegram path, TUI path, session behavior, and real OpenClaw tool execution are not yet automated in this dashboard.</p>
      </article>
      <article class="card card-history">
        <div class="card-head">
          <h2>Model History</h2>
          <span class="card-kicker">Audit Trail</span>
        </div>
        <p class="meta">Recent sandbox model changes, resets, and the backup file generated for each action.</p>
        <ul id="history-list" class="list"></ul>
      </article>
      <article class="card card-live-log">
        <div class="card-head">
          <h2>Live Model Log</h2>
          <span class="card-kicker">Markdown notebook</span>
        </div>
        <p class="meta">This panel mirrors the human-readable Markdown log for model incidents, Telegram failures, and real workflow observations.</p>
        <div id="live-log-path" class="log-path">No live log configured.</div>
        <pre id="live-log-content" class="log-viewer">No live log loaded yet.</pre>
      </article>
      <article class="card card-probe">
        <div class="card-head">
          <h2>Direct Ollama Probe</h2>
          <span class="card-kicker">Model capability checks</span>
        </div>
        <p class="meta">After each model change, the dashboard can run the documented direct Ollama probe from <code>ollama_tool_probe.sh</code>. This covers plain chat, tools payload acceptance, and structured tool-call return. It is not the full OpenClaw end-to-end confirmation pass.</p>
        <ul id="probe-results-list" class="list"></ul>
      </article>
      <article class="card card-tests">
        <div class="card-head">
          <h2>TDD Test Status</h2>
          <span class="card-kicker">Regression dashboard</span>
        </div>
        <p class="meta">This panel shows the latest recorded regression run from the local/CI suite so you can see whether the test-driven workflow is still green before making more changes.</p>
        <div id="test-summary-list" class="list"></div>
      </article>
    </section>
  </main>
  <script>
    let latestState = null;

    function setMessage(id, text, isError = false) {
      const node = document.getElementById(id);
      node.textContent = text;
      node.className = 'status ' + (isError ? 'error' : 'ok');
    }

    function renderState(payload) {
      latestState = payload;
      const summary = payload.summary;
      const models = Array.from(new Set([
        ...summary.availableConfiguredModels,
        ...payload.installedModels
      ])).sort();
      const select = document.getElementById('model-select');
      select.innerHTML = models.map((model) => '<option value="' + model + '">' + model + '</option>').join('');
      select.value = summary.primaryModel || models[0] || '';
      document.getElementById('primary-model').textContent = summary.primaryModel || 'Not set';
      document.getElementById('configured-count').textContent = String(summary.availableConfiguredModels.length);
      document.getElementById('installed-count').textContent = String(payload.installedModels.length);
      const latestBackupPath = payload.history[0]?.backupPath || 'No backups yet.';
      const latestProbe = payload.probeResults[0];
      const liveLog = payload.modelLiveLog || { available: false, path: null, content: '' };
      const testStatus = payload.testStatus;
      document.getElementById('mode-badge').textContent = summary.currentMode + ' | ' + summary.writeMode;
      document.getElementById('mode-summary-text').textContent =
        'Mode: ' + summary.currentMode + ' | Write: ' + summary.writeMode;
      document.getElementById('mode-path-text').textContent = summary.configPath || 'No config path';
      document.getElementById('mode-note-text').textContent =
        summary.currentMode === 'live'
          ? (summary.liveWritesEnabled
            ? 'Live mode is active and writes are enabled. Changes affect the real OpenClaw config.'
            : 'Live mode is active in read-only form. Inspect safely before explicitly enabling live writes.')
          : 'Sandbox mode is active. Model changes and resets affect only the sandbox config copy.';
      document.getElementById('latest-backup').textContent = latestBackupPath;
      document.getElementById('latest-backup-path').textContent = latestBackupPath;
      document.getElementById('latest-probe').textContent = latestProbe
        ? latestProbe.model + ' | ' + latestProbe.toolsOutcome
        : 'No probe results yet.';
      document.getElementById('test-overall-status').textContent = testStatus.lastRunAt
        ? testStatus.overallStatus + ' | ' + testStatus.passedCount + ' passed'
        : 'Not run yet.';
      document.getElementById('validation-input').value = JSON.stringify(payload.config, null, 2);
      document.getElementById('config-summary').innerHTML = [
        '<li><strong>Configured models:</strong> ' + summary.availableConfiguredModels.join(', ') + '</li>',
        '<li><strong>Tool-capable configured models:</strong> ' + (summary.toolCapableConfiguredModels.join(', ') || 'None marked yet') + '</li>',
        '<li><strong>Installed models:</strong> ' + (payload.installedModels.join(', ') || 'None detected') + '</li>',
        '<li><strong>Telegram enabled:</strong> ' + (summary.telegramEnabled ? 'Yes' : 'No') + '</li>',
        '<li><strong>Telegram channel configured:</strong> ' + (summary.telegramChannelConfigured ? 'Yes' : 'No') + '</li>',
        '<li><strong>Tool profile:</strong> ' + (summary.toolProfile || 'Not set') + '</li>',
        '<li><strong>Config path:</strong> ' + escapeHtml(summary.configPath || 'Not set') + '</li>',
        '<li><strong>Write mode:</strong> ' + escapeHtml(summary.writeMode) + '</li>'
      ].join('');
      document.getElementById('history-list').innerHTML = payload.history.length
        ? payload.history.map((entry) =>
            '<li>' +
            '<span class="history-action">' + entry.action + '</span>' +
            '<div><strong>' + (entry.previousPrimaryModel || 'none') + '</strong> -> <strong>' + (entry.nextPrimaryModel || 'none') + '</strong></div>' +
            '<span class="history-meta">Backup: ' + (entry.backupPath || 'not recorded') + '</span>' +
            '<span class="history-meta">Timestamp: ' + entry.timestamp + '</span>' +
            '</li>'
          ).join('')
        : '<li class="empty">No changes logged yet.</li>';
      document.getElementById('live-log-path').innerHTML = liveLog.path
        ? '<strong>Source:</strong> ' + escapeHtml(liveLog.path)
        : 'No live log configured.';
      document.getElementById('live-log-content').textContent = liveLog.available
        ? (liveLog.content || 'Live log file is empty.')
        : (liveLog.path ? 'Live log file not found yet.' : 'No live log configured.');
      document.getElementById('probe-results-list').innerHTML = payload.probeResults.length
        ? payload.probeResults.map((entry) =>
            '<li>' +
            '<span class="history-action">' + entry.model + '</span>' +
            '<div><strong>Chat:</strong> ' + entry.chatOk + ' (' + entry.chatHttp + ')</div>' +
            '<div><strong>Tools:</strong> ' + entry.toolsOutcome + ' (' + entry.toolsHttp + ')</div>' +
            '<div><strong>Chat Summary:</strong> ' + entry.chatSummary + '</div>' +
            '<div><strong>Tools Summary:</strong> ' + entry.toolsSummary + '</div>' +
            '<span class="history-meta">Timestamp: ' + entry.timestamp + '</span>' +
            '</li>'
          ).join('')
        : '<li class="empty">No probe results logged yet.</li>';
      document.getElementById('test-summary-list').innerHTML = testStatus.lastRunAt
        ? [
            '<li><strong>Last run:</strong> ' + testStatus.lastRunAt + '</li>',
            '<li><strong>Overall status:</strong> ' + testStatus.overallStatus + '</li>',
            '<li><strong>Suites:</strong> ' + testStatus.suiteCount + ' | <strong>Passed:</strong> ' + testStatus.passedCount + ' | <strong>Failed:</strong> ' + testStatus.failedCount + '</li>',
            '<li><strong>Suite detail:</strong> ' + testStatus.suites.map((suite) => suite.name + ' (' + suite.status + ')').join(', ') + '</li>'
          ].join('')
        : '<li class="empty">No regression report has been recorded yet. Run <code>npm run test:regression</code> to populate this panel.</li>';
      document.getElementById('matrix-body').innerHTML = buildMatrixRows(summary.availableConfiguredModels, payload.probeResults);
      document.getElementById('mode-sandbox-button').disabled = summary.currentMode === 'sandbox';
      document.getElementById('mode-live-button').disabled = !summary.liveAvailable || summary.currentMode === 'live';
      renderHealth(payload.health);
    }

    function buildMatrixRows(models, probeResults) {
      const probeByModel = new Map(probeResults.map((entry) => [entry.model, entry]));

      return models.map((model) => {
        const probe = probeByModel.get(model);
        const chatOk = probe ? yesNoChip(probe.chatOk === 'yes') : pendingChip('Pending');
        const toolsAccepted = probe ? yesNoChip(probe.toolsHttp === '200') : pendingChip('Pending');
        const structuredCall = probe
          ? yesNoChip(probe.toolsOutcome === 'tool_calls_returned')
          : pendingChip('Pending');
        const openClawPass = pendingChip('Manual');
        const notes = probe
          ? escapeHtml(probe.toolsSummary || probe.chatSummary || 'Probe recorded')
          : 'Direct Ollama probe not run yet';

        return '<tr>' +
          '<td><strong>' + escapeHtml(model) + '</strong></td>' +
          '<td>' + chatOk + '</td>' +
          '<td>' + toolsAccepted + '</td>' +
          '<td>' + structuredCall + '</td>' +
          '<td>' + openClawPass + '</td>' +
          '<td>' + notes + '</td>' +
        '</tr>';
      }).join('');
    }

    function yesNoChip(value) {
      return value
        ? '<span class="chip pass">Yes</span>'
        : '<span class="chip fail">No</span>';
    }

    function pendingChip(label) {
      return '<span class="chip pending">' + escapeHtml(label) + '</span>';
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    function renderHealth(health) {
      document.getElementById('health-summary').innerHTML = [
        '<div class="health-tile"><strong>OpenClaw</strong><div class="health-state">' + (health.openclaw.ok ? 'Healthy' : 'Unavailable') + '</div><div class="meta">' + health.openclaw.message + '</div></div>',
        '<div class="health-tile"><strong>Ollama</strong><div class="health-state">' + (health.ollama.ok ? 'Healthy' : 'Unavailable') + '</div><div class="meta">' + health.ollama.message + '</div></div>'
      ].join('');
    }

    function buildHealthStatusMessage(health) {
      if (health.ok) {
        return 'Health checks passed.';
      }

      const failed = Array.isArray(health.failedChecks) ? health.failedChecks : [];
      if (!failed.length) {
        return 'One or more health checks failed.';
      }

      return 'Health checks failed: ' + failed
        .map((check) => check.label + ' (' + check.message + ')')
        .join('; ');
    }

    async function loadState(options = {}) {
      const {
        announce = false,
        message = 'Dashboard state refreshed.',
        targetId = 'save-status'
      } = options;
      const response = await fetch('/api/state');
      const payload = await response.json();
      renderState(payload);
      if (announce) {
        setMessage(targetId, message);
      }
    }

    async function savePrimaryModel() {
      const modelId = document.getElementById('model-select').value;
      const configured = latestState.summary.availableConfiguredModels.includes(modelId);
      const catalogEntry = configured ? null : {
        notes: 'Promoted from installed Ollama model',
        compat: { supportsTools: false }
      };
      const response = await fetch('/api/config/primary-model', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          modelId,
          addToCatalog: !configured,
          catalogEntry
        })
      });
      const payload = await response.json();
      const statusText = response.ok
        ? (payload.validation?.message || 'Validation passed.') +
          ' Backup: ' + (payload.backup?.path || 'created') +
          '. ' + (payload.probe?.ok ? 'Probe complete.' : (payload.probe?.message || 'Probe skipped.')) +
          ' Primary model saved.'
        : (payload.message || 'Save failed.');
      setMessage('save-status', statusText, !response.ok);
      if (response.ok) {
        await loadState();
      }
    }

    async function validateJson() {
      const text = document.getElementById('validation-input').value;
      const response = await fetch('/api/config/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const payload = await response.json();
      setMessage('validation-status', payload.ok ? 'JSON is valid.' : payload.error, !payload.ok);
    }

    async function checkHealth() {
      const response = await fetch('/api/health');
      const payload = await response.json();
      renderHealth(payload);
      setMessage('health-status', buildHealthStatusMessage(payload), !payload.ok);
    }

    async function restartGateway() {
      if (!window.confirm('Restart OpenClaw gateway now?')) {
        return;
      }
      const response = await fetch('/api/restart', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: true })
      });
      const payload = await response.json();
      setMessage('health-status', payload.message, !response.ok);
    }

    async function resetSandboxConfig() {
      if (!window.confirm('Reset the sandbox config back to its seed state?')) {
        return;
      }
      const response = await fetch('/api/config/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: true })
      });
      const payload = await response.json();
      const statusText = response.ok
        ? (payload.validation?.message || 'Validation passed.') +
          ' Backup: ' + (payload.backup?.path || 'created') +
          '. Active config restored.'
        : (payload.message || 'Reset failed.');
      setMessage('save-status', statusText, !response.ok);
      if (response.ok) {
        await loadState();
      }
    }

    async function switchMode(mode) {
      const body = { mode };
      if (mode === 'live') {
        const confirmLive = window.confirm('Switch the dashboard to the live OpenClaw config? Live writes will remain blocked unless they are explicitly enabled.');
        if (!confirmLive) {
          return;
        }
        body.confirm = true;
      }

      const response = await fetch('/api/mode', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const payload = await response.json();
      setMessage('mode-status', payload.message || 'Mode updated.', !response.ok);
      if (response.ok) {
        await loadState();
      }
    }

    async function probeCandidateModels() {
      const modelIds = latestState.summary.toolCapableConfiguredModels || [];
      if (!modelIds.length) {
        setMessage('save-status', 'No configured models are currently marked as tool-capable.', true);
        return;
      }

      setMessage('save-status', 'Running direct Ollama probes for: ' + modelIds.join(', '));
      const response = await fetch('/api/probe/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modelIds })
      });
      const payload = await response.json();
      setMessage('save-status', payload.message || 'Probe run completed.', !response.ok);
      if (response.ok) {
        await loadState();
      }
    }

    document.getElementById('save-button').addEventListener('click', savePrimaryModel);
    document.getElementById('refresh-button').addEventListener('click', () => {
      loadState({ announce: true });
    });
    document.getElementById('reset-button').addEventListener('click', resetSandboxConfig);
    document.getElementById('mode-sandbox-button').addEventListener('click', () => switchMode('sandbox'));
    document.getElementById('mode-live-button').addEventListener('click', () => switchMode('live'));
    document.getElementById('validate-button').addEventListener('click', validateJson);
    document.getElementById('health-button').addEventListener('click', checkHealth);
    document.getElementById('restart-button').addEventListener('click', restartGateway);
    document.getElementById('probe-candidates-button').addEventListener('click', probeCandidateModels);
    loadState().catch((error) => setMessage('save-status', error.message, true));
  </script>
</body>
</html>`;
}

function sendHtml(response, html) {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(html);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk.toString();
  }

  return raw ? JSON.parse(raw) : {};
}

module.exports = {
  createApp
};
