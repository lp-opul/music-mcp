# Music MCP

AI-powered music distribution. Generate songs and release to Spotify, Apple Music & 150+ platforms.

**[Try it now →](https://web-navy-eight-33.vercel.app)**

## What it does

1. **Generate music** - Create songs with AI (lyrics or instrumental)
2. **Distribute** - Release to Spotify, Apple Music, Amazon, YouTube Music, TikTok, and more
3. **Track** - Monitor your releases across platforms

## Quick Start

### Option 1: Web UI (easiest)

Visit **https://web-navy-eight-33.vercel.app** and start chatting.

### Option 2: Claude Desktop

1. Clone this repo:
```bash
git clone https://github.com/lp-opul/music-mcp.git
cd music-mcp
npm install
npm run build
```

2. Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "music-mcp": {
      "command": "node",
      "args": ["/path/to/music-mcp/dist/index.js"],
      "env": {
        "SUNO_API_KEY": "your-suno-key",
        "DITTO_EMAIL": "your-ditto-email",
        "DITTO_PASSWORD": "your-ditto-password"
      }
    }
  }
}
```

3. Restart Claude Desktop

## Features

| Feature | Description |
|---------|-------------|
| AI Music Generation | Create songs from text prompts |
| Custom Lyrics | Write your own lyrics with [Verse], [Chorus] tags |
| Vocalist Selection | Choose male/female vocals or instrumental |
| Artwork Generation | AI-generated cover art |
| Multi-Platform Distribution | Spotify, Apple Music, Amazon, YouTube, TikTok, and 150+ more |
| Release Tracking | Monitor status across platforms |

## Available MCP Tools

| Tool | Description |
|------|-------------|
| `generate_music` | Create AI music (with or without lyrics) |
| `create_artist` | Set up artist profile |
| `create_release` | Create a new release |
| `upload_track` | Upload audio to release |
| `upload_artwork` | Add cover art (auto-upscales to 1400x1400) |
| `submit_release` | Submit to streaming platforms |
| `get_release_status` | Check distribution status |
| `release_ai_track` | All-in-one: generate, create, upload, submit |

## Supported Platforms

Spotify, Apple Music, Amazon Music, YouTube Music, TikTok, Instagram, Deezer, Tidal, Pandora, SoundCloud, and 150+ more.

## API

The hosted API is available at `https://distro-nu.vercel.app`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/generate` | POST | Generate AI music |
| `/api/artist` | POST | Create artist |
| `/api/release` | POST | Create release |
| `/api/upload-track` | POST | Upload track |
| `/api/upload-artwork` | POST | Upload artwork |
| `/api/submit` | POST | Submit to DSPs |
| `/api/release/:id` | GET | Get release status |
| `/status/:id` | GET | Release status page |

## Tech Stack

- **AI Music**: Suno API
- **Distribution**: Ditto Music API
- **MCP Server**: TypeScript + @modelcontextprotocol/sdk
- **Web UI**: Vanilla JS + Claude API
- **Hosting**: Vercel

## Rate Limits

- 3 music generations per day (per user)
- 5 releases per day (per user)

## License

MIT
