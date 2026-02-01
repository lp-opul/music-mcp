// Distro HTTP API Server
import express from 'express';
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
import { setArtistWallet, getArtistWallet } from './wallet-service.js';
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
}
else {
    console.log('⚠ Suno client not configured (SUNO_API_KEY missing)');
}
// Store ID mapping
const STORE_IDS = {
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
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};
// ============================================
// Artist Endpoints
// ============================================
/**
 * POST /api/artist - Create artist
 */
app.post('/api/artist', asyncHandler(async (req, res) => {
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
app.get('/api/artists', asyncHandler(async (req, res) => {
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
app.post('/api/release', asyncHandler(async (req, res) => {
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
    }
    catch (err) {
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
app.get('/api/release/:id', asyncHandler(async (req, res) => {
    const id = req.params.id;
    const result = await dittoClient.getRelease(id);
    res.json({
        success: true,
        release: result,
    });
}));
/**
 * GET /api/releases - List releases
 */
app.get('/api/releases', asyncHandler(async (req, res) => {
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
 * If wait=false, returns immediately with taskId for polling
 */
app.post('/api/generate', asyncHandler(async (req, res) => {
    if (!sunoClient) {
        return res.status(503).json({ error: 'Suno client not configured. Set SUNO_API_KEY in .env' });
    }
    const { prompt, style, lyrics, title, instrumental, wait } = req.body;
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
    // If wait=false, return immediately for async flow
    if (wait === false) {
        return res.json({
            success: true,
            taskId: task.taskId,
            status: 'PENDING',
            message: 'Generation started. Poll /api/generate/status/:taskId for results.',
        });
    }
    // Wait for completion (default behavior)
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
// Cache for downloaded audio (taskId -> base64 audio data)
const audioCache = new Map();
/**
 * GET /api/generate/status/:taskId - Check generation status
 */
app.get('/api/generate/status/:taskId', asyncHandler(async (req, res) => {
    if (!sunoClient) {
        return res.status(503).json({ error: 'Suno client not configured' });
    }
    const taskId = req.params.taskId;
    // Check if we already cached this task
    const cached = audioCache.get(taskId);
    if (cached) {
        return res.json({
            success: true,
            status: 'SUCCESS',
            cached: true,
            tracks: [{
                    id: taskId,
                    title: cached.title,
                    audioData: cached.audio.substring(0, 50) + '...', // Don't send full data, just indicate it's cached
                    imageData: cached.image.substring(0, 50) + '...',
                }],
        });
    }
    const details = await sunoClient.getGenerationDetails(taskId);
    if (details.status === 'SUCCESS' && details.tracks && details.tracks.length > 0) {
        const track = details.tracks[0];
        // Download and cache audio immediately before URL expires
        try {
            console.error(`[Cache] Downloading audio for task ${taskId}...`);
            // Try audioUrl first, fallback to streamUrl
            let audioUrl = track.audioUrl;
            let audioRes = await fetch(audioUrl);
            if (audioRes.status === 403 && audioUrl.endsWith('.mp3')) {
                audioUrl = track.streamAudioUrl || audioUrl.replace('.mp3', '');
                audioRes = await fetch(audioUrl);
            }
            if (audioRes.ok) {
                const audioBuffer = await audioRes.arrayBuffer();
                if (audioBuffer.byteLength > 0) {
                    const audioBase64 = Buffer.from(audioBuffer).toString('base64');
                    console.error(`[Cache] Downloaded ${audioBuffer.byteLength} bytes of audio`);
                    // Download image too
                    let imageBase64 = '';
                    if (track.imageUrl) {
                        const imgRes = await fetch(track.imageUrl);
                        if (imgRes.ok) {
                            const imgBuffer = await imgRes.arrayBuffer();
                            imageBase64 = Buffer.from(imgBuffer).toString('base64');
                            console.error(`[Cache] Downloaded ${imgBuffer.byteLength} bytes of image`);
                        }
                    }
                    // Cache the data
                    audioCache.set(taskId, {
                        audio: audioBase64,
                        image: imageBase64,
                        title: track.title,
                        timestamp: Date.now(),
                    });
                    // Clean old cache entries (keep last 10)
                    if (audioCache.size > 10) {
                        const oldest = Array.from(audioCache.entries())
                            .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
                        audioCache.delete(oldest[0]);
                    }
                }
            }
        }
        catch (e) {
            console.error(`[Cache] Failed to cache audio: ${e}`);
        }
        return res.json({
            success: true,
            status: 'SUCCESS',
            tracks: details.tracks.map(track => ({
                id: track.id,
                title: track.title,
                audioUrl: track.audioUrl,
                streamUrl: track.streamAudioUrl,
                imageUrl: track.imageUrl,
                duration: track.duration,
            })),
        });
    }
    res.json({
        success: true,
        status: details.status || 'PENDING',
        message: details.status === 'SUCCESS' ? 'Complete but no tracks' : 'Still generating...',
    });
}));
/**
 * GET /api/audio/:taskId - Get cached audio data
 */
app.get('/api/audio/:taskId', (req, res) => {
    const taskId = req.params.taskId;
    const cached = audioCache.get(taskId);
    if (!cached) {
        return res.status(404).json({ error: 'Audio not found in cache' });
    }
    // Return as downloadable audio file
    const audioBuffer = Buffer.from(cached.audio, 'base64');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${cached.title}.mp3"`);
    res.send(audioBuffer);
});
// ============================================
// Track Upload
// ============================================
/**
 * POST /api/upload-track - Upload track to release
 */
app.post('/api/upload-track', asyncHandler(async (req, res) => {
    const { releaseId, artistId, title, audioUrl, taskId, explicit, language } = req.body;
    if (!releaseId || !title) {
        return res.status(400).json({ error: 'releaseId and title are required' });
    }
    // Extract release ID
    const releaseIdMatch = releaseId.toString().match(/\/(\d+)$/) || releaseId.toString().match(/^(\d+)$/);
    const cleanReleaseId = releaseIdMatch ? releaseIdMatch[1] : releaseId;
    // Check if we have cached audio for this task
    let audioBuffer = null;
    // Try to find cached audio by taskId or by matching URL pattern
    if (taskId && audioCache.has(taskId)) {
        const cached = audioCache.get(taskId);
        audioBuffer = Buffer.from(cached.audio, 'base64');
        console.error(`[Upload] Using cached audio for task ${taskId} (${audioBuffer.length} bytes)`);
    }
    else if (audioUrl) {
        // Try to extract taskId from URL (the base64-looking part)
        const urlMatch = audioUrl.match(/\/([A-Za-z0-9+/=]{20,})\./);
        if (urlMatch) {
            // Search cache for matching audio
            for (const [cachedTaskId, cached] of audioCache.entries()) {
                if (cached.audio) {
                    audioBuffer = Buffer.from(cached.audio, 'base64');
                    console.error(`[Upload] Found cached audio from task ${cachedTaskId} (${audioBuffer.length} bytes)`);
                    break;
                }
            }
        }
        // If no cache, try to download directly
        if (!audioBuffer) {
            console.error(`[Upload] No cached audio, attempting direct download from: ${audioUrl}`);
            try {
                let response = await fetch(audioUrl);
                if (response.status === 403 && audioUrl.endsWith('.mp3')) {
                    const streamUrl = audioUrl.replace('.mp3', '');
                    response = await fetch(streamUrl);
                }
                if (response.ok) {
                    const arrayBuffer = await response.arrayBuffer();
                    if (arrayBuffer.byteLength > 0) {
                        audioBuffer = Buffer.from(arrayBuffer);
                        console.error(`[Upload] Downloaded ${audioBuffer.length} bytes directly`);
                    }
                }
            }
            catch (e) {
                console.error(`[Upload] Direct download failed: ${e}`);
            }
        }
    }
    if (!audioBuffer || audioBuffer.length === 0) {
        return res.status(400).json({
            error: 'Could not get audio. The Suno URL may have expired. Try generating a new track.',
            hint: 'Audio URLs expire quickly. The upload must happen within 1-2 minutes of generation.'
        });
    }
    // Upload using buffer directly
    const result = await dittoClient.createTrackWithAudioBuffer(cleanReleaseId, audioBuffer, `${title.replace(/[^a-zA-Z0-9]/g, '_')}.mp3`);
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
app.post('/api/upload-artwork', asyncHandler(async (req, res) => {
    const { releaseId, artworkInput } = req.body;
    if (!releaseId || !artworkInput) {
        return res.status(400).json({ error: 'releaseId and artworkInput are required' });
    }
    let imageBuffer;
    // Get image from URL or base64
    if (artworkInput.startsWith('data:')) {
        const base64Data = artworkInput.split(',')[1];
        if (!base64Data) {
            return res.status(400).json({ error: 'Invalid base64 data URI' });
        }
        imageBuffer = Buffer.from(base64Data, 'base64');
    }
    else if (artworkInput.startsWith('http')) {
        const response = await fetch(artworkInput);
        if (!response.ok) {
            return res.status(400).json({ error: `Failed to fetch image: ${response.status}` });
        }
        const arrayBuffer = await response.arrayBuffer();
        imageBuffer = Buffer.from(arrayBuffer);
    }
    else {
        return res.status(400).json({ error: 'artworkInput must be URL or base64 data URI' });
    }
    // Process with sharp - ensure 1400x1400 minimum
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();
    const minSize = 1400;
    let processedBuffer;
    if ((metadata.width || 0) < minSize || (metadata.height || 0) < minSize) {
        processedBuffer = await image
            .resize(minSize, minSize, { fit: 'cover', position: 'center' })
            .jpeg({ quality: 95 })
            .toBuffer();
    }
    else {
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
app.post('/api/submit', asyncHandler(async (req, res) => {
    const { releaseId, dsps } = req.body;
    if (!releaseId || !dsps || !Array.isArray(dsps)) {
        return res.status(400).json({ error: 'releaseId and dsps array are required' });
    }
    // Map DSP names to store IDs
    const storeIds = [];
    const unknownDsps = [];
    for (const dsp of dsps) {
        const id = STORE_IDS[dsp.toLowerCase()];
        if (id) {
            storeIds.push(id);
        }
        else {
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
app.post('/api/wallet', asyncHandler(async (req, res) => {
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
app.get('/api/wallet/:artistName', asyncHandler(async (req, res) => {
    const artistName = req.params.artistName;
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
app.get('/', (req, res) => {
    res.json({
        name: 'Distro API',
        version: '1.0.0',
        docs: 'POST /api/artist, /api/release, /api/generate, /api/upload-track, /api/submit',
        health: '/api/health',
    });
});
app.get('/api/health', (req, res) => {
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
app.use((err, req, res, next) => {
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
