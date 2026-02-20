"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
//TODO: change from normal recorder to react-use-recorder
//TODO: ให้ console.log type ของ file ตอนอัดเสียงเสร็จ
function AudioRecorder({
  roomId,
  accessToken,
}: {
  roomId: string;
  accessToken: string;
}) {
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [legalRisks, setLegalRisks] = useState<any[]>([]);
  const [transcripts, setTranscripts] = useState<string[]>([]);
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
          setTranscripts((prev) => [...prev, data.text]);
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

      // Auto-reconnect after 2 seconds
      setTimeout(() => {
        if (!roomId || !accessToken) return;

        const protocol = window.location.protocol === "https:" ? "wss" : "ws";
        const host = window.location.host;
        const wsUrl = `${protocol}://${host}/ws?roomId=${roomId}&accessToken=${accessToken}`;

        try {
          const newWs = new WebSocket(wsUrl);
          wsRef.current = newWs;
          // Re-attach handlers...
          newWs.onopen = () => {
            setStatus("Connected");
          };
          newWs.onerror = () => setStatus("❌ WebSocket connection error");
          newWs.onclose = () => setStatus("❌ WebSocket disconnected");
        } catch (error) {
          console.error("❌ Reconnect failed:", error);
        }
      }, 2000);
    };

    wsRef.current = ws;

    return () => {
      console.log("🔌 Cleaning up WebSocket connection");
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close(1000, "Component unmounting");
      }
    };
  }, [roomId, accessToken]); // Only re-run when room credentials change

  const startRecording = async () => {
    try {
      console.log("🎙️ Start recording clicked");
      allChunksRef.current = [];
      sentSizeRef.current = 0;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log("✅ Got audio stream");

      // Try different audio formats in order of compatibility
      // const mimeType = "audio/mp4";
      const mimeType = "audio/webm;codecs=opus";

      const mediaRecorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      console.log(
        `🎤 Using MediaRecorder with mimeType: ${mediaRecorder.mimeType}`,
      );

      // const chunks: Blob[] = [];

      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size === 0) return;
        console.log(
          `📦 ondataavailable triggered, event.data.size: ${event.data.size}`,
        );

        allChunksRef.current.push(event.data);

        // Check if accumulated size exceeds threshold
        const totalSize = allChunksRef.current.reduce(
          (sum, chunk) => sum + chunk.size,
          0,
        );
        const newDataSize = totalSize - sentSizeRef.current;
        // console.log(`📊 Total accumulated size: ${newDataSize} bytes`);

        if (newDataSize >= CHUNK_SIZE) {
          console.log(
            `🚀 Size threshold reached, sending to transcribe API...`,
          );
          // Determine format based on what was actually used
          const mimeType = mediaRecorder.mimeType;
          const audioBlob = new Blob(allChunksRef.current, { type: mimeType });

          // Validate audio blob size (minimum 30KB for meaningful transcription)
          if (audioBlob.size < 30 * 1024) {
            console.log(
              `⚠️ Audio chunk too small (${audioBlob.size} bytes), skipping...`,
            );
            return;
          }

          if (audioBlob.size >= 30 * 1024) {
            await transcribeAudioChunk(audioBlob);
            sentSizeRef.current = totalSize; // update ว่าส่งไปถึงไหนแล้ว
          }
        }
      };

      mediaRecorder.onstop = async () => {
        console.log("⏹️ Recording stopped");
        if (allChunksRef.current.length > 0) {
          const mimeType = mediaRecorder.mimeType;
          const audioBlob = new Blob(allChunksRef.current, { type: mimeType });

          // Validate final chunk size
          if (audioBlob.size >= 30 * 1024) {
            await transcribeAudioChunk(audioBlob);
          } else {
            console.log(
              `⚠️ Final audio chunk too small (${audioBlob.size} bytes), skipping...`,
            );
          }
        }
        allChunksRef.current = [];
        sentSizeRef.current = 0;
      };

      mediaRecorder.start(250); // Collect data every 250ms for lower latency
      console.log("🔴 MediaRecorder started");
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      setStatus("Recording...");
      setLegalRisks([]);
      setTranscripts([]);
    } catch (error) {
      console.error("❌ Error accessing microphone:", error);
      setStatus("Microphone error");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream
        .getTracks()
        .forEach((track) => track.stop());
      setIsRecording(false);
      setStatus("Stopped");
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
        <button
          onClick={startRecording}
          disabled={isRecording}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50 hover:bg-blue-600"
        >
          Start Recording
        </button>
        <button
          onClick={stopRecording}
          disabled={!isRecording}
          className="px-4 py-2 bg-red-500 text-white rounded disabled:opacity-50 hover:bg-red-600"
        >
          Stop Recording
        </button>
      </div>

      {/* Transcript Display */}
      {transcripts.length > 0 && (
        <div className="bg-blue-50 border border-blue-300 rounded p-4">
          <h3 className="font-bold text-blue-700 mb-3">
            📝 Transcription ({transcripts.length} chunks)
          </h3>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {transcripts.map((text, idx) => (
              <div
                key={idx}
                className="bg-white p-3 rounded border border-blue-200"
              >
                <span className="text-xs text-blue-500 font-semibold">
                  Chunk {idx + 1}:
                </span>
                <p className="mt-1 text-gray-800">{text}</p>
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

  return (
    <div className="min-h-screen bg-linear-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <h1 className="text-3xl font-bold mb-8 text-gray-800">
            Audio Recording & Legal Analysis
          </h1>

          {!isConnected ? (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Room ID
                </label>
                <Input
                  type="text"
                  placeholder="Enter room ID"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Access Token
                </label>
                <Input
                  type="password"
                  placeholder="Enter access token"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded"
                />
              </div>

              <button
                onClick={handleConnect}
                disabled={!roomId.trim() || !accessToken.trim()}
                className="w-full px-4 py-3 bg-indigo-600 text-white rounded font-semibold disabled:opacity-50 hover:bg-indigo-700 transition"
              >
                Connect
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="bg-gray-100 p-4 rounded">
                <p className="text-sm text-gray-600">
                  <strong>Room ID:</strong> {roomId}
                </p>
                <p className="text-sm text-gray-600 mt-2">
                  <strong>Access Token:</strong> {accessToken.substring(0, 10)}
                  ...
                </p>
              </div>

              <AudioRecorder roomId={roomId} accessToken={accessToken} />

              <button
                onClick={handleDisconnect}
                className="w-full px-4 py-2 bg-gray-500 text-white rounded font-semibold hover:bg-gray-600 transition"
              >
                Disconnect
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
