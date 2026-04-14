const { spawn } = require('node:child_process');

function createSystemService({
  fetchImpl = global.fetch,
  runCommand = defaultRunCommand,
  openclawHealthUrl = 'http://127.0.0.1:18789/health',
  ollamaTagsUrl = 'http://127.0.0.1:11434/api/tags'
} = {}) {
  return {
    async checkHealth() {
      const [openclaw, ollama] = await Promise.all([
        fetchJson(fetchImpl, openclawHealthUrl, 'OpenClaw gateway'),
        fetchJson(fetchImpl, ollamaTagsUrl, 'Ollama API')
      ]);

      return {
        openclaw: {
          ok: openclaw.ok,
          status: openclaw.status,
          message: openclaw.message,
          body: openclaw.body
        },
        ollama: {
          ok: ollama.ok,
          status: ollama.status,
          message: ollama.message,
          body: ollama.body,
          models: Array.isArray(ollama.body?.models)
            ? ollama.body.models.map((model) => model.name).filter(Boolean)
            : []
        }
      };
    },
    async restartGateway() {
      const result = await runCommand('systemctl', ['--user', 'restart', 'openclaw-gateway']);
      if (result.code !== 0) {
        return {
          ok: false,
          message: result.stderr || 'Failed to restart openclaw-gateway'
        };
      }

      return {
        ok: true,
        message: 'OpenClaw gateway restarted.'
      };
    }
  };
}

async function fetchJson(fetchImpl, url, label) {
  try {
    const response = await fetchImpl(url);
    const text = await response.text();
    const isJson = response.headers.get('content-type')?.includes('application/json');
    const body = isJson && text ? JSON.parse(text) : text;

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        message: `${label} returned HTTP ${response.status}`,
        body
      };
    }

    return {
      ok: true,
      status: response.status,
      message: `${label} is healthy.`,
      body
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      message: `${label} check failed: ${error.message}`,
      body: null
    };
  }
}

async function defaultRunCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });

    child.on('error', (error) => {
      resolve({ code: 1, stdout, stderr: error.message });
    });
  });
}

module.exports = {
  createSystemService
};
