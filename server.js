const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { buildStaticDataContext, textToAudioSequence } = require('./lib/text-to-audio-sequence');
const { getRuntimeConfig } = require('./lib/runtime-config');
const { validateApiKeyHeader } = require('./lib/api-security');
const remoteAudio = require('./lib/remote-audio');
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '10mb' }));

// Load static data files
let subdirFileMap;
let tokenSet, ysddSource, ysddDict, tonedChinglish, ysddLastWordLengthIndex;
let staticRoot;
let tokensRoot;
let ysddTokensRoot;

// In-memory cache for local audio file buffers. Enabled by default via OTTO_HZYS_CACHE_AUDIO.
const localAudioBufferCache = new Map();

const runtimeConfig = getRuntimeConfig();
const { cacheAudio } = runtimeConfig;

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    return false;
  }
}

async function resolveStaticRoot() {
  const candidate = path.join(__dirname, 'submod', 'public', 'static');
  if (await pathExists(path.join(candidate, 'tokens.json'))) {
    return candidate;
  }

  throw new Error('Could not locate static assets in submod/public/static. Run `git submodule update --init --recursive` first, or set OTTO_HZYS_ASSET_BASE_URL to use remote assets.');
}

async function loadLocalStaticData() {
  staticRoot = await resolveStaticRoot();
  tokensRoot = path.join(staticRoot, 'tokens');
  ysddTokensRoot = path.join(staticRoot, 'ysddTokens');

  // Load tokens.json
  const tokensPath = path.join(staticRoot, 'tokens.json');
  const tokensContent = await fs.readFile(tokensPath, 'utf8');
  const tokensData = JSON.parse(tokensContent);

  // Load ysdd.json
  const ysddPath = path.join(staticRoot, 'ysdd.json');
  const ysddContent = await fs.readFile(ysddPath, 'utf8');
  const ysddData = JSON.parse(ysddContent);

  // Load chinglish.json
  const chinglishPath = path.join(staticRoot, 'chinglish.json');
  const chinglishContent = await fs.readFile(chinglishPath, 'utf8');
  const chinglishRaw = JSON.parse(chinglishContent);

  ({
    tokenSet,
    ysddSource,
    ysddDict,
    ysddLastWordLengthIndex,
    tonedChinglish
  } = buildStaticDataContext(tokensData, ysddData, chinglishRaw));

  // Build subdirFileMap for non-ddb pinyin
  subdirFileMap = new Map();
  const subdirs = remoteAudio.NON_DDB_SUBDIRS;

  for (const subdir of subdirs) {
    try {
      const subdirPath = path.join(tokensRoot, subdir);
      const files = await fs.readdir(subdirPath);
      const wavFiles = files.filter(file => file.endsWith('.wav'));
      subdirFileMap.set(subdir, wavFiles);
    } catch (err) {
      // Subdirectory might not exist, that's fine
      subdirFileMap.set(subdir, []);
    }
  }

  console.log(`Static data loaded successfully from ${staticRoot}`);
}

async function loadStaticData() {
  if (runtimeConfig.remoteMode) {
    console.log(`Remote mode enabled. Loading static data from ${runtimeConfig.assetBaseUrl}`);
    const staticData = await remoteAudio.loadStaticData(runtimeConfig.assetBaseUrl);
    ({
      tokenSet,
      ysddSource,
      ysddDict,
      ysddLastWordLengthIndex,
      tonedChinglish
    } = staticData);
    console.log('Remote static data loaded successfully');
    return;
  }

  await loadLocalStaticData();
}

async function checkFfmpegAvailability() {
  if (runtimeConfig.remoteMode) {
    console.log('Remote mode: ffmpeg check skipped (using pure JS audio decoding)');
    return;
  }

  console.log('Local mode: using pure JS audio decoding (ffmpeg not required)');
}

// Helper function to get audio file path based on useNonDdbPinyin setting (local mode only)
function getAudioFilePath(token, useNonDdbPinyin = false) {
  // If it's an original sound track (<filename>), always use ysddTokens directory
  if (/<.+>/.test(token)) {
    const filename = token.replace(/<(.+)>/, '$1');
    return path.join(ysddTokensRoot, `${filename}.mp3`);
  }

  // For regular tokens
  const baseTokensPath = tokensRoot;

  // If useNonDdbPinyin is false, use direct tokens directory
  if (!useNonDdbPinyin) {
    return path.join(baseTokensPath, `${token}.wav`);
  }

  // If useNonDdbPinyin is true, implement random selection logic
  const subdirs = remoteAudio.NON_DDB_SUBDIRS;
  const availableSubdirs = [];

  // Check which subdirectories contain this token
  for (const subdir of subdirs) {
    const files = subdirFileMap.get(subdir) || [];
    const matchingFiles = files.filter(file => file.startsWith(token + '_') && file.endsWith('.wav'));
    if (matchingFiles.length > 0) {
      availableSubdirs.push({ subdir, files: matchingFiles });
    }
  }

  // If no subdirectories have this token, fall back to direct tokens directory
  if (availableSubdirs.length === 0) {
    return path.join(baseTokensPath, `${token}.wav`);
  }

  // Randomly choose between subdirectories and direct tokens directory
  // Total options = available subdirectories + 1 (for direct tokens)
  const totalOptions = availableSubdirs.length + 1;
  const randomChoice = Math.floor(Math.random() * totalOptions);

  // If random choice is the last option, use direct tokens directory
  if (randomChoice === availableSubdirs.length) {
    return path.join(baseTokensPath, `${token}.wav`);
  }

  // Otherwise, use the selected subdirectory
  const selectedOption = availableSubdirs[randomChoice];
  const randomFile = selectedOption.files[Math.floor(Math.random() * selectedOption.files.length)];
  return path.join(baseTokensPath, selectedOption.subdir, randomFile);
}

async function resolveAudioFilePath(filePath) {
  try {
    await fs.access(filePath);
    return filePath;
  } catch (error) {
    console.warn(`Audio file not found: ${filePath}`);
    return path.join(tokensRoot, '_.wav');
  }
}

async function readAudioFile(filePath) {
  if (!cacheAudio) {
    return fs.readFile(filePath);
  }

  if (localAudioBufferCache.has(filePath)) {
    return localAudioBufferCache.get(filePath);
  }

  const buffer = await fs.readFile(filePath);
  localAudioBufferCache.set(filePath, buffer);
  return buffer;
}

async function concatAudioFilesToWav(filePaths) {
  const audioFiles = await Promise.all(
    filePaths.map(async (filePath) => ({
      buffer: await readAudioFile(filePath),
      extension: path.extname(filePath).toLowerCase()
    }))
  );

  return remoteAudio.renderBuffersToWavBuffer(audioFiles);
}

// Main text-to-wav endpoint
app.post('/api/text-to-wav', async (req, res) => {
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
    } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Invalid text parameter' });
    }

    const { maxTextLength } = getRuntimeConfig();
    if (text.length > maxTextLength) {
      return res.status(400).json({ error: `Text too long (max ${maxTextLength} characters)` });
    }

    // Convert text to audio sequence
    const audioSequence = textToAudioSequence(text, {
      tokenSet,
      ysddSource,
      ysddDict,
      ysddLastWordLengthIndex,
      tonedChinglish
    }, { isYsdd, isSliced });

    if (audioSequence.length === 0) {
      return res.status(400).json({ error: 'No valid audio sequence generated' });
    }

    let resultBuffer;

    if (runtimeConfig.remoteMode) {
      // Remote mode: fetch audio via HTTP and mix with pure JS
      resultBuffer = await remoteAudio.renderSequenceToWavBuffer(
        audioSequence, useNonDdbPinyin, runtimeConfig.assetBaseUrl
      );
    } else {
      // Local mode: resolve local files and concatenate with pure JS
      const audioFilePaths = [];
      for (const item of audioSequence) {
        const filePath = getAudioFilePath(item, useNonDdbPinyin);
        audioFilePaths.push(await resolveAudioFilePath(filePath));
      }

      if (audioFilePaths.length === 0) {
        return res.status(400).json({ error: 'No audio files found' });
      }

      resultBuffer = await concatAudioFilesToWav(audioFilePaths);
    }

    // Set response headers
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', `attachment; filename="otto-${Date.now()}.wav"`);

    res.send(resultBuffer);

  } catch (error) {
    console.error('Text-to-WAV error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Internal server error'
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  const { authEnabled, maxTextLength, assetBaseUrl, remoteMode } = getRuntimeConfig();
  const response = {
    status: 'ok',
    message: 'Backend server is running',
    authEnabled,
    maxTextLength,
    remoteMode
  };
  if (remoteMode) {
    response.assetBaseUrl = assetBaseUrl;
  }
  res.json(response);
});

// Catch-all route for non-API requests - return JSON error instead of HTML
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'This backend server only provides API endpoints. Valid endpoints: POST /api/text-to-wav, GET /health'
  });
});

// Start server
async function startServer() {
  try {
    await loadStaticData();
    await checkFfmpegAvailability();
    app.listen(port, () => {
      console.log(`Backend server running at http://localhost:${port}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully');
  process.exit(0);
});

startServer();
