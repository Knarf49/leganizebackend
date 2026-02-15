# Prisma Setup Guide

## 1. Install Dependencies

```bash
npm install prisma tsx @types/pg --save-dev
npm install @prisma/client @prisma/adapter-pg dotenv pg
```

## 2. Initialize Prisma

```bash
npx prisma init --db --output ../app/generated/prisma
```

## 3. Configure Prisma Schema

Create or update `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
  output   = "../app/generated/prisma"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Room {
  id           String      @id @default(uuid())
  status       RoomStatus  @default(ACTIVE)
  threadId     String      @unique
  accessToken  String      @unique
  startedAt    DateTime    @default(now())
  endedAt      DateTime?
  finalSummary String?
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt
  companyType  CompanyType @default(LIMITED)
}

enum RoomStatus {
  ACTIVE
  ENDED
  ABORTED
}

enum CompanyType {
  LIMITED
  PUBLIC_LIMITED
}

model TranscriptChunk {
  id        String   @id @default(cuid())
  roomId    String
  content   String
  createdAt DateTime @default(now())
}

model LegalRisk {
  id                   String   @id @default(cuid())
  roomId               String
  riskLevel            String
  issueDescription     String
  legalBasisType       String
  legalBasisReference  String
  legalReasoning       String
  recommendation       String
  urgencyLevel         String
  rawJson              Json
  createdAt            DateTime @default(now())
}

model AnalysisLog {
  id        String   @id @default(cuid())
  roomId    String
  status    String
  rawOutput String
  error     String?
  createdAt DateTime @default(now())
}
```

## 4. Configure Environment Variables

Create or update `.env` file:

```env
DATABASE_URL="postgresql://username:password@localhost:5432/database_name?schema=public"
```

## 5. Generate Prisma Client

```bash
npx prisma generate
```

## 6. Run Database Migrations (Optional)

```bash
npx prisma migrate dev --name init
```
