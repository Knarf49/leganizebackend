# Leganize

Real-time legal compliance monitoring for Thai company meetings. Records audio, transcribes speech, and flags violations of Thai corporate law (Civil and Commercial Code / Public Limited Companies Act) as the meeting happens.

## How It Works

```
Browser mic → WebSocket (PCM audio) → ASR service → transcript
                                                         ↓
                                          Risk Detector (LLM, fast)
                                                         ↓ YES
                                          Risk Analyzer (LangGraph, deep)
                                                         ↓
                                          legal-risk alert → all room clients
```

1. Browser streams raw PCM audio via WebSocket with silence detection
2. Server flushes audio chunks to ASR service → Thai transcript
3. **Stage 1** — fast LLM (OpenRouter) checks if transcript violates Thai law: quorum, voting thresholds, conflict of interest, agenda rules
4. **Stage 2** — if Stage 1 returns `YES`, LangGraph agent runs deep analysis with full legal citations
5. Legal risk alerts broadcast to all connected clients in the room in real-time

## Features

- Real-time audio recording with VAD (voice activity detection)
- Thai speech-to-text with speaker diarization
- Two-stage legal risk detection (fast pre-filter → deep analysis)
- Supports **บริษัทจำกัด** and **บริษัทมหาชนจำกัด** with correct legal rules per type
- Meeting types: AGM, EGM, BOD
- Meeting dashboard with calendar view
- Post-meeting summarization and Q&A
- Legal quiz mode for compliance training

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, React 19, Tailwind CSS v4, Framer Motion |
| Backend | Express + Next.js custom server, WebSocket (`ws`), SSE |
| AI — Risk Detector | OpenRouter (`gpt-oss-120b:free`) via LangChain |
| AI — Risk Analyzer | LangGraph (separate server in `/server`) |
| ASR | External Python service (Whisper-based, default `localhost:8000`) |
| Database | PostgreSQL via Prisma ORM |
| Cache / Queue | Redis (ioredis) |
| Deployment | Docker Compose |

## Prerequisites

- Node.js 20+
- PostgreSQL 16
- Redis 7
- ASR service running at `ASR_SERVICE_URL` (Python/Whisper, exposes `POST /transcribe`)
- LangGraph server running at `LANGGRAPH_URL`

## Quick Start

### Option A — Docker Compose (PostgreSQL + Redis only)

```bash
# Start postgres and redis
docker compose up postgres redis -d

# Install dependencies
npm install

# Set up env
cp .env.example .env
# edit .env — see Environment Variables section

# Run migrations
npx prisma migrate dev

# Seed sample data (optional)
npx prisma db seed

# Start dev server
npm run dev
```

### Option B — Full Docker

```bash
docker compose up
```

App runs at `http://localhost:3000`.

## Environment Variables

```env
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/leganize

# Redis
REDIS_URL=redis://localhost:6379

# ASR service (Python/Whisper)
ASR_SERVICE_URL=http://localhost:8000

# LangGraph server (risk analyzer)
LANGGRAPH_URL=http://localhost:8123

# LLM (risk detector)
OPENROUTER_API_KEY=your_openrouter_api_key

# Google Cloud (optional — legacy STT path)
GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json
```

## Project Structure

```
leganize/
├── app/                    # Next.js app router
│   ├── api/                # API routes
│   ├── dashboard/          # Meeting overview
│   ├── create-meeting/     # New room form
│   ├── record/             # Real-time recording + live transcript
│   ├── connect/            # Join existing room
│   ├── summarize/          # Post-meeting summary
│   ├── ask/                # Q&A against transcript
│   └── quiz/               # Legal compliance quiz
├── components/             # React components
├── lib/
│   ├── riskDetector.ts     # Stage 1: fast LLM risk check
│   ├── riskAnalyzer.ts     # Stage 2: LangGraph deep analysis
│   ├── prisma.ts           # Prisma client
│   └── redis.ts            # Redis client
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── server/                 # LangGraph agent server (separate app)
├── server.ts               # Express + Next.js + WebSocket entry
├── websocket.ts            # WebSocket server (audio streaming)
├── sse.ts                  # SSE broadcast
└── docker-compose.yml
```

## Database Models

| Model | Description |
|---|---|
| `Room` | Meeting session — type (AGM/EGM/BOD), company type, status, access token |
| `TranscriptChunk` | Individual transcribed segments |
| `LegalRisk` | Detected violations with legal basis, risk level, recommendation |
| `AnalysisLog` | Raw analyzer output for audit |

## Scripts

```bash
npm run dev          # Dev server with hot reload (tsx watch)
npm run build        # Next.js production build
npm run start        # Production server
npm run test:risk    # Test risk detector against sample transcript
npm run test:summary # Test meeting summarizer
```

## Legal Rules Monitored

The system checks Thai law in real-time during meetings:

| Area | บริษัทจำกัด | บริษัทมหาชนจำกัด |
|---|---|---|
| Quorum | ≥2 persons, ≥¼ of shares (§1178) | ≥25 persons, ≥⅓ of shares (§103) |
| Ordinary resolution | Simple majority | Simple majority |
| Special resolution | ≥¾ of attendees (§1194) | ≥¾ of attendees (§107) |
| Director removal | — | ¾ of persons + ½ of shares (§76) |
| Conflict of interest | Conflicted party cannot vote (§1185) | Conflicted party cannot vote (§33) |
| Agenda | Must be in notice, no new items at adjourned meeting (§1175, 1181) | Same |

## Disclaimer

Leganize is a compliance support tool. Output is **not legal advice**. Always have a qualified lawyer review findings before acting on them.

## License

MIT License © 2026 Leganize
