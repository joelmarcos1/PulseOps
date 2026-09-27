function positiveInteger(value, fallback, variableName) {
  const number = Number(value ?? fallback);

  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${variableName} must be a positive integer`);
  }

  return number;
}

function allowedHosts(value) {
  const hosts = (value ?? 'example.com')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);

  if (hosts.length === 0) {
    throw new Error('ALLOWED_HOSTS must contain at least one hostname');
  }

  return hosts;
}

module.exports = {
  port: positiveInteger(process.env.PORT, 8080, 'PORT'),
  databaseUrl: process.env.DATABASE_URL
    ?? 'postgresql://pulseops:pulseops@localhost:5432/pulseops',
  checkIntervalMs: positiveInteger(
    process.env.CHECK_INTERVAL_MS,
    30000,
    'CHECK_INTERVAL_MS',
  ),
  requestTimeoutMs: positiveInteger(
    process.env.REQUEST_TIMEOUT_MS,
    5000,
    'REQUEST_TIMEOUT_MS',
  ),
  allowedHosts: allowedHosts(process.env.ALLOWED_HOSTS),
};

