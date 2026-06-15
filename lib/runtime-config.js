const DEFAULT_MAX_TEXT_LENGTH = 1000;
const DEFAULT_REMOTE_ASSET_BASE_URL = 'https://otto-hzys-api-backend.vercel.app/submod/public/static';

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

  // 只有显式设置 OTTO_HZYS_ASSET_BASE_URL 时才启用远程模式
  const assetBaseUrlRaw = process.env.OTTO_HZYS_ASSET_BASE_URL;
  const remoteMode = assetBaseUrlRaw !== undefined;
  const assetBaseUrl = (assetBaseUrlRaw || DEFAULT_REMOTE_ASSET_BASE_URL).replace(/\/$/, '');

  return {
    apiKey,
    authEnabled: apiKey.length > 0,
    maxTextLength: parseMaxTextLength(process.env.OTTO_HZYS_MAX_TEXT_LENGTH),
    assetBaseUrl,
    remoteMode
  };
}

module.exports = {
  DEFAULT_MAX_TEXT_LENGTH,
  DEFAULT_REMOTE_ASSET_BASE_URL,
  getRuntimeConfig
};
