"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { fixThaiSpacing } from "@/lib/textProcessing";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Dynamic import for RecordRTC to avoid SSR issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RecordRTC: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let StereoAudioRecorder: any = null;

/**
 * Merge multiple WAV blobs into a single valid WAV blob.
 * Each RecordRTC ondataavailable slice is a complete WAV file with a 44-byte RIFF
 * header. Naive Blob concatenation chains those headers together, creating an
 * invalid file that Speech-to-Text silently rejects. This function keeps only the
 * first blob's header and appends the raw PCM data from every blob, then patches
 * the RIFF/data size fields so the result is a well-formed WAV.
 */
async function mergeWavBlobs(blobs: Blob[]): Promise<Blob> {
  const WAV_HEADER_SIZE = 44;
  if (blobs.length === 0) return new Blob([], { type: "audio/wav" });
  if (blobs.length === 1) return blobs[0];

  const buffers = await Promise.all(blobs.map((b) => b.arrayBuffer()));

  // Total bytes of raw PCM across all blobs (header stripped from each)
  const totalPcmSize = buffers.reduce(
    (sum, buf) => sum + Math.max(0, buf.byteLength - WAV_HEADER_SIZE),
    0,
  );

  // Clone the first blob's header so we can patch the size fields
  const headerBuf = buffers[0].slice(0, WAV_HEADER_SIZE);
  const view = new DataView(headerBuf);
  // Bytes 4-7: RIFF chunk size = total file size - 8
  view.setUint32(4, totalPcmSize + WAV_HEADER_SIZE - 8, true);
  // Bytes 40-43: data sub-chunk size
  view.setUint32(40, totalPcmSize, true);

  const parts: BlobPart[] = [headerBuf as BlobPart];
  for (const buf of buffers) {
    if (buf.byteLength > WAV_HEADER_SIZE) {
      parts.push(new Uint8Array(buf, WAV_HEADER_SIZE) as unknown as BlobPart);
    }
  }

  return new Blob(parts, { type: "audio/wav" });
}

//TODO: แก้ error ตอน file เสียงรวมเกิน 1 min
function AudioRecorder({
  roomId,
  accessToken,
}: {
  roomId: string;
  accessToken: string;
}) {
  const wsRef = useRef<WebSocket | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recorderRef = useRef<any | null>(null);
  const streamRef = useRef<MediaStream | null>(null); // keep stream separately for clean teardown
  const isStoppingRef = useRef(false); // guard against stop/start race condition
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Ready");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [legalRisks, setLegalRisks] = useState<any[]>([]);
  const [transcripts, setTranscripts] = useState<
    Array<{
      text: string;
      speakers?: Array<{
        speakerTag: number;
        text: string;
        startTime: number;
        endTime: number;
      }>;
    }>
  >([]);
  const allChunksRef = useRef<Blob[]>([]);
  const sentSizeRef = useRef<number>(0);

  const CHUNK_SIZE = 200 * 1024; // 200KB chunks - balance between latency and file integrity

  // Helper to ensure WebSocket is connected
  const ensureWebSocketConnected = async (): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        resolve(wsRef.current);
        return;
      }

      // Wait for connection with longer timeout
      const timeout = setTimeout(() => {
        reject(new Error("WebSocket connection timeout after 15 seconds"));
      }, 15000); // Increased to 15 seconds

      const checkConnection = () => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          clearTimeout(timeout);
          resolve(wsRef.current!);
        } else if (
          wsRef.current?.readyState === WebSocket.CLOSED ||
          wsRef.current?.readyState === WebSocket.CLOSING
        ) {
          // WebSocket is closed/closing, reject immediately
          clearTimeout(timeout);
          reject(new Error("WebSocket is closed or closing"));
        } else {
          // Still connecting, wait more
          setTimeout(checkConnection, 200);
        }
      };

      checkConnection();
    });
  };

  useEffect(() => {
    // Only connect if we have valid credentials
    if (!roomId || !accessToken) {
      return;
    }

    connectWebSocket();

    return () => {
      console.log("🔌 Cleaning up WebSocket connection");
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close(1000, "Component unmounting");
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, accessToken]); // Only re-run when room credentials change

  function connectWebSocket() {
    if (!roomId || !accessToken) return;

    // Prevent duplicate connections
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
      console.log("⚠️ WebSocket already exists, skipping new connection");
      return;
    }

    // Connect to WebSocket (for legal risk analysis)
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.host;
    const wsUrl = `${protocol}://${host}/ws?roomId=${roomId}&accessToken=${accessToken}`;

    console.log(`🔌 Creating NEW WebSocket connection: ${wsUrl}`);

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (error) {
      console.error("❌ Failed to create WebSocket:", error);
      return;
    }

    ws.onopen = () => {
      setStatus("Connected");
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "connected") {
          setStatus("Connected");
        } else if (data.type === "queue-status") {
          setStatus(`📋 ${data.message}`);
        } else if (data.type === "transcribing") {
          setStatus(data.message || "🎤 Transcribing audio...");
        } else if (data.type === "transcribed") {
          setStatus(`✅ Transcribed: ${data.text}`);
          setTranscripts((prev) => [
            ...prev,
            {
              text: fixThaiSpacing(data.text ?? ""),
              speakers: data.speakers?.map(
                (s: { speakerTag: number; text: string; startTime: number; endTime: number }) => ({
                  ...s,
                  text: fixThaiSpacing(s.text ?? ""),
                })
              ),
            },
          ]);
        } else if (data.type === "analyzing") {
          setStatus("🔍 Checking for legal risks...");
        } else if (data.type === "deep-analyzing") {
          setStatus("🧠 Performing deep legal analysis...");
        } else if (data.type === "buffer-status") {
          setStatus(`📊 Buffer: ${data.bufferLength}/${data.totalNeeded}`);
        } else if (data.type === "cooldown-active") {
          setStatus("⏱️ Cooldown active, please wait...");
        } else if (data.type === "legal-risk") {
          setStatus("🚨 Legal Risks Found!");
          setLegalRisks(data.issues || []);
        } else if (data.type === "analysis-complete") {
          if (data.hasRisks) {
            setStatus("⚠️ " + data.message);
          } else {
            setStatus("✅ " + data.message);
          }
        } else if (data.type === "error") {
          setStatus(`❌ Error: ${data.message}`);
        }
      } catch (error) {
        console.error("❌ Failed to parse message:", error);
      }
    };

    ws.onerror = (event) => {
      console.error("❌ WebSocket error:", event);
      setStatus("❌ WebSocket connection error");
    };

    ws.onclose = () => {
      setStatus("⚠️ WebSocket disconnected, attempting reconnect...");
      console.log("🔌 WebSocket closed, reconnecting in 2s...");

      // Auto-reconnect after 2 seconds — trigger the useEffect by clearing wsRef
      // so the effect sees wsRef as null/closed and re-runs via a state change.
      wsRef.current = null;
      setTimeout(() => connectWebSocket(), 2000);
    };

    wsRef.current = ws;
  }

  const startRecording = async () => {
    try {
      console.log("🎙️ Start recording clicked");

      // Dynamic import RecordRTC to avoid SSR issues
      if (!RecordRTC) {
        const recordRTCModule = await import("recordrtc");
        RecordRTC = recordRTCModule.default;
        StereoAudioRecorder = recordRTCModule.StereoAudioRecorder;
        console.log("✅ RecordRTC loaded");
      }

      allChunksRef.current = [];
      sentSizeRef.current = 0;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      console.log("✅ Got audio stream");

      // Configure RecordRTC for Linear16 PCM at 16kHz
      const recorder = new RecordRTC(stream, {
        type: "audio",
        mimeType: "audio/wav",
        recorderType: StereoAudioRecorder,
        numberOfAudioChannels: 1, // Mono for Google Cloud STT
        desiredSampRate: 16000, // 16kHz sample rate for Linear16
        timeSlice: 250, // Get data every 250ms
        ondataavailable: async (blob: Blob) => {
          if (blob.size === 0) return;
          console.log(`📦 ondataavailable triggered, blob.size: ${blob.size}`);

          allChunksRef.current.push(blob);

          // Check if accumulated size exceeds threshold
          const totalSize = allChunksRef.current.reduce(
            (sum, chunk) => sum + chunk.size,
            0,
          );
          const newDataSize = totalSize - sentSizeRef.current;

          if (newDataSize >= CHUNK_SIZE) {
            console.log(
              `🚀 Size threshold reached, sending to transcribe API...`,
            );

            // Snapshot current chunks then reset so the next batch starts fresh.
            // Merging is required because each 250ms slice is a complete WAV file
            // with its own RIFF header — raw concatenation produces an invalid file.
            const chunksToSend = allChunksRef.current.slice();
            allChunksRef.current = [];
            sentSizeRef.current = 0;

            const audioBlob = await mergeWavBlobs(chunksToSend);

            // Validate audio blob size (minimum 10KB for meaningful transcription)
            if (audioBlob.size < 10 * 1024) {
              console.log(
                `⚠️ Audio chunk too small (${audioBlob.size} bytes), skipping...`,
              );
              return;
            }

            await transcribeAudioChunk(audioBlob);
          }
        },
      });

      console.log("🎤 Starting RecordRTC with Linear16 PCM format");
      recorder.startRecording();
      recorderRef.current = recorder;
      setIsRecording(true);
      setStatus("Recording...");
      setLegalRisks([]);
      setTranscripts([]);
    } catch (error) {
      console.error("❌ Error accessing microphone:", error);
      setStatus("Microphone error");
    }
  };

  const stopRecording = async () => {
    if (recorderRef.current && !isStoppingRef.current) {
      console.log("⏹️ Stopping recording...");
      isStoppingRef.current = true;

      // Capture refs synchronously NOW before any async work,
      // so a concurrent startRecording() cannot interfere.
      const recorder = recorderRef.current;
      const stream = streamRef.current;
      recorderRef.current = null;
      streamRef.current = null;
      setIsRecording(false);
      setStatus("Stopped");

      recorder.stopRecording(async () => {
        // ส่ง chunk สุดท้ายถ้ามีข้อมูลที่ยังไม่ได้ส่ง
        // Snapshot chunks before clearing so a new recording cannot corrupt them.
        const finalChunks = allChunksRef.current.slice();
        allChunksRef.current = [];
        sentSizeRef.current = 0;

        if (finalChunks.length > 0) {
          const audioBlob = await mergeWavBlobs(finalChunks);
          if (audioBlob.size > 44 + 10 * 1024) {
            await transcribeAudioChunk(audioBlob);
          }
        }

        // Stop all microphone tracks
        if (stream) {
          stream.getTracks().forEach((track) => track.stop());
        } else {
          // Fallback: try to stop via internal recorder
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const internalRecorder = recorder.getInternalRecorder() as any;
          if (internalRecorder?.stream) {
            internalRecorder.stream
              .getTracks()
              .forEach((track: MediaStreamTrack) => track.stop());
          }
        }

        isStoppingRef.current = false;
        console.log("✅ Recording stopped and cleaned up");
      });
    }
  };

  const transcribeAudioChunk = async (blob: Blob) => {
    try {
      console.log(`🎤 Sending audio chunk via WebSocket: ${blob.size} bytes`);
      setStatus("⏳ Checking WebSocket connection...");

      // Wait for WebSocket to be ready
      try {
        const ws = await ensureWebSocketConnected();
        setStatus("🎤 Sending audio for transcription...");

        // Convert blob to base64
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            const base64Data = result.split(",")[1];
            resolve(base64Data);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });

        // Send via WebSocket
        ws.send(
          JSON.stringify({
            type: "audio-chunk",
            roomId,
            accessToken,
            audio: base64,
            mimeType: blob.type, // Include the MIME type for proper file extension
            isFinal: false,
          }),
        );

        console.log(`✅ Audio chunk sent via WebSocket`);
        setStatus("📡 Audio sent, waiting for transcription...");
      } catch (connectionError) {
        console.error("❌ WebSocket connection failed:", connectionError);
        setStatus(
          `❌ Connection Error: ${connectionError instanceof Error ? connectionError.message : "Unknown"}`,
        );
        return;
      }
    } catch (error) {
      console.error("❌ Error sending audio chunk:", error);
      setStatus(
        `❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-4 items-center">
        <p className="text-lg font-semibold">Status: {status}</p>
      </div>

      <div className="flex gap-2">
        <Button
          onClick={startRecording}
          disabled={isRecording}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50 hover:bg-blue-600"
        >
          Start Recording
        </Button>
        <Button
          onClick={stopRecording}
          disabled={!isRecording}
          className="px-4 py-2 bg-red-500 text-white rounded disabled:opacity-50 hover:bg-red-600"
        >
          Stop Recording
        </Button>
      </div>

      {/* Transcript Display */}
      {transcripts.length > 0 && (
        <div className="bg-blue-50 border border-blue-300 rounded p-4">
          <h3 className="font-bold text-blue-700 mb-3">
            📝 Transcription ({transcripts.length} chunks)
          </h3>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {transcripts.map((transcript, idx) => (
              <div
                key={idx}
                className="bg-white p-3 rounded border border-blue-200"
              >
                <span className="text-xs text-blue-500 font-semibold">
                  Chunk {idx + 1}:
                </span>
                <p className="mt-1 text-gray-800">{transcript.text}</p>

                {/* Display speaker information if available */}
                {transcript.speakers && transcript.speakers.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-blue-100">
                    <p className="text-xs text-blue-600 font-semibold mb-2">
                      👥 Speakers Detected:
                    </p>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {transcript.speakers.map((speaker, sIdx) => (
                        <div
                          key={sIdx}
                          className="text-xs bg-blue-50 p-2 rounded"
                        >
                          <span className="font-semibold text-blue-700">
                            ผู้พูด {speaker.speakerTag + 1}
                          </span>
                          <span className="text-gray-500 ml-2">
                            ({speaker.startTime.toFixed(1)}s -{" "}
                            {speaker.endTime.toFixed(1)}s):
                          </span>
                          <p className="mt-1 text-gray-700">{speaker.text}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {legalRisks.length > 0 && (
        <div className="bg-red-50 border border-red-300 rounded p-4">
          <h3 className="font-bold text-red-700 mb-3">
            🚨 Found {legalRisks.length} Legal Risk(s)
          </h3>
          <div className="space-y-4">
            {legalRisks.map((issue, idx) => (
              <div
                key={idx}
                className="bg-white p-3 rounded border border-red-200"
              >
                <p className="font-semibold text-red-600">
                  Risk Level: {issue.riskLevel}
                </p>
                <p className="mt-1">
                  <strong>Issue:</strong> {issue.issueDescription}
                </p>
                <p className="mt-1">
                  <strong>Legal Basis:</strong> {issue.legalBasis?.type} -
                  {issue.legalBasis?.reference}
                </p>
                <p className="mt-1">
                  <strong>Reasoning:</strong> {issue.legalReasoning}
                </p>
                <p className="mt-1">
                  <strong>Recommendation:</strong> {issue.recommendation}
                </p>
                <p className="mt-1 text-amber-600">
                  <strong>Urgency:</strong> {issue.urgencyLevel}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function RecordPage() {
  const [roomId, setRoomId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [formData, setFormData] = useState<{
    companyType: "บริษัทจำกัด" | "บริษัทมหาชนจำกัด";
  }>({
    companyType: "บริษัทจำกัด",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitResult, setSubmitResult] = useState<Record<
    string,
    unknown
  > | null>(null);

  const handleConnect = () => {
    if (roomId.trim() && accessToken.trim()) {
      setIsConnected(true);
    }
  };

  const handleDisconnect = () => {
    setIsConnected(false);
    setRoomId("");
    setAccessToken("");
  };

  const handleSubmit = async (event: React.SubmitEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setSubmitError(null);
    setSubmitResult(null);

    try {
      const res = await fetch("/api/room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyType: formData.companyType }),
      });

      const data = (await res.json()) as Record<string, unknown>;

      if (!res.ok) {
        setSubmitError(
          typeof data.error === "string" ? data.error : "Failed to create room",
        );
        setSubmitResult(data);
        return;
      }

      setSubmitResult(data);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Unexpected error",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-6xl grid gap-8 lg:grid-cols-[360px_1fr]">
        <section className="rounded-3xl border border-amber-100 bg-white/90 p-6 shadow-[0_18px_45px_-30px_rgba(15,23,42,0.6)] backdrop-blur">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.2em] text-amber-600">
              Create Room
            </p>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
              Step 01
            </span>
          </div>
          <h1 className="mt-4 text-2xl font-semibold">
            เลือกประเภทบริษัทก่อนเริ่มประชุม
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            ระบบจะสร้างห้องพร้อมโครงสร้างการวิเคราะห์ให้เหมาะกับประเภทบริษัทของคุณ
          </p>
          <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">
                Company type
              </label>
              <Select
                value={formData.companyType}
                onValueChange={(value) =>
                  setFormData((prev) => ({
                    ...prev,
                    companyType: value as "บริษัทจำกัด" | "บริษัทมหาชนจำกัด",
                  }))
                }
              >
                <SelectTrigger className="w-full rounded-xl border-slate-200 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="บริษัทจำกัด">บริษัทจำกัด</SelectItem>
                    <SelectItem value="บริษัทมหาชนจำกัด">
                      บริษัทมหาชนจำกัด
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-xl bg-amber-500 text-slate-900 hover:bg-amber-400"
            >
              {isSubmitting ? "Creating..." : "Create meeting room"}
            </Button>
            {submitError && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {submitError}
              </p>
            )}
            {submitResult && (
              <pre className="rounded-xl bg-slate-900/90 p-3 text-xs text-slate-100 overflow-x-auto">
                {JSON.stringify(submitResult, null, 2)}
              </pre>
            )}
          </form>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white/95 p-8 shadow-[0_22px_60px_-40px_rgba(15,23,42,0.6)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2
                className="text-3xl font-semibold"
                style={{ fontFamily: '"Fraunces", serif' }}
              >
                Audio Recording & Legal Analysis
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                เชื่อมต่อห้องเพื่อเริ่มอัดเสียงและวิเคราะห์ความเสี่ยงทางกฎหมายแบบเรียลไทม์
              </p>
            </div>
            <div className="rounded-2xl bg-slate-900 px-4 py-3 text-xs uppercase tracking-[0.18em] text-slate-100">
              Live Session
            </div>
          </div>

          <div className="mt-8">
            {!isConnected ? (
              <div className="grid gap-5">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Room ID
                  </label>
                  <Input
                    type="text"
                    placeholder="Enter room ID"
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value)}
                    className="w-full rounded-xl border-slate-200 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Access Token
                  </label>
                  <Input
                    type="password"
                    placeholder="Enter access token"
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    className="w-full rounded-xl border-slate-200 bg-white"
                  />
                </div>

                <Button
                  onClick={handleConnect}
                  disabled={!roomId.trim() || !accessToken.trim()}
                  className="w-full rounded-xl bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  Connect
                </Button>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm text-slate-600">
                    <strong className="text-slate-700">Room ID:</strong>{" "}
                    {roomId}
                  </p>
                  <p className="text-sm text-slate-600 mt-2">
                    <strong className="text-slate-700">Access Token:</strong>{" "}
                    {accessToken.substring(0, 10)}...
                  </p>
                </div>

                <AudioRecorder roomId={roomId} accessToken={accessToken} />

                <Button
                  onClick={handleDisconnect}
                  className="w-full rounded-xl bg-slate-200 text-slate-900 hover:bg-slate-300"
                >
                  Disconnect
                </Button>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
