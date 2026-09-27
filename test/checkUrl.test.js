const assert = require('node:assert/strict');
const test = require('node:test');

const checkUrl = require('../src/checkUrl');

test('checkUrl marks HTTP 204 as UP', async () => {
  const fakeFetch = async () => new Response(null, { status: 204 });
  const result = await checkUrl('https://example.com/', 5000, fakeFetch);

  assert.equal(result.status, 'UP');
  assert.equal(result.httpStatus, 204);
  assert.equal(typeof result.latencyMs, 'number');
  assert.equal(result.errorType, null);
});

test('checkUrl marks HTTP 503 as DOWN', async () => {
  const fakeFetch = async () => new Response(null, { status: 503 });
  const result = await checkUrl('https://example.com/', 5000, fakeFetch);

  assert.equal(result.status, 'DOWN');
  assert.equal(result.httpStatus, 503);
  assert.equal(typeof result.latencyMs, 'number');
  assert.equal(result.errorType, null);
});

test('checkUrl distinguishes a timeout from an HTTP response', async () => {
  const fakeFetch = async () => {
    const error = new Error('The operation timed out');
    error.name = 'TimeoutError';
    throw error;
  };
  const result = await checkUrl('https://example.com/', 5000, fakeFetch);

  assert.deepEqual(result, {
    status: 'DOWN',
    httpStatus: null,
    latencyMs: null,
    errorType: 'TIMEOUT',
    errorMessage: 'The operation timed out',
  });
});

test('checkUrl distinguishes a network error from an HTTP response', async () => {
  const fakeFetch = async () => {
    throw new TypeError('fetch failed');
  };
  const result = await checkUrl('https://example.com/', 5000, fakeFetch);

  assert.deepEqual(result, {
    status: 'DOWN',
    httpStatus: null,
    latencyMs: null,
    errorType: 'NETWORK',
    errorMessage: 'fetch failed',
  });
});

