const http = require('node:http');

const { createConfigService } = require('./config-service');
const { createSystemService } = require('./system-service');

function createApp(options) {
  const {
    configPath,
    now,
    fetchImpl,
    runCommand,
    port = 3000
  } = options;

  const configService = createConfigService({ configPath, now });
  const systemService = createSystemService({ fetchImpl, runCommand });

  const handler = async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/') {
        return sendHtml(response, renderDashboardHtml());
      }

      if (request.method === 'GET' && request.url === '/api/state') {
        const [config, health] = await Promise.all([
          configService.getMaskedConfig(),
          systemService.checkHealth()
        ]);

        return sendJson(response, 200, {
          ok: true,
          config,
          installedModels: health.ollama.models,
          health,
          summary: summarizeConfig(config)
        });
      }

      if (request.method === 'GET' && request.url === '/api/health') {
        return sendJson(response, 200, await systemService.checkHealth());
      }

      if (request.method === 'POST' && request.url === '/api/config/validate') {
        const body = await readJsonBody(request);
        const result = configService.validateText(body.text || '');
        return sendJson(response, result.ok ? 200 : 400, result);
      }

      if (request.method === 'POST' && request.url === '/api/config/primary-model') {
        const body = await readJsonBody(request);
        const result = await configService.savePrimaryModel({
          modelId: body.modelId,
          addToCatalog: body.addToCatalog,
          catalogEntry: body.catalogEntry
        });

        return sendJson(response, 200, {
          ok: true,
          message: `Validation passed. Backup created. Primary model saved as ${body.modelId}.`,
          validation: result.validation,
          backup: result.backup,
          saved: result.saved
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
    async start(startPort = port) {
      await new Promise((resolve) => server.listen(startPort, '127.0.0.1', resolve));
      const address = server.address();
      this.baseUrl = `http://127.0.0.1:${address.port}`;
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

function summarizeConfig(config) {
  const catalog = config?.models?.providers?.ollama?.models || {};
  const defaults = config?.agents?.defaults || {};
  const telegram = config?.integrations?.telegram || {};

  return {
    primaryModel: defaults?.model?.primary || null,
    activeModels: defaults?.models || {},
    availableConfiguredModels: Object.keys(catalog),
    telegramEnabled: Boolean(telegram.enabled),
    telegramChannelConfigured: Boolean(telegram.channelId),
    toolProfile: defaults.toolProfile || null
  };
}

function renderDashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OpenClaw Dashboard</title>
  <style>
    :root {
      --bg: #f4efe4;
      --panel: #fffaf2;
      --ink: #1f2933;
      --accent: #b5542f;
      --accent-soft: #e8b89e;
      --muted: #6b7280;
      --ok: #1f7a45;
      --error: #a12f2f;
      --line: #dccdbd;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, #f9d7b8 0, transparent 28%),
        linear-gradient(135deg, #f5efe2 0%, #efe2cc 55%, #e8d8c2 100%);
      min-height: 100vh;
    }
    .shell {
      max-width: 1100px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }
    .hero {
      margin-bottom: 20px;
      padding: 24px;
      border: 1px solid var(--line);
      background: rgba(255, 250, 242, 0.85);
      backdrop-filter: blur(10px);
    }
    .hero h1 { margin: 0 0 10px; font-size: clamp(2rem, 5vw, 3.8rem); }
    .hero p { margin: 0; color: var(--muted); max-width: 60ch; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      padding: 18px;
      box-shadow: 0 10px 30px rgba(62, 39, 24, 0.08);
    }
    label, button, select, textarea { font: inherit; }
    select, textarea {
      width: 100%;
      margin-top: 8px;
      padding: 10px 12px;
      border: 1px solid var(--line);
      background: #fff;
    }
    button {
      border: none;
      padding: 10px 14px;
      margin: 8px 8px 0 0;
      background: var(--accent);
      color: white;
      cursor: pointer;
    }
    button.secondary { background: #6b7280; }
    button.ghost { background: #e8dfd2; color: var(--ink); }
    .status { margin-top: 12px; min-height: 24px; font-weight: 600; }
    .ok { color: var(--ok); }
    .error { color: var(--error); }
    .meta { color: var(--muted); font-size: 0.95rem; }
    ul { padding-left: 18px; }
    code { background: #f1e8dc; padding: 2px 4px; }
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <h1>OpenClaw Model Dashboard</h1>
      <p>Switch the active Ollama-backed model safely, validate the config before writes, and check gateway health without editing <code>openclaw.json</code> by hand.</p>
    </section>
    <section class="grid">
      <article class="card">
        <h2>Primary Model</h2>
        <p class="meta">Current primary: <strong id="primary-model">Loading...</strong></p>
        <label for="model-select">Choose configured or installed model</label>
        <select id="model-select"></select>
        <div>
          <button id="save-button">Save Model</button>
          <button id="refresh-button" class="ghost">Refresh</button>
        </div>
        <div id="save-status" class="status"></div>
      </article>
      <article class="card">
        <h2>Health</h2>
        <p class="meta">OpenClaw gateway and Ollama status</p>
        <div id="health-summary">Loading...</div>
        <button id="health-button" class="ghost">Check Health</button>
        <button id="restart-button" class="secondary">Restart Gateway</button>
        <div id="health-status" class="status"></div>
      </article>
      <article class="card">
        <h2>Validation</h2>
        <p class="meta">Paste JSON here to validate without writing it.</p>
        <textarea id="validation-input" rows="10" spellcheck="false"></textarea>
        <button id="validate-button">Validate JSON</button>
        <div id="validation-status" class="status"></div>
      </article>
      <article class="card">
        <h2>Config Summary</h2>
        <ul id="config-summary"></ul>
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
      document.getElementById('validation-input').value = JSON.stringify(payload.config, null, 2);
      document.getElementById('config-summary').innerHTML = [
        '<li>Configured models: ' + summary.availableConfiguredModels.join(', ') + '</li>',
        '<li>Installed models: ' + (payload.installedModels.join(', ') || 'None detected') + '</li>',
        '<li>Telegram enabled: ' + (summary.telegramEnabled ? 'Yes' : 'No') + '</li>',
        '<li>Telegram channel configured: ' + (summary.telegramChannelConfigured ? 'Yes' : 'No') + '</li>',
        '<li>Tool profile: ' + (summary.toolProfile || 'Not set') + '</li>'
      ].join('');
      renderHealth(payload.health);
    }

    function renderHealth(health) {
      document.getElementById('health-summary').innerHTML = [
        '<div>OpenClaw: ' + (health.openclaw.ok ? 'Healthy' : 'Unavailable') + '</div>',
        '<div>Ollama: ' + (health.ollama.ok ? 'Healthy' : 'Unavailable') + '</div>'
      ].join('');
    }

    async function loadState() {
      const response = await fetch('/api/state');
      const payload = await response.json();
      renderState(payload);
      setMessage('save-status', 'Dashboard state refreshed.');
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
          '. Primary model saved.'
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
      setMessage('health-status', payload.openclaw.ok && payload.ollama.ok ? 'Health checks passed.' : 'One or more health checks failed.', !(payload.openclaw.ok && payload.ollama.ok));
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

    document.getElementById('save-button').addEventListener('click', savePrimaryModel);
    document.getElementById('refresh-button').addEventListener('click', loadState);
    document.getElementById('validate-button').addEventListener('click', validateJson);
    document.getElementById('health-button').addEventListener('click', checkHealth);
    document.getElementById('restart-button').addEventListener('click', restartGateway);
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
