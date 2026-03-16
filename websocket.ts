import "dotenv/config";
import { WebSocketServer, WebSocket } from "ws";
import type { Server as HTTPServer } from "http";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { runRiskDetector, type CompanyTypeInput } from "@/lib/riskDetector";
import { runRiskAnalyzer } from "@/lib/riskAnalyzer";
import {
  transcribeWithGoogleSTT,
  formatTranscriptWithSpeakers,
  createGoogleSTTStream,
} from "@/lib/googleSpeechToText";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

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

type StartRecordingMessage = {
  type: "start-recording";
  targetDeviceId: string;
};

type StopRecordingMessage = {
  type: "stop-recording";
  targetDeviceId: string;
};

type GoPendingMessage = {
  type: "go-pending";
  targetDeviceId: string;
};

type ESP32AudioChunkMessage = {
  type: "esp32-audio-chunk";
  roomId: string;
  audio: string; // base64 encoded
};

type TestAlertMessage = {
  type: "test-alert";
};

type StartStreamMessage = {
  type: "start-stream";
};

type AudioDataMessage = {
  type: "audio-data";
  audio: string;
};

type StopStreamMessage = {
  type: "stop-stream";
};

type WebSocketMessage =
  | AudioChunkMessage
  | TranscribedAnalysisMessage
  | StartRecordingMessage
  | StopRecordingMessage
  | GoPendingMessage
  | ESP32AudioChunkMessage
  | TestAlertMessage
  | StartStreamMessage
  | AudioDataMessage
  | StopStreamMessage;

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
  deviceId?: string; // For ESP32 clients
  clientType?: string; // "browser" | "esp32"
  endSttStream?: () => void;
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
  var __pendingAutoStart: Map<string, { roomId: string }> | undefined;
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

// Stores deviceId → roomId for start-recording requests that arrived before ESP32 reconnected
const pendingAutoStart =
  globalThis.__pendingAutoStart ?? new Map<string, { roomId: string }>();
globalThis.__pendingAutoStart = pendingAutoStart;

const BUFFER_SIZE = 3;
const COOLDOWN_MS = 60_000;

/**
 * Initialize WebSocket server
 */
export function initializeWebSocketServer(httpServer: HTTPServer) {
  const wss = new WebSocketServer({ noServer: true });
  globalThis.__wss = wss;

  // Heartbeat: ping every 30s to prevent Render.com from closing idle connections (60s timeout)
  // The browser WebSocket responds to ping frames automatically at protocol level.
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const extWs = ws as WebSocket & { isAlive?: boolean };
      if (extWs.isAlive === false) {
        console.log("💔 WebSocket did not respond to ping, terminating");
        return extWs.terminate();
      }
      extWs.isAlive = false;
      extWs.ping();
    });
  }, 30_000);

  wss.on("close", () => clearInterval(heartbeatInterval));

  // Handle HTTP upgrade requests
  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "", `http://${request.headers.host}`);

    // Handle both /ws (full mode) and /ws/simple (simple transcription mode)
    if (url.pathname === "/ws" || url.pathname === "/ws/simple") {
      // console.log(`🔗 Handling WebSocket upgrade for ${url.pathname}`);

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
    // Mark connection as alive; will be reset to false on each ping.
    // Pong from browser resets it back to true.
    (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
    ws.on("pong", () => {
      (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
    });

    const url = new URL(req.url || "", `http://${req.headers.host}`);

    // ✨ Simple mode - no room required, just transcribe audio
    if (url.pathname === "/ws/simple") {
      handleSimpleWebSocket(ws);
      return;
    }

    // Full mode - requires roomId and accessToken
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
        // Check pending ESP32 first
        const esp32Pending = pendingESP32.get(targetDeviceId);
        if (esp32Pending) {
          esp32Pending.ws.send(
            JSON.stringify({
              type: "room-config",
              roomId,
              accessToken,
              wsHost: req.headers.host,
            }),
          );
          pendingESP32.delete(targetDeviceId);
          console.log(`✅ Config sent to pending ESP32: ${targetDeviceId}`);
        } else {
          // ESP32 already connected to some room — find it and reconfigure
          let reconfigured = false;
          for (const [, clientSet] of wsClients) {
            for (const client of clientSet) {
              if (
                client.deviceId === targetDeviceId &&
                client.clientType === "esp32"
              ) {
                client.ws.send(
                  JSON.stringify({
                    type: "room-config",
                    roomId,
                    accessToken,
                    wsHost: req.headers.host,
                  }),
                );
                reconfigured = true;
                console.log(
                  `✅ Reconfigured connected ESP32: ${targetDeviceId} → room ${roomId}`,
                );
                break;
              }
            }
            if (reconfigured) break;
          }
          if (!reconfigured) {
            console.log(
              `⚠️ ESP32 ${targetDeviceId} not found (pending or connected)`,
            );
          }
        }
        // Close browser connection หลังส่ง config เสร็จ
        ws.close(1000, "Config sent");
        return;
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

    const client: WebSocketClient = {
      ws,
      roomId,
      accessToken,
      deviceId: deviceId || undefined,
      clientType: clientType || undefined,
    };

    // If this is an ESP32 reconnecting with a new room, remove it from any previous room
    if (clientType === "esp32" && deviceId) {
      for (const [otherRoomId, clientSet] of wsClients) {
        if (otherRoomId === roomId) continue;
        for (const c of clientSet) {
          if (c.deviceId === deviceId && c.clientType === "esp32") {
            if (c.endSttStream) c.endSttStream();
            clientSet.delete(c);
            console.log(
              `🔄 Removed ESP32 ${deviceId} from old room ${otherRoomId}`,
            );
            break;
          }
        }
      }
    }

    const set = wsClients.get(roomId) ?? new Set<WebSocketClient>();
    set.add(client);
    wsClients.set(roomId, set);

    // Per-connection streaming STT session (for dashboard auto-recording)
    let connSttStream: ReturnType<typeof createGoogleSTTStream> | null = null;
    let isConnRecording = false;
    let connSilenceTimer: ReturnType<typeof setTimeout> | null = null;
    // True while gracefully ending the stream due to silence (not a 5-min limit restart)
    let connEndingFromSilence = false;

    // Called after every ESP32 audio chunk to detect end-of-clip silence.
    // If no audio arrives within SILENCE_TIMEOUT_MS, the stream is ended gracefully
    // so Google can return the final transcript.  The next incoming audio chunk will
    // create a fresh stream — avoiding the "Audio Timeout Error".
    const CONN_SILENCE_TIMEOUT_MS = 800;
    const resetConnSilenceTimer = () => {
      if (connSilenceTimer) clearTimeout(connSilenceTimer);
      connEndingFromSilence = false;
      connSilenceTimer = setTimeout(() => {
        connSilenceTimer = null;
        if (connSttStream) {
          console.log(
            `🔚 Room ${roomId}: silence detected, ending STT stream gracefully`,
          );
          connEndingFromSilence = true;
          connSttStream.end();
          connSttStream = null;
        }
      }, CONN_SILENCE_TIMEOUT_MS);
    };

    const startConnSttStream = () => {
      connSttStream = createGoogleSTTStream();

      connSttStream.events.on(
        "transcript",
        async ({ text, isFinal }: { text: string; isFinal: boolean }) => {
          if (!isFinal) {
            // Send to current connection
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "partial-transcript", text }));
            }
            // Broadcast partial transcript so dashboard can see live typing from ESP32
            broadcastToRoom(roomId, { type: "partial-transcript", text });
            return;
          }

          // Save final transcript to DB
          try {
            await prisma.transcriptChunk.create({
              data: { roomId, content: text },
            });
          } catch (e) {
            console.error("❌ Failed to save transcript chunk:", e);
          }

          // Send directly to this connection (like /ws/simple does)
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "transcribed",
                text,
                timestamp: Date.now(),
              }),
            );
          }

          // Also broadcast to any other clients in the room (e.g., ESP32 or multiple tabs)
          broadcastToRoom(roomId, {
            type: "transcribed",
            text,
            speakers: undefined,
            timestamp: Date.now(),
          });

          // Run risk analysis
          try {
            const room = await prisma.room.findFirst({
              where: { id: roomId, accessToken },
              select: { companyType: true },
            });
            if (room) {
              await processTranscriptAnalysis(roomId, text, room.companyType);
            }
          } catch (e) {
            console.error("❌ Failed to run transcript analysis:", e);
          }
        },
      );

      connSttStream.events.on("error", (err: Error) => {
        console.error("❌ Room conn STT error:", err.message);
        connSttStream = null;
        // Do NOT auto-restart immediately — an empty stream would trigger the same
        // timeout right away.  The next incoming audio-data / esp32-audio-chunk
        // message will call startConnSttStream() when it needs a stream.
      });

      connSttStream.events.on("end", () => {
        connSttStream = null;
        if (isConnRecording && !connEndingFromSilence) {
          // Stream hit the 5-minute session limit during continuous dashboard
          // recording — restart immediately so audio-data messages keep working.
          startConnSttStream();
        }
        connEndingFromSilence = false;
      });
    };

    const endConnSttStream = () => {
      isConnRecording = false;
      if (connSilenceTimer) {
        clearTimeout(connSilenceTimer);
        connSilenceTimer = null;
      }
      connEndingFromSilence = false;
      if (connSttStream) {
        connSttStream.end();
        connSttStream = null;
      }
    };

    client.endSttStream = endConnSttStream;

    ws.send(
      JSON.stringify({
        type: "connected",
        roomId,
        timestamp: new Date().toISOString(),
      }),
    );

    // If there was a pending start-recording for this ESP32 (sent before it reconnected)
    // deliver it now that the connection is established.
    if (clientType === "esp32" && deviceId) {
      const autoStart = pendingAutoStart.get(deviceId);
      if (autoStart && autoStart.roomId === roomId) {
        pendingAutoStart.delete(deviceId);
        ws.send(JSON.stringify({ type: "start-recording", roomId }));
        console.log(
          `🎙️ Auto-delivered queued start-recording to ESP32: ${deviceId}`,
        );
        // Notify dashboard that ESP32 recording has started
        broadcastToRoom(roomId, { type: "esp32-started-recording", deviceId });
      }
    }

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
        } else if (message.type === "start-recording") {
          handleStartRecording(
            message as StartRecordingMessage,
            roomId,
            accessToken,
            (req.headers.host as string) || "",
          );
        } else if (message.type === "stop-recording") {
          handleStopRecording(message as StopRecordingMessage, roomId);
        } else if (message.type === "go-pending") {
          handleGoPending(message as GoPendingMessage, roomId);
        } else if (message.type === "esp32-audio-chunk") {
          handleESP32AudioChunk(message as ESP32AudioChunkMessage);

          // Auto-start STT stream for any connection sending ESP32 audio
          // (clientType may be null if ESP32 reconnected without ?type=esp32)
          if (!isConnRecording) {
            console.log(`🎤 Room ${roomId}: auto-starting STT for ESP32 audio`);
            isConnRecording = true;
            startConnSttStream();
          } else if (!connSttStream) {
            // Stream was gracefully ended (silence timeout or error) — restart
            // now that new audio has arrived.
            console.log(
              `🔄 Room ${roomId}: restarting STT stream for new audio clip`,
            );
            startConnSttStream();
          }
          if (connSttStream) {
            const pcmBuffer = Buffer.from(
              (message as ESP32AudioChunkMessage).audio,
              "base64",
            );
            connSttStream.write(pcmBuffer);
            // Reset silence timer so the stream stays open while audio is flowing
            // and closes ~1.5 s after the last chunk of this recording clip.
            resetConnSilenceTimer();
          }
        } else if (message.type === "start-stream") {
          endConnSttStream();
          isConnRecording = true;
          startConnSttStream();
          ws.send(JSON.stringify({ type: "stream-started" }));
          console.log(`🎤 Room ${roomId}: streaming STT started`);
        } else if (message.type === "audio-data") {
          if (connSttStream) {
            const pcmBuffer = Buffer.from(
              (message as AudioDataMessage).audio,
              "base64",
            );
            connSttStream.write(pcmBuffer);
          }
        } else if (message.type === "stop-stream") {
          endConnSttStream();
          console.log(`⏹️ Room ${roomId}: streaming STT stopped`);
        } else if (message.type === "test-alert") {
          const samples = [
            {
              riskLevel: "HIGH",
              issueDescription:
                "ที่ประชุมมีมติโดยไม่ครบองค์ประชุมตามที่กฎหมายกำหนด (ต้องการ 2 ใน 3 ของผู้ถือหุ้น)",
              recommendation: "ควรตรวจสอบจำนวนผู้ถือหุ้นและองค์ประชุมก่อนลงมติ",
            },
            {
              riskLevel: "MEDIUM",
              issueDescription:
                "ไม่มีการแจ้งวาระล่วงหน้าตาม พ.ร.บ. บริษัทมหาชนจำกัด มาตรา 100",
              recommendation:
                "ควรส่งหนังสือเชิญประชุมพร้อมวาระล่วงหน้าไม่น้อยกว่า 14 วัน",
            },
            {
              riskLevel: "LOW",
              issueDescription:
                "บันทึกรายงานการประชุมไม่ครบถ้วนตามข้อบังคับบริษัท",
              recommendation:
                "ควรระบุชื่อผู้เข้าร่วมประชุม คะแนนโหวต และมติที่ประชุมให้ครบถ้วน",
            },
          ];
          const sample = samples[Math.floor(Math.random() * samples.length)];
          broadcastToRoom(roomId, {
            type: "legal-risk",
            ...sample,
            timestamp: new Date().toISOString(),
          });
        }
      } catch {
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
      endConnSttStream();
      console.log(`❌ WebSocket disconnected from room: ${roomId}`);

      const set = wsClients.get(roomId);
      set?.delete(client);

      if (set?.size === 0) {
        wsClients.delete(roomId);
      }
    });

    ws.on("error", () => {
      // console.error(`WebSocket error for room ${roomId}:`, error);
    });
  });
}

export function getPendingESP32List() {
  return Array.from(pendingESP32.values()).map((e) => ({
    deviceId: e.deviceId,
  }));
}

export function getConnectedESP32List() {
  const result: { deviceId: string; roomId: string }[] = [];
  for (const [roomId, clientSet] of wsClients) {
    for (const client of clientSet) {
      if (client.clientType === "esp32" && client.deviceId) {
        result.push({ deviceId: client.deviceId, roomId });
      }
    }
  }
  return result;
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

      // Process this transcription item and get the transcribed text
      const transcribedText = await processSingleTranscription(item);
      if (transcribedText) {
        // Append chunk to Redis list — survives restarts and works across instances
        const redisKey = `transcript:${roomId}`;
        await redis.rpush(redisKey, transcribedText);
        // Expire after 2 hours in case room never cleanly ends
        await redis.expire(redisKey, 7200);
      }

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
    let speakerInfo = null;
    try {
      // Use Google Cloud Speech-to-Text V2 Chirp 3 for transcription with speaker diarization
      const result = await transcribeWithGoogleSTT(tempPath);

      if (!result.success) {
        throw new Error(result.error || "Transcription failed");
      }

      if (!result.text) {
        // No speech detected in this chunk — skip silently
        console.log(`⚠️ No speech detected in audio chunk, skipping.`);
        return "";
      }

      text = result.text;
      speakerInfo = result.speakers;
      console.log(`✅ Transcribed (${item.timestamp}): ${text}`);

      if (speakerInfo && speakerInfo.length > 0) {
        const speakerCount = new Set(speakerInfo.map((s) => s.speakerTag)).size;
        console.log(`👥 Detected ${speakerCount} speakers`);

        // Format transcript with speaker labels for logging
        const formattedTranscript = formatTranscriptWithSpeakers(speakerInfo);
        console.log(`📝 Speaker transcript:\n${formattedTranscript}`);
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
      speakers: speakerInfo,
      timestamp: item.timestamp,
    });

    /* ========================
       3️⃣ Continue with existing analysis logic (don't save to DB yet)
    ======================== */
    // Continue with buffer management and risk analysis...
    await processTranscriptAnalysis(roomId, text, room.companyType);

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
  console.log(
    `🔍 Running risk detector: roomId=${roomId}, companyType=${companyType}`,
  );

  broadcastToRoom(roomId, {
    type: "analyzing",
    message: "Checking for legal risks...",
  });

  const signal = await runRiskDetector(buffer, companyType);
  console.log(`📊 Risk detector result: ${signal}`);

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
  console.log(`🧠 Running risk analyzer for room: ${roomId}`);

  broadcastToRoom(roomId, {
    type: "deep-analyzing",
    message: "Performing deep legal analysis...",
  });

  const analyzerResult = await runRiskAnalyzer({
    roomId,
    transcript: buffer,
  });

  console.log(`📋 Analyzer result:`, analyzerResult);

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
      (issue) =>
        issue.legalBasis?.type !==
        "ไม่พบบทบัญญัติกฎหมายหรือหลักเกณฑ์ที่เกี่ยวข้องในเอกสารที่ค้นพบ",
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
    await processTranscriptAnalysis(roomId, text, room.companyType);
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
export function broadcastToRoom(roomId: string, data: Record<string, unknown>) {
  const set = wsClients.get(roomId);
  if (!set) {
    // console.log(`⚠️ No WebSocket clients in room: ${roomId}`);
    return;
  }

  const payload = JSON.stringify(data);

  for (const client of set) {
    try {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload);
      }
    } catch {
      // console.error(`Failed to broadcast to room ${roomId}:`, error);
    }
  }

  // console.log(`✅ Broadcast to clients in room: ${roomId}`);
}

/**
 * Emit legal event (for backward compatibility with SSE)
 */
export function emitLegalEventWebSocket(
  roomId: string,
  data: Record<string, unknown>,
) {
  // console.log(`📡 Emitting legal event for room: ${roomId}`);
  broadcastToRoom(roomId, {
    type: "legal-risk",
    ...data,
  });
}

/**
 * Handle go-pending command from browser - tell ESP32 to disconnect and return to pending mode
 */
function handleGoPending(message: GoPendingMessage, roomId: string) {
  const { targetDeviceId } = message;

  const set = wsClients.get(roomId);
  if (!set) return;

  let esp32Client: WebSocketClient | undefined;
  for (const client of set) {
    if (client.deviceId === targetDeviceId && client.clientType === "esp32") {
      esp32Client = client;
      break;
    }
  }

  if (!esp32Client) {
    console.log(`⚠️ ESP32 ${targetDeviceId} not found for go-pending`);
    return;
  }

  try {
    // Stop STT stream first
    if (esp32Client.endSttStream) esp32Client.endSttStream();
    // Tell ESP32 to go back to pending mode (reconnect without roomId)
    esp32Client.ws.send(JSON.stringify({ type: "go-pending" }));
    console.log(`🔄 Sent go-pending to ESP32: ${targetDeviceId}`);
  } catch (error) {
    console.error(`❌ Failed to send go-pending to ESP32:`, error);
  }
}

/**
 * Handle start recording command from browser - relay to ESP32
 */
function handleStartRecording(
  message: StartRecordingMessage,
  roomId: string,
  accessToken: string,
  wsHost: string,
) {
  const { targetDeviceId } = message;

  // If ESP32 is in pending mode (e.g., after go-pending triggered by room switch),
  // send room-config proactively so it can reconnect to this room.
  const pendingDevice = pendingESP32.get(targetDeviceId);
  if (pendingDevice) {
    try {
      pendingDevice.ws.send(
        JSON.stringify({ type: "room-config", roomId, accessToken, wsHost }),
      );
      pendingESP32.delete(targetDeviceId);
      console.log(
        `📡 Sent room-config to pending ESP32 ${targetDeviceId} (triggered by start-recording)`,
      );
    } catch (err) {
      console.error(`❌ Failed to send room-config to pending ESP32:`, err);
    }
    // Queue start-recording for delivery once ESP32 reconnects with the new roomId
    pendingAutoStart.set(targetDeviceId, { roomId });
    return;
  }

  // Find ESP32 client in the room
  const set = wsClients.get(roomId);
  if (!set) {
    // Room has no clients yet — queue for when ESP32 connects
    pendingAutoStart.set(targetDeviceId, { roomId });
    console.log(
      `⏳ No clients in room ${roomId} yet, queued start-recording for ESP32 ${targetDeviceId}`,
    );
    return;
  }

  let esp32Client: WebSocketClient | undefined;
  for (const client of set) {
    if (client.deviceId === targetDeviceId && client.clientType === "esp32") {
      esp32Client = client;
      break;
    }
  }

  if (!esp32Client) {
    // ESP32 not in room yet — queue the command so it's delivered when it reconnects
    pendingAutoStart.set(targetDeviceId, { roomId });
    console.log(
      `⏳ ESP32 ${targetDeviceId} not in room yet, queued start-recording for room ${roomId}`,
    );
    return;
  }

  // Send command to ESP32
  try {
    esp32Client.ws.send(
      JSON.stringify({
        type: "start-recording",
        roomId,
      }),
    );
    console.log(`🎙️ Sent start-recording command to ESP32: ${targetDeviceId}`);
  } catch (error) {
    console.error(`❌ Failed to send start-recording to ESP32:`, error);
  }
}

/**
 * Handle stop recording command from browser - relay to ESP32
 */
function handleStopRecording(message: StopRecordingMessage, roomId: string) {
  const { targetDeviceId } = message;

  // Find ESP32 client in the room
  const set = wsClients.get(roomId);
  if (!set) {
    console.log(`⚠️ No clients found in room: ${roomId}`);
    return;
  }

  let esp32Client: WebSocketClient | undefined;
  for (const client of set) {
    if (client.deviceId === targetDeviceId && client.clientType === "esp32") {
      esp32Client = client;
      break;
    }
  }

  if (!esp32Client) {
    console.log(`⚠️ ESP32 ${targetDeviceId} not found in room ${roomId}`);
    return;
  }

  // Send command to ESP32
  try {
    esp32Client.ws.send(
      JSON.stringify({
        type: "stop-recording",
        roomId,
      }),
    );
    console.log(`⏹️ Sent stop-recording command to ESP32: ${targetDeviceId}`);
    // Also stop the STT stream attached to this ESP32 connection
    if (esp32Client.endSttStream) {
      esp32Client.endSttStream();
    }
  } catch (error) {
    console.error(`❌ Failed to send stop-recording to ESP32:`, error);
  }
}

/**
 * Handle audio chunk from ESP32 - relay to browser clients
 */
function handleESP32AudioChunk(message: ESP32AudioChunkMessage) {
  const { roomId, audio } = message;

  console.log(`📦 Received audio chunk from ESP32 for room ${roomId}`);

  // Broadcast to all browser clients in the room (not to ESP32)
  const set = wsClients.get(roomId);
  if (!set) {
    console.log(`⚠️ No clients in room: ${roomId}`);
    return;
  }

  const payload = JSON.stringify({
    type: "esp32-audio-chunk",
    audio,
  });

  let successCount = 0;
  for (const client of set) {
    // Only send to browser clients, not ESP32
    if (client.clientType !== "esp32") {
      try {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(payload);
          successCount++;
        }
      } catch (error) {
        console.error(`Failed to relay audio chunk to browser:`, error);
      }
    }
  }

  console.log(`✅ Relayed audio chunk to ${successCount} browser clients`);
}

/**
 * Handle simple WebSocket connection for transcription only (no room required)
 */
function handleSimpleWebSocket(ws: WebSocket) {
  console.log("🎤 Simple WebSocket connected");

  // Active streaming STT session for this connection
  let sttStream: ReturnType<typeof createGoogleSTTStream> | null = null;
  let isClientRecording = false;

  const startSttStream = () => {
    sttStream = createGoogleSTTStream();

    sttStream.events.on(
      "transcript",
      ({ text, isFinal }: { text: string; isFinal: boolean }) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(
          JSON.stringify({
            type: isFinal ? "transcribed" : "partial-transcript",
            text,
            speakers: [],
          }),
        );
        if (isFinal)
          console.log(`✅ Final transcript: ${text.substring(0, 80)}`);
      },
    );

    sttStream.events.on("error", (err: Error) => {
      console.error("❌ STT stream error:", err.message);
      sttStream = null;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "error", message: err.message }));
      }
      // Auto-restart stream if client is still recording
      if (isClientRecording) {
        console.log("🔄 Auto-restarting STT stream...");
        setTimeout(() => {
          if (isClientRecording) startSttStream();
        }, 500);
      }
    });

    sttStream.events.on("end", () => {
      console.log("🔚 STT stream ended");
      sttStream = null;
      // Auto-restart if client is still recording (5-min limit hit)
      if (isClientRecording) {
        console.log("🔄 Restarting STT stream (session limit)...");
        startSttStream();
      }
    });
  };

  const endStream = () => {
    isClientRecording = false;
    if (sttStream) {
      sttStream.end();
      sttStream = null;
    }
  };

  ws.send(
    JSON.stringify({
      type: "connected",
      message: "Connected to simple transcription service",
      timestamp: new Date().toISOString(),
    }),
  );

  ws.on("message", (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === "start-stream") {
        // Close existing session if any
        endStream();

        console.log("🎤 Starting STT streaming session...");
        isClientRecording = true;
        startSttStream();

        ws.send(JSON.stringify({ type: "stream-started" }));
      } else if (message.type === "audio-data") {
        if (!sttStream) {
          console.warn("⚠️ Received audio-data but no active STT stream");
          return;
        }
        const pcmBuffer = Buffer.from(message.audio, "base64");
        sttStream.write(pcmBuffer);
      } else if (message.type === "stop-stream") {
        console.log("⏹️ Client requested stop-stream");
        endStream();
      }
    } catch (error) {
      console.error("❌ Error processing simple WebSocket message:", error);
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Failed to process message",
        }),
      );
    }
  });

  ws.on("close", () => {
    endStream();
    console.log("❌ Simple WebSocket disconnected");
  });
}
