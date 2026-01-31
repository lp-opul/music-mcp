# opulous-distro-mcp

MCP server wrapping Ditto's music distribution APIs for uploading tracks, submitting releases to DSPs, and managing earnings.

## Features

- **upload_track** - Upload audio files with metadata
- **submit_release** - Submit releases to Spotify, Apple Music, etc.
- **get_release_status** - Check distribution status across platforms
- **get_earnings** - Query revenue from streams
- **get_streams** - Query play counts
- **set_splits** - Configure revenue sharing between collaborators

## Installation

```bash
npm install
npm run build
```

## Development

Run with hot reload:
```bash
npm run dev
```

## Configuration

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "opulous-distro-mcp": {
      "command": "node",
      "args": ["/path/to/opulous-distro-mcp/dist/index.js"]
    }
  }
}
```

## API Endpoints (for future implementation)

This server is designed to wrap Ditto's APIs:

- Releases API: https://releases.dittomusic.com/api/docs
- Sales API: https://sales.dittomusic.com/api/docs
- Payouts API: https://payouts.dittomusic.com/api/docs
- Trends API: https://trends.dittomusic.com/api/docs
- Sales-Splits API: https://sales-splits.dittomusic.com/api/docs

## Current Status

**Mock Mode**: All tools currently return mock data. Set `DITTO_API_KEY` environment variable when credentials are available to enable real API calls.

## Tool Examples

### Upload a track

```json
{
  "tool": "upload_track",
  "arguments": {
    "audioBase64": "<base64-encoded-audio>",
    "audioFormat": "wav",
    "title": "Summer Vibes",
    "artist": "DJ Example",
    "genre": "Electronic",
    "explicit": false,
    "language": "en"
  }
}
```

### Submit a release

```json
{
  "tool": "submit_release",
  "arguments": {
    "title": "Summer Vibes EP",
    "artist": "DJ Example",
    "trackIds": ["track_123", "track_456"],
    "releaseDate": "2024-06-01",
    "dsps": ["spotify", "apple_music", "youtube_music"],
    "genre": "Electronic",
    "copyrightHolder": "DJ Example",
    "copyrightYear": 2024
  }
}
```

### Check release status

```json
{
  "tool": "get_release_status",
  "arguments": {
    "releaseId": "release_abc123"
  }
}
```

### Configure revenue splits

```json
{
  "tool": "set_splits",
  "arguments": {
    "releaseId": "release_abc123",
    "splits": [
      {
        "collaboratorEmail": "artist@example.com",
        "collaboratorName": "Main Artist",
        "percentage": 60,
        "role": "Artist"
      },
      {
        "collaboratorEmail": "producer@example.com",
        "collaboratorName": "Beat Producer",
        "percentage": 40,
        "role": "Producer"
      }
    ]
  }
}
```

## License

MIT
