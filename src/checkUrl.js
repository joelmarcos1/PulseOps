async function checkUrl(url, timeoutMs, fetchFunction = fetch) {
  const startedAt = performance.now();

  try {
    const response = await fetchFunction(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Math.round(performance.now() - startedAt);

    if (response.body) {
      await response.body.cancel();
    }

    return {
      status: response.status >= 200 && response.status <= 399 ? 'UP' : 'DOWN',
      httpStatus: response.status,
      latencyMs,
      errorType: null,
      errorMessage: null,
    };
  } catch (error) {
    const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';

    return {
      status: 'DOWN',
      httpStatus: null,
      latencyMs: null,
      errorType: timedOut ? 'TIMEOUT' : 'NETWORK',
      errorMessage: error.message,
    };
  }
}

module.exports = checkUrl;

