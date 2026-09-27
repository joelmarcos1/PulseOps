const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');

const createApp = require('../src/app');
const createInMemoryMonitorRepository = require('../test-support/inMemoryMonitorRepository');

async function startTestServer(t) {
  const app = createApp({
    monitorRepository: createInMemoryMonitorRepository(),
    allowedHosts: ['example.com'],
  });
  const server = app.listen(0);
  await once(server, 'listening');

  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  }));

  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

test('GET /monitors starts with an empty list', async (t) => {
  const baseUrl = await startTestServer(t);
  const response = await fetch(`${baseUrl}/monitors`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, { monitors: [] });
});

test('POST /monitors creates a monitor that can be listed', async (t) => {
  const baseUrl = await startTestServer(t);
  const createResponse = await fetch(`${baseUrl}/monitors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Example',
      url: 'https://example.com',
    }),
  });
  const createdMonitor = await createResponse.json();

  assert.equal(createResponse.status, 201);
  assert.equal(createResponse.headers.get('location'), '/monitors/1');
  assert.deepEqual(createdMonitor, {
    id: 1,
    name: 'Example',
    url: 'https://example.com/',
    enabled: true,
    createdAt: createdMonitor.createdAt,
    latestCheck: null,
  });
  assert.equal(Number.isNaN(Date.parse(createdMonitor.createdAt)), false);

  const listResponse = await fetch(`${baseUrl}/monitors`);
  const listBody = await listResponse.json();

  assert.equal(listResponse.status, 200);
  assert.deepEqual(listBody, { monitors: [createdMonitor] });
});

test('POST /monitors rejects an invalid name', async (t) => {
  const baseUrl = await startTestServer(t);
  const response = await fetch(`${baseUrl}/monitors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '', url: 'not-a-url' }),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'INVALID_NAME');
});

test('POST /monitors rejects a non-HTTP URL', async (t) => {
  const baseUrl = await startTestServer(t);
  const response = await fetch(`${baseUrl}/monitors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'FTP server', url: 'ftp://example.com' }),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'INVALID_URL');
});

test('POST /monitors rejects a hostname outside ALLOWED_HOSTS', async (t) => {
  const baseUrl = await startTestServer(t);
  const response = await fetch(`${baseUrl}/monitors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Other', url: 'https://example.org' }),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'INVALID_URL');
  assert.equal(body.error.message, 'URL hostname is not in ALLOWED_HOSTS');
});

test('POST /monitors rejects a duplicated URL', async (t) => {
  const baseUrl = await startTestServer(t);
  const request = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Example', url: 'https://example.com' }),
  };

  await fetch(`${baseUrl}/monitors`, request);
  const duplicateResponse = await fetch(`${baseUrl}/monitors`, request);
  const body = await duplicateResponse.json();

  assert.equal(duplicateResponse.status, 409);
  assert.equal(body.error.code, 'MONITOR_ALREADY_EXISTS');
});
