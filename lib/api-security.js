const { getRuntimeConfig } = require('./runtime-config');

function getBearerToken(headerValue) {
  if (typeof headerValue !== 'string') {
    return null;
  }

  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function validateApiKeyHeader(headerValue) {
  const { authEnabled, apiKey } = getRuntimeConfig();

  if (!authEnabled) {
    return { ok: true };
  }

  const token = getBearerToken(headerValue);
  if (!token || token !== apiKey) {
    return {
      ok: false,
      statusCode: 401,
      body: {
        error: 'Unauthorized',
        message: 'Missing or invalid bearer token'
      }
    };
  }

  return { ok: true };
}

module.exports = {
  validateApiKeyHeader
};
