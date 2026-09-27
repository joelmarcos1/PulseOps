class UrlValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UrlValidationError';
  }
}

function normalizeAllowedUrl(rawUrl, allowedHosts) {
  if (typeof rawUrl !== 'string') {
    throw new UrlValidationError('URL must be text');
  }

  const trimmedUrl = rawUrl.trim();
  if (trimmedUrl.length < 1 || trimmedUrl.length > 2048) {
    throw new UrlValidationError('URL must contain between 1 and 2048 characters');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    throw new UrlValidationError('URL must be valid');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new UrlValidationError('URL must use HTTP or HTTPS');
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new UrlValidationError('URL must not include credentials');
  }

  if (!allowedHosts.includes(parsedUrl.hostname.toLowerCase())) {
    throw new UrlValidationError('URL hostname is not in ALLOWED_HOSTS');
  }

  return parsedUrl.toString();
}

module.exports = {
  UrlValidationError,
  normalizeAllowedUrl,
};

