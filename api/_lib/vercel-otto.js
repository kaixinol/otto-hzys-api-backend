const wav = require('node-wav');
const { MPEGDecoder } = require('mpg123-decoder');
const { buildStaticDataContext, textToAudioSequence } = require('../../lib/text-to-audio-sequence');

const REMOTE_STATIC_BASE_URL = (
  process.env.OTTO_HZYS_ASSET_BASE_URL ||
  'https://otto-hzys.huazhiwan.top/static'
).replace(/\/$/, '');

const OUTPUT_SAMPLE_RATE = 44100;
const NON_DDB_SUBDIRS = ['amns', 'ddj', 'dxl', 'hg1', 'hg2', 'hjm', 'hm', 'mb', 'mbo', 'nyyszgr', 'pbb', 'uzi', 'yzd', 'yy'];

let staticDataPromise;
const remoteAudioBufferCache = new Map();
const metadataCache = new Map();
let mp3DecoderPromise;

async function fetchJson(relativePath) {
  const response = await fetch(`${REMOTE_STATIC_BASE_URL}/${relativePath}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${relativePath}: HTTP ${response.status}`);
  }

  return response.json();
}

async function loadStaticData() {
  if (!staticDataPromise) {
    staticDataPromise = (async () => {
      const [tokensData, ysddData, chinglishRaw] = await Promise.all([
        fetchJson('tokens.json'),
        fetchJson('ysdd.json'),
        fetchJson('chinglish.json')
      ]);

      return buildStaticDataContext(tokensData, ysddData, chinglishRaw);
    })().catch((error) => {
      staticDataPromise = null;
      throw error;
    });
  }

  return staticDataPromise;
}

async function fetchRemoteBuffer(relativePath, expectedContentTypePrefix) {
  const cacheKey = relativePath;
  if (!remoteAudioBufferCache.has(cacheKey)) {
    remoteAudioBufferCache.set(cacheKey, (async () => {
      const response = await fetch(`${REMOTE_STATIC_BASE_URL}/${relativePath}`);
      const contentType = response.headers.get('content-type') || '';

      if (!response.ok) {
        throw new Error(`Failed to fetch ${relativePath}: HTTP ${response.status}`);
      }

      if (expectedContentTypePrefix && !contentType.startsWith(expectedContentTypePrefix)) {
        throw new Error(`Unexpected content type for ${relativePath}: ${contentType || 'unknown'}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    })().catch((error) => {
      remoteAudioBufferCache.delete(cacheKey);
      throw error;
    }));
  }

  return remoteAudioBufferCache.get(cacheKey);
}

async function loadSubdirMetadata(subdir) {
  if (!metadataCache.has(subdir)) {
    metadataCache.set(subdir, (async () => {
      try {
        const metadata = await fetchJson(`tokens/${subdir}/metadata.json`);
        return metadata
          .map((entry) => entry.filename)
          .filter((filename) => typeof filename === 'string' && filename !== 'MISSING');
      } catch (error) {
        return [];
      }
    })());
  }

  return metadataCache.get(subdir);
}

async function getRemoteAudioCandidates(token, useNonDdbPinyin) {
  if (/<.+>/.test(token)) {
    const filename = token.replace(/<(.+)>/, '$1');
    return [`ysddTokens/${filename}.mp3`];
  }

  const directTokenPath = `tokens/${token}.wav`;
  if (!useNonDdbPinyin) {
    return [directTokenPath];
  }

  const metadataLists = await Promise.all(
    NON_DDB_SUBDIRS.map(async (subdir) => ({
      subdir,
      files: (await loadSubdirMetadata(subdir)).filter((filename) => filename.startsWith(`${token}_`) && filename.endsWith('.wav'))
    }))
  );

  const availableSubdirs = metadataLists.filter((entry) => entry.files.length > 0);
  if (availableSubdirs.length === 0) {
    return [directTokenPath];
  }

  const totalOptions = availableSubdirs.length + 1;
  const randomChoice = Math.floor(Math.random() * totalOptions);

  if (randomChoice === availableSubdirs.length) {
    return [directTokenPath];
  }

  const selectedOption = availableSubdirs[randomChoice];
  const randomFile = selectedOption.files[Math.floor(Math.random() * selectedOption.files.length)];
  return [`tokens/${selectedOption.subdir}/${randomFile}`, directTokenPath];
}

async function getAudioBufferForToken(token, useNonDdbPinyin) {
  const candidates = await getRemoteAudioCandidates(token, useNonDdbPinyin);
  let lastError;

  for (const relativePath of candidates) {
    const expectedContentTypePrefix = relativePath.endsWith('.mp3') ? 'audio/' : 'audio/';
    try {
      return {
        buffer: await fetchRemoteBuffer(relativePath, expectedContentTypePrefix),
        extension: relativePath.endsWith('.mp3') ? '.mp3' : '.wav'
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    buffer: await fetchRemoteBuffer('tokens/_.wav', 'audio/'),
    extension: '.wav',
    fallbackError: lastError
  };
}

async function getMp3Decoder() {
  if (!mp3DecoderPromise) {
    mp3DecoderPromise = (async () => {
      const decoder = new MPEGDecoder();
      await decoder.ready;
      return decoder;
    })().catch((error) => {
      mp3DecoderPromise = null;
      throw error;
    });
  }

  return mp3DecoderPromise;
}

function mixToMono(channelData) {
  if (!channelData || channelData.length === 0) {
    return new Float32Array(0);
  }

  if (channelData.length === 1) {
    return channelData[0];
  }

  const output = new Float32Array(channelData[0].length);
  for (let i = 0; i < output.length; i += 1) {
    let sum = 0;
    for (const channel of channelData) {
      sum += channel[i] || 0;
    }
    output[i] = sum / channelData.length;
  }
  return output;
}

function resampleLinear(input, sourceRate, targetRate) {
  if (sourceRate === targetRate || input.length === 0) {
    return input;
  }

  const outputLength = Math.max(1, Math.round(input.length * targetRate / sourceRate));
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / targetRate;

  for (let i = 0; i < outputLength; i += 1) {
    const sourceIndex = i * ratio;
    const leftIndex = Math.floor(sourceIndex);
    const rightIndex = Math.min(leftIndex + 1, input.length - 1);
    const weight = sourceIndex - leftIndex;
    output[i] = input[leftIndex] * (1 - weight) + input[rightIndex] * weight;
  }

  return output;
}

async function decodeAudioBuffer(buffer, extension) {
  if (extension === '.wav') {
    return wav.decode(buffer);
  }

  if (extension === '.mp3') {
    const decoder = await getMp3Decoder();
    const decoded = decoder.decode(new Uint8Array(buffer));
    return {
      sampleRate: decoded.sampleRate,
      channelData: decoded.channelData
    };
  }

  throw new Error(`Unsupported audio extension: ${extension}`);
}

async function renderSequenceToWavBuffer(sequence, useNonDdbPinyin) {
  const decodedParts = await Promise.all(
    sequence.map(async (token) => {
      const audioFile = await getAudioBufferForToken(token, useNonDdbPinyin);
      const decoded = await decodeAudioBuffer(audioFile.buffer, audioFile.extension);
      const mono = mixToMono(decoded.channelData);
      return resampleLinear(mono, decoded.sampleRate, OUTPUT_SAMPLE_RATE);
    })
  );

  const totalSamples = decodedParts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Float32Array(totalSamples);

  let offset = 0;
  for (const part of decodedParts) {
    merged.set(part, offset);
    offset += part.length;
  }

  return Buffer.from(
    wav.encode([merged], {
      sampleRate: OUTPUT_SAMPLE_RATE,
      float: false,
      bitDepth: 16
    })
  );
}

async function generateTextToWav({ text, isYsdd = true, useNonDdbPinyin = true, isSliced = false }) {
  const staticData = await loadStaticData();
  const audioSequence = textToAudioSequence(text, staticData, { isYsdd, isSliced });

  if (audioSequence.length === 0) {
    const error = new Error('No valid audio sequence generated');
    error.statusCode = 400;
    throw error;
  }

  const buffer = await renderSequenceToWavBuffer(audioSequence, useNonDdbPinyin);
  return { buffer, audioSequence };
}

module.exports = {
  generateTextToWav,
  loadStaticData,
  REMOTE_STATIC_BASE_URL
};
