const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const { buildStaticDataContext, textToAudioSequence } = require('../../lib/text-to-audio-sequence');
const { loadStaticData: loadRemoteStaticData, renderSequenceToWavBuffer } = require('../../lib/remote-audio');

// 只有显式设置 OTTO_HZYS_ASSET_BASE_URL 时才启用远程模式
const REMOTE_STATIC_BASE_URL = (process.env.OTTO_HZYS_ASSET_BASE_URL || '').replace(/\/$/, '');
const USE_REMOTE_MODE = REMOTE_STATIC_BASE_URL.length > 0;

const STATIC_ROOT = path.join(process.cwd(), 'submod', 'public', 'static');
const TOKENS_ROOT = path.join(STATIC_ROOT, 'tokens');
const YSDD_TOKENS_ROOT = path.join(STATIC_ROOT, 'ysddTokens');
const NON_DDB_SUBDIRS = ['amns', 'ddj', 'dxl', 'hg1', 'hg2', 'hjm', 'hm', 'mb', 'mbo', 'nyyszgr', 'pbb', 'uzi', 'yzd', 'yy'];

let staticDataPromise;
let staticData;
let subdirFileMap;

async function loadStaticData() {
  if (!staticDataPromise) {
    staticDataPromise = (async () => {
      if (USE_REMOTE_MODE) {
        staticData = await loadRemoteStaticData(REMOTE_STATIC_BASE_URL);
      } else {
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
      }
      return staticData;
    })().catch((error) => {
      staticDataPromise = null;
      throw error;
    });
  }
  return staticDataPromise;
}

function getLocalAudioFilePath(token, useNonDdbPinyin) {
  if (/<.+>/.test(token)) {
    const filename = token.replace(/<(.+)>/, '$1');
    return path.join(YSDD_TOKENS_ROOT, `${filename}.mp3`);
  }
  if (!useNonDdbPinyin) {
    return path.join(TOKENS_ROOT, `${token}.wav`);
  }
  const availableSubdirs = [];
  for (const subdir of NON_DDB_SUBDIRS) {
    const files = subdirFileMap.get(subdir) || [];
    const matchingFiles = files.filter(f => f.startsWith(`${token}_`) && f.endsWith('.wav'));
    if (matchingFiles.length > 0) {
      availableSubdirs.push({ subdir, files: matchingFiles });
    }
  }
  if (availableSubdirs.length === 0) {
    return path.join(TOKENS_ROOT, `${token}.wav`);
  }
  const totalOptions = availableSubdirs.length + 1;
  const randomChoice = Math.floor(Math.random() * totalOptions);
  if (randomChoice === availableSubdirs.length) {
    return path.join(TOKENS_ROOT, `${token}.wav`);
  }
  const selectedOption = availableSubdirs[randomChoice];
  const randomFile = selectedOption.files[Math.floor(Math.random() * selectedOption.files.length)];
  return path.join(TOKENS_ROOT, selectedOption.subdir, randomFile);
}

async function concatAudioFilesToWav(filePaths) {
  const ffmpegArgs = ['-hide_banner', '-loglevel', 'error'];
  for (const filePath of filePaths) {
    ffmpegArgs.push('-i', path.resolve(filePath));
  }
  const filterInputs = filePaths.map((_, i) => `[${i}:a]`).join('');
  ffmpegArgs.push('-filter_complex', `${filterInputs}concat=n=${filePaths.length}:v=0:a=1[aout]`, '-map', '[aout]', '-ac', '1', '-ar', '44100', '-f', 'wav', 'pipe:1');

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', ffmpegArgs);
    const stdoutChunks = [];
    ffmpeg.stdout.on('data', chunk => stdoutChunks.push(chunk));
    ffmpeg.on('error', reject);
    ffmpeg.on('close', code => {
      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks));
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });
}

async function generateTextToWav({ text, isYsdd = true, useNonDdbPinyin = true, isSliced = false }) {
  await loadStaticData();
  const audioSequence = textToAudioSequence(text, staticData, { isYsdd, isSliced });

  if (audioSequence.length === 0) {
    const error = new Error('No valid audio sequence generated');
    error.statusCode = 400;
    throw error;
  }

  let buffer;
  if (USE_REMOTE_MODE) {
    buffer = await renderSequenceToWavBuffer(audioSequence, useNonDdbPinyin, REMOTE_STATIC_BASE_URL);
  } else {
    const audioFilePaths = audioSequence.map(item => getLocalAudioFilePath(item, useNonDdbPinyin));
    buffer = await concatAudioFilesToWav(audioFilePaths);
  }

  return { buffer, audioSequence };
}

module.exports = {
  generateTextToWav,
  loadStaticData,
  REMOTE_STATIC_BASE_URL,
  USE_REMOTE_MODE
};
