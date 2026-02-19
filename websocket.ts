import { WebSocketServer, WebSocket } from "ws";
import type { Server as HTTPServer } from "http";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { runRiskDetector } from "@/lib/riskDetector";
import { runRiskAnalyzer } from "@/lib/riskAnalyzer";
import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type AudioChunkMessage = {
  type: "audio-chunk";
  roomId: string;
  accessToken: string;
  audio: string; // base64 encoded
  isFinal: boolean;
};

type AnalyzerIssue = {
  riskLevel?: string;
  issueDescription?: string;
  legalBasis?: {
    type?: string;
    reference?: string;
  };
  legalReasoning?: string;
  recommendation?: string;
  urgencyLevel?: string;
  disclaimer?: string;
};

type WebSocketClient = {
  ws: WebSocket;
  roomId: string;
  accessToken: string;
};

declare global {
  var __wsClients: Map<string, Set<WebSocketClient>> | undefined;
  var __wss: WebSocketServer | undefined;
}

const wsClients =
  globalThis.__wsClients ?? new Map<string, Set<WebSocketClient>>();
globalThis.__wsClients = wsClients;

let wss: WebSocketServer = globalThis.__wss as WebSocketServer;

const BUFFER_SIZE = 3;
const COOLDOWN_MS = 60_000;

/**
 * Initialize WebSocket server
 */
export function initializeWebSocketServer(httpServer: HTTPServer) {
  wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  globalThis.__wss = wss;

  wss.on("connection", (ws: WebSocket, req) => {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const roomId = url.searchParams.get("roomId");
    const accessToken = url.searchParams.get("accessToken");

    if (!roomId || !accessToken) {
      console.log(
        "❌ WebSocket connection failed: Missing roomId or accessToken",
      );
      ws.close(1008, "Missing roomId or accessToken");
      return;
    }

    console.log(`✅ WebSocket client connecting to room: ${roomId}`);

    const client: WebSocketClient = { ws, roomId, accessToken };
    const set = wsClients.get(roomId) ?? new Set<WebSocketClient>();
    set.add(client);
    wsClients.set(roomId, set);

    ws.send(
      JSON.stringify({
        type: "connected",
        roomId,
        timestamp: new Date().toISOString(),
      }),
    );
    console.log(
      `✅ WebSocket connected to room: ${roomId}, total: ${set.size}`,
    );

    ws.on("message", async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString()) as AudioChunkMessage;
        await handleAudioChunkMessage(message);
      } catch (error) {
        console.error("Failed to process WebSocket message:", error);
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Failed to process message",
          }),
        );
      }
    });

    ws.on("close", () => {
      console.log(`❌ WebSocket disconnected from room: ${roomId}`);
      const set = wsClients.get(roomId);
      set?.delete(client);
      if (set?.size === 0) {
        wsClients.delete(roomId);
      }
    });

    ws.on("error", (error) => {
      console.error(`WebSocket error for room ${roomId}:`, error);
    });
  });

  console.log("🟢 WebSocket server initialized");
}

/**
 * Handle audio chunk message - main logic
 */
async function handleAudioChunkMessage(message: AudioChunkMessage) {
  const { roomId, accessToken, audio } = message;

  console.log(
    `🎤 [WebSocket] Received audio chunk: roomId=${roomId}, size=${audio.length}`,
  );

  try {
    /* ========================
       1️⃣ Validate room
    ======================== */
    const room = await prisma.room.findFirst({
      where: {
        id: roomId,
        accessToken,
        status: "ACTIVE",
      },
      select: {
        id: true,
        threadId: true,
        companyType: true,
      },
    });

    if (!room) {
      console.error(`❌ Invalid room or access token`);
      broadcastToRoom(roomId, {
        type: "error",
        message: "Invalid room or access token",
      });
      return;
    }

    /* ========================
       2️⃣ Decode & Transcribe audio
    ======================== */
    const audioBuffer = Buffer.from(audio, "base64");
    console.log(`✅ Decoded audio: ${audioBuffer.length} bytes`);

    broadcastToRoom(roomId, {
      type: "transcribing",
      message: "Transcribing audio...",
    });

    // Create File object from buffer
    const file = new File([audioBuffer], `audio_${Date.now()}.webm`, {
      type: "audio/webm",
    });

    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: "whisper-1",
      language: "th",
    });

    const text = transcription.text;
    console.log(`✅ Transcribed: ${text}`);

    broadcastToRoom(roomId, {
      type: "transcribed",
      text,
      //   isFinal,
    });

    /* ========================
       3️⃣ Save to DB
    ======================== */
    await prisma.transcriptChunk.create({
      data: {
        roomId,
        content: text,
      },
    });

    /* ========================
       4️⃣ Buffer management (Redis)
    ======================== */
    const bufferKey = `room:${roomId}:buffer`;
    const cooldownKey = `room:${roomId}:cooldown`;

    await redis.rpush(bufferKey, text);
    await redis.ltrim(bufferKey, -BUFFER_SIZE, -1);

    const bufferLength = await redis.llen(bufferKey);
    console.log(`📊 Buffer length: ${bufferLength}/${BUFFER_SIZE}`);

    // ยังไม่ครบ buffer
    if (bufferLength < BUFFER_SIZE) {
      broadcastToRoom(roomId, {
        type: "buffer-status",
        bufferLength,
        totalNeeded: BUFFER_SIZE,
      });
      return;
    }

    /* ========================
       5️⃣ Cooldown check
    ======================== */
    const lastAlertAtRaw = await redis.get(cooldownKey);
    if (lastAlertAtRaw) {
      const lastAlertAt = Number(lastAlertAtRaw);
      if (Date.now() - lastAlertAt < COOLDOWN_MS) {
        console.log(`⏱️ Still in cooldown, clearing buffer`);
        await redis.del(bufferKey);
        broadcastToRoom(roomId, {
          type: "cooldown-active",
          message: "Still in cooldown period",
        });
        return;
      }
    }

    /* ========================
       6️⃣ Risk Detector (เบา/เร็ว)
    ======================== */
    const buffer = await redis.lrange(bufferKey, 0, -1);
    console.log(
      `🔍 Running risk detector: roomId=${roomId}, companyType=${room.companyType}`,
    );

    broadcastToRoom(roomId, {
      type: "analyzing",
      message: "Checking for legal risks...",
    });

    const signal = await runRiskDetector(buffer, room.companyType);
    console.log(`📊 Risk detector result: ${signal}`);

    if (!signal) {
      console.log(`✅ No risk detected`);
      await redis.del(bufferKey);
      broadcastToRoom(roomId, {
        type: "analysis-complete",
        hasRisks: false,
        message: "No legal risks detected",
      });
      return;
    }

    /* ========================
       7️⃣ Risk Analyzer (หนัก)
    ======================== */
    console.log(`🧠 Running risk analyzer for room: ${roomId}`);

    broadcastToRoom(roomId, {
      type: "deep-analyzing",
      message: "Performing deep legal analysis...",
    });

    const analyzerResult = await runRiskAnalyzer({
      roomId,
      transcript: buffer,
      threadId: room.threadId,
    });

    console.log(`📋 Analyzer result:`, analyzerResult);

    if (
      analyzerResult &&
      typeof analyzerResult === "object" &&
      "issues" in analyzerResult &&
      Array.isArray((analyzerResult as { issues?: unknown[] }).issues) &&
      (analyzerResult as { issues: unknown[] }).issues.length > 0
    ) {
      console.log(
        `🚨 Found ${(analyzerResult as { issues: unknown[] }).issues.length} legal issues`,
      );

      const issues = (analyzerResult as { issues: AnalyzerIssue[] }).issues;

      /* ========================
         8️⃣ Save to database
      ======================== */
      console.log(`💾 Saving legal risks to database...`);
      await prisma.legalRisk.createMany({
        data: issues.map((issue) => ({
          roomId,
          riskLevel: issue.riskLevel ?? "ไม่ระบุ",
          issueDescription: issue.issueDescription ?? "",
          legalBasisType: issue.legalBasis?.type ?? "ไม่ระบุ",
          legalBasisReference: issue.legalBasis?.reference ?? "",
          legalReasoning: issue.legalReasoning ?? "",
          recommendation: issue.recommendation ?? "",
          urgencyLevel: issue.urgencyLevel ?? "ไม่ระบุ",
          rawJson: issue,
        })),
      });
      console.log(`✅ Saved ${issues.length} legal risks`);

      /* ========================
         9️⃣ Broadcast to client
      ======================== */
      console.log(`📡 Broadcasting legal risks to room: ${roomId}`);
      broadcastToRoom(roomId, {
        type: "legal-risk",
        roomId,
        createdAt: new Date().toISOString(),
        issues,
      });

      /* ========================
         🔟 Set cooldown
      ======================== */
      console.log(`⏰ Setting cooldown for room: ${roomId}`);
      await redis.set(cooldownKey, Date.now().toString(), "PX", COOLDOWN_MS);
    } else {
      console.log(`ℹ️ No issues found`);
      broadcastToRoom(roomId, {
        type: "analysis-complete",
        hasRisks: false,
        message: "Analysis complete - no critical issues found",
      });
    }

    // Clear buffer
    await redis.del(bufferKey);
  } catch (error) {
    console.error(`❌ Error processing audio chunk:`, error);
    broadcastToRoom(roomId, {
      type: "error",
      message: "Failed to process audio chunk",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * Broadcast message to all clients in a room
 */
export function broadcastToRoom(roomId: string, data: any) {
  const set = wsClients.get(roomId);
  if (!set) {
    console.log(`⚠️ No WebSocket clients in room: ${roomId}`);
    return;
  }

  const payload = JSON.stringify(data);
  let successCount = 0;

  for (const client of set) {
    try {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload);
        successCount++;
      }
    } catch (error) {
      console.error(`Failed to broadcast to room ${roomId}:`, error);
    }
  }

  console.log(`✅ Broadcast to ${successCount} clients in room: ${roomId}`);
}

/**
 * Emit legal event (for backward compatibility with SSE)
 */
export function emitLegalEventWebSocket(roomId: string, data: any) {
  console.log(`📡 Emitting legal event for room: ${roomId}`);
  broadcastToRoom(roomId, {
    type: "legal-risk",
    ...data,
  });
}
