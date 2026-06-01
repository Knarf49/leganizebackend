import "dotenv/config";
import { WebSocketServer, WebSocket } from "ws";
import type { Server as HTTPServer } from "http";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { runRiskDetector, type CompanyTypeInput } from "@/lib/riskDetector";
import { runRiskAnalyzer } from "@/lib/riskAnalyzer";

type AudioChunkMessage = {
  type: "audio-chunk";
  roomId: string;
  accessToken: string;
  audio: string;
  mimeType?: string;
  isFinal: boolean;
};

type TranscribedAnalysisMessage = {
  type: "transcribed-for-analysis";
  roomId: string;
  accessToken: string;
  text: string;
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
  audio: string;
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

const BUFFER_SIZE = 1;
const COOLDOWN_MS = 60_000;

const SILENCE_THRESHOLD_RMS = 0.015; // below this = silence
const SILENCE_DURATION_MS = 700;     // flush after 700ms of silence
const MAX_BUFFER_SAMPLES = 16000 * 30; // force flush at 30s

function calculateRMS(pcmBuffer: Buffer): number {
  const samples = pcmBuffer.length / 2;
  if (samples === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcmBuffer.length - 1; i += 2) {
    const sample = pcmBuffer.readInt16LE(i) / 32768;
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples);
}

function createWavBuffer(pcmData: Buffer): Buffer {
  const dataSize = pcmData.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(16000, 24); // sample rate
  header.writeUInt32LE(32000, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmData]);
}

export function initializeWebSocketServer(httpServer: HTTPServer) {
  const wss = new WebSocketServer({ noServer: true });
  globalThis.__wss = wss;

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

  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    if (url.pathname === "/ws") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
  });

  wss.on("connection", (ws: WebSocket, req) => {
    (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
    ws.on("pong", () => {
      (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
    });

    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const roomId = url.searchParams.get("roomId");
    const accessToken = url.searchParams.get("accessToken");

    if (!roomId || !accessToken) {
      ws.close(1008, "Missing roomId or accessToken");
      return;
    }

    const client: WebSocketClient = { ws, roomId, accessToken };

    const set = wsClients.get(roomId) ?? new Set<WebSocketClient>();
    set.add(client);
    wsClients.set(roomId, set);

    // PCM buffer with silence-triggered flush
    let pcmChunks: Buffer[] = [];
    let totalPcmSamples = 0;
    let isStreaming = false;
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    let isFlushing = false;

    const flushToASR = async () => {
      if (isFlushing || pcmChunks.length === 0) return;
      isFlushing = true;

      const pcmData = Buffer.concat(pcmChunks);
      pcmChunks = [];
      totalPcmSamples = 0;

      const asrUrl = process.env.ASR_SERVICE_URL ?? "http://localhost:8000";
      const wav = createWavBuffer(pcmData);
      const form = new FormData();
      form.append("audio", new Blob([wav], { type: "audio/wav" }), "audio.wav");

      try {
        const res = await fetch(`${asrUrl}/transcribe`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) throw new Error(`ASR error: ${res.status}`);

        const asrData = (await res.json()) as { text: string; speaker?: string };
        const text = asrData.text?.trim();
        if (text) {
          const finalText = asrData.speaker ? `[${asrData.speaker}] ${text}` : text;

          await prisma.transcriptChunk.create({ data: { roomId, content: finalText } });

          broadcastToRoom(roomId, { type: "transcribed", text: finalText, timestamp: Date.now() });

          const room = await prisma.room.findFirst({
            where: { id: roomId, accessToken },
            select: { companyType: true },
          });
          if (room) await processTranscriptAnalysis(roomId, finalText, room.companyType);
        }
      } catch (e) {
        console.error("❌ ASR flush failed:", e);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "error", message: "Transcription failed" }));
        }
      } finally {
        isFlushing = false;
        // Re-flush if new chunks arrived while we were processing
        if (pcmChunks.length > 0 && !isStreaming) {
          flushToASR();
        }
      }
    };

    const resetSilenceTimer = () => {
      if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
      silenceTimer = setTimeout(() => {
        silenceTimer = null;
        flushToASR();
      }, SILENCE_DURATION_MS);
    };

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
        } else if (message.type === "start-stream") {
          pcmChunks = [];
          totalPcmSamples = 0;
          isStreaming = true;
          if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
          ws.send(JSON.stringify({ type: "stream-started" }));
          console.log(`🎤 Room ${roomId}: streaming started`);
        } else if (message.type === "audio-data") {
          if (!isStreaming) return;
          const chunk = Buffer.from((message as AudioDataMessage).audio, "base64");
          pcmChunks.push(chunk);
          totalPcmSamples += chunk.length / 2;

          const rms = calculateRMS(chunk);
          if (rms > SILENCE_THRESHOLD_RMS) {
            // Speech — reset silence timer so we don't flush mid-word
            if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
          } else {
            // Silence — start countdown to flush
            if (!silenceTimer) resetSilenceTimer();
          }

          // Force flush if buffer too long
          if (totalPcmSamples >= MAX_BUFFER_SAMPLES) {
            if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
            flushToASR();
          }
        } else if (message.type === "stop-stream") {
          isStreaming = false;
          if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
          console.log(`⏹️ Room ${roomId}: streaming stopped`);
          flushToASR();
        } else if (message.type === "test-alert") {
          const samples = [
            {
              riskLevel: "HIGH",
              issueDescription:
                "ที่ประชุมมีมติโดยไม่ครบองค์ประชุมตามที่กฎหมายกำหนด (ต้องการ 2 ใน 3 ของผู้ถือหุ้น)",
              recommendation:
                "ควรตรวจสอบจำนวนผู้ถือหุ้นและองค์ประชุมก่อนลงมติ",
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
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Failed to process message",
          }),
        );
      }
    });

    ws.on("close", () => {
      isStreaming = false;
      pcmChunks = [];
      totalPcmSamples = 0;
      if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
      console.log(`❌ WebSocket disconnected from room: ${roomId}`);

      const set = wsClients.get(roomId);
      set?.delete(client);

      if (set?.size === 0) {
        wsClients.delete(roomId);
      }
    });

    ws.on("error", () => {});
  });
}

export function broadcastToRoom(
  roomId: string,
  data: Record<string, unknown>,
) {
  const set = wsClients.get(roomId);
  if (!set) return;

  const payload = JSON.stringify(data);

  for (const client of set) {
    try {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload);
      }
    } catch {}
  }
}

export function emitLegalEventWebSocket(
  roomId: string,
  data: Record<string, unknown>,
) {
  broadcastToRoom(roomId, { type: "legal-risk", ...data });
}

async function processTranscriptionQueue(roomId: string) {
  const roomQueue = transcriptionQueues.get(roomId);
  if (!roomQueue || roomQueue.processing) return;

  roomQueue.processing = true;

  try {
    while (roomQueue.queue.length > 0) {
      const item = roomQueue.queue.shift()!;

      broadcastToRoom(roomId, {
        type: "transcribing",
        message: `Processing audio... (${roomQueue.queue.length} in queue)`,
        queueLength: roomQueue.queue.length + 1,
        timestamp: item.timestamp,
      });

      const transcribedText = await processSingleTranscription(item);
      if (transcribedText) {
        const redisKey = `transcript:${roomId}`;
        const listLen = await redis.rpush(redisKey, transcribedText);
        await redis.expire(redisKey, 7200);
        console.log(
          `📝 [Redis] transcript:${roomId} → rpush OK, list length=${listLen}`,
        );
      }

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
    if (roomQueue.queue.length === 0) {
      transcriptionQueues.delete(roomId);
    }
  }
}

async function processSingleTranscription(
  item: TranscriptionQueueItem,
): Promise<string> {
  const { audio, mimeType, roomId, accessToken } = item;

  try {
    const room = await prisma.room.findFirst({
      where: { id: roomId, accessToken },
      select: { id: true, companyType: true },
    });

    if (!room) throw new Error("Invalid room or access token");

    const audioBuffer = Buffer.from(audio, "base64");
    const asrUrl = process.env.ASR_SERVICE_URL ?? "http://localhost:8000";

    const asrForm = new FormData();
    asrForm.append(
      "audio",
      new Blob([audioBuffer], { type: mimeType ?? "audio/webm" }),
      `audio.${mimeType?.includes("mp4") ? "mp4" : "webm"}`,
    );

    const asrRes = await fetch(`${asrUrl}/transcribe`, {
      method: "POST",
      body: asrForm,
    });

    if (!asrRes.ok) throw new Error(`ASR service error: ${asrRes.status}`);

    const asrData = (await asrRes.json()) as {
      text: string;
      speaker: string;
      speaker_confidence: number;
    };

    const text = asrData.text.trim()
      ? `[${asrData.speaker}] ${asrData.text.trim()}`
      : "";
    console.log(`✅ Transcribed (${item.timestamp}): ${text}`);

    broadcastToRoom(roomId, {
      type: "transcribed",
      text,
      timestamp: item.timestamp,
    });

    await processTranscriptAnalysis(roomId, text, room.companyType);

    return text;
  } catch (error) {
    console.error(`❌ Error processing transcription item:`, error);
    broadcastToRoom(roomId, {
      type: "error",
      message: "Failed to transcribe audio",
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return "";
  }
}

async function processTranscriptAnalysis(
  roomId: string,
  text: string,
  companyType: CompanyTypeInput,
) {
  const bufferKey = `room:${roomId}:buffer`;
  const cooldownKey = `room:${roomId}:cooldown`;
  const deepAnalyzingKey = `room:${roomId}:deep-analyzing`;

  const bufferPushLen = await redis.rpush(bufferKey, text);
  await redis.ltrim(bufferKey, -BUFFER_SIZE, -1);

  const bufferLength = await redis.llen(bufferKey);
  console.log(
    `📊 [Redis] buffer:${roomId} → pre-trim=${bufferPushLen}, after-trim=${bufferLength}/${BUFFER_SIZE}`,
  );

  if (bufferLength < BUFFER_SIZE) {
    broadcastToRoom(roomId, {
      type: "buffer-status",
      bufferLength,
      totalNeeded: BUFFER_SIZE,
    });
    return;
  }

  const lastAlertAtRaw = await redis.get(cooldownKey);
  if (lastAlertAtRaw) {
    const lastAlertAt = Number(lastAlertAtRaw);
    if (Date.now() - lastAlertAt < COOLDOWN_MS) {
      await redis.del(bufferKey);
      broadcastToRoom(roomId, {
        type: "cooldown-active",
        message: "Still in cooldown period",
      });
      return;
    }
  }

  const buffer = await redis.lrange(bufferKey, 0, -1);
  console.log(
    `🔍 Running risk detector: roomId=${roomId}, companyType=${companyType}`,
  );

  const isDeepAnalyzingNow = await redis.get(deepAnalyzingKey);
  if (!isDeepAnalyzingNow) {
    broadcastToRoom(roomId, {
      type: "analyzing",
      message: "Checking for legal risks...",
    });
  }

  const signal = await runRiskDetector(buffer, companyType);
  console.log(`📊 Risk detector result: ${signal}`);

  if (!signal) {
    await redis.del(bufferKey);
    const stillDeepAnalyzing = await redis.get(deepAnalyzingKey);
    if (!stillDeepAnalyzing) {
      broadcastToRoom(roomId, {
        type: "analysis-complete",
        hasRisks: false,
        message: "No legal risks detected",
      });
    }
    return;
  }

  console.log(`🧠 Running risk analyzer for room: ${roomId}`);
  await redis.set(deepAnalyzingKey, "1", "EX", 180);

  broadcastToRoom(roomId, {
    type: "deep-analyzing",
    message: "Performing deep legal analysis...",
  });

  try {
    const analyzerResult = await runRiskAnalyzer({ roomId, transcript: buffer });

    if (
      analyzerResult &&
      typeof analyzerResult === "object" &&
      "issues" in analyzerResult &&
      Array.isArray((analyzerResult as { issues?: unknown[] }).issues) &&
      (analyzerResult as { issues: unknown[] }).issues.length > 0
    ) {
      const allIssues = (analyzerResult as { issues: AnalyzerIssue[] }).issues;

      const validIssues = allIssues.filter(
        (issue) =>
          issue.legalBasis?.type !==
          "ไม่พบบทบัญญัติกฎหมายหรือหลักเกณฑ์ที่เกี่ยวข้องในเอกสารที่ค้นพบ",
      );

      if (validIssues.length > 0) {
        console.log(`🚨 Found ${validIssues.length} valid legal issues`);

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

        broadcastToRoom(roomId, {
          type: "legal-risk",
          roomId,
          createdAt: new Date().toISOString(),
          issues: validIssues,
        });

        await redis.set(cooldownKey, Date.now().toString(), "PX", COOLDOWN_MS);
      } else {
        broadcastToRoom(roomId, {
          type: "analysis-complete",
          hasRisks: false,
          message: "Analysis complete - no critical issues found",
        });
      }
    } else {
      broadcastToRoom(roomId, {
        type: "analysis-complete",
        hasRisks: false,
        message: "Analysis complete - no critical issues found",
      });
    }
  } finally {
    await redis.del(deepAnalyzingKey);
  }

  await redis.del(bufferKey);
}

async function handleAudioChunkMessage(message: AudioChunkMessage) {
  const { roomId, accessToken, audio, mimeType } = message;

  try {
    const roomExists = await prisma.room.findFirst({
      where: { id: roomId, accessToken, status: "ACTIVE" },
      select: { id: true },
    });

    if (!roomExists) {
      broadcastToRoom(roomId, {
        type: "error",
        message: "Invalid room or access token",
      });
      return;
    }

    if (!transcriptionQueues.has(roomId)) {
      transcriptionQueues.set(roomId, { queue: [], processing: false });
    }

    const roomQueue = transcriptionQueues.get(roomId)!;
    roomQueue.queue.push({ audio, mimeType, timestamp: Date.now(), roomId, accessToken });

    broadcastToRoom(roomId, {
      type: "queue-status",
      message: `Audio received (${roomQueue.queue.length} in queue)`,
      queueLength: roomQueue.queue.length,
      processing: roomQueue.processing,
    });

    if (!roomQueue.processing) {
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

async function handleTranscribedAnalysisMessage(
  message: TranscribedAnalysisMessage,
) {
  const { roomId, accessToken, text } = message;

  try {
    const room = await prisma.room.findFirst({
      where: { id: roomId, accessToken, status: "ACTIVE" },
      select: { id: true, companyType: true },
    });

    if (!room) {
      broadcastToRoom(roomId, {
        type: "error",
        message: "Invalid room or access token",
      });
      return;
    }

    await prisma.transcriptChunk.create({ data: { roomId, content: text } });
    await processTranscriptAnalysis(roomId, text, room.companyType);
  } catch (error) {
    broadcastToRoom(roomId, {
      type: "error",
      message: "Failed to process transcribed text",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
