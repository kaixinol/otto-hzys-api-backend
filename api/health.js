const { loadStaticData, REMOTE_STATIC_BASE_URL } = require('./_lib/vercel-otto');
const { getRuntimeConfig } = require('../lib/runtime-config');

module.exports = async (_req, res) => {
  try {
    await loadStaticData();
    const { authEnabled, maxTextLength } = getRuntimeConfig();
    return res.status(200).json({
      status: 'ok',
      message: 'Vercel backend is ready',
      assetBaseUrl: REMOTE_STATIC_BASE_URL,
      authEnabled,
      maxTextLength
    });
  } catch (error) {
    return res.status(503).json({
      status: 'error',
      message: error.message
    });
  }
};
