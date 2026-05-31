# Deepgram Setup Guide

## Overview

This project uses **Deepgram Nova-3** for Thai speech-to-text transcription with speaker diarization. Deepgram provides superior speaker detection compared to Google Cloud Speech-to-Text for Thai language.

## Why Deepgram?

- ✅ Native support for Thai language with speaker diarization
- ✅ No need to upload files to cloud storage (direct streaming)
- ✅ Simple REST API - easier to deploy on platforms like Render.com
- ✅ Accurate speaker detection (2+ speakers)
- ✅ Fast processing with Nova-3 model

## Setup Instructions

### 1. Sign up for Deepgram

1. Go to [https://deepgram.com](https://deepgram.com)
2. Create a free account
3. You'll get **$200 free credits** (enough for ~45 hours of audio)

### 2. Get API Key

1. Log in to [Deepgram Console](https://console.deepgram.com/)
2. Navigate to **API Keys** section
3. Create a new API key
4. Copy the API key

### 3. Add to Environment Variables

Add this line to your `.env` file:

```bash
DEEPGRAM_API_KEY=your_api_key_here
```

### 4. Deploy to Render.com

In your Render.com service settings:

1. Go to **Environment** tab
2. Add environment variable:
   - Key: `DEEPGRAM_API_KEY`
   - Value: Your Deepgram API key

## Pricing

| Plan          | Price       | Audio Hours              |
| ------------- | ----------- | ------------------------ |
| Free Trial    | $0          | ~45 hours ($200 credits) |
| Pay as you go | $0.0043/min | ~$0.26/hour              |

Example: 100 hours of audio = ~$26/month

## Features Used

- **Model**: Nova-3 (most accurate)
- **Language**: Thai (`th`)
- **Diarization**: Enabled (speaker detection)
- **Smart Formatting**: Automatic punctuation and formatting
- **Utterances**: Speaker-segmented text outputs

## API Limits

- Max file size: 2 GB
- Max duration: 360 minutes (6 hours) per request
- Concurrent requests: Depends on your plan

## Migration from Google STT

The code has been updated to use Deepgram instead of Google Cloud Speech-to-Text V2 (Chirp 3) because:

1. Thai language is not officially supported for diarization in Google STT
2. Deployment is simpler (no Python dependencies, no GCS bucket required)
3. Better accuracy for Thai speaker detection

## Support

- Documentation: https://developers.deepgram.com/docs
- Community: https://discord.gg/deepgram
- Email: support@deepgram.com
