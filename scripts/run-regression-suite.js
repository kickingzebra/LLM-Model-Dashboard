const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

async function main() {
  const workspaceDir = path.resolve(__dirname, '..');
  const reportPath =
    process.env.OPENCLAW_TEST_REPORT_PATH ||
    path.join(workspaceDir, 'local-data', 'test-regression-report.json');

  const suites = [];

  try {
    const unit = await runSuite('Unit', process.execPath, ['--test'], workspaceDir);
    suites.push(unit.summary);

    const smoke = await runSuite('Smoke', process.execPath, ['scripts/run-regression.js'], workspaceDir);
    suites.push(smoke.summary);

    const report = buildReport(suites);
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  } catch (error) {
    if (error.suite) {
      suites.push(error.suite);
    }
    const report = buildReport(suites, error);
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    throw error;
  }
}

function buildReport(suites, error = null) {
  const passedCount = suites.reduce((sum, suite) => sum + (suite.status === 'passed' ? 1 : 0), 0);
  const failedCount = suites.reduce((sum, suite) => sum + (suite.status === 'failed' ? 1 : 0), 0) + (error && suites.length === 0 ? 1 : 0);
  return {
    lastRunAt: new Date().toISOString(),
    overallStatus: error || failedCount > 0 ? 'failed' : 'passed',
    suiteCount: suites.length,
    passedCount,
    failedCount,
    suites
  };
}

function runSuite(name, command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: 'inherit'
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({
          summary: {
            name,
            status: 'passed'
          }
        });
        return;
      }

      reject(
        Object.assign(new Error(`${name} regression suite failed with exit code ${code}`), {
          suite: {
            name,
            status: 'failed'
          }
        })
      );
    });

    child.on('error', (error) => {
      reject(
        Object.assign(error, {
          suite: {
            name,
            status: 'failed'
          }
        })
      );
    });
  }).catch((error) => {
    if (error.suite) {
      return Promise.reject(error);
    }
    return Promise.reject(
      Object.assign(error, {
        suite: {
          name,
          status: 'failed'
        }
      })
    );
  });
}

main().catch(async (error) => {
  const workspaceDir = path.resolve(__dirname, '..');
  const reportPath =
    process.env.OPENCLAW_TEST_REPORT_PATH ||
    path.join(workspaceDir, 'local-data', 'test-regression-report.json');
  console.error(error.message);
  process.exitCode = 1;
});
