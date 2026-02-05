#!/usr/bin/env node
// Thin MCP Client - forwards to hosted Distro API
// No credentials needed - server handles authentication
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
const API_BASE = process.env.DISTRO_API_URL || 'https://distromcp.xyz';
// API request helper
async function apiRequest(method, endpoint, body) {
    const url = `${API_BASE}${endpoint}`;
    console.error(`[Client] ${method} ${url}`);
    const response = await fetch(url, {
        method,
        headers: {
            'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || `API error: ${response.status}`);
    }
    return data;
}
// Tool definitions
const tools = [
    {
        name: 'create_artist',
        description: 'Create a new artist profile',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Artist name' },
                genres: { type: 'array', items: { type: 'string' }, description: 'Optional genres' },
            },
            required: ['name'],
        },
    },
    {
        name: 'get_artists',
        description: 'List all artists',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'create_release',
        description: 'Create a new release (single/EP/album)',
        inputSchema: {
            type: 'object',
            properties: {
                artistId: { type: 'string', description: 'Artist ID' },
                title: { type: 'string', description: 'Release title' },
                releaseDate: { type: 'string', description: 'Release date (YYYY-MM-DD, 7+ days out)' },
                copyrightHolder: { type: 'string', description: 'Copyright holder name' },
                copyrightYear: { type: 'number', description: 'Copyright year' },
            },
            required: ['artistId', 'title', 'releaseDate'],
        },
    },
    {
        name: 'get_release_status',
        description: 'Get release details and status',
        inputSchema: {
            type: 'object',
            properties: {
                releaseId: { type: 'string', description: 'Release ID' },
            },
            required: ['releaseId'],
        },
    },
    {
        name: 'get_releases',
        description: 'List all releases',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'generate_music',
        description: 'Generate AI music with Suno',
        inputSchema: {
            type: 'object',
            properties: {
                prompt: { type: 'string', description: 'Music description or style' },
                style: { type: 'string', description: 'Musical style' },
                lyrics: { type: 'string', description: 'Custom lyrics (use [Verse], [Chorus] tags)' },
                title: { type: 'string', description: 'Track title' },
                instrumental: { type: 'boolean', description: 'Instrumental only (no vocals)' },
            },
            required: ['prompt'],
        },
    },
    {
        name: 'upload_track',
        description: 'Upload a track to a release',
        inputSchema: {
            type: 'object',
            properties: {
                releaseId: { type: 'string', description: 'Release ID' },
                title: { type: 'string', description: 'Track title' },
                audioUrl: { type: 'string', description: 'Audio file URL (MP3 or WAV)' },
                explicit: { type: 'boolean', description: 'Contains explicit content' },
                language: { type: 'string', description: 'Language code (e.g., en)' },
            },
            required: ['releaseId', 'title', 'audioUrl'],
        },
    },
    {
        name: 'upload_artwork',
        description: 'Upload artwork to a release (auto-upscales to 1400x1400)',
        inputSchema: {
            type: 'object',
            properties: {
                releaseId: { type: 'string', description: 'Release ID' },
                artworkInput: { type: 'string', description: 'Image URL or base64 data URI' },
            },
            required: ['releaseId', 'artworkInput'],
        },
    },
    {
        name: 'submit_release',
        description: 'Submit release to streaming platforms',
        inputSchema: {
            type: 'object',
            properties: {
                releaseId: { type: 'string', description: 'Release ID' },
                dsps: {
                    type: 'array',
                    items: {
                        type: 'string',
                        enum: ['spotify', 'apple_music', 'amazon_music', 'youtube_music', 'tidal', 'tiktok', 'soundcloud', 'deezer'],
                    },
                    description: 'Platforms to submit to',
                },
            },
            required: ['releaseId', 'dsps'],
        },
    },
    {
        name: 'set_wallet',
        description: 'Set wallet address for artist royalties',
        inputSchema: {
            type: 'object',
            properties: {
                artistName: { type: 'string', description: 'Artist name' },
                walletAddress: { type: 'string', description: 'Ethereum wallet address (0x...)' },
            },
            required: ['artistName', 'walletAddress'],
        },
    },
    {
        name: 'get_wallet',
        description: 'Get wallet address for an artist',
        inputSchema: {
            type: 'object',
            properties: {
                artistName: { type: 'string', description: 'Artist name' },
            },
            required: ['artistName'],
        },
    },
];
// Input schemas for validation
const createArtistSchema = z.object({
    name: z.string(),
    genres: z.array(z.string()).optional(),
});
const createReleaseSchema = z.object({
    artistId: z.string(),
    title: z.string(),
    releaseDate: z.string(),
    copyrightHolder: z.string().optional(),
    copyrightYear: z.number().optional(),
});
const getReleaseStatusSchema = z.object({
    releaseId: z.string(),
});
const generateMusicSchema = z.object({
    prompt: z.string(),
    style: z.string().optional(),
    lyrics: z.string().optional(),
    title: z.string().optional(),
    instrumental: z.boolean().optional(),
});
const uploadTrackSchema = z.object({
    releaseId: z.string(),
    title: z.string(),
    audioUrl: z.string(),
    explicit: z.boolean().optional(),
    language: z.string().optional(),
});
const uploadArtworkSchema = z.object({
    releaseId: z.string(),
    artworkInput: z.string(),
});
const submitReleaseSchema = z.object({
    releaseId: z.string(),
    dsps: z.array(z.string()),
});
const walletSchema = z.object({
    artistName: z.string(),
    walletAddress: z.string().optional(),
});
// Create MCP server
const server = new Server({
    name: 'distro-client',
    version: '1.0.0',
}, {
    capabilities: {
        tools: {},
    },
});
// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
});
// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        let result;
        switch (name) {
            case 'create_artist': {
                const validated = createArtistSchema.parse(args);
                result = await apiRequest('POST', '/api/artist', validated);
                break;
            }
            case 'get_artists': {
                result = await apiRequest('GET', '/api/artists');
                break;
            }
            case 'create_release': {
                const validated = createReleaseSchema.parse(args);
                result = await apiRequest('POST', '/api/release', validated);
                break;
            }
            case 'get_release_status': {
                const validated = getReleaseStatusSchema.parse(args);
                result = await apiRequest('GET', `/api/release/${validated.releaseId}`);
                break;
            }
            case 'get_releases': {
                result = await apiRequest('GET', '/api/releases');
                break;
            }
            case 'generate_music': {
                const validated = generateMusicSchema.parse(args);
                result = await apiRequest('POST', '/api/generate', validated);
                break;
            }
            case 'upload_track': {
                const validated = uploadTrackSchema.parse(args);
                result = await apiRequest('POST', '/api/upload-track', validated);
                break;
            }
            case 'upload_artwork': {
                const validated = uploadArtworkSchema.parse(args);
                result = await apiRequest('POST', '/api/upload-artwork', validated);
                break;
            }
            case 'submit_release': {
                const validated = submitReleaseSchema.parse(args);
                result = await apiRequest('POST', '/api/submit', {
                    releaseId: validated.releaseId,
                    dsps: validated.dsps,
                });
                break;
            }
            case 'set_wallet': {
                const validated = walletSchema.parse(args);
                result = await apiRequest('POST', '/api/wallet', validated);
                break;
            }
            case 'get_wallet': {
                const validated = walletSchema.parse(args);
                result = await apiRequest('GET', `/api/wallet/${encodeURIComponent(validated.artistName)}`);
                break;
            }
            default:
                return {
                    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
                    isError: true,
                };
        }
        return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
            isError: true,
        };
    }
});
// Start server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Distro MCP Client running (connected to ' + API_BASE + ')');
}
main().catch(console.error);
