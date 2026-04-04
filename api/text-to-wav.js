const { generateTextToWav, REMOTE_STATIC_BASE_URL } = require('./_lib/vercel-otto');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const {
      text,
      isYsdd = true,
      useNonDdbPinyin = true,
      isSliced = false
    } = req.body || {};

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Invalid text parameter' });
    }

    if (text.length > 1000) {
      return res.status(400).json({ error: 'Text too long (max 1000 characters)' });
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
