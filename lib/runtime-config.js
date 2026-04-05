const DEFAULT_MAX_TEXT_LENGTH = 1000;

function parseMaxTextLength(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return DEFAULT_MAX_TEXT_LENGTH;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return DEFAULT_MAX_TEXT_LENGTH;
  }

  return parsedValue;
}

function getRuntimeConfig() {
  const apiKey = typeof process.env.OTTO_HZYS_API_KEY === 'string'
    ? process.env.OTTO_HZYS_API_KEY.trim()
    : '';

  return {
    apiKey,
    authEnabled: apiKey.length > 0,
    maxTextLength: parseMaxTextLength(process.env.OTTO_HZYS_MAX_TEXT_LENGTH)
  };
}

module.exports = {
  DEFAULT_MAX_TEXT_LENGTH,
  getRuntimeConfig
};
