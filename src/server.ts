// Distro HTTP API Server

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from 'dotenv';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '..', '.env') });

import { createDittoClient } from './ditto-client.js';
import { createSunoClient } from './suno-client.js';
import { setArtistWallet, getArtistWallet, isValidEthAddress } from './wallet-service.js';
import sharp from 'sharp';

// Initialize clients
const dittoClient = createDittoClient();
const sunoClient = createSunoClient();

if (!dittoClient) {
  console.error('ERROR: Ditto client not configured. Check DITTO_EMAIL and DITTO_PASSWORD in .env');
  process.exit(1);
}

console.log('✓ Ditto client initialized');
if (sunoClient) {
  console.log('✓ Suno client initialized');
} else {
  console.log('⚠ Suno client not configured (SUNO_API_KEY missing)');
}

// Store ID mapping
const STORE_IDS: Record<string, number> = {
  spotify: 2,
  apple_music: 63,
  amazon_music: 104,
  youtube_music: 102,
  tidal: 81,
  tiktok: 100,
  soundcloud: 92,
  deezer: 16,
  pandora: 85,
  instagram: 100,
};

// Create Express app
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Error handler
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) => 
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// ============================================
// Artist Endpoints
// ============================================

/**
 * POST /api/artist - Create artist
 */
app.post('/api/artist', asyncHandler(async (req: Request, res: Response) => {
  const { name, genres } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }
  
  const result = await dittoClient.createArtist(name, genres);
  res.json({
    success: true,
    artist: result,
  });
}));

/**
 * GET /api/artists - List artists
 */
app.get('/api/artists', asyncHandler(async (req: Request, res: Response) => {
  const result = await dittoClient.getArtists();
  const artists = Array.isArray(result) ? result : (result['hydra:member'] || []);
  res.json({
    success: true,
    artists,
    count: artists.length,
  });
}));

// ============================================
// Release Endpoints
// ============================================

/**
 * POST /api/release - Create release
 */
app.post('/api/release', asyncHandler(async (req: Request, res: Response) => {
  const { artistId, title, releaseDate, copyrightHolder, copyrightYear } = req.body;
  
  if (!artistId || !title || !releaseDate) {
    return res.status(400).json({ error: 'artistId, title, and releaseDate are required' });
  }
  
  // Convert artistId to IRI if needed
  const artistIri = artistId.toString().startsWith('/api/') 
    ? artistId 
    : `/api/me/artists/${artistId}`;
  
  console.log('Creating release with:', {
    title,
    artistIri,
    releaseDate,
    copyrightHolder,
    copyrightYear,
  });
  
  const result = await dittoClient.createRelease({
    title,
    artistId: artistIri,
    releaseDate,
    copyrightLine: copyrightHolder,
    copyrightYear,
  });
  
  // Add artist to release via PUT
  const releaseId = result.id;
  const numericArtistId = parseInt(artistId.toString().match(/(\d+)$/)?.[1] || artistId, 10);
  
  try {
    const putResult = await dittoClient.addArtistToRelease(releaseId.toString(), numericArtistId);
    console.log(`[Server] Artist link result:`, JSON.stringify(putResult, null, 2));
  } catch (err: any) {
    console.error('[Server] Failed to add artist to release:', err.message || err);
  }
  
  res.json({
    success: true,
    release: result,
  });
}));

/**
 * GET /api/release/:id - Get release status
 */
app.get('/api/release/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await dittoClient.getRelease(id);
  res.json({
    success: true,
    release: result,
  });
}));

/**
 * GET /api/releases - List releases
 */
app.get('/api/releases', asyncHandler(async (req: Request, res: Response) => {
  const result = await dittoClient.getReleases();
  const releases = Array.isArray(result) ? result : (result['hydra:member'] || []);
  res.json({
    success: true,
    releases,
    count: releases.length,
  });
}));

// ============================================
// Music Generation
// ============================================

/**
 * POST /api/generate - Generate music with Suno
 */
app.post('/api/generate', asyncHandler(async (req: Request, res: Response) => {
  if (!sunoClient) {
    return res.status(503).json({ error: 'Suno client not configured. Set SUNO_API_KEY in .env' });
  }
  
  const { prompt, style, lyrics, title, instrumental } = req.body;
  
  if (!prompt && !lyrics) {
    return res.status(400).json({ error: 'prompt or lyrics is required' });
  }
  
  // Start generation
  const task = await sunoClient.generateMusic({
    prompt: prompt || style || 'pop',
    style,
    lyrics,
    title,
    instrumental,
  });
  
  // Wait for completion
  const result = await sunoClient.waitForCompletion(task.taskId);
  
  res.json({
    success: true,
    taskId: task.taskId,
    tracks: result.tracks?.map(track => ({
      id: track.id,
      title: track.title,
      audioUrl: track.audioUrl,
      streamUrl: track.streamAudioUrl,
      imageUrl: track.imageUrl,
      duration: track.duration,
    })),
  });
}));

// ============================================
// Track Upload
// ============================================

/**
 * POST /api/upload-track - Upload track to release
 */
app.post('/api/upload-track', asyncHandler(async (req: Request, res: Response) => {
  const { releaseId, artistId, title, audioUrl, explicit, language } = req.body;
  
  if (!releaseId || !title || !audioUrl) {
    return res.status(400).json({ error: 'releaseId, title, and audioUrl are required' });
  }
  
  // Check audio format (allow .mp3 or .wav anywhere in URL, not just at end)
  const audioUrlLower = audioUrl.toLowerCase();
  const isMp3 = audioUrlLower.includes('.mp3');
  const isWav = audioUrlLower.includes('.wav');
  if (!isMp3 && !isWav) {
    return res.status(400).json({ error: 'Audio URL must contain .mp3 or .wav' });
  }
  
  // Extract release ID
  const releaseIdMatch = releaseId.toString().match(/\/(\d+)$/) || releaseId.toString().match(/^(\d+)$/);
  const cleanReleaseId = releaseIdMatch ? releaseIdMatch[1] : releaseId;
  
  const fileExt = isWav ? 'wav' : 'mp3';
  
  const result = await dittoClient.createTrackWithAudio(
    cleanReleaseId,
    audioUrl,
    `${title.replace(/[^a-zA-Z0-9]/g, '_')}.${fileExt}`
  );
  
  res.json({
    success: true,
    track: result,
  });
}));

// ============================================
// Artwork Upload
// ============================================

/**
 * POST /api/upload-artwork - Upload artwork to release
 */
app.post('/api/upload-artwork', asyncHandler(async (req: Request, res: Response) => {
  const { releaseId, artworkInput } = req.body;
  
  if (!releaseId || !artworkInput) {
    return res.status(400).json({ error: 'releaseId and artworkInput are required' });
  }
  
  let imageBuffer: Buffer;
  
  // Get image from URL or base64
  if (artworkInput.startsWith('data:')) {
    const base64Data = artworkInput.split(',')[1];
    if (!base64Data) {
      return res.status(400).json({ error: 'Invalid base64 data URI' });
    }
    imageBuffer = Buffer.from(base64Data, 'base64');
  } else if (artworkInput.startsWith('http')) {
    const response = await fetch(artworkInput);
    if (!response.ok) {
      return res.status(400).json({ error: `Failed to fetch image: ${response.status}` });
    }
    const arrayBuffer = await response.arrayBuffer();
    imageBuffer = Buffer.from(arrayBuffer);
  } else {
    return res.status(400).json({ error: 'artworkInput must be URL or base64 data URI' });
  }
  
  // Process with sharp - ensure 1400x1400 minimum
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();
  const minSize = 1400;
  
  let processedBuffer: Buffer;
  if ((metadata.width || 0) < minSize || (metadata.height || 0) < minSize) {
    processedBuffer = await image
      .resize(minSize, minSize, { fit: 'cover', position: 'center' })
      .jpeg({ quality: 95 })
      .toBuffer();
  } else {
    processedBuffer = await image.jpeg({ quality: 95 }).toBuffer();
  }
  
  const result = await dittoClient.uploadArtworkBuffer(releaseId, processedBuffer);
  
  res.json({
    success: true,
    artwork: result,
  });
}));

// ============================================
// Submit to DSPs
// ============================================

/**
 * POST /api/submit - Submit release to DSPs
 */
app.post('/api/submit', asyncHandler(async (req: Request, res: Response) => {
  const { releaseId, dsps } = req.body;
  
  if (!releaseId || !dsps || !Array.isArray(dsps)) {
    return res.status(400).json({ error: 'releaseId and dsps array are required' });
  }
  
  // Map DSP names to store IDs
  const storeIds: number[] = [];
  const unknownDsps: string[] = [];
  
  for (const dsp of dsps) {
    const id = STORE_IDS[dsp.toLowerCase()];
    if (id) {
      storeIds.push(id);
    } else {
      unknownDsps.push(dsp);
    }
  }
  
  if (storeIds.length === 0) {
    return res.status(400).json({ 
      error: 'No valid DSPs provided',
      validDsps: Object.keys(STORE_IDS),
      unknownDsps,
    });
  }
  
  const result = await dittoClient.submitToStores(releaseId, storeIds);
  
  res.json({
    success: true,
    submitted: dsps.filter(d => STORE_IDS[d.toLowerCase()]),
    unknownDsps: unknownDsps.length > 0 ? unknownDsps : undefined,
    result,
  });
}));

// ============================================
// Wallet Endpoints
// ============================================

/**
 * POST /api/wallet - Set artist wallet
 */
app.post('/api/wallet', asyncHandler(async (req: Request, res: Response) => {
  const { artistName, walletAddress } = req.body;
  
  if (!artistName || !walletAddress) {
    return res.status(400).json({ error: 'artistName and walletAddress are required' });
  }
  
  const result = setArtistWallet(artistName, walletAddress);
  
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  
  res.json({
    success: true,
    artistName,
    walletAddress,
  });
}));

/**
 * GET /api/wallet/:artistName - Get artist wallet
 */
app.get('/api/wallet/:artistName', asyncHandler(async (req: Request, res: Response) => {
  const artistName = req.params.artistName as string;
  const wallet = getArtistWallet(artistName);
  
  res.json({
    success: true,
    artistName,
    walletAddress: wallet,
  });
}));

// ============================================
// Health Check
// ============================================

// Root route
app.get('/', (req: Request, res: Response) => {
  res.json({
    name: 'Distro API',
    version: '1.0.0',
    docs: 'POST /api/artist, /api/release, /api/generate, /api/upload-track, /api/submit',
    health: '/api/health',
  });
});

app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    services: {
      ditto: !!dittoClient,
      suno: !!sunoClient,
    },
    timestamp: new Date().toISOString(),
  });
});

// ============================================
// Error Handler
// ============================================

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('API Error:', err);
  res.status(500).json({
    error: err.message || 'Internal server error',
  });
});

// ============================================
// Start Server (local only, not on Vercel)
// ============================================

const PORT = process.env.PORT || 3000;

// Only start server when running locally (not on Vercel)
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`\n🎵 Distro API Server running on http://localhost:${PORT}`);
    console.log('\nEndpoints:');
    console.log('  POST /api/artist        - Create artist');
    console.log('  GET  /api/artists       - List artists');
    console.log('  POST /api/release       - Create release');
    console.log('  GET  /api/release/:id   - Get release status');
    console.log('  GET  /api/releases      - List releases');
    console.log('  POST /api/generate      - Generate music (Suno)');
    console.log('  POST /api/upload-track  - Upload track');
    console.log('  POST /api/upload-artwork - Upload artwork');
    console.log('  POST /api/submit        - Submit to DSPs');
    console.log('  POST /api/wallet        - Set artist wallet');
    console.log('  GET  /api/wallet/:name  - Get artist wallet');
    console.log('  GET  /api/health        - Health check');
  });
}

// Export for Vercel
export default app;
