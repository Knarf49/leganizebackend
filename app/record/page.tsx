"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { fixThaiSpacing } from "@/lib/textProcessing";

// Dynamic import for RecordRTC to avoid SSR issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RecordRTC: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let StereoAudioRecorder: any = null;


function AudioRecorder() {
  const wsRef = useRef<WebSocket | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recorderRef = useRef<any | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isStoppingRef = useRef(false);
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [chunkCount, setChunkCount] = useState(0); // Track chunks sent
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

  // Connect to WebSocket on mount
  const connectWebSocket = useCallback(() => {
    // Prevent duplicate connections
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
      console.log("⚠️ WebSocket already exists, skipping new connection");
      return;
    }

    // Connect to simple WebSocket
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.host;
    const wsUrl = `${protocol}://${host}/ws/simple`;

    console.log(`🔌 Connecting to simple WebSocket: ${wsUrl}`);

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (error) {
      console.error("❌ Failed to create WebSocket:", error);
      setStatus("❌ Connection failed");
      return;
    }

    ws.onopen = () => {
      console.log("✅ WebSocket connected");
      setStatus("✅ Connected");
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === "connected") {
          setStatus("✅ Connected");
        } else if (data.type === "transcribing") {
          setStatus("🎤 Transcribing audio...");
        } else if (data.type === "transcribed") {
          setStatus("✅ Transcription complete");
          setTranscripts((prev) => [
            ...prev,
            {
              text: fixThaiSpacing(data.text ?? ""),
              speakers: data.speakers?.map(
                (s: {
                  speakerTag: number;
                  text: string;
                  startTime: number;
                  endTime: number;
                }) => ({
                  ...s,
                  text: fixThaiSpacing(s.text ?? ""),
                }),
              ),
            },
          ]);
        } else if (data.type === "error") {
          setStatus(`❌ Error: ${data.message}`);
          console.error("❌ WebSocket error:", data);
        }
      } catch (error) {
        console.error("❌ Failed to parse WebSocket message:", error);
      }
    };

    ws.onerror = (event) => {
      console.error("❌ WebSocket error:", event);
      setStatus("❌ WebSocket error");
    };

    ws.onclose = () => {
      setStatus("⚠️ Disconnected, reconnecting...");
      console.log("🔌 WebSocket closed, reconnecting in 2s...");
      wsRef.current = null;
      setTimeout(() => connectWebSocket(), 2000);
    };

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connectWebSocket();

    return () => {
      console.log("🔌 Cleaning up WebSocket connection");
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close(1000, "Component unmounting");
      }
    };
  }, [connectWebSocket]);

  const sendAudioToWebSocket = async (blob: Blob) => {
    try {
      console.log(`🎤 Sending audio via WebSocket: ${blob.size} bytes`);

      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn("⚠️ WebSocket is not connected, skipping chunk");
        return;
      }

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
          audio: base64,
          mimeType: blob.type,
        }),
      );

      // Update chunk count
      setChunkCount((prev) => {
        const newCount = prev + 1;
        setStatus(`🎤 Recording... (${newCount} chunks sent)`);
        return newCount;
      });

      console.log(`✅ Audio chunk sent via WebSocket`);
    } catch (error) {
      console.error("❌ Error sending audio:", error);
    }
  };

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

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      console.log("✅ Got audio stream");

      // Configure RecordRTC for WAV format with real-time chunks
      const recorder = new RecordRTC(stream, {
        type: "audio",
        mimeType: "audio/wav",
        recorderType: StereoAudioRecorder,
        numberOfAudioChannels: 1,
        desiredSampRate: 16000,
        timeSlice: 3000, // Send chunks every 3 seconds
        ondataavailable: async (blob: Blob) => {
          if (blob.size === 0) return;
          console.log(`📦 Audio chunk ready, size: ${blob.size} bytes`);

          // Validate minimum size (at least 10KB for meaningful transcription)
          if (blob.size < 10 * 1024) {
            console.log(
              `⚠️ Audio chunk too small (${blob.size} bytes), skipping...`,
            );
            return;
          }

          // Send chunk immediately via WebSocket
          await sendAudioToWebSocket(blob);
        },
      });

      console.log("🎤 Starting RecordRTC with real-time chunking");
      recorder.startRecording();
      recorderRef.current = recorder;
      setIsRecording(true);
      setChunkCount(0); // Reset chunk count
      setStatus("🎤 Recording... (0 chunks sent)");
      setTranscripts([]);
    } catch (error) {
      console.error("❌ Error accessing microphone:", error);
      setStatus("❌ Microphone error");
    }
  };

  const stopRecording = async () => {
    if (recorderRef.current && !isStoppingRef.current) {
      console.log("⏹️ Stopping recording...");
      isStoppingRef.current = true;

      const recorder = recorderRef.current;
      const stream = streamRef.current;
      const totalChunks = chunkCount;
      recorderRef.current = null;
      streamRef.current = null;
      setIsRecording(false);
      setStatus(`✅ Recording stopped (${totalChunks} chunks sent)`);

      recorder.stopRecording(() => {
        console.log("✅ RecordRTC stopped");

        // Stop all microphone tracks
        if (stream) {
          stream.getTracks().forEach((track) => track.stop());
        }

        isStoppingRef.current = false;
        console.log("✅ Recording stopped and cleaned up");
      });
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
            📝 Transcription ({transcripts.length}{" "}
            {transcripts.length === 1 ? "recording" : "recordings"})
          </h3>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {transcripts.map((transcript, idx) => (
              <div
                key={idx}
                className="bg-white p-3 rounded border border-blue-200"
              >
                <span className="text-xs text-blue-500 font-semibold">
                  Recording {idx + 1}:
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
    </div>
  );
}


export default function RecordPage() {
  return (
    <div className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-4xl">
        <section className="rounded-3xl border border-slate-200 bg-white/95 p-8 shadow-[0_22px_60px_-40px_rgba(15,23,42,0.6)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2
                className="text-3xl font-semibold"
                style={{ fontFamily: '"Fraunces", serif' }}
              >
                Audio Recording & Transcription
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                อัดเสียงและดู transcription แบบง่าย ๆ ผ่าน WebSocket (ไม่ต้องสร้าง room)
              </p>
            </div>
            <div className="rounded-2xl bg-slate-900 px-4 py-3 text-xs uppercase tracking-[0.18em] text-slate-100">
              WebSocket Mode
            </div>
          </div>

          <div className="mt-8">
            <AudioRecorder />
          </div>
        </section>
      </div>
    </div>
  );
}
