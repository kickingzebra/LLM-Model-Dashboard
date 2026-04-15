const path = require('node:path');

const { createApp } = require('./app');

const configPath =
  process.env.OPENCLAW_CONFIG_PATH ||
  '/home/zia-basit/.openclaw/openclaw.json';
const resetSourcePath = process.env.OPENCLAW_RESET_SOURCE_PATH || null;
const sandboxConfigPath = process.env.OPENCLAW_SANDBOX_CONFIG_PATH || configPath;
const sandboxResetSourcePath = process.env.OPENCLAW_SANDBOX_RESET_SOURCE_PATH || resetSourcePath;
const liveConfigPath = process.env.OPENCLAW_LIVE_CONFIG_PATH || null;
const liveResetSourcePath = process.env.OPENCLAW_LIVE_RESET_SOURCE_PATH || null;
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
  sandboxConfigPath: sandboxConfigPath ? path.resolve(sandboxConfigPath) : null,
  sandboxResetSourcePath: sandboxResetSourcePath ? path.resolve(sandboxResetSourcePath) : null,
  liveConfigPath: liveConfigPath ? path.resolve(liveConfigPath) : null,
  liveResetSourcePath: liveResetSourcePath ? path.resolve(liveResetSourcePath) : null,
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
    console.log(`Using sandbox config path: ${sandboxConfigPath}`);
    if (liveConfigPath) {
      console.log(`Using live config path: ${liveConfigPath}`);
    }
    if (resetSourcePath) {
      console.log(`Using reset seed path: ${resetSourcePath}`);
    }
    if (sandboxResetSourcePath) {
      console.log(`Using sandbox reset seed path: ${sandboxResetSourcePath}`);
    }
    if (liveResetSourcePath) {
      console.log(`Using live reset seed path: ${liveResetSourcePath}`);
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
