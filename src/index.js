const path = require('node:path');

const { createApp } = require('./app');

const configPath =
  process.env.OPENCLAW_CONFIG_PATH ||
  '/home/zia-basit/.openclaw/openclaw.json';

const port = Number(process.env.PORT || 3024);

const app = createApp({
  configPath: path.resolve(configPath),
  port
});

app
  .start(port)
  .then(() => {
    console.log(`OpenClaw dashboard running at ${app.baseUrl}`);
    console.log(`Using config path: ${configPath}`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
