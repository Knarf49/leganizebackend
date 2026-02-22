import "dotenv/config";
import { WebSocketServer, WebSocket } from "ws";
import type { Server as HTTPServer } from "http";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { runRiskDetector, type CompanyTypeInput } from "@/lib/riskDetector";
import { runRiskAnalyzer } from "@/lib/riskAnalyzer";
import { transcribeAudio } from "@/lib/transcribe";
import {
  callAgentForSummary,
  waitForTranscriptionComplete,
} from "@/lib/agentSummary";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

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

type PendingESP32 = {
  ws: WebSocket;
  deviceId: string;
};

declare global {
  var __wsClients: Map<string, Set<WebSocketClient>> | undefined;
  var __wss: WebSocketServer | undefined;
  var __transcriptionQueues: Map<string, RoomTranscriptionQueue> | undefined;
  var __pendingESP32: Map<string, PendingESP32> | undefined;
}

const wsClients =
  globalThis.__wsClients ?? new Map<string, Set<WebSocketClient>>();
globalThis.__wsClients = wsClients;

const transcriptionQueues =
  globalThis.__transcriptionQueues ?? new Map<string, RoomTranscriptionQueue>();
globalThis.__transcriptionQueues = transcriptionQueues;

const pendingESP32 =
  globalThis.__pendingESP32 ?? new Map<string, PendingESP32>();
globalThis.__pendingESP32 = pendingESP32;

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
    const deviceId = url.searchParams.get("deviceId"); // ESP32 ส่งมา
    const clientType = url.searchParams.get("type"); // "esp32" | "browser"

    // ESP32 ที่ยังไม่มี roomId → เข้า pending pool
    if (clientType === "esp32" && !roomId && deviceId) {
      pendingESP32.set(deviceId, { ws, deviceId });
      console.log(`📡 ESP32 pending: ${deviceId}`);

      ws.send(
        JSON.stringify({
          type: "waiting-for-config",
          deviceId,
        }),
      );

      ws.on("close", () => {
        pendingESP32.delete(deviceId);
        console.log(`❌ ESP32 disconnected from pending: ${deviceId}`);
      });
      return;
    }

    // Browser ส่ง config ไปให้ ESP32
    if (clientType === "browser" && roomId) {
      const targetDeviceId = url.searchParams.get("targetDeviceId");

      if (targetDeviceId) {
        const esp32 = pendingESP32.get(targetDeviceId);
        if (esp32) {
          // ส่ง roomId + accessToken ไปที่ ESP32
          esp32.ws.send(
            JSON.stringify({
              type: "room-config",
              roomId,
              accessToken,
              wsHost: req.headers.host,
            }),
          );
          pendingESP32.delete(targetDeviceId);
          console.log(`✅ Config sent to ESP32: ${targetDeviceId}`);
        }
      }
    }
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

    ws.on("close", async () => {
      console.log(`❌ WebSocket disconnected from room: ${roomId}`);

      const set = wsClients.get(roomId);
      set?.delete(client);

      // If this was the last client in the room, handle final processing
      if (set?.size === 0) {
        wsClients.delete(roomId);
        console.log(
          `🔄 Last client disconnected from room ${roomId}, starting final processing`,
        );

        try {
          // Wait for all transcription queues to complete
          const finalTranscriptText =
            await waitForTranscriptionComplete(roomId);

          if (finalTranscriptText && finalTranscriptText.trim().length > 0) {
            console.log(
              `📝 Final transcript collected for room ${roomId}, calling agent for summary`,
            );

            // Broadcast processing status
            broadcastToRoom(roomId, {
              type: "finalizing",
              message: "กำลังสรุป...",
              timestamp: new Date().toISOString(),
            });

            // Call agent for summary (async, will callback via webhook)
            await callAgentForSummary(roomId, finalTranscriptText);

            console.log(`✅ Summary processing initiated for room ${roomId}`);
          } else {
            console.log(
              `⚠️ No transcript text found for room ${roomId}, marking as ended without summary`,
            );

            // Update room status without summary
            await prisma.room.update({
              where: { id: roomId },
              data: {
                status: "ENDED",
                endedAt: new Date(),
                finalSummary: "ไม่มีข้อความที่จะสรุป",
              },
            });
          }
        } catch (error) {
          console.error(
            `❌ Error during final processing for room ${roomId}:`,
            error,
          );

          // Update room with error status
          try {
            await prisma.room.update({
              where: { id: roomId },
              data: {
                status: "ENDED",
                endedAt: new Date(),
                finalSummary: `ข้อผิดพลาด: ${error instanceof Error ? error.message : "Unknown error"}`,
              },
            });
          } catch (dbError) {
            console.error(
              `❌ Failed to update room status for ${roomId}:`,
              dbError,
            );
          }
        }
      }
    });

    ws.on("error", (error) => {
      // console.error(`WebSocket error for room ${roomId}:`, error);
    });
  });
}

export function getPendingESP32List() {
  return Array.from(pendingESP32.values()).map((e) => ({
    deviceId: e.deviceId,
  }));
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
  let lastTranscribedText = "";

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

      // Process this transcription item and get the transcribed text
      const transcribedText = await processSingleTranscription(item);
      if (transcribedText) {
        lastTranscribedText = transcribedText; // Keep the latest/most complete transcription
      }

      // Small delay to prevent API rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Save only the last (most complete) transcribed text to database
    if (lastTranscribedText.trim()) {
      console.log(
        `💾 Saving final transcribed text to DB for room ${roomId}: ${lastTranscribedText.substring(0, 100)}...`,
      );
      await prisma.transcriptChunk.create({
        data: {
          roomId,
          content: lastTranscribedText,
        },
      });
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
 * @returns {Promise<string>} The transcribed text
 */
async function processSingleTranscription(
  item: TranscriptionQueueItem,
): Promise<string> {
  const { audio, mimeType, roomId, accessToken } = item;

  try {
    /* ========================
       1️⃣ Validate room (don't check status - allow processing even after ENDED)
    ======================== */
    const room = await prisma.room.findFirst({
      where: {
        id: roomId,
        accessToken,
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
    const tempDir = tmpdir(); // Use OS temp directory for deployment compatibility

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

    writeFileSync(tempPath, audioBuffer);

    let text = "";
    try {
      // Call TypeScript transcribe function
      const openaiApiKey = process.env.OPENAI_API_KEY;

      if (!openaiApiKey) {
        throw new Error("OPENAI_API_KEY not set in environment");
      }

      const result = await transcribeAudio(tempPath, openaiApiKey);

      if (result.success && result.text) {
        text = result.text;
        console.log(`✅ Transcribed (${item.timestamp}): ${text}`);
      } else {
        throw new Error(result.error || "Transcription failed");
      }

      /* OLD: Python script approach
      // Use system python for compatibility (Linux/Docker uses /usr/bin/python3, Windows uses venv)
      const pythonPath =
        process.platform === "win32"
          ? join(process.cwd(), ".venv", "Scripts", "python.exe")
          : "python3";
      const scriptPath = join(process.cwd(), "lib", "transcribe.py");

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
      */
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
       3️⃣ Continue with existing analysis logic (don't save to DB yet)
    ======================== */
    // Continue with buffer management and risk analysis...
    await processTranscriptAnalysis(
      roomId,
      text,
      room.companyType,
      room.threadId,
    );

    // Return the transcribed text for potential saving later
    return text;
  } catch (error) {
    console.error(`❌ Error processing transcription item:`, error);
    broadcastToRoom(roomId, {
      type: "error",
      message: "Failed to transcribe audio",
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return ""; // Return empty string on error
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
    const allIssues = (analyzerResult as { issues: AnalyzerIssue[] }).issues;

    // Filter out issues with "ไม่พบกฎหมายที่เกี่ยวข้อง"
    const validIssues = allIssues.filter(
      (issue) => issue.legalBasis?.type !== "ไม่พบกฎหมายที่เกี่ยวข้อง",
    );

    if (validIssues.length > 0) {
      console.log(`🚨 Found ${validIssues.length} valid legal issues`);

      /* ========================
         Save to database
      ======================== */
      await prisma.legalRisk.createMany({
        data: validIssues.map((issue) => ({
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

      /* ========================
         Broadcast to client
      ======================== */
      broadcastToRoom(roomId, {
        type: "legal-risk",
        roomId,
        createdAt: new Date().toISOString(),
        issues: validIssues,
      });

      /* ========================
         Set cooldown
      ======================== */
      await redis.set(cooldownKey, Date.now().toString(), "PX", COOLDOWN_MS);
    } else {
      console.log(
        `ℹ️ No valid issues found (filtered out issues without legal basis)`,
      );
      broadcastToRoom(roomId, {
        type: "analysis-complete",
        hasRisks: false,
        message: "Analysis complete - no critical issues found",
      });
    }
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
