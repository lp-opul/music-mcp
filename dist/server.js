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
// Rate limiting configuration
const LIMITS = {
    generations: 3, // Music generations per day
    releases: 5, // Releases per day
    artists: 5, // Artist creations per day
};
// Track usage per endpoint type
const usageTrackers = {
    generations: new Map(),
    releases: new Map(),
    artists: new Map(),
};
function checkLimit(userId, type) {
    const today = new Date().toISOString().split('T')[0];
    const tracker = usageTrackers[type];
    const limit = LIMITS[type];
    const usage = tracker.get(userId);
    if (!usage || usage.date !== today) {
        tracker.set(userId, { count: 1, date: today });
        return true;
    }
    if (usage.count >= limit) {
        return false;
    }
    usage.count++;
    return true;
}
function getRemaining(userId, type) {
    const today = new Date().toISOString().split('T')[0];
    const tracker = usageTrackers[type];
    const limit = LIMITS[type];
    const usage = tracker.get(userId);
    if (!usage || usage.date !== today) {
        return limit;
    }
    return Math.max(0, limit - usage.count);
}
// Legacy functions for backward compatibility
function checkDailyLimit(userId) {
    return checkLimit(userId, 'generations');
}
function getRemainingGenerations(userId) {
    return getRemaining(userId, 'generations');
}
// Create Express app
const app = express();
// CORS - restrict to known origins in production
const allowedOrigins = [
    'https://distro-nu.vercel.app',
    'https://web-navy-eight-33.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
];
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, Postman, curl)
        if (!origin)
            return callback(null, true);
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        // In development, allow all
        if (process.env.NODE_ENV !== 'production') {
            return callback(null, true);
        }
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
}));
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
    // Rate limiting
    const userId = req.ip || 'anonymous';
    if (!checkLimit(userId, 'artists')) {
        return res.status(429).json({
            error: 'Daily limit reached (5 artists per day). Try again tomorrow!',
            remaining: 0,
        });
    }
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
    // Rate limiting
    const userId = req.ip || 'anonymous';
    if (!checkLimit(userId, 'releases')) {
        return res.status(429).json({
            error: 'Daily limit reached (5 releases per day). Try again tomorrow!',
            remaining: 0,
        });
    }
    const { artistId, artistName, title, releaseDate, copyrightHolder, copyrightYear } = req.body;
    if (!artistId || !title || !releaseDate) {
        return res.status(400).json({ error: 'artistId, title, and releaseDate are required' });
    }
    // Convert artistId to IRI if needed
    const artistIri = artistId.toString().startsWith('/api/')
        ? artistId
        : `/api/me/artists/${artistId}`;
    console.log(`[Release] Creating: ${title}`);
    const result = await dittoClient.createRelease({
        title,
        artistId: artistIri,
        artistName: artistName || copyrightHolder, // Use for default copyright holder
        releaseDate,
        copyrightHolder,
        copyrightYear,
    });
    // Add artist to release via PUT
    const releaseId = result.id;
    const numericArtistId = parseInt(artistId.toString().match(/(\d+)$/)?.[1] || artistId, 10);
    try {
        await dittoClient.addArtistToRelease(releaseId.toString(), numericArtistId);
        console.log(`[Release] Artist linked`);
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
 * GET /api/release/:id - Get release status (JSON)
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
 * GET /status/:id - Nice HTML status page for a release
 */
app.get('/status/:id', asyncHandler(async (req, res) => {
    const id = req.params.id;
    const release = await dittoClient.getRelease(id);
    const statusMap = {
        1: { label: 'Draft', color: '#888', icon: '📝' },
        2: { label: 'Pending Review', color: '#f59e0b', icon: '⏳' },
        3: { label: 'In Review', color: '#3b82f6', icon: '🔍' },
        4: { label: 'Approved', color: '#10b981', icon: '✅' },
        5: { label: 'Rejected', color: '#ef4444', icon: '❌' },
        6: { label: 'Live', color: '#22c55e', icon: '🎵' },
        7: { label: 'Taken Down', color: '#6b7280', icon: '⬇️' },
        8: { label: 'Submitted', color: '#8b5cf6', icon: '🚀' },
    };
    const status = statusMap[release.statusId] || { label: 'Unknown', color: '#888', icon: '❓' };
    const artwork = release.artwork?.medium || release.artwork?.original || '';
    const releaseDate = new Date(release.releaseDate).toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    const artworkHtml = artwork
        ? '<img src="' + artwork + '" alt="Artwork" class="artwork">'
        : '<div class="no-artwork">🎵</div>';
    const copyrightHolder = release.copyrightHolder || 'Not specified';
    const language = release.language?.name || 'English';
    const html = '<!DOCTYPE html>' +
        '<html lang="en">' +
        '<head>' +
        '  <meta charset="UTF-8">' +
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">' +
        '  <title>' + release.title + ' - Release Status</title>' +
        '  <style>' +
        '    * { box-sizing: border-box; margin: 0; padding: 0; }' +
        '    body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); min-height: 100vh; color: white; padding: 40px 20px; }' +
        '    .container { max-width: 600px; margin: 0 auto; }' +
        '    .card { background: rgba(255,255,255,0.1); border-radius: 20px; padding: 30px; backdrop-filter: blur(10px); }' +
        '    .artwork { width: 200px; height: 200px; border-radius: 12px; margin: 0 auto 20px; display: block; object-fit: cover; box-shadow: 0 10px 40px rgba(0,0,0,0.3); }' +
        '    .no-artwork { width: 200px; height: 200px; border-radius: 12px; margin: 0 auto 20px; background: rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center; font-size: 48px; }' +
        '    h1 { text-align: center; font-size: 28px; margin-bottom: 8px; }' +
        '    .status { text-align: center; padding: 8px 20px; border-radius: 20px; display: inline-block; font-weight: 600; font-size: 14px; margin: 15px auto; background: ' + status.color + '22; color: ' + status.color + '; border: 1px solid ' + status.color + '44; }' +
        '    .status-container { text-align: center; }' +
        '    .details { margin-top: 25px; display: grid; gap: 12px; }' +
        '    .detail { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.1); }' +
        '    .detail:last-child { border-bottom: none; }' +
        '    .label { color: #888; }' +
        '    .value { font-weight: 500; }' +
        '    .footer { text-align: center; margin-top: 25px; color: #666; font-size: 13px; }' +
        '    .footer a { color: #667eea; }' +
        '  </style>' +
        '</head>' +
        '<body>' +
        '  <div class="container">' +
        '    <div class="card">' +
        '      ' + artworkHtml +
        '      <h1>' + release.title + '</h1>' +
        '      <div class="status-container">' +
        '        <div class="status">' + status.icon + ' ' + status.label + '</div>' +
        '      </div>' +
        '      <div class="details">' +
        '        <div class="detail"><span class="label">Release ID</span><span class="value">#' + release.id + '</span></div>' +
        '        <div class="detail"><span class="label">Release Date</span><span class="value">' + releaseDate + '</span></div>' +
        '        <div class="detail"><span class="label">Copyright</span><span class="value">© ' + release.copyrightYear + ' ' + copyrightHolder + '</span></div>' +
        '        <div class="detail"><span class="label">Language</span><span class="value">' + language + '</span></div>' +
        '      </div>' +
        '      <div class="footer">Powered by <a href="https://web-navy-eight-33.vercel.app">MCP Distro</a></div>' +
        '    </div>' +
        '  </div>' +
        '</body>' +
        '</html>';
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
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
    // Rate limiting
    const userId = req.ip || 'anonymous';
    if (!checkDailyLimit(userId)) {
        return res.status(429).json({
            error: 'Daily limit reached (3 songs per day). Try again tomorrow!',
            remaining: 0,
        });
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
            remaining: getRemainingGenerations(userId),
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
// Complete Release Flow (All-in-one)
// ============================================
/**
 * POST /api/release-full - Complete release from generated music
 * Takes a completed taskId and does everything: create artist, release, upload track+artwork, submit
 */
app.post('/api/release-full', asyncHandler(async (req, res) => {
    // Rate limiting
    const userId = req.ip || 'anonymous';
    if (!checkLimit(userId, 'releases')) {
        return res.status(429).json({
            error: 'Daily limit reached (5 releases per day). Try again tomorrow!',
            remaining: 0,
        });
    }
    const { taskId, artistName, trackTitle, style } = req.body;
    if (!taskId || !artistName || !trackTitle) {
        return res.status(400).json({ error: 'taskId, artistName, and trackTitle are required' });
    }
    console.log(`[ReleaseFull] Starting for task ${taskId}, artist: ${artistName}, track: ${trackTitle}`);
    if (!sunoClient) {
        return res.status(503).json({ error: 'Suno client not configured' });
    }
    // Step 1: Get generation details and download audio immediately
    const details = await sunoClient.getGenerationDetails(taskId);
    if (details.status !== 'SUCCESS' || !details.tracks || details.tracks.length === 0) {
        return res.status(400).json({
            error: 'Music generation not complete',
            status: details.status
        });
    }
    const track = details.tracks[0];
    console.log(`[ReleaseFull] Got track: ${track.title}, downloading audio...`);
    // Download audio immediately (before URL expires)
    let audioBuffer;
    try {
        let audioUrl = track.audioUrl;
        let audioRes = await fetch(audioUrl);
        if (audioRes.status === 403 && audioUrl.endsWith('.mp3')) {
            audioUrl = track.streamAudioUrl || audioUrl.replace('.mp3', '');
            audioRes = await fetch(audioUrl);
        }
        if (!audioRes.ok) {
            throw new Error(`Failed to download audio: ${audioRes.status}`);
        }
        const buffer = await audioRes.arrayBuffer();
        if (buffer.byteLength === 0) {
            throw new Error('Audio file is empty');
        }
        audioBuffer = Buffer.from(buffer);
        console.log(`[ReleaseFull] Downloaded ${audioBuffer.length} bytes of audio`);
    }
    catch (e) {
        return res.status(500).json({ error: 'Failed to download audio' });
    }
    // Download artwork
    let artworkBuffer = null;
    if (track.imageUrl) {
        try {
            const imgRes = await fetch(track.imageUrl);
            if (imgRes.ok) {
                const buffer = await imgRes.arrayBuffer();
                artworkBuffer = Buffer.from(buffer);
                console.log(`[ReleaseFull] Downloaded ${artworkBuffer.length} bytes of artwork`);
            }
        }
        catch (e) {
            console.error(`[ReleaseFull] Artwork download failed: ${e}`);
        }
    }
    // Step 2: Create artist
    let artist;
    try {
        artist = await dittoClient.createArtist(artistName);
        console.log(`[ReleaseFull] Created artist: ${artist.id}`);
    }
    catch (e) {
        console.error(`[ReleaseFull] Artist creation failed: ${e}`);
        return res.status(500).json({ error: 'Failed to create artist' });
    }
    // Step 3: Create release with all required details
    const releaseDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const currentYear = new Date().getFullYear();
    let release;
    try {
        release = await dittoClient.createRelease({
            title: trackTitle,
            artistId: artist.id.toString(),
            artistName: artistName,
            releaseDate,
            copyrightHolder: artistName, // Required for Step 2
            copyrightYear: currentYear,
        });
        console.log(`[ReleaseFull] Created release: ${release.id}`);
        // Try to update with additional required fields
        const releaseIdNum = release.id.toString().match(/(\d+)$/)?.[1] || release.id;
        try {
            await dittoClient.updateRelease(releaseIdNum, {
                cLine: artistName, // Copyright holder
                cLineYear: currentYear, // Copyright year
                pLine: artistName, // Phonographic rights holder
                pLineYear: currentYear, // Production year
                originalReleaseDate: releaseDate,
            });
            console.log(`[ReleaseFull] Updated release with required details`);
        }
        catch (updateErr) {
            console.error(`[ReleaseFull] Release update failed (non-fatal): ${updateErr}`);
        }
    }
    catch (e) {
        console.error(`[ReleaseFull] Release creation failed: ${e}`);
        return res.status(500).json({ error: 'Failed to create release' });
    }
    // Step 4: Upload track audio
    const releaseId = release.id.toString().match(/(\d+)$/)?.[1] || release.id;
    try {
        const trackResult = await dittoClient.createTrackWithAudioBuffer(releaseId, audioBuffer, `${trackTitle.replace(/[^a-zA-Z0-9]/g, '_')}.mp3`);
        console.log(`[ReleaseFull] Track uploaded`);
    }
    catch (e) {
        console.error(`[ReleaseFull] Track upload failed: ${e}`);
        return res.status(500).json({ error: 'Failed to upload track' });
    }
    // Step 5: Upload artwork (if available)
    if (artworkBuffer) {
        try {
            // Resize to 1400x1400 if needed
            const image = sharp(artworkBuffer);
            const metadata = await image.metadata();
            if ((metadata.width || 0) < 1400 || (metadata.height || 0) < 1400) {
                artworkBuffer = await image
                    .resize(1400, 1400, { fit: 'cover', position: 'center' })
                    .jpeg({ quality: 95 })
                    .toBuffer();
            }
            await dittoClient.uploadArtworkBuffer(releaseId, artworkBuffer);
            console.log(`[ReleaseFull] Artwork uploaded`);
        }
        catch (e) {
            console.error(`[ReleaseFull] Artwork upload failed: ${e}`);
            // Don't fail the whole request for artwork
        }
    }
    // Step 6: Submit to all DSPs
    const defaultDsps = ['spotify', 'apple_music', 'amazon_music', 'youtube_music', 'tidal', 'tiktok', 'deezer'];
    const storeIds = defaultDsps.map(d => STORE_IDS[d]).filter(Boolean);
    try {
        await dittoClient.submitToStores(releaseId, storeIds);
        await dittoClient.finalizeRelease(releaseId);
        console.log(`[ReleaseFull] Submitted to stores and finalized`);
    }
    catch (e) {
        console.error(`[ReleaseFull] Submit failed: ${e}`);
        // Don't fail for submit issues
    }
    res.json({
        success: true,
        artistId: artist.id,
        artistName,
        releaseId,
        trackTitle,
        // Note: Don't return audioUrl/imageUrl - Suno URLs expire quickly
        // The track is already uploaded to Ditto
        statusUrl: `https://distro-nu.vercel.app/status/${releaseId}`,
        dsps: defaultDsps,
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
    // Step 1: Set the stores
    await dittoClient.submitToStores(releaseId, storeIds);
    console.log(`[Submit] Stores set for release ${releaseId}`);
    // Step 2: Finalize/submit the release for review
    await dittoClient.finalizeRelease(releaseId);
    console.log(`[Submit] Release ${releaseId} finalized`);
    res.json({
        success: true,
        submitted: dsps.filter(d => STORE_IDS[d.toLowerCase()]),
        finalized: true,
        unknownDsps: unknownDsps.length > 0 ? unknownDsps : undefined,
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
    // Log only error name and message, not full stack or sensitive details
    console.error('API Error:', err.name, '-', err.message?.substring(0, 100));
    res.status(500).json({
        error: 'An error occurred processing your request',
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
