const path = require('path');
const fs = require('fs').promises;
const { buildStaticDataContext, textToAudioSequence } = require('../../lib/text-to-audio-sequence');
const { renderSequenceToWavBuffer } = require('../../lib/remote-audio');

// Vercel 版本始終使用純 JS 音頻處理，不自建子進程調用 ffmpeg。
// 素材優先從環境變量設置的地址拉取；未設置時根據當前請求的 host 動態構造 base URL。
const USE_REMOTE_MODE = true;

const STATIC_ROOT = path.join(process.cwd(), 'submod', 'public', 'static');
const TOKENS_ROOT = path.join(STATIC_ROOT, 'tokens');
const NON_DDB_SUBDIRS = ['amns', 'ddj', 'dxl', 'hg1', 'hg2', 'hjm', 'hm', 'mb', 'mbo', 'nyyszgr', 'pbb', 'uzi', 'yzd', 'yy'];

let staticDataPromise;
let staticData;
let subdirFileMap;

function getRemoteStaticBaseUrl(req) {
  const envBaseUrl = (process.env.OTTO_HZYS_ASSET_BASE_URL || '').replace(/\/$/, '');
  if (envBaseUrl) {
    return envBaseUrl;
  }
  const protocol = (req?.headers?.['x-forwarded-proto'] || 'https').replace(/\/$/, '');
  const host = (req?.headers?.host || 'otto-hzys-api-backend.vercel.app').replace(/\/$/, '');
  return `${protocol}://${host}/submod/public/static`;
}

async function loadStaticData() {
  if (!staticDataPromise) {
    staticDataPromise = (async () => {
      const [tokensData, ysddData, chinglishData] = await Promise.all([
        fs.readFile(path.join(STATIC_ROOT, 'tokens.json'), 'utf8').then(JSON.parse),
        fs.readFile(path.join(STATIC_ROOT, 'ysdd.json'), 'utf8').then(JSON.parse),
        fs.readFile(path.join(STATIC_ROOT, 'chinglish.json'), 'utf8').then(JSON.parse)
      ]);
      staticData = buildStaticDataContext(tokensData, ysddData, chinglishData);

      // 构建 subdirFileMap
      subdirFileMap = new Map();
      for (const subdir of NON_DDB_SUBDIRS) {
        try {
          const files = await fs.readdir(path.join(TOKENS_ROOT, subdir));
          subdirFileMap.set(subdir, files.filter(f => f.endsWith('.wav')));
        } catch (_err) {
          subdirFileMap.set(subdir, []);
        }
      }
      return staticData;
    })().catch((error) => {
      staticDataPromise = null;
      throw error;
    });
  }
  return staticDataPromise;
}

async function generateTextToWav(req, { text, isYsdd = true, useNonDdbPinyin = true, isSliced = false }) {
  await loadStaticData();
  const audioSequence = textToAudioSequence(text, staticData, { isYsdd, isSliced });

  if (audioSequence.length === 0) {
    const error = new Error('No valid audio sequence generated');
    error.statusCode = 400;
    throw error;
  }

  const remoteStaticBaseUrl = getRemoteStaticBaseUrl(req);
  const buffer = await renderSequenceToWavBuffer(audioSequence, useNonDdbPinyin, remoteStaticBaseUrl);
  return { buffer, audioSequence, remoteStaticBaseUrl };
}

module.exports = {
  generateTextToWav,
  loadStaticData,
  getRemoteStaticBaseUrl,
  USE_REMOTE_MODE
};
