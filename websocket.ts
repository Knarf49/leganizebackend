import "dotenv/config";
import { WebSocketServer, WebSocket } from "ws";
import type { Server as HTTPServer } from "http";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { runRiskDetector, type CompanyTypeInput } from "@/lib/riskDetector";
import { runRiskAnalyzer } from "@/lib/riskAnalyzer";
import { writeFileSync, unlinkSync, mkdirSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

//TODO: ทำให้มัน detect legal risk ในแต่ละ chunk เลย
type AudioChunkMessage = {
  type: "audio-chunk";
  roomId: string;
  accessToken: string;
  audio: string; // base64 encoded
  mimeType?: string; // MIME type for proper file extension
  isFinal: boolean;
};

type TranscribedAnalysisMessage = {
  type: "transcribed-for-analysis";
  roomId: string;
  accessToken: string;
  text: string;
};

type WebSocketMessage = AudioChunkMessage | TranscribedAnalysisMessage;

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

type TranscriptionQueueItem = {
  audio: string; // base64 encoded
  mimeType?: string;
  timestamp: number;
  roomId: string;
  accessToken: string;
};

type RoomTranscriptionQueue = {
  queue: TranscriptionQueueItem[];
  processing: boolean;
};

type WebSocketClient = {
  ws: WebSocket;
  roomId: string;
  accessToken: string;
};

declare global {
  var __wsClients: Map<string, Set<WebSocketClient>> | undefined;
  var __wss: WebSocketServer | undefined;
  var __transcriptionQueues: Map<string, RoomTranscriptionQueue> | undefined;
}

const wsClients =
  globalThis.__wsClients ?? new Map<string, Set<WebSocketClient>>();
globalThis.__wsClients = wsClients;

const transcriptionQueues =
  globalThis.__transcriptionQueues ?? new Map<string, RoomTranscriptionQueue>();
globalThis.__transcriptionQueues = transcriptionQueues;

const wss: WebSocketServer = globalThis.__wss as WebSocketServer;

const BUFFER_SIZE = 3;
const COOLDOWN_MS = 60_000;

/**
 * Initialize WebSocket server
 */
export function initializeWebSocketServer(httpServer: HTTPServer) {
  const wss = new WebSocketServer({ noServer: true });
  globalThis.__wss = wss;

  // console.log("🔧 WebSocketServer created with noServer: true");

  // Handle HTTP upgrade requests
  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "", `http://${request.headers.host}`);

    // Only handle our WebSocket path, let Next.js handle HMR and others
    if (url.pathname === "/ws") {
      // console.log("🔗 Handling WebSocket upgrade for /ws");

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
    // Don't destroy socket - let other handlers (Next.js HMR) handle it
    // else {
    //   socket.destroy();
    // }
  });

  wss.on("connection", (ws: WebSocket, req) => {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const roomId = url.searchParams.get("roomId");
    const accessToken = url.searchParams.get("accessToken");

    // console.log("🔍 Parsed params:", { roomId, accessToken });

    if (!roomId || !accessToken) {
      // console.log(
      //   "❌ WebSocket connection failed: Missing roomId or accessToken",
      // );
      ws.close(1008, "Missing roomId or accessToken");
      return;
    }

    // console.log(`✅ WebSocket client connecting to room: ${roomId}`);

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
        const message = JSON.parse(data.toString()) as WebSocketMessage;

        if (message.type === "audio-chunk") {
          await handleAudioChunkMessage(message as AudioChunkMessage);
        } else if (message.type === "transcribed-for-analysis") {
          await handleTranscribedAnalysisMessage(
            message as TranscribedAnalysisMessage,
          );
        }
      } catch (error) {
        // console.error("Failed to process WebSocket message:", error);
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Failed to process message",
          }),
        );
      }
    });

    ws.on("close", () => {
      // console.log(`❌ WebSocket disconnected from room: ${roomId}`);
      const set = wsClients.get(roomId);
      set?.delete(client);
      if (set?.size === 0) {
        wsClients.delete(roomId);
      }
    });

    ws.on("error", (error) => {
      // console.error(`WebSocket error for room ${roomId}:`, error);
    });
  });

  // console.log("🟢 WebSocket server initialized");
}

/**
 * Process transcription queue for a specific room
 */
async function processTranscriptionQueue(roomId: string) {
  const roomQueue = transcriptionQueues.get(roomId);
  if (!roomQueue || roomQueue.processing) {
    return;
  }

  roomQueue.processing = true;

  try {
    while (roomQueue.queue.length > 0) {
      const item = roomQueue.queue.shift()!;

      console.log(
        `🎤 Processing queue item for room ${roomId}. Remaining: ${roomQueue.queue.length}`,
      );

      // Broadcast queue status
      broadcastToRoom(roomId, {
        type: "transcribing",
        message: `Processing audio... (${roomQueue.queue.length} in queue)`,
        queueLength: roomQueue.queue.length + 1,
        timestamp: item.timestamp,
      });

      // Process this transcription item
      await processSingleTranscription(item);

      // Small delay to prevent API rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } catch (error) {
    console.error(`❌ Queue processing error for room ${roomId}:`, error);
    broadcastToRoom(roomId, {
      type: "error",
      message: "Failed to process transcription queue",
    });
  } finally {
    roomQueue.processing = false;

    // Clean up empty queue
    if (roomQueue.queue.length === 0) {
      transcriptionQueues.delete(roomId);
    }
  }
}

/**
 * Process a single transcription item
 */
async function processSingleTranscription(item: TranscriptionQueueItem) {
  const { audio, mimeType, roomId, accessToken } = item;

  try {
    /* ========================
       1️⃣ Validate room (quick check)
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
      throw new Error("Invalid room or access token");
    }

    /* ========================
       2️⃣ Decode & Transcribe audio
    ======================== */
    const audioBuffer = Buffer.from(audio, "base64");

    // Save audio to temp file with proper extension based on MIME type
    const tempDir = join(process.cwd(), "tmp");

    // Determine file extension from MIME type
    let extension = "webm"; // default
    if (mimeType) {
      if (mimeType.includes("mp4")) {
        extension = "mp4";
      } else if (mimeType.includes("wav")) {
        extension = "wav";
      } else if (mimeType.includes("ogg")) {
        extension = "ogg";
      } else if (mimeType.includes("mp3")) {
        extension = "mp3";
      }
    }

    const tempPath = join(tempDir, `audio_${Date.now()}.${extension}`);

    try {
      mkdirSync(tempDir, { recursive: true });
    } catch (e) {
      // dir might already exist
    }

    writeFileSync(tempPath, audioBuffer);

    let text = "";
    try {
      // Call Python transcribe script
      // Use system python for compatibility (Linux/Docker uses /usr/bin/python3, Windows uses venv)
      const pythonPath = process.platform === "win32" 
        ? join(process.cwd(), ".venv", "Scripts", "python.exe")
        : "python3";
      const scriptPath = join(process.cwd(), "lib", "transcribe.py");
      const openaiApiKey = process.env.OPENAI_API_KEY;

      if (!openaiApiKey) {
        throw new Error("OPENAI_API_KEY not set in environment");
      }

      const output = execSync(
        `"${pythonPath}" "${scriptPath}" "${tempPath}" "${openaiApiKey}"`,
        {
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        },
      );

      const result = JSON.parse(output);

      if (result.success) {
        text = result.text;
        console.log(`✅ Transcribed (${item.timestamp}): ${text}`);
      } else {
        throw new Error(result.error);
      }
    } finally {
      // Clean up temp file
      try {
        unlinkSync(tempPath);
      } catch (e) {
        console.error(`Failed to delete temp file:`, e);
      }
    }

    broadcastToRoom(roomId, {
      type: "transcribed",
      text,
      timestamp: item.timestamp,
    });

    /* ========================
       3️⃣ Continue with existing analysis logic
    ======================== */
    // Save to DB
    await prisma.transcriptChunk.create({
      data: {
        roomId,
        content: text,
      },
    });

    // Continue with buffer management and risk analysis...
    await processTranscriptAnalysis(
      roomId,
      text,
      room.companyType,
      room.threadId,
    );
  } catch (error) {
    console.error(`❌ Error processing transcription item:`, error);
    broadcastToRoom(roomId, {
      type: "error",
      message: "Failed to transcribe audio",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * Process transcript analysis (buffer management + risk analysis)
 */
async function processTranscriptAnalysis(
  roomId: string,
  text: string,
  companyType: CompanyTypeInput,
  threadId: string,
) {
  // Existing buffer management and risk analysis logic
  const bufferKey = `room:${roomId}:buffer`;
  const cooldownKey = `room:${roomId}:cooldown`;

  await redis.rpush(bufferKey, text);
  await redis.ltrim(bufferKey, -BUFFER_SIZE, -1);

  const bufferLength = await redis.llen(bufferKey);
  // console.log(`📊 Buffer length: ${bufferLength}/${BUFFER_SIZE}`);

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
     Cooldown check
  ======================== */
  const lastAlertAtRaw = await redis.get(cooldownKey);
  if (lastAlertAtRaw) {
    const lastAlertAt = Number(lastAlertAtRaw);
    if (Date.now() - lastAlertAt < COOLDOWN_MS) {
      // console.log(`⏱️ Still in cooldown, clearing buffer`);
      await redis.del(bufferKey);
      broadcastToRoom(roomId, {
        type: "cooldown-active",
        message: "Still in cooldown period",
      });
      return;
    }
  }

  /* ========================
     Risk Detector (เบา/เร็ว)
  ======================== */
  const buffer = await redis.lrange(bufferKey, 0, -1);
  // console.log(
  //   `🔍 Running risk detector: roomId=${roomId}, companyType=${companyType}`,
  // );

  broadcastToRoom(roomId, {
    type: "analyzing",
    message: "Checking for legal risks...",
  });

  const signal = await runRiskDetector(buffer, companyType);
  // console.log(`📊 Risk detector result: ${signal}`);

  if (!signal) {
    // console.log(`✅ No risk detected`);
    await redis.del(bufferKey);
    broadcastToRoom(roomId, {
      type: "analysis-complete",
      hasRisks: false,
      message: "No legal risks detected",
    });
    return;
  }

  /* ========================
     Risk Analyzer (หนัก)
  ======================== */
  // console.log(`🧠 Running risk analyzer for room: ${roomId}`);

  broadcastToRoom(roomId, {
    type: "deep-analyzing",
    message: "Performing deep legal analysis...",
  });

  const analyzerResult = await runRiskAnalyzer({
    roomId,
    transcript: buffer,
    threadId: threadId,
  });

  // console.log(`📋 Analyzer result:`, analyzerResult);

  if (
    analyzerResult &&
    typeof analyzerResult === "object" &&
    "issues" in analyzerResult &&
    Array.isArray((analyzerResult as { issues?: unknown[] }).issues) &&
    (analyzerResult as { issues: unknown[] }).issues.length > 0
  ) {
    // console.log(
    //   `🚨 Found ${(analyzerResult as { issues: unknown[] }).issues.length} legal issues`,
    // );

    const issues = (analyzerResult as { issues: AnalyzerIssue[] }).issues;

    /* ========================
       Save to database
    ======================== */
    // console.log(`💾 Saving legal risks to database...`);
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
    // console.log(`✅ Saved ${issues.length} legal risks`);

    /* ========================
       Broadcast to client
    ======================== */
    // console.log(`📡 Broadcasting legal risks to room: ${roomId}`);
    broadcastToRoom(roomId, {
      type: "legal-risk",
      roomId,
      createdAt: new Date().toISOString(),
      issues,
    });

    /* ========================
       Set cooldown
    ======================== */
    // console.log(`⏰ Setting cooldown for room: ${roomId}`);
    await redis.set(cooldownKey, Date.now().toString(), "PX", COOLDOWN_MS);
  } else {
    // console.log(`ℹ️ No issues found`);
    broadcastToRoom(roomId, {
      type: "analysis-complete",
      hasRisks: false,
      message: "Analysis complete - no critical issues found",
    });
  }

  // Clear buffer
  await redis.del(bufferKey);
}

/**
 * Handle audio chunk message - main logic
 */
async function handleAudioChunkMessage(message: AudioChunkMessage) {
  const { roomId, accessToken, audio, mimeType } = message;

  // console.log(
  //   `🎤 [WebSocket] Received audio chunk: roomId=${roomId}, size=${audio.length}`,
  // );

  try {
    /* ========================
       1️⃣ Quick validation (just check if room exists and is active)
    ======================== */
    const roomExists = await prisma.room.findFirst({
      where: {
        id: roomId,
        accessToken,
        status: "ACTIVE",
      },
      select: {
        id: true,
      },
    });

    if (!roomExists) {
      // console.error(`❌ Invalid room or access token`);
      broadcastToRoom(roomId, {
        type: "error",
        message: "Invalid room or access token",
      });
      return;
    }

    /* ========================
       2️⃣ Add to transcription queue
    ======================== */
    // Initialize queue for room if not exists
    if (!transcriptionQueues.has(roomId)) {
      transcriptionQueues.set(roomId, {
        queue: [],
        processing: false,
      });
    }

    const roomQueue = transcriptionQueues.get(roomId)!;

    // Add audio chunk to queue
    const queueItem: TranscriptionQueueItem = {
      audio,
      mimeType,
      timestamp: Date.now(),
      roomId,
      accessToken,
    };

    roomQueue.queue.push(queueItem);

    console.log(
      `🎵 Added audio chunk to queue for room ${roomId}. Queue size: ${roomQueue.queue.length}`,
    );

    // Send queue status update
    broadcastToRoom(roomId, {
      type: "queue-status",
      message: `Audio received (${roomQueue.queue.length} in queue)`,
      queueLength: roomQueue.queue.length,
      processing: roomQueue.processing,
    });

    /* ========================
       3️⃣ Start processing queue if not already processing
    ======================== */
    if (!roomQueue.processing) {
      // Start processing queue in background
      processTranscriptionQueue(roomId).catch((error) => {
        console.error(`❌ Queue processing error for room ${roomId}:`, error);
      });
    }
  } catch (error) {
    console.error(`❌ Error handling audio chunk:`, error);
    broadcastToRoom(roomId, {
      type: "error",
      message: "Failed to queue audio chunk",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * Handle transcribed text for analysis - skip audio transcription
 */
async function handleTranscribedAnalysisMessage(
  message: TranscribedAnalysisMessage,
) {
  const { roomId, accessToken, text } = message;

  // console.log(
  //   `📝 [WebSocket] Received transcribed text for analysis: roomId=${roomId}, text=${text.substring(0, 50)}...`,
  // );

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
      // console.error(`❌ Invalid room or access token`);
      broadcastToRoom(roomId, {
        type: "error",
        message: "Invalid room or access token",
      });
      return;
    }

    /* ========================
       2️⃣ Save to DB
    ======================== */
    await prisma.transcriptChunk.create({
      data: {
        roomId,
        content: text,
      },
    });

    /* ========================
       3️⃣ Continue with transcript analysis
    ======================== */
    await processTranscriptAnalysis(
      roomId,
      text,
      room.companyType,
      room.threadId,
    );
  } catch (error) {
    // console.error(`❌ Error processing transcribed text:`, error);
    broadcastToRoom(roomId, {
      type: "error",
      message: "Failed to process transcribed text",
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
    // console.log(`⚠️ No WebSocket clients in room: ${roomId}`);
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
      // console.error(`Failed to broadcast to room ${roomId}:`, error);
    }
  }

  // console.log(`✅ Broadcast to ${successCount} clients in room: ${roomId}`);
}

/**
 * Emit legal event (for backward compatibility with SSE)
 */
export function emitLegalEventWebSocket(roomId: string, data: any) {
  // console.log(`📡 Emitting legal event for room: ${roomId}`);
  broadcastToRoom(roomId, {
    type: "legal-risk",
    ...data,
  });
}
