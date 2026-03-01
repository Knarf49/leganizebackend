"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { fixThaiSpacing } from "@/lib/textProcessing";

function AudioRecorder() {
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const processorRef = useRef<any | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isStoppingRef = useRef(false);
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Ready");
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
        } else if (data.type === "stream-started") {
          setStatus("🎤 Recording & streaming...");
        } else if (data.type === "partial-transcript") {
          setStatus(`🎤 ${data.text}`);
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

  const sendAudioToWebSocket = (pcmBuffer: ArrayBuffer) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // Convert ArrayBuffer to base64
    const bytes = new Uint8Array(pcmBuffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    ws.send(JSON.stringify({ type: "audio-data", audio: base64 }));
  };

  const startRecording = async () => {
    try {
      console.log("🎙️ Start recording clicked");

      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setStatus("❌ WebSocket not connected");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      console.log("✅ Got audio stream");

      // Tell server to start a new STT streaming session
      ws.send(JSON.stringify({ type: "start-stream" }));

      // AudioContext at 16 kHz mono — required for LINEAR16 PCM
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN)
          return;
        const float32 = e.inputBuffer.getChannelData(0);
        // Convert Float32 [-1,1] → Int16 PCM
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          int16[i] = Math.max(
            -32768,
            Math.min(32767, Math.round(float32[i] * 32767)),
          );
        }
        sendAudioToWebSocket(int16.buffer);
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      setIsRecording(true);
      setTranscripts([]);
      setStatus("🎤 Waiting for stream to start...");
    } catch (error) {
      console.error("❌ Error accessing microphone:", error);
      setStatus("❌ Microphone error");
    }
  };

  const stopRecording = async () => {
    if (!isRecording || isStoppingRef.current) return;
    isStoppingRef.current = true;
    console.log("⏹️ Stopping recording...");

    // Disconnect audio nodes
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioContextRef.current) {
      await audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Stop microphone tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    // Tell server to end the STT stream
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "stop-stream" }));
    }

    setIsRecording(false);
    setStatus("⏹️ Stopped — waiting for final transcript...");
    isStoppingRef.current = false;
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
                อัดเสียงและดู transcription แบบง่าย ๆ ผ่าน WebSocket
                (ไม่ต้องสร้าง room)
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
