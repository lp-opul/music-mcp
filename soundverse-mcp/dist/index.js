import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });
const SOUNDVERSE_API_KEY = process.env.SOUNDVERSE_API_KEY ?? '';
const SOUNDVERSE_BASE_URL = 'https://api.soundverse.ai/v1';
// ── In-memory result store (for status polling) ─────────────────────
const generationResults = new Map();
// ── Tool definitions ────────────────────────────────────────────────
const tools = [
    {
        name: 'generate_song',
        description: 'Generate a song from a text prompt using the Soundverse AI. Returns a generation ID that can be polled with get_generation_status.',
        inputSchema: {
            type: 'object',
            properties: {
                prompt: {
                    type: 'string',
                    description: 'Describes the desired song style, mood, and characteristics.',
                },
                lyrics: {
                    type: 'string',
                    description: 'Optional lyrics. If omitted, lyrics are auto-generated.',
                },
            },
            required: ['prompt'],
        },
    },
    {
        name: 'generate_song_from_lyrics',
        description: 'Generate a song driven primarily by provided lyrics. A style prompt can optionally refine the result.',
        inputSchema: {
            type: 'object',
            properties: {
                lyrics: {
                    type: 'string',
                    description: 'The lyrics for the song.',
                },
                genre: {
                    type: 'string',
                    description: 'Optional genre hint (e.g. "pop", "hip-hop", "country").',
                },
                mood: {
                    type: 'string',
                    description: 'Optional mood hint (e.g. "upbeat", "melancholic", "energetic").',
                },
            },
            required: ['lyrics'],
        },
    },
    {
        name: 'get_generation_status',
        description: 'Check the status of a previously submitted song generation. Returns progress percentage, status, and download URL when complete.',
        inputSchema: {
            type: 'object',
            properties: {
                generation_id: {
                    type: 'string',
                    description: 'The message_id returned by a generate call.',
                },
            },
            required: ['generation_id'],
        },
    },
];
// ── Zod schemas ─────────────────────────────────────────────────────
const generateSongSchema = z.object({
    prompt: z.string(),
    lyrics: z.string().optional(),
});
const generateSongFromLyricsSchema = z.object({
    lyrics: z.string(),
    genre: z.string().optional(),
    mood: z.string().optional(),
});
const getGenerationStatusSchema = z.object({
    generation_id: z.string(),
});
// ── API helpers ─────────────────────────────────────────────────────
function apiHeaders() {
    return {
        Authorization: `Bearer ${SOUNDVERSE_API_KEY}`,
        'Content-Type': 'application/json',
    };
}
async function generateSong(body) {
    const res = await fetch(`${SOUNDVERSE_BASE_URL}/generate/song-from-prompt`, {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Soundverse API error ${res.status}: ${text || res.statusText}. Request body: ${JSON.stringify(body)}`);
    }
    const data = (await res.json());
    // Store result for later status polling
    const id = (data.message_id ?? data.id ?? `sv_${Date.now()}`);
    generationResults.set(id, data);
    return data;
}
function formatResult(data) {
    const audioData = data.audioData;
    if (audioData && audioData.length > 0) {
        const songs = audioData.map((item) => ({
            songName: item.songName,
            audioUrl: item.audioUrl,
            licenses: item.licenses,
        }));
        return JSON.stringify({ status: 'completed', songs }, null, 2);
    }
    return JSON.stringify(data, null, 2);
}
// ── Server setup ────────────────────────────────────────────────────
const server = new Server({ name: 'soundverse-mcp', version: '0.1.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (!SOUNDVERSE_API_KEY || SOUNDVERSE_API_KEY === 'your_soundverse_api_key_here') {
        return {
            content: [{ type: 'text', text: 'Error: SOUNDVERSE_API_KEY is not configured. Set it in your .env file.' }],
            isError: true,
        };
    }
    try {
        switch (name) {
            case 'generate_song': {
                const { prompt, lyrics } = generateSongSchema.parse(args);
                const body = { prompt, StyleOfMusic: prompt };
                if (lyrics)
                    body.lyrics = lyrics;
                const result = await generateSong(body);
                return { content: [{ type: 'text', text: formatResult(result) }] };
            }
            case 'generate_song_from_lyrics': {
                const { lyrics, genre, mood } = generateSongFromLyricsSchema.parse(args);
                const promptParts = [];
                if (genre)
                    promptParts.push(genre);
                if (mood)
                    promptParts.push(mood);
                const prompt = promptParts.length > 0
                    ? `A ${promptParts.join(', ')} song`
                    : 'A song';
                const result = await generateSong({ prompt, lyrics, StyleOfMusic: prompt });
                return { content: [{ type: 'text', text: formatResult(result) }] };
            }
            case 'get_generation_status': {
                const { generation_id } = getGenerationStatusSchema.parse(args);
                const stored = generationResults.get(generation_id);
                if (stored) {
                    return {
                        content: [{ type: 'text', text: JSON.stringify({ generation_id, status: 'completed', ...stored }, null, 2) }],
                    };
                }
                return {
                    content: [{ type: 'text', text: JSON.stringify({ generation_id, status: 'not_found', message: 'No generation found with that ID.' }, null, 2) }],
                    isError: true,
                };
            }
            default:
                return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
        }
    }
    catch (error) {
        if (error instanceof z.ZodError) {
            return {
                content: [{ type: 'text', text: `Validation error: ${JSON.stringify(error.errors, null, 2)}` }],
                isError: true,
            };
        }
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
    }
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Soundverse MCP server running on stdio');
}
main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
