const path = require('node:path');

const { createApp } = require('./app');

const configPath =
  process.env.OPENCLAW_CONFIG_PATH ||
  '/home/zia-basit/.openclaw/openclaw.json';
const resetSourcePath = process.env.OPENCLAW_RESET_SOURCE_PATH || null;
const auditLogPath = process.env.OPENCLAW_AUDIT_LOG_PATH || null;
const modelProbeScriptPath = process.env.OPENCLAW_MODEL_PROBE_SCRIPT_PATH || null;
const probeResultsPath = process.env.OPENCLAW_PROBE_RESULTS_PATH || null;
const testReportPath = process.env.OPENCLAW_TEST_REPORT_PATH || null;
const allowLiveWrites = process.env.OPENCLAW_ENABLE_LIVE_WRITES === 'true';
const host = process.env.HOST || '127.0.0.1';

const port = Number(process.env.PORT || 3024);

const app = createApp({
  configPath: path.resolve(configPath),
  resetSourcePath: resetSourcePath ? path.resolve(resetSourcePath) : null,
  auditLogPath: auditLogPath ? path.resolve(auditLogPath) : null,
  modelProbeScriptPath: modelProbeScriptPath ? path.resolve(modelProbeScriptPath) : null,
  probeResultsPath: probeResultsPath ? path.resolve(probeResultsPath) : null,
  testReportPath: testReportPath ? path.resolve(testReportPath) : null,
  allowLiveWrites,
  host,
  port
});

app
  .start(port, host)
  .then(() => {
    console.log(`OpenClaw dashboard running at ${app.baseUrl}`);
    console.log(`Using host bind: ${host}`);
    console.log(`Using config path: ${configPath}`);
    if (resetSourcePath) {
      console.log(`Using reset seed path: ${resetSourcePath}`);
    }
    if (auditLogPath) {
      console.log(`Using audit log path: ${auditLogPath}`);
    }
    if (modelProbeScriptPath) {
      console.log(`Using model probe script: ${modelProbeScriptPath}`);
    }
    if (probeResultsPath) {
      console.log(`Using probe results path: ${probeResultsPath}`);
    }
    if (testReportPath) {
      console.log(`Using test report path: ${testReportPath}`);
    }
    console.log(`Live writes enabled: ${allowLiveWrites ? 'yes' : 'no'}`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
