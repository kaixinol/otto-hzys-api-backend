const { generateTextToWav, REMOTE_STATIC_BASE_URL } = require('./_lib/vercel-otto');
const { getRuntimeConfig } = require('../lib/runtime-config');
const { validateApiKeyHeader } = require('../lib/api-security');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const authResult = validateApiKeyHeader(req.headers.authorization);
    if (!authResult.ok) {
      return res.status(authResult.statusCode).json(authResult.body);
    }

    const {
      text,
      isYsdd = true,
      useNonDdbPinyin = true,
      isSliced = false
    } = req.body || {};

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Invalid text parameter' });
    }

    const { maxTextLength } = getRuntimeConfig();
    if (text.length > maxTextLength) {
      return res.status(400).json({ error: `Text too long (max ${maxTextLength} characters)` });
    }

    const { buffer } = await generateTextToWav({
      text,
      isYsdd,
      useNonDdbPinyin,
      isSliced
    });

    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', `attachment; filename="otto-${Date.now()}.wav"`);
    res.setHeader('X-Otto-Asset-Base', REMOTE_STATIC_BASE_URL);
    return res.status(200).send(buffer);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      error: statusCode === 400 ? error.message : 'Internal server error',
      message: error.message || 'Internal server error'
    });
  }
};
