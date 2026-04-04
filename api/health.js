const { loadStaticData, REMOTE_STATIC_BASE_URL } = require('./_lib/vercel-otto');

module.exports = async (_req, res) => {
  try {
    await loadStaticData();
    return res.status(200).json({
      status: 'ok',
      message: 'Vercel backend is ready',
      assetBaseUrl: REMOTE_STATIC_BASE_URL
    });
  } catch (error) {
    return res.status(503).json({
      status: 'error',
      message: error.message
    });
  }
};
