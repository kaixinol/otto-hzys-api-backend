const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const { buildStaticDataContext, textToAudioSequence } = require('./lib/text-to-audio-sequence');
const { getRuntimeConfig } = require('./lib/runtime-config');
const { validateApiKeyHeader } = require('./lib/api-security');
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '10mb' }));

// Load static data files
let subdirFileMap;
let tokenSet, ysddSource, ysddDict, tonedChinglish, ysddLastWordLengthIndex;
let ffmpegAvailable = false;
let ffmpegStatusMessage = 'ffmpeg has not been checked yet.';
let staticRoot;
let tokensRoot;
let ysddTokensRoot;

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

  throw new Error('Could not locate static assets in submod/public/static. Run `git submodule update --init --recursive` first.');
}

async function loadStaticData() {
  try {
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
    const subdirs = ['amns', 'ddj', 'dxl', 'hg1', 'hg2', 'hjm', 'hm', 'mb', 'mbo', 'nyyszgr', 'pbb', 'uzi', 'yzd', 'yy'];
    
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
  } catch (error) {
    console.error('Failed to load static data:', error);
    throw error;
  }
}

async function checkFfmpegAvailability() {
  try {
    const versionOutput = await new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', ['-version']);
      const stdoutChunks = [];
      const stderrChunks = [];

      ffmpeg.stdout.on('data', chunk => stdoutChunks.push(chunk));
      ffmpeg.stderr.on('data', chunk => stderrChunks.push(chunk));
      ffmpeg.on('error', reject);
      ffmpeg.on('close', code => {
        if (code === 0) {
          resolve(Buffer.concat(stdoutChunks).toString('utf8'));
          return;
        }

        reject(new Error(Buffer.concat(stderrChunks).toString('utf8') || `ffmpeg exited with code ${code}`));
      });
    });

    const firstLine = versionOutput.split('\n')[0]?.trim() || 'ffmpeg is available';
    ffmpegAvailable = true;
    ffmpegStatusMessage = firstLine;
    console.log(`ffmpeg check passed: ${firstLine}`);
  } catch (error) {
    ffmpegAvailable = false;
    ffmpegStatusMessage = `ffmpeg is required for audio generation but was not found or failed to start: ${error.message}`;
    console.error(`ffmpeg check failed: ${ffmpegStatusMessage}`);
  }
}

// Helper function to get audio file path based on useNonDdbPinyin setting
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
  const subdirs = ['amns', 'ddj', 'dxl', 'hg1', 'hg2', 'hjm', 'hm', 'mb', 'mbo', 'nyyszgr', 'pbb', 'uzi', 'yzd', 'yy'];
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

async function concatAudioFilesToWav(filePaths) {
  const ffmpegArgs = [
    '-hide_banner',
    '-loglevel', 'error'
  ];

  for (const filePath of filePaths) {
    ffmpegArgs.push('-i', path.resolve(filePath));
  }

  const filterInputs = filePaths.map((_, index) => `[${index}:a]`).join('');
  ffmpegArgs.push(
    '-filter_complex',
    `${filterInputs}concat=n=${filePaths.length}:v=0:a=1[aout]`,
    '-map', '[aout]',
    '-ac', '1',
    '-ar', '44100',
    '-f', 'wav',
    'pipe:1'
  );

  const outputBuffer = await new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', ffmpegArgs);

    const stdoutChunks = [];
    const stderrChunks = [];

    ffmpeg.stdout.on('data', chunk => stdoutChunks.push(chunk));
    ffmpeg.stderr.on('data', chunk => stderrChunks.push(chunk));
    ffmpeg.on('error', reject);
    ffmpeg.on('close', code => {
      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks));
        return;
      }

      reject(new Error(`ffmpeg exited with code ${code}: ${Buffer.concat(stderrChunks).toString('utf8')}`));
    });
  });

  return outputBuffer;
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

    if (!ffmpegAvailable) {
      return res.status(503).json({
        error: 'ffmpeg unavailable',
        message: ffmpegStatusMessage
      });
    }

    // Convert text to audio sequence (useNonDdbPinyin doesn't affect sequence generation)
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

    // Resolve all source audio files and let ffmpeg produce a valid single WAV.
    const audioFilePaths = [];
    for (const item of audioSequence) {
      const filePath = getAudioFilePath(item, useNonDdbPinyin);
      audioFilePaths.push(await resolveAudioFilePath(filePath));
    }

    if (audioFilePaths.length === 0) {
      return res.status(400).json({ error: 'No audio files found' });
    }

    const resultBuffer = await concatAudioFilesToWav(audioFilePaths);

    // Set response headers
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', `attachment; filename="otto-${Date.now()}.wav"`);
    
    res.send(resultBuffer);

  } catch (error) {
    console.error('Text-to-WAV error:', error);
    const isFfmpegError = /ffmpeg/i.test(error.message || '');
    res.status(isFfmpegError ? 503 : 500).json({
      error: isFfmpegError ? 'ffmpeg unavailable' : 'Internal server error',
      message: isFfmpegError ? error.message : 'Internal server error'
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  const { authEnabled, maxTextLength } = getRuntimeConfig();
  res.json({
    status: 'ok',
    message: 'Backend server is running',
    authEnabled,
    maxTextLength
  });
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
