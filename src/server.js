const config = require('./config');
const createApp = require('./app');
const createDatabasePool = require('./database');
const createMonitorRepository = require('./monitorRepository');

async function main() {
  const pool = createDatabasePool(config.databaseUrl);

  try {
    await pool.query('SELECT 1');
  } catch (error) {
    await pool.end();
    throw error;
  }

  const monitorRepository = createMonitorRepository(pool);
  const app = createApp({
    monitorRepository,
    allowedHosts: config.allowedHosts,
  });

  const server = app.listen(config.port, () => {
    console.log(`PulseOps API listening at http://localhost:${config.port}`);
  });

  async function shutdown() {
    server.close(async () => {
      await pool.end();
    });
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('API failed to start:', error.message);
  process.exitCode = 1;
});

