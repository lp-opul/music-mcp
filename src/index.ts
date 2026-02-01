#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import type { DSP, Split } from './types.js';
import { createDittoClient, DittoClient } from './ditto-client.js';
import { createSunoClient, SunoClient } from './suno-client.js';
import {
  createArtistWallet,
  getArtistWallet,
  getWalletBalance,
  isCdpConfigured,
} from './wallet-service.js';
import {
  createMockUploadResponse,
  createMockSubmitReleaseResponse,
  getMockReleaseStatus,
  getMockEarnings,
  getMockStreams,
  setMockSplits,
} from './mocks/mock-data.js';

// Load environment variables from the project root (not cwd)
// This ensures Claude Desktop can find .env regardless of working directory
import { config } from 'dotenv';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '..', '.env'), quiet: true });

// Initialize Ditto client (null if credentials not configured)
const dittoClient = createDittoClient();
const USE_MOCKS = !dittoClient;

if (USE_MOCKS) {
  console.error('⚠️  Ditto credentials not configured. Running in MOCK mode.');
  console.error('   Set DITTO_EMAIL and DITTO_PASSWORD in .env to enable real API calls.');
} else {
  console.error('✓ Ditto client initialized. Using real API.');
}

// Initialize Suno client for AI music generation
const sunoClient = createSunoClient();
if (sunoClient) {
  console.error('✓ Suno client initialized for AI music generation.');
} else {
  console.error('⚠️  Suno API key not configured. Set SUNO_API_KEY in .env to enable music generation.');
}

// DSP name to Ditto store ID mapping (populated on first use)
let storeMapping: Map<string, string> | null = null;

async function getStoreId(dsp: DSP): Promise<string | null> {
  if (!dittoClient) return null;
  
  if (!storeMapping) {
    try {
      const stores = await dittoClient.getStores();
      storeMapping = new Map();
      for (const store of stores['hydra:member'] || stores) {
        const name = store.name?.toLowerCase().replace(/\s+/g, '_');
        if (name) {
          storeMapping.set(name, store['@id'] || store.id);
        }
      }
    } catch (e) {
      console.error('Failed to load stores:', e);
      return null;
    }
  }
  
  return storeMapping.get(dsp) || null;
}

// Tool definitions
const tools: Tool[] = [
  {
    name: 'create_artist',
    description: 'Create a new artist profile in Ditto. Required before uploading tracks or creating releases.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Artist name',
        },
        genres: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of genres (optional)',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_artists',
    description: 'List all artists associated with your Ditto account.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'upload_track',
    description: 'Upload/create a track for a release. Requires an existing release and artist. Optionally upload audio from a URL.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Track title',
        },
        releaseId: {
          type: 'string',
          description: 'Release ID to add this track to',
        },
        artistId: {
          type: 'string',
          description: 'Artist ID for the track',
        },
        isrc: {
          type: 'string',
          description: 'International Standard Recording Code (optional, will be generated if not provided)',
        },
        explicit: {
          type: 'boolean',
          description: 'Whether the track contains explicit content',
        },
        language: {
          type: 'string',
          description: 'Primary language code (e.g., "en", "es")',
        },
        trackNumber: {
          type: 'number',
          description: 'Track number on the release (optional, defaults to 1)',
        },
        audioUrl: {
          type: 'string',
          description: 'URL to audio file to upload (optional). If provided, downloads and uploads the audio to the track.',
        },
      },
      required: ['title', 'releaseId', 'artistId', 'explicit', 'language'],
    },
  },
  {
    name: 'create_release',
    description: 'Create a new release (single, EP, or album) in Ditto. Must be created before adding tracks.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Release title',
        },
        artistId: {
          type: 'string',
          description: 'Artist ID for the release',
        },
        releaseDate: {
          type: 'string',
          description: 'Release date in YYYY-MM-DD format (must be at least 7 days in the future)',
        },
        upc: {
          type: 'string',
          description: 'Universal Product Code (optional, will be generated)',
        },
        copyrightHolder: {
          type: 'string',
          description: 'Copyright holder name',
        },
        copyrightYear: {
          type: 'number',
          description: 'Copyright year',
        },
      },
      required: ['title', 'artistId', 'releaseDate'],
    },
  },
  {
    name: 'submit_release',
    description: 'Submit a release to digital streaming platforms (DSPs) like Spotify, Apple Music, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        releaseId: {
          type: 'string',
          description: 'Release ID to submit',
        },
        dsps: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['spotify', 'apple_music', 'amazon_music', 'youtube_music', 'deezer', 'tidal', 'pandora', 'soundcloud', 'tiktok', 'instagram'],
          },
          description: 'List of DSPs to distribute to',
        },
      },
      required: ['releaseId', 'dsps'],
    },
  },
  {
    name: 'get_release_status',
    description: 'Check the status of a release. Shows whether the release is pending, live, or has issues.',
    inputSchema: {
      type: 'object',
      properties: {
        releaseId: {
          type: 'string',
          description: 'The release ID to check',
        },
      },
      required: ['releaseId'],
    },
  },
  {
    name: 'get_releases',
    description: 'List all releases in your Ditto account.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_earnings',
    description: 'Query revenue earnings from streams across DSPs. Can filter by release, track, date range, or platform.',
    inputSchema: {
      type: 'object',
      properties: {
        releaseId: {
          type: 'string',
          description: 'Filter by specific release ID (optional)',
        },
        trackId: {
          type: 'string',
          description: 'Filter by specific track ID (optional)',
        },
        startDate: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format (optional)',
        },
        endDate: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format (optional)',
        },
        dsp: {
          type: 'string',
          enum: ['spotify', 'apple_music', 'amazon_music', 'youtube_music', 'deezer', 'tidal', 'pandora', 'soundcloud', 'tiktok', 'instagram'],
          description: 'Filter by specific DSP (optional)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_streams',
    description: 'Query stream/play counts across DSPs. Can filter by release, track, date range, or platform.',
    inputSchema: {
      type: 'object',
      properties: {
        releaseId: {
          type: 'string',
          description: 'Filter by specific release ID (optional)',
        },
        trackId: {
          type: 'string',
          description: 'Filter by specific track ID (optional)',
        },
        startDate: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format (optional)',
        },
        endDate: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format (optional)',
        },
        dsp: {
          type: 'string',
          enum: ['spotify', 'apple_music', 'amazon_music', 'youtube_music', 'deezer', 'tidal', 'pandora', 'soundcloud', 'tiktok', 'instagram'],
          description: 'Filter by specific DSP (optional)',
        },
      },
      required: [],
    },
  },
  {
    name: 'set_splits',
    description: 'Configure revenue splits for a release among collaborators. Percentages must total 100%.',
    inputSchema: {
      type: 'object',
      properties: {
        releaseId: {
          type: 'string',
          description: 'The release ID to configure splits for',
        },
        splits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              collaboratorEmail: {
                type: 'string',
                description: 'Email address of the collaborator',
              },
              collaboratorName: {
                type: 'string',
                description: 'Display name of the collaborator',
              },
              percentage: {
                type: 'number',
                description: 'Percentage of revenue (0-100)',
              },
              role: {
                type: 'string',
                description: 'Role (e.g., "Artist", "Producer", "Writer")',
              },
            },
            required: ['collaboratorEmail', 'collaboratorName', 'percentage', 'role'],
          },
          description: 'Array of collaborators and their revenue percentages',
        },
      },
      required: ['releaseId', 'splits'],
    },
  },
  {
    name: 'get_account',
    description: 'Get your Ditto account info and balance.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_stores',
    description: 'List all available stores/DSPs you can distribute to.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_genres',
    description: 'List all available genres for releases.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'upload_artwork',
    description: 'Upload artwork image to a release from a URL.',
    inputSchema: {
      type: 'object',
      properties: {
        releaseId: {
          type: 'string',
          description: 'Release ID to add artwork to',
        },
        imageUrl: {
          type: 'string',
          description: 'URL to the image file (JPG or PNG)',
        },
      },
      required: ['releaseId', 'imageUrl'],
    },
  },
  {
    name: 'generate_artwork',
    description: 'Generate AI artwork for a release using Ditto\'s artgen service.',
    inputSchema: {
      type: 'object',
      properties: {
        releaseId: {
          type: 'string',
          description: 'Release ID to generate artwork for',
        },
        prompt: {
          type: 'string',
          description: 'Description of desired artwork (e.g., "abstract colorful waves with neon lights")',
        },
      },
      required: ['releaseId', 'prompt'],
    },
  },
  {
    name: 'generate_music',
    description: 'Generate music using Suno AI. Can use AI-generated lyrics (simple mode) or your own custom lyrics (custom mode).',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Description of the song to generate. In simple mode, this guides the AI. In custom mode, this becomes the style.',
        },
        style: {
          type: 'string',
          description: 'Musical style/genre (e.g., "indie pop, dreamy, female vocals"). Used in custom mode.',
        },
        instrumental: {
          type: 'boolean',
          description: 'If true, generate instrumental only (no vocals). Cannot be used with custom lyrics.',
        },
        lyrics: {
          type: 'string',
          description: 'Optional: Your own lyrics. Use [Verse], [Chorus], [Bridge] tags to structure. If provided, enables custom mode.',
        },
        title: {
          type: 'string',
          description: 'Optional: Song title. Used when providing custom lyrics.',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'release_ai_track',
    description: 'One-shot tool: Generate AI music with Suno and set up for distribution on Ditto. Creates artist, release, track, and optionally artwork in one call. Supports custom lyrics.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Description of the song to generate. If using custom lyrics, this becomes the musical style.',
        },
        artistName: {
          type: 'string',
          description: 'Name of the artist',
        },
        trackTitle: {
          type: 'string',
          description: 'Title of the track/release',
        },
        releaseDate: {
          type: 'string',
          description: 'Release date in YYYY-MM-DD format (must be at least 7 days in the future)',
        },
        dsps: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['spotify', 'apple_music', 'amazon_music', 'youtube_music', 'deezer', 'tidal', 'pandora', 'soundcloud', 'tiktok', 'instagram'],
          },
          description: 'Optional: List of DSPs to submit to (e.g., ["spotify", "apple_music"])',
        },
        instrumental: {
          type: 'boolean',
          description: 'If true, generate instrumental only (no vocals). Cannot be used with custom lyrics.',
        },
        lyrics: {
          type: 'string',
          description: 'Optional: Your own lyrics. Use [Verse], [Chorus], [Bridge] tags. If provided, AI will sing your words.',
        },
        style: {
          type: 'string',
          description: 'Optional: Musical style (e.g., "indie pop, dreamy vocals, acoustic guitar"). Recommended when using custom lyrics.',
        },
        artworkPrompt: {
          type: 'string',
          description: 'Optional: Description for AI-generated artwork (e.g., "abstract neon waves"). If provided, generates cover art.',
        },
      },
      required: ['prompt', 'artistName', 'trackTitle', 'releaseDate'],
    },
  },
  {
    name: 'get_my_wallet',
    description: 'Get the wallet address for an artist. Each artist gets a unique wallet for receiving royalties.',
    inputSchema: {
      type: 'object',
      properties: {
        artistName: {
          type: 'string',
          description: 'Name of the artist',
        },
      },
      required: ['artistName'],
    },
  },
  {
    name: 'get_my_balance',
    description: 'Check the balance of an artist\'s wallet.',
    inputSchema: {
      type: 'object',
      properties: {
        artistName: {
          type: 'string',
          description: 'Name of the artist',
        },
      },
      required: ['artistName'],
    },
  },
];

// Input validation schemas
const createArtistSchema = z.object({
  name: z.string(),
  genres: z.array(z.string()).optional(),
});

const uploadTrackSchema = z.object({
  title: z.string(),
  releaseId: z.string(),
  artistId: z.string(),
  isrc: z.string().optional(),
  explicit: z.boolean(),
  language: z.string(),
  trackNumber: z.number().optional(),
  audioUrl: z.string().optional(),
});

const createReleaseSchema = z.object({
  title: z.string(),
  artistId: z.string(),
  releaseDate: z.string(),
  upc: z.string().optional(),
  copyrightHolder: z.string().optional(),
  copyrightYear: z.number().optional(),
});

const submitReleaseSchema = z.object({
  releaseId: z.string(),
  dsps: z.array(z.enum(['spotify', 'apple_music', 'amazon_music', 'youtube_music', 'deezer', 'tidal', 'pandora', 'soundcloud', 'tiktok', 'instagram'])),
});

const getReleaseStatusSchema = z.object({
  releaseId: z.string(),
});

const earningsQuerySchema = z.object({
  releaseId: z.string().optional(),
  trackId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  dsp: z.enum(['spotify', 'apple_music', 'amazon_music', 'youtube_music', 'deezer', 'tidal', 'pandora', 'soundcloud', 'tiktok', 'instagram']).optional(),
});

const streamsQuerySchema = z.object({
  releaseId: z.string().optional(),
  trackId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  dsp: z.enum(['spotify', 'apple_music', 'amazon_music', 'youtube_music', 'deezer', 'tidal', 'pandora', 'soundcloud', 'tiktok', 'instagram']).optional(),
});

const setSplitsSchema = z.object({
  releaseId: z.string(),
  splits: z.array(z.object({
    collaboratorEmail: z.string().email(),
    collaboratorName: z.string(),
    percentage: z.number().min(0).max(100),
    role: z.string(),
  })),
});

const uploadArtworkSchema = z.object({
  releaseId: z.string(),
  imageUrl: z.string(),
});

const generateArtworkSchema = z.object({
  releaseId: z.string(),
  prompt: z.string(),
});

const generateMusicSchema = z.object({
  prompt: z.string(),
  style: z.string().optional(),
  instrumental: z.boolean().optional(),
  lyrics: z.string().optional(),
  title: z.string().optional(),
});

const releaseAiTrackSchema = z.object({
  prompt: z.string(),
  artistName: z.string(),
  trackTitle: z.string(),
  releaseDate: z.string(),
  dsps: z.array(z.enum(['spotify', 'apple_music', 'amazon_music', 'youtube_music', 'deezer', 'tidal', 'pandora', 'soundcloud', 'tiktok', 'instagram'])).optional(),
  instrumental: z.boolean().optional(),
  lyrics: z.string().optional(),
  style: z.string().optional(),
  artworkPrompt: z.string().optional(),
});

const getMyWalletSchema = z.object({
  artistName: z.string(),
});

const getMyBalanceSchema = z.object({
  artistName: z.string(),
});

// Create MCP server
const server = new Server(
  {
    name: 'opulous-distro-mcp',
    version: '0.2.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // ============================================
      // Artist Tools
      // ============================================
      case 'create_artist': {
        const validated = createArtistSchema.parse(args);
        
        if (dittoClient) {
          const result = await dittoClient.createArtist(validated.name, validated.genres);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }
        
        // Mock response
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              '@id': `/api/me/artists/artist_${Date.now()}`,
              name: validated.name,
              genres: validated.genres || [],
              createdAt: new Date().toISOString(),
              _mock: true,
            }, null, 2),
          }],
        };
      }

      case 'get_artists': {
        if (dittoClient) {
          const result = await dittoClient.getArtists();
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              'hydra:member': [
                { '@id': '/api/me/artists/1', name: 'Demo Artist', _mock: true }
              ],
              _mock: true,
            }, null, 2),
          }],
        };
      }

      // ============================================
      // Track Tools
      // ============================================
      case 'upload_track': {
        const validated = uploadTrackSchema.parse(args);
        
        if (dittoClient) {
          let result;
          
          // If audioUrl provided, create track with audio in one request
          if (validated.audioUrl) {
            // Extract release ID from IRI if needed
            const releaseIdMatch = validated.releaseId.match(/\/(\d+)$/) || validated.releaseId.match(/^(\d+)$/);
            const releaseId = releaseIdMatch ? releaseIdMatch[1] : validated.releaseId;
            
            result = await dittoClient.createTrackWithAudio(
              releaseId,
              validated.audioUrl,
              `${validated.title.replace(/[^a-zA-Z0-9]/g, '_')}.mp3`
            );
          } else {
            // Create track metadata only (no audio)
            result = await dittoClient.createTrack({
              title: validated.title,
              releaseId: validated.releaseId,
              artistId: validated.artistId,
              isrc: validated.isrc,
              explicit: validated.explicit,
              languageCode: validated.language,
              trackNumber: validated.trackNumber,
            });
          }
          
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }
        
        // Mock response
        const mockResult = createMockUploadResponse(validated.title, 'Artist');
        return {
          content: [{ type: 'text', text: JSON.stringify({ ...mockResult, _mock: true }, null, 2) }],
        };
      }

      // ============================================
      // Release Tools
      // ============================================
      case 'create_release': {
        const validated = createReleaseSchema.parse(args);
        
        if (dittoClient) {
          const result = await dittoClient.createRelease({
            title: validated.title,
            artistId: validated.artistId,
            releaseDate: validated.releaseDate,
            upc: validated.upc,
            copyrightLine: validated.copyrightHolder,
            copyrightYear: validated.copyrightYear,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              '@id': `/api/me/releases/music/release_${Date.now()}`,
              title: validated.title,
              artist: validated.artistId,
              originalReleaseDate: validated.releaseDate,
              status: 'draft',
              createdAt: new Date().toISOString(),
              _mock: true,
            }, null, 2),
          }],
        };
      }

      case 'submit_release': {
        const validated = submitReleaseSchema.parse(args);
        
        if (dittoClient) {
          // Map DSP names to store IDs
          const storeIds: string[] = [];
          for (const dsp of validated.dsps) {
            const storeId = await getStoreId(dsp as DSP);
            if (storeId) storeIds.push(storeId);
          }
          
          const result = await dittoClient.submitToStores(validated.releaseId, storeIds);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }
        
        // Mock response
        const mockResult = createMockSubmitReleaseResponse(
          'Release',
          'Artist',
          ['track_1'],
          validated.dsps as DSP[],
          new Date().toISOString()
        );
        return {
          content: [{ type: 'text', text: JSON.stringify({ ...mockResult, _mock: true }, null, 2) }],
        };
      }

      case 'get_release_status': {
        const validated = getReleaseStatusSchema.parse(args);
        
        if (dittoClient) {
          const result = await dittoClient.getRelease(validated.releaseId);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }
        
        const mockResult = getMockReleaseStatus(validated.releaseId);
        return {
          content: [{ type: 'text', text: JSON.stringify({ ...mockResult, _mock: true }, null, 2) }],
        };
      }

      case 'get_releases': {
        if (dittoClient) {
          const result = await dittoClient.getReleases();
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              'hydra:member': [
                { '@id': '/api/me/releases/music/1', title: 'Demo Release', status: 'live', _mock: true }
              ],
              _mock: true,
            }, null, 2),
          }],
        };
      }

      // ============================================
      // Earnings & Streams
      // ============================================
      case 'get_earnings': {
        const validated = earningsQuerySchema.parse(args);
        
        if (dittoClient) {
          const storeId = validated.dsp ? await getStoreId(validated.dsp as DSP) : undefined;
          const result = await dittoClient.getEarnings({
            releaseId: validated.releaseId,
            trackId: validated.trackId,
            startDate: validated.startDate,
            endDate: validated.endDate,
            storeId: storeId || undefined,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }
        
        const mockResult = getMockEarnings(
          validated.releaseId,
          validated.trackId,
          validated.startDate,
          validated.endDate,
          validated.dsp as DSP | undefined
        );
        return {
          content: [{ type: 'text', text: JSON.stringify({ ...mockResult, _mock: true }, null, 2) }],
        };
      }

      case 'get_streams': {
        const validated = streamsQuerySchema.parse(args);
        
        if (dittoClient) {
          const storeId = validated.dsp ? await getStoreId(validated.dsp as DSP) : undefined;
          const result = await dittoClient.getStreams({
            releaseId: validated.releaseId,
            trackId: validated.trackId,
            startDate: validated.startDate,
            endDate: validated.endDate,
            storeId: storeId || undefined,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }
        
        const mockResult = getMockStreams(
          validated.releaseId,
          validated.trackId,
          validated.startDate,
          validated.endDate,
          validated.dsp as DSP | undefined
        );
        return {
          content: [{ type: 'text', text: JSON.stringify({ ...mockResult, _mock: true }, null, 2) }],
        };
      }

      // ============================================
      // Splits
      // ============================================
      case 'set_splits': {
        const validated = setSplitsSchema.parse(args);
        
        if (dittoClient) {
          const result = await dittoClient.setReleaseSplits(validated.releaseId, validated.splits as Split[]);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }
        
        const mockResult = setMockSplits(validated.releaseId, validated.splits as Split[]);
        return {
          content: [{ type: 'text', text: JSON.stringify({ ...mockResult, _mock: true }, null, 2) }],
        };
      }

      // ============================================
      // Account & Lookups
      // ============================================
      case 'get_account': {
        if (dittoClient) {
          const [me, balances] = await Promise.all([
            dittoClient.getMe(),
            dittoClient.getAccountBalances(),
          ]);
          return {
            content: [{ type: 'text', text: JSON.stringify({ user: me, balances }, null, 2) }],
          };
        }
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              user: { email: 'demo@example.com', name: 'Demo User' },
              balances: { available: 1234.56, pending: 567.89, currency: 'USD' },
              _mock: true,
            }, null, 2),
          }],
        };
      }

      case 'get_stores': {
        if (dittoClient) {
          const result = await dittoClient.getStores();
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              'hydra:member': [
                { '@id': '/api/lookup/stores/1', name: 'Spotify' },
                { '@id': '/api/lookup/stores/2', name: 'Apple Music' },
                { '@id': '/api/lookup/stores/3', name: 'YouTube Music' },
                { '@id': '/api/lookup/stores/4', name: 'TikTok' },
                { '@id': '/api/lookup/stores/5', name: 'Amazon Music' },
              ],
              _mock: true,
            }, null, 2),
          }],
        };
      }

      case 'get_genres': {
        if (dittoClient) {
          const result = await dittoClient.getGenres();
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              'hydra:member': [
                { '@id': '/api/lookup/genres/1', name: 'Electronic' },
                { '@id': '/api/lookup/genres/2', name: 'Pop' },
                { '@id': '/api/lookup/genres/3', name: 'Hip-Hop' },
                { '@id': '/api/lookup/genres/4', name: 'Rock' },
                { '@id': '/api/lookup/genres/5', name: 'R&B' },
              ],
              _mock: true,
            }, null, 2),
          }],
        };
      }

      // ============================================
      // Artwork Tools
      // ============================================
      case 'upload_artwork': {
        const validated = uploadArtworkSchema.parse(args);
        
        if (!dittoClient) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: 'Ditto API not configured',
                message: 'Set DITTO_EMAIL and DITTO_PASSWORD in .env to enable artwork upload.',
              }, null, 2),
            }],
            isError: true,
          };
        }
        
        const result = await dittoClient.uploadArtwork(validated.releaseId, validated.imageUrl);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'generate_artwork': {
        const validated = generateArtworkSchema.parse(args);
        
        if (!dittoClient) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: 'Ditto API not configured',
                message: 'Set DITTO_EMAIL and DITTO_PASSWORD in .env to enable artwork generation.',
              }, null, 2),
            }],
            isError: true,
          };
        }
        
        const result = await dittoClient.generateArtwork(validated.releaseId, validated.prompt);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      // ============================================
      // Suno AI Music Generation
      // ============================================
      case 'generate_music': {
        const validated = generateMusicSchema.parse(args);

        if (!sunoClient) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: 'Suno API not configured',
                message: 'Set SUNO_API_KEY in .env to enable AI music generation.',
              }, null, 2),
            }],
            isError: true,
          };
        }

        // Start generation
        const task = await sunoClient.generateMusic({
          prompt: validated.prompt,
          style: validated.style,
          instrumental: validated.instrumental,
          lyrics: validated.lyrics,
          title: validated.title,
        });

        // Wait for completion
        const result = await sunoClient.waitForCompletion(task.taskId);

        // Format tracks with clear URL info
        const formattedTracks = result.tracks?.map(track => ({
          id: track.id,
          title: track.title,
          duration: track.duration,
          tags: track.tags,
          // Primary audio URL (download/play)
          audioUrl: track.audioUrl,
          // Streaming URL (may work better for playback)
          streamUrl: track.streamAudioUrl,
          // Cover image
          imageUrl: track.imageUrl,
          // Recommendation: try streamUrl first, fall back to audioUrl
          recommendedUrl: track.streamAudioUrl || track.audioUrl,
        }));

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'completed',
              taskId: task.taskId,
              prompt: validated.prompt,
              style: validated.style,
              instrumental: validated.instrumental ?? false,
              trackCount: formattedTracks?.length || 0,
              tracks: formattedTracks,
              note: 'Use recommendedUrl for playback. If timeout occurs, try audioUrl directly.',
            }, null, 2),
          }],
        };
      }

      // ============================================
      // One-Shot AI Release Tool
      // ============================================
      case 'release_ai_track': {
        const validated = releaseAiTrackSchema.parse(args);

        // Check required clients
        if (!sunoClient) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: 'Suno API not configured',
                message: 'Set SUNO_API_KEY in .env to enable AI music generation.',
              }, null, 2),
            }],
            isError: true,
          };
        }

        if (!dittoClient) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: 'Ditto API not configured',
                message: 'Set DITTO_EMAIL and DITTO_PASSWORD in .env to enable distribution.',
              }, null, 2),
            }],
            isError: true,
          };
        }

        const steps: string[] = [];
        
        try {
          // Step 1: Generate music with Suno
          const usingCustomLyrics = !!validated.lyrics;
          if (usingCustomLyrics) {
            steps.push('🎵 Generating music with your custom lyrics...');
          } else {
            steps.push('🎵 Generating music with Suno AI...');
          }
          console.error(`[release_ai_track] Step 1: Generating music (custom lyrics: ${usingCustomLyrics})...`);
          
          const task = await sunoClient.generateMusic({
            prompt: validated.prompt,
            style: validated.style,
            instrumental: validated.instrumental,
            lyrics: validated.lyrics,
            title: validated.trackTitle,
          });
          
          steps.push(`   Task ID: ${task.taskId}`);
          console.error(`[release_ai_track] Task ID: ${task.taskId}`);

          // Step 2: Wait for completion
          steps.push('⏳ Waiting for music generation to complete...');
          console.error('[release_ai_track] Step 2: Waiting for completion...');
          
          const sunoResult = await sunoClient.waitForCompletion(task.taskId);
          const generatedTrack = sunoResult.tracks?.[0];
          
          if (!generatedTrack) {
            throw new Error('No tracks were generated');
          }
          
          steps.push(`   ✅ Generated: "${generatedTrack.title}" (${Math.round(generatedTrack.duration || 0)}s)`);
          steps.push(`   Audio URL: ${generatedTrack.audioUrl}`);

          // Step 3: Find or create artist on Ditto
          steps.push(`👤 Looking for artist "${validated.artistName}" on Ditto...`);
          console.error(`[release_ai_track] Step 3: Finding or creating artist: ${validated.artistName}`);
          
          // Check if artist already exists
          const existingArtists = await dittoClient.getArtists();
          const artistList = Array.isArray(existingArtists) ? existingArtists : (existingArtists['hydra:member'] || []);
          const existingArtist = artistList.find(
            (a: any) => a.name?.toLowerCase() === validated.artistName.toLowerCase()
          );
          
          let artistId: number;
          let artistIri: string;
          
          if (existingArtist) {
            artistId = existingArtist.id;
            artistIri = `/api/me/artists/${artistId}`;
            steps.push(`   ✅ Found existing artist (ID: ${artistId})`);
            console.error(`[release_ai_track] Using existing artist: ${artistId}`);
          } else {
            const artistResult = await dittoClient.createArtist(validated.artistName);
            artistId = artistResult.id;
            artistIri = `/api/me/artists/${artistId}`;
            steps.push(`   ✅ Created new artist (ID: ${artistId})`);
            console.error(`[release_ai_track] Created new artist: ${artistId}`);
          }

          // Step 3b: Create/get wallet for artist
          let artistWallet: string | null = null;
          if (isCdpConfigured()) {
            steps.push(`💰 Setting up royalty wallet...`);
            console.error(`[release_ai_track] Step 3b: Creating wallet for ${validated.artistName}`);
            artistWallet = await createArtistWallet(validated.artistName);
            if (artistWallet) {
              steps.push(`   ✅ Wallet: ${artistWallet.slice(0, 6)}...${artistWallet.slice(-4)}`);
            } else {
              steps.push(`   ⚠️ Wallet creation skipped`);
            }
          }

          // Step 4: Create release on Ditto
          steps.push(`💿 Creating release "${validated.trackTitle}" for ${validated.releaseDate}...`);
          console.error(`[release_ai_track] Step 4: Creating release: ${validated.trackTitle}`);
          
          const releaseResult = await dittoClient.createRelease({
            title: validated.trackTitle,
            artistId: artistIri,
            releaseDate: validated.releaseDate,
            copyrightLine: validated.artistName,
            copyrightYear: new Date().getFullYear(),
          });
          const releaseId = releaseResult.id;
          const releaseIri = `/api/me/releases/music/${releaseId}`;
          
          steps.push(`   ✅ Release ID: ${releaseId}`);

          // Step 5: Create track with audio
          steps.push(`🎤 Creating track with audio...`);
          console.error(`[release_ai_track] Step 5: Creating track with audio from ${generatedTrack.audioUrl}`);
          
          const trackResult = await dittoClient.createTrackWithAudio(
            releaseId.toString(),
            generatedTrack.audioUrl,
            `${validated.trackTitle.replace(/[^a-zA-Z0-9]/g, '_')}.mp3`
          );
          const trackId = trackResult.id || trackResult['@id']?.match(/\/(\d+)$/)?.[1];
          
          steps.push(`   ✅ Track created with audio (ID: ${trackId})`);

          // Step 5b: Generate artwork (if requested)
          let artworkResult = null;
          if (validated.artworkPrompt) {
            steps.push(`🎨 Generating AI artwork...`);
            console.error(`[release_ai_track] Step 5b: Generating artwork with prompt: ${validated.artworkPrompt}`);
            
            try {
              artworkResult = await dittoClient.generateArtwork(releaseId.toString(), validated.artworkPrompt);
              steps.push(`   ✅ Artwork generated successfully`);
            } catch (artworkError) {
              const artworkErrorMsg = artworkError instanceof Error ? artworkError.message : String(artworkError);
              steps.push(`   ⚠️ Artwork generation failed: ${artworkErrorMsg}`);
              console.error(`[release_ai_track] Artwork error: ${artworkErrorMsg}`);
            }
          }

          // Step 6: Submit to DSPs (if specified)
          let submissionResult = null;
          if (validated.dsps && validated.dsps.length > 0) {
            steps.push(`📡 Submitting to ${validated.dsps.length} DSPs: ${validated.dsps.join(', ')}...`);
            console.error(`[release_ai_track] Step 6: Submitting to DSPs: ${validated.dsps.join(', ')}`);
            
            const storeIds: string[] = [];
            for (const dsp of validated.dsps) {
              const storeId = await getStoreId(dsp as DSP);
              if (storeId) storeIds.push(storeId);
            }
            
            if (storeIds.length > 0) {
              submissionResult = await dittoClient.submitToStores(releaseId.toString(), storeIds);
              steps.push(`   ✅ Submitted to stores`);
            } else {
              steps.push(`   ⚠️ Could not resolve store IDs`);
            }
          }

          steps.push('');
          steps.push('🎉 Release setup complete!');

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                steps: steps,
                summary: {
                  artistName: validated.artistName,
                  artistId: artistId,
                  artistWallet: artistWallet,
                  trackTitle: validated.trackTitle,
                  releaseId: releaseId,
                  trackId: trackId,
                  releaseDate: validated.releaseDate,
                  dspsSubmitted: validated.dsps || [],
                },
                sunoTrack: {
                  title: generatedTrack.title,
                  audioUrl: generatedTrack.audioUrl,
                  streamUrl: generatedTrack.streamAudioUrl,
                  imageUrl: generatedTrack.imageUrl,
                  duration: generatedTrack.duration,
                },
                allGeneratedTracks: sunoResult.tracks,
              }, null, 2),
            }],
          };
        } catch (stepError) {
          const errorMsg = stepError instanceof Error ? stepError.message : String(stepError);
          steps.push(`❌ Error: ${errorMsg}`);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                steps: steps,
                error: errorMsg,
              }, null, 2),
            }],
            isError: true,
          };
        }
      }

      // ============================================
      // Wallet Tools
      // ============================================
      case 'get_my_wallet': {
        const validated = getMyWalletSchema.parse(args);
        const wallet = getArtistWallet(validated.artistName);
        
        if (wallet) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                artistName: validated.artistName,
                walletAddress: wallet,
                network: 'Base',
                message: `This is ${validated.artistName}'s wallet for receiving royalties.`,
              }, null, 2),
            }],
          };
        }
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              artistName: validated.artistName,
              walletAddress: null,
              message: 'No wallet found. A wallet will be created automatically when you release music.',
            }, null, 2),
          }],
        };
      }

      case 'get_my_balance': {
        const validated = getMyBalanceSchema.parse(args);
        const wallet = getArtistWallet(validated.artistName);
        
        if (!wallet) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                artistName: validated.artistName,
                error: 'No wallet found for this artist. Release music first to create a wallet.',
              }, null, 2),
            }],
          };
        }
        
        const balance = await getWalletBalance(wallet);
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              artistName: validated.artistName,
              walletAddress: wallet,
              balance: balance,
              network: 'Base',
            }, null, 2),
          }],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        content: [{
          type: 'text',
          text: `Validation error: ${JSON.stringify(error.errors, null, 2)}`,
        }],
        isError: true,
      };
    }
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Opulous Distro MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
