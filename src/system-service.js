const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');

function createSystemService({
  fetchImpl = global.fetch,
  runCommand = defaultRunCommand,
  modelProbeScriptPath = null,
  probeResultsPath = null,
  modelLiveLogPath = null,
  testReportPath = null,
  now = defaultTimestamp,
  openclawHealthUrl = 'http://127.0.0.1:18789/health',
  ollamaTagsUrl = 'http://127.0.0.1:11434/api/tags'
} = {}) {
  return {
    async checkHealth() {
      const [openclaw, ollama] = await Promise.all([
        fetchJson(fetchImpl, openclawHealthUrl, 'OpenClaw gateway'),
        fetchJson(fetchImpl, ollamaTagsUrl, 'Ollama API')
      ]);

      const failedChecks = [
        !openclaw.ok ? {
          id: 'openclaw',
          label: 'OpenClaw gateway',
          status: openclaw.status,
          message: openclaw.message
        } : null,
        !ollama.ok ? {
          id: 'ollama',
          label: 'Ollama API',
          status: ollama.status,
          message: ollama.message
        } : null
      ].filter(Boolean);

      return {
        ok: failedChecks.length === 0,
        failedChecks,
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
    },
    async getProbeResults() {
      if (!probeResultsPath) {
        return [];
      }

      try {
        const text = await fs.readFile(probeResultsPath, 'utf8');
        const parsed = JSON.parse(text);
        return Array.isArray(parsed.entries) ? parsed.entries : [];
      } catch (error) {
        if (error.code === 'ENOENT') {
          return [];
        }

        throw error;
      }
    },
    async getModelLiveLog() {
      if (!modelLiveLogPath) {
        return {
          available: false,
          path: null,
          content: ''
        };
      }

      try {
        const content = await fs.readFile(modelLiveLogPath, 'utf8');
        return {
          available: true,
          path: modelLiveLogPath,
          content
        };
      } catch (error) {
        if (error.code === 'ENOENT') {
          return {
            available: false,
            path: modelLiveLogPath,
            content: ''
          };
        }

        throw error;
      }
    },
    async getTestStatus() {
      if (!testReportPath) {
        return emptyTestStatus();
      }

      try {
        const text = await fs.readFile(testReportPath, 'utf8');
        const parsed = JSON.parse(text);
        return {
          lastRunAt: parsed.lastRunAt || null,
          lastRunAtIso: toIsoTimestamp(parsed.lastRunAt),
          overallStatus: parsed.overallStatus || 'unknown',
          suiteCount: parsed.suiteCount || 0,
          passedCount: parsed.passedCount || 0,
          failedCount: parsed.failedCount || 0,
          suites: Array.isArray(parsed.suites) ? parsed.suites : []
        };
      } catch (error) {
        if (error.code === 'ENOENT') {
          return emptyTestStatus();
        }

        throw error;
      }
    },
    async runModelProbe(modelId) {
      if (!modelProbeScriptPath) {
        return {
          ok: false,
          skipped: true,
          message: 'Model probe script is not configured.',
          entries: []
        };
      }

      const result = await runCommand('/bin/bash', [modelProbeScriptPath, modelId]);
      if (result.code !== 0) {
        return {
          ok: false,
          skipped: false,
          message: result.stderr || 'Model probe failed.',
          entries: []
        };
      }

      const timestamp = now();
      const entries = parseModelProbeOutput(result.stdout).map((entry) => ({
        timestamp,
        timestampIso: toIsoTimestamp(timestamp),
        ...entry
      }));

      if (probeResultsPath && entries.length > 0) {
        const existing = await this.getProbeResults();
        await fs.writeFile(
          probeResultsPath,
          `${JSON.stringify({ entries: [...entries, ...existing].slice(0, 50) }, null, 2)}\n`,
          'utf8'
        );
      }

      return {
        ok: true,
        skipped: false,
        message: 'Direct Ollama capability probe completed.',
        entries
      };
    },
    async runModelProbeBatch(modelIds) {
      const uniqueModelIds = Array.from(new Set((modelIds || []).filter(Boolean)));
      if (uniqueModelIds.length === 0) {
        return {
          ok: false,
          skipped: true,
          message: 'No models were provided for probing.',
          entries: []
        };
      }

      const entries = [];
      for (const modelId of uniqueModelIds) {
        const result = await this.runModelProbe(modelId);
        if (!result.ok) {
          return {
            ok: false,
            skipped: result.skipped,
            message: `Probe failed for ${modelId}: ${result.message}`,
            entries
          };
        }

        entries.push(...result.entries);
      }

      return {
        ok: true,
        skipped: false,
        message: `Direct Ollama capability probe completed for ${uniqueModelIds.length} model(s).`,
        entries
      };
    }
  };
}

function emptyTestStatus() {
  return {
    lastRunAt: null,
    lastRunAtIso: null,
    overallStatus: 'not_run',
    suiteCount: 0,
    passedCount: 0,
    failedCount: 0,
    suites: []
  };
}

function parseModelProbeOutput(stdout) {
  const blocks = stdout
    .split('-----')
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.map((block) => {
    const map = {};
    for (const line of block.split('\n')) {
      const index = line.indexOf('=');
      if (index === -1) {
        continue;
      }

      const key = line.slice(0, index);
      const value = line.slice(index + 1);
      map[key] = value;
    }

    return {
      model: map.MODEL || '',
      chatHttp: map.CHAT_HTTP || '',
      chatOk: map.CHAT_OK || '',
      chatSummary: map.CHAT_SUMMARY || '',
      toolsHttp: map.TOOLS_HTTP || '',
      toolsOutcome: map.TOOLS_OUTCOME || '',
      toolsSummary: map.TOOLS_SUMMARY || ''
    };
  });
}

function toIsoTimestamp(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }

  if (/^\d{8}T\d{6}Z?$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().replace('.000Z', 'Z');
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

function defaultTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

module.exports = {
  createSystemService,
  parseModelProbeOutput
};
