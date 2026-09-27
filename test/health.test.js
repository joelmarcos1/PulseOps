const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');

const createApp = require('../src/app');
const createInMemoryMonitorRepository = require('../test-support/inMemoryMonitorRepository');

test('GET /health returns an OK response', async (t) => {
  const app = createApp({
    monitorRepository: createInMemoryMonitorRepository(),
    allowedHosts: ['example.com'],
  });

  // Port 0 asks the operating system to choose a free port for this test.
  const server = app.listen(0);
  await once(server, 'listening');

  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  }));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, { status: 'ok' });
});
