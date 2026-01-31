---
name: distro
description: Distribute your music to Spotify, Apple Music, and all major streaming platforms.
author: lp-opul
version: 1.0.0
tags: [music, distribution, streaming, spotify, apple-music, artists, indie]
---

# Distro

Release your music to all major streaming platforms through conversation.

## What it does

- Distribute your tracks to Spotify, Apple Music, Amazon, Tidal, TikTok, and more
- Track release status and streaming analytics
- Manage artists and royalty splits
- Check your streams and earnings

## Example prompts

- "Release my track to Spotify and Apple Music for March 1st"
- "What's the status of my releases?"
- "How many streams did my last track get?"
- "Set up royalty splits: 60% me, 40% producer"
- "Create a new artist profile"

## Setup

1. Create an account at dittomusic.com
2. Add your credentials to environment

## Environment variables
```
DITTO_EMAIL=your-email
DITTO_PASSWORD=your-password
```

## Tools included

- `create_artist` — Create artist profile
- `create_release` — Create single/EP/album
- `upload_track` — Upload your track
- `submit_release` — Send to streaming platforms
- `get_release_status` — Check distribution status
- `get_streams` — View play counts
- `get_earnings` — View revenue
- `set_splits` — Configure royalty splits
