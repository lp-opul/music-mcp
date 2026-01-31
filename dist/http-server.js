#!/usr/bin/env node
import express from 'express';
import { paymentMiddleware } from 'x402-express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from 'dotenv';
// Load environment variables from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '..', '.env') });
import { createDittoClient } from './ditto-client.js';
const app = express();
app.use(express.json());
// Initialize Ditto client
const dittoClient = createDittoClient();
if (!dittoClient) {
    console.error('❌ Ditto credentials not configured. Set DITTO_EMAIL and DITTO_PASSWORD in .env');
    process.exit(1);
}
console.error('✓ Ditto client initialized');
// Payment configuration
const PAYMENT_WALLET = process.env.PAYMENT_WALLET_ADDRESS;
if (!PAYMENT_WALLET) {
    console.error('❌ PAYMENT_WALLET_ADDRESS not configured in .env');
    process.exit(1);
}
console.error(`✓ Payment wallet: ${PAYMENT_WALLET}`);
// x402 payment middleware - protect paid endpoints
app.use(paymentMiddleware(PAYMENT_WALLET, {
    '/release': {
        price: '$1.00',
        network: 'base-sepolia',
        config: {
            description: 'Create a new music release on Ditto',
        },
    },
    '/artist': {
        price: '$0.50',
        network: 'base-sepolia',
        config: {
            description: 'Create a new artist profile',
        },
    },
}, {
    url: 'https://x402.org/facilitator',
}));
// ============================================
// PAID ENDPOINTS (require x402 payment)
// ============================================
/**
 * POST /release - Create a new release ($1.00)
 * Body: { title, artistId, releaseDate, copyrightHolder?, copyrightYear? }
 */
app.post('/release', async (req, res) => {
    try {
        const { title, artistId, releaseDate, copyrightHolder, copyrightYear } = req.body;
        if (!title || !artistId || !releaseDate) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['title', 'artistId', 'releaseDate'],
            });
        }
        const result = await dittoClient.createRelease({
            title,
            artistId,
            releaseDate,
            copyrightLine: copyrightHolder,
            copyrightYear,
        });
        res.json({
            success: true,
            release: result,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: message });
    }
});
/**
 * POST /artist - Create a new artist ($0.50)
 * Body: { name, genres? }
 */
app.post('/artist', async (req, res) => {
    try {
        const { name, genres } = req.body;
        if (!name) {
            return res.status(400).json({
                error: 'Missing required field: name',
            });
        }
        const result = await dittoClient.createArtist(name, genres);
        res.json({
            success: true,
            artist: result,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: message });
    }
});
// ============================================
// FREE ENDPOINTS
// ============================================
/**
 * GET /status/:releaseId - Check release status (free)
 */
app.get('/status/:releaseId', async (req, res) => {
    try {
        const releaseId = req.params.releaseId;
        const result = await dittoClient.getRelease(releaseId);
        res.json({
            releaseId,
            status: result.statusId,
            title: result.title,
            release: result,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: message });
    }
});
/**
 * GET /streams/:releaseId - Get stream counts (free)
 */
app.get('/streams/:releaseId', async (req, res) => {
    try {
        const releaseId = req.params.releaseId;
        const result = await dittoClient.getStreams({ releaseId });
        res.json({
            releaseId,
            streams: result,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: message });
    }
});
/**
 * GET /artists - List all artists (free)
 */
app.get('/artists', async (_req, res) => {
    try {
        const result = await dittoClient.getArtists();
        res.json({ artists: result });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: message });
    }
});
/**
 * GET /releases - List all releases (free)
 */
app.get('/releases', async (_req, res) => {
    try {
        const result = await dittoClient.getReleases();
        res.json({ releases: result });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: message });
    }
});
/**
 * GET /health - Health check (free)
 */
app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        service: 'distro-api',
        paymentWallet: PAYMENT_WALLET,
        network: 'base-sepolia',
    });
});
// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`
🎵 Distro API Server running on http://localhost:${PORT}

Paid endpoints (x402 USDC payments):
  POST /release  - $1.00 - Create a release
  POST /artist   - $0.50 - Create an artist

Free endpoints:
  GET /status/:id   - Check release status
  GET /streams/:id  - View stream counts
  GET /artists      - List all artists
  GET /releases     - List all releases
  GET /health       - Health check

Payment network: base-sepolia (testnet)
Wallet: ${PAYMENT_WALLET}
  `);
});
