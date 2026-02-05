import Anthropic from '@anthropic-ai/sdk';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const API_BASE = process.env.DISTRO_API_URL || 'https://distromcp.xyz';

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
        artistName: { type: 'string', description: 'Artist name (used for copyright)' },
        title: { type: 'string', description: 'Release title' },
        releaseDate: { type: 'string', description: 'Release date (YYYY-MM-DD, 7+ days out)' },
        copyrightHolder: { type: 'string', description: 'Copyright holder name (defaults to artist)' },
        copyrightYear: { type: 'number', description: 'Copyright year (defaults to current year)' },
      },
      required: ['artistId', 'artistName', 'title', 'releaseDate'],
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
    name: 'complete_release',
    description: 'Complete the full release process from generated music - creates artist, release, uploads track and artwork, submits to all platforms. Use this after music generation is complete.',
    input_schema: {
      type: 'object' as const,
      properties: {
        taskId: { type: 'string', description: 'Generation task ID' },
        artistName: { type: 'string', description: 'Artist name' },
        trackTitle: { type: 'string', description: 'Track title' },
        style: { type: 'string', description: 'Music style (optional)' },
      },
      required: ['taskId', 'artistName', 'trackTitle'],
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

// Human-readable status messages for each tool
const toolStatusMessages: Record<string, string> = {
  create_artist: '🎤 Creating artist profile...',
  get_artists: '📋 Getting artists...',
  create_release: '💿 Setting up release...',
  get_release_status: '📊 Checking release status...',
  get_releases: '📋 Getting releases...',
  generate_music: '🎵 Generating your song (this takes about 1 minute)...',
  upload_track: '📤 Uploading track to release...',
  upload_artwork: '🎨 Uploading artwork...',
  submit_release: '🚀 Submitting to streaming platforms...',
  set_wallet: '💰 Setting wallet address...',
  get_wallet: '💰 Getting wallet info...',
};

// Call Distro API with status callback
async function callDistroApi(
  toolName: string, 
  input: any, 
  onStatus?: (msg: string) => void
): Promise<any> {
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
      // Start async generation - return immediately with taskId
      const genRes = await fetch(`${API_BASE}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, wait: false }),
      });
      const genData = await genRes.json();
      if (!genRes.ok) throw new Error(genData.error || 'Generation failed');
      
      // Return immediately - frontend will poll
      return {
        success: true,
        taskId: genData.taskId,
        status: 'GENERATING',
        message: 'Music generation started! This takes about 60-90 seconds.',
        pollUrl: `${API_BASE}/api/generate/status/${genData.taskId}`,
      };
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
    case 'complete_release':
      endpoint = '/api/release-full';
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
- Clear intent to CREATE ("make a beat", "create a song", "generate music") → ask for artist name first
- Clear intent with EXISTING track ("I have a song to upload") → ask for the audio URL
- Ambiguous ("release a song", "distribute my music") → ask: "Do you have a track ready, or want me to create one?"

RULES:
- Ask ONE question at a time
- Keep responses short (2-3 sentences max)
- Be natural and conversational - vary your responses
- NEVER generate music without asking for artist name and track title first!
- Don't repeat the same questions verbatim

REQUIRED INFO BEFORE GENERATING:
You need these 4 things before calling generate_music:
1. Style/genre (can be vague like "lofi" or "chill beats")
2. Lyrics or instrumental? Ask: "Do you have lyrics, or should I make it instrumental?"
   - If they provide lyrics → use them, check if explicit (profanity, adult themes)
   - If instrumental → set explicit=false
3. Artist name (MUST ASK - e.g. "What artist name should we release this under?")
4. Track title (MUST ASK - e.g. "What should we call this track?")

CREATIVE FLOW - BE CONVERSATIONAL:

Help them create their song step by step. Ask naturally, one question at a time:

1. GENRE/STYLE - "What kind of music are you feeling?"
   
2. LYRICS - If they want lyrics:
   - "What should the song be about?" (theme, story, emotion)
   - "Any specific mood - upbeat, emotional, reflective?"
   - Help them develop the concept, suggest ideas if they're stuck
   - Once you have the theme/mood, write the lyrics and SHOW THEM FIRST
   - Ask: "Here are the lyrics - want me to make any changes?"
   - After lyrics are approved, ask: "Male or female vocalist? And any vocal style preference (e.g., raspy, smooth, powerful, soft)?"
   - Only generate after they've chosen the vocalist
   
3. ARTIST NAME - "What name should we release this under?"

4. TRACK TITLE - "What should we call it?" (can suggest based on theme)

Be creative and collaborative! If they say "I want lyrics about heartbreak" - ask follow-up questions like "Tell me more - is this about moving on, or still in the pain?" 

Build the song concept WITH them before generating.

DO NOT call generate_music until you have: genre, lyrics OR instrumental, artist name, track title.

When generating with lyrics:
- Use customMode=true, put lyrics in the prompt field
- In the style field, include: genre + vocalist (e.g., "country, female vocalist, smooth voice")
- Check your lyrics for explicit content → set explicit accordingly

VOCALIST OPTIONS to offer:
- Male vocalist (can add: raspy, smooth, deep, powerful, soft)
- Female vocalist (can add: raspy, smooth, powerful, soft, ethereal)
- Duet (male and female)
- No vocals / instrumental

MUSIC GENERATION:
When generate_music returns a taskId and status "GENERATING", include this EXACT format in your response:
"Starting generation! taskId: {taskId}"
The frontend will handle polling. Do NOT wait or check status yourself.

DISTRIBUTION TIMING:
- After submission, releases typically go live within 7 days (can be faster)
- Don't promise specific timeframes beyond this

AFTER MUSIC IS GENERATED:
When you receive a message with "Audio URL:" - this is the generated track!

Call the complete_release tool with:
- taskId (from the generation)
- artistName (the artist name they chose)
- trackTitle (the track title they chose)

This tool handles EVERYTHING in one call: creates artist, release, uploads audio + artwork, submits to all platforms.

DO NOT call individual tools (create_artist, create_release, upload_track, etc.) - use complete_release instead!

URLS:
- Release status/tracking: https://distromcp.xyz/status/{releaseId}
- Never show localhost URLs to users`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check if client wants streaming
  const wantsStream = req.headers.accept?.includes('text/event-stream');
  
  if (wantsStream) {
    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    
    try {
      const { messages } = req.body;
      if (!messages || !Array.isArray(messages)) {
        sendEvent('error', { error: 'Messages array required' });
        return res.end();
      }

      const anthropicMessages: Anthropic.MessageParam[] = messages.map((m: any) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      sendEvent('status', { message: '🤔 Thinking...' });

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

        // Show what Claude said before using tools
        const textBlocks = response.content.filter(
          (block): block is Anthropic.TextBlock => block.type === 'text'
        );
        if (textBlocks.length > 0) {
          sendEvent('text', { text: textBlocks.map(b => b.text).join('\n') });
        }

        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolUse of toolUseBlocks) {
          const statusMsg = toolStatusMessages[toolUse.name] || `Running ${toolUse.name}...`;
          sendEvent('status', { message: statusMsg });
          
          console.log(`[Tool] ${toolUse.name}:`, toolUse.input);
          try {
            const result = await callDistroApi(
              toolUse.name, 
              toolUse.input,
              (msg) => sendEvent('status', { message: msg })
            );
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: JSON.stringify(result),
            });
          } catch (error) {
            sendEvent('status', { message: `❌ ${toolUse.name} failed` });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
              is_error: true,
            });
          }
        }

        sendEvent('status', { message: '🤔 Processing results...' });

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

      // Extract final text response
      const textBlocks = response.content.filter(
        (block): block is Anthropic.TextBlock => block.type === 'text'
      );
      const responseText = textBlocks.map(b => b.text).join('\n');

      sendEvent('done', { response: responseText });
      return res.end();
    } catch (error) {
      console.error('Chat error:', error);
      sendEvent('error', { error: error instanceof Error ? error.message : 'Internal error' });
      return res.end();
    }
  }

  // Non-streaming fallback
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array required' });
    }

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

    // Track if music generation was started
    let generationTaskId: string | null = null;

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
          
          // Capture taskId if this is a generate_music call
          if (toolUse.name === 'generate_music' && result.taskId) {
            generationTaskId = result.taskId;
            console.log(`[Generate] Started with taskId: ${generationTaskId}`);
          }
          
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
    let responseText = textBlocks.map(b => b.text).join('\n');
    
    // If music generation started, append taskId to ensure frontend can detect it
    if (generationTaskId) {
      responseText += `\n\n[taskId: ${generationTaskId}]`;
    }

    return res.status(200).json({ response: responseText, taskId: generationTaskId });
  } catch (error) {
    console.error('Chat error:', error);
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Internal error' 
    });
  }
}
