import Anthropic from '@anthropic-ai/sdk';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const API_BASE = process.env.DISTRO_API_URL || 'https://distro-nu.vercel.app';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Tool definitions for Claude
const tools: Anthropic.Tool[] = [
  {
    name: 'create_artist',
    description: 'Create a new artist profile',
    input_schema: {
      type: 'object' as const,
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
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'create_release',
    description: 'Create a new release (single/EP/album)',
    input_schema: {
      type: 'object' as const,
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
    input_schema: {
      type: 'object' as const,
      properties: {
        releaseId: { type: 'string', description: 'Release ID' },
      },
      required: ['releaseId'],
    },
  },
  {
    name: 'get_releases',
    description: 'List all releases',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'generate_music',
    description: 'Generate AI music with Suno. Use lyrics parameter for custom lyrics with [Verse], [Chorus] tags.',
    input_schema: {
      type: 'object' as const,
      properties: {
        prompt: { type: 'string', description: 'Music description (used as style when lyrics provided)' },
        style: { type: 'string', description: 'Musical style' },
        lyrics: { type: 'string', description: 'Custom lyrics with [Verse], [Chorus] tags' },
        title: { type: 'string', description: 'Track title' },
        instrumental: { type: 'boolean', description: 'Instrumental only (no vocals)' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'upload_track',
    description: 'Upload a track to a release',
    input_schema: {
      type: 'object' as const,
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
    input_schema: {
      type: 'object' as const,
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
    input_schema: {
      type: 'object' as const,
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
    input_schema: {
      type: 'object' as const,
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
    input_schema: {
      type: 'object' as const,
      properties: {
        artistName: { type: 'string', description: 'Artist name' },
      },
      required: ['artistName'],
    },
  },
];

// Call Distro API
async function callDistroApi(toolName: string, input: any): Promise<any> {
  let endpoint: string;
  let method = 'POST';
  let body: any = input;

  switch (toolName) {
    case 'create_artist':
      endpoint = '/api/artist';
      break;
    case 'get_artists':
      endpoint = '/api/artists';
      method = 'GET';
      body = undefined;
      break;
    case 'create_release':
      endpoint = '/api/release';
      break;
    case 'get_release_status':
      endpoint = `/api/release/${input.releaseId}`;
      method = 'GET';
      body = undefined;
      break;
    case 'get_releases':
      endpoint = '/api/releases';
      method = 'GET';
      body = undefined;
      break;
    case 'generate_music': {
      // Start async generation
      const genRes = await fetch(`${API_BASE}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, wait: false }),
      });
      const genData = await genRes.json();
      if (!genRes.ok) throw new Error(genData.error || 'Generation failed');
      
      const taskId = genData.taskId;
      console.log(`[Generate] Started task ${taskId}, polling...`);
      
      // Poll for completion (max 2 minutes)
      for (let i = 0; i < 24; i++) {
        await new Promise(r => setTimeout(r, 5000)); // Wait 5s
        const statusRes = await fetch(`${API_BASE}/api/generate/status/${taskId}`);
        const statusData = await statusRes.json();
        console.log(`[Generate] Poll ${i+1}: ${statusData.status}`);
        
        if (statusData.status === 'SUCCESS' && statusData.tracks) {
          return statusData;
        }
        if (statusData.status === 'FAILED') {
          throw new Error('Generation failed');
        }
      }
      throw new Error('Generation timed out');
    }
    case 'upload_track':
      endpoint = '/api/upload-track';
      break;
    case 'upload_artwork':
      endpoint = '/api/upload-artwork';
      break;
    case 'submit_release':
      endpoint = '/api/submit';
      break;
    case 'set_wallet':
      endpoint = '/api/wallet';
      break;
    case 'get_wallet':
      endpoint = `/api/wallet/${encodeURIComponent(input.artistName)}`;
      method = 'GET';
      body = undefined;
      break;
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }

  const url = `${API_BASE}${endpoint}`;
  console.log(`[Distro] ${method} ${url}`);

  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `API error: ${response.status}`);
  }
  return data;
}

const SYSTEM_PROMPT = `You are Distro, an AI assistant for music distribution.

IMPORTANT:
- NO LOGIN OR SIGNUP REQUIRED - everything works automatically
- Just use the tools directly - never ask users to authenticate or create accounts
- The API handles all authentication behind the scenes

INTENT HANDLING:
- Clear intent to CREATE ("make a beat", "create a song", "generate music") → ask genre/style, then proceed
- Clear intent with EXISTING track ("I have a song to upload") → ask for the audio URL
- Ambiguous ("release a song", "distribute my music") → ask: "Do you have a track ready, or want me to create one?"

RULES:
- Ask ONE question at a time
- Keep responses short (2-3 sentences max)
- Be natural and conversational - vary your responses
- When you have enough info, USE THE TOOLS immediately
- Don't repeat the same questions verbatim

CREATING MUSIC FLOW:
1. Genre/style/vibe
2. Artist name
3. Track title
4. Then: generate_music → create_artist → create_release → upload_track → upload_artwork → submit_release

For lyrics: if provided, use them. Otherwise make instrumental.

URLS:
- Release status/tracking: https://distro-nu.vercel.app/api/release/{releaseId}
- Never show localhost URLs to users`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array required' });
    }

    // Convert to Anthropic format
    const anthropicMessages: Anthropic.MessageParam[] = messages.map((m: any) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    let response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools,
      messages: anthropicMessages,
    });

    // Handle tool calls in a loop
    while (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
      );

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        console.log(`[Tool] ${toolUse.name}:`, toolUse.input);
        try {
          const result = await callDistroApi(toolUse.name, toolUse.input);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(result),
          });
        } catch (error) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
            is_error: true,
          });
        }
      }

      // Continue conversation with tool results
      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools,
        messages: [
          ...anthropicMessages,
          { role: 'assistant', content: response.content },
          { role: 'user', content: toolResults },
        ],
      });
    }

    // Extract text response
    const textBlocks = response.content.filter(
      (block): block is Anthropic.TextBlock => block.type === 'text'
    );
    const responseText = textBlocks.map(b => b.text).join('\n');

    return res.status(200).json({ response: responseText });
  } catch (error) {
    console.error('Chat error:', error);
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Internal error' 
    });
  }
}
