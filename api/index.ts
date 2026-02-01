// Vercel Serverless Function - wraps Express app

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { config } from 'dotenv';

// Load env vars
config();

import { createDittoClient } from '../src/ditto-client.js';
import { createSunoClient } from '../src/suno-client.js';
import { setArtistWallet, getArtistWallet } from '../src/wallet-service.js';
import sharp from 'sharp';

// Initialize clients
const dittoClient = createDittoClient();
const sunoClient = createSunoClient();

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

// Error handler wrapper
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) => 
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// Root
app.get('/', (req, res) => {
  res.json({
    name: 'Distro API',
    version: '1.0.0',
    status: 'ok',
    services: { ditto: !!dittoClient, suno: !!sunoClient },
  });
});

// Health
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    services: { ditto: !!dittoClient, suno: !!sunoClient },
    timestamp: new Date().toISOString(),
  });
});

// Create artist
app.post('/api/artist', asyncHandler(async (req, res) => {
  if (!dittoClient) return res.status(503).json({ error: 'Ditto not configured' });
  const { name, genres } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const result = await dittoClient.createArtist(name, genres);
  res.json({ success: true, artist: result });
}));

// List artists
app.get('/api/artists', asyncHandler(async (req, res) => {
  if (!dittoClient) return res.status(503).json({ error: 'Ditto not configured' });
  const result = await dittoClient.getArtists();
  const artists = Array.isArray(result) ? result : (result['hydra:member'] || []);
  res.json({ success: true, artists, count: artists.length });
}));

// Create release
app.post('/api/release', asyncHandler(async (req, res) => {
  if (!dittoClient) return res.status(503).json({ error: 'Ditto not configured' });
  const { artistId, title, releaseDate, copyrightHolder, copyrightYear } = req.body;
  if (!artistId || !title || !releaseDate) {
    return res.status(400).json({ error: 'artistId, title, releaseDate required' });
  }
  const artistIri = artistId.toString().startsWith('/api/') ? artistId : `/api/me/artists/${artistId}`;
  const result = await dittoClient.createRelease({
    title, artistId: artistIri, releaseDate,
    copyrightLine: copyrightHolder, copyrightYear,
  });
  res.json({ success: true, release: result });
}));

// Get release
app.get('/api/release/:id', asyncHandler(async (req, res) => {
  if (!dittoClient) return res.status(503).json({ error: 'Ditto not configured' });
  const result = await dittoClient.getRelease(req.params.id as string);
  res.json({ success: true, release: result });
}));

// List releases
app.get('/api/releases', asyncHandler(async (req, res) => {
  if (!dittoClient) return res.status(503).json({ error: 'Ditto not configured' });
  const result = await dittoClient.getReleases();
  const releases = Array.isArray(result) ? result : (result['hydra:member'] || []);
  res.json({ success: true, releases, count: releases.length });
}));

// Generate music
app.post('/api/generate', asyncHandler(async (req, res) => {
  if (!sunoClient) return res.status(503).json({ error: 'Suno not configured' });
  const { prompt, style, lyrics, title, instrumental } = req.body;
  if (!prompt && !lyrics) return res.status(400).json({ error: 'prompt or lyrics required' });
  
  const task = await sunoClient.generateMusic({
    prompt: prompt || style || 'pop', style, lyrics, title, instrumental,
  });
  const result = await sunoClient.waitForCompletion(task.taskId);
  
  res.json({
    success: true,
    taskId: task.taskId,
    tracks: result.tracks?.map(t => ({
      id: t.id, title: t.title, audioUrl: t.audioUrl,
      streamUrl: t.streamAudioUrl, imageUrl: t.imageUrl, duration: t.duration,
    })),
  });
}));

// Upload track
app.post('/api/upload-track', asyncHandler(async (req, res) => {
  if (!dittoClient) return res.status(503).json({ error: 'Ditto not configured' });
  const { releaseId, title, audioUrl } = req.body;
  if (!releaseId || !title || !audioUrl) {
    return res.status(400).json({ error: 'releaseId, title, audioUrl required' });
  }
  
  const audioUrlLower = audioUrl.toLowerCase();
  if (!audioUrlLower.endsWith('.mp3') && !audioUrlLower.endsWith('.wav')) {
    return res.status(400).json({ error: 'Audio must be MP3 or WAV' });
  }
  
  const releaseIdMatch = releaseId.toString().match(/\/(\d+)$/) || releaseId.toString().match(/^(\d+)$/);
  const cleanId = releaseIdMatch ? releaseIdMatch[1] : releaseId;
  const ext = audioUrlLower.endsWith('.wav') ? 'wav' : 'mp3';
  
  const result = await dittoClient.createTrackWithAudio(cleanId, audioUrl, `${title.replace(/[^a-zA-Z0-9]/g, '_')}.${ext}`);
  res.json({ success: true, track: result });
}));

// Upload artwork
app.post('/api/upload-artwork', asyncHandler(async (req, res) => {
  if (!dittoClient) return res.status(503).json({ error: 'Ditto not configured' });
  const { releaseId, artworkInput } = req.body;
  if (!releaseId || !artworkInput) {
    return res.status(400).json({ error: 'releaseId and artworkInput required' });
  }
  
  let imageBuffer: Buffer;
  if (artworkInput.startsWith('data:')) {
    const base64Data = artworkInput.split(',')[1];
    if (!base64Data) return res.status(400).json({ error: 'Invalid base64' });
    imageBuffer = Buffer.from(base64Data, 'base64');
  } else if (artworkInput.startsWith('http')) {
    const response = await fetch(artworkInput);
    if (!response.ok) return res.status(400).json({ error: `Fetch failed: ${response.status}` });
    imageBuffer = Buffer.from(await response.arrayBuffer());
  } else {
    return res.status(400).json({ error: 'artworkInput must be URL or base64' });
  }
  
  const image = sharp(imageBuffer);
  const meta = await image.metadata();
  let processed: Buffer;
  if ((meta.width || 0) < 1400 || (meta.height || 0) < 1400) {
    processed = await image.resize(1400, 1400, { fit: 'cover' }).jpeg({ quality: 95 }).toBuffer();
  } else {
    processed = await image.jpeg({ quality: 95 }).toBuffer();
  }
  
  const result = await dittoClient.uploadArtworkBuffer(releaseId, processed);
  res.json({ success: true, artwork: result });
}));

// Submit to DSPs
app.post('/api/submit', asyncHandler(async (req, res) => {
  if (!dittoClient) return res.status(503).json({ error: 'Ditto not configured' });
  const { releaseId, dsps } = req.body;
  if (!releaseId || !dsps?.length) {
    return res.status(400).json({ error: 'releaseId and dsps array required' });
  }
  
  const storeIds = dsps.map((d: string) => STORE_IDS[d.toLowerCase()]).filter(Boolean);
  if (!storeIds.length) {
    return res.status(400).json({ error: 'No valid DSPs', validDsps: Object.keys(STORE_IDS) });
  }
  
  const result = await dittoClient.submitToStores(releaseId, storeIds);
  res.json({ success: true, result });
}));

// Wallet
app.post('/api/wallet', asyncHandler(async (req, res) => {
  const { artistName, walletAddress } = req.body;
  if (!artistName || !walletAddress) {
    return res.status(400).json({ error: 'artistName and walletAddress required' });
  }
  const result = setArtistWallet(artistName, walletAddress);
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ success: true, artistName, walletAddress });
}));

app.get('/api/wallet/:artistName', asyncHandler(async (req, res) => {
  const wallet = getArtistWallet(req.params.artistName as string);
  res.json({ success: true, artistName: req.params.artistName, walletAddress: wallet });
}));

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('API Error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

export default app;
