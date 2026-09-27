const checkUrl = require('./checkUrl');
const config = require('./config');
const createDatabasePool = require('./database');
const createMonitorRepository = require('./monitorRepository');
const { normalizeAllowedUrl } = require('./urlPolicy');

const pool = createDatabasePool(config.databaseUrl);
const monitorRepository = createMonitorRepository(pool);
let stopping = false;
let cancelWait = null;

function wait(milliseconds) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cancelWait = null;
      resolve();
    }, milliseconds);

    cancelWait = () => {
      clearTimeout(timer);
      cancelWait = null;
      resolve();
    };
  });
}

async function runRound() {
  const monitors = await monitorRepository.listEnabled();
  console.log(`Starting check round for ${monitors.length} monitor(s)`);

  for (const monitor of monitors) {
    let check;

    try {
      normalizeAllowedUrl(monitor.url, config.allowedHosts);
      check = await checkUrl(monitor.url, config.requestTimeoutMs);
    } catch (error) {
      check = {
        status: 'DOWN',
        httpStatus: null,
        latencyMs: null,
        errorType: 'DISALLOWED_URL',
        errorMessage: error.message,
      };
    }

    await monitorRepository.saveCheckResult(monitor.id, check);
    console.log(`${monitor.name}: ${check.status}`);
  }
}

async function main() {
  await pool.query('SELECT 1');
  console.log(
    `PulseOps worker started; interval=${config.checkIntervalMs}ms, `
    + `timeout=${config.requestTimeoutMs}ms`,
  );

  while (!stopping) {
    try {
      await runRound();
    } catch (error) {
      console.error('Check round failed:', error.message);
    }

    if (!stopping) {
      await wait(config.checkIntervalMs);
    }
  }

  await pool.end();
}

function requestStop() {
  stopping = true;
  if (cancelWait) cancelWait();
}

process.on('SIGINT', requestStop);
process.on('SIGTERM', requestStop);

main().catch(async (error) => {
  console.error('Worker failed to start:', error.message);
  await pool.end();
  process.exitCode = 1;
});
