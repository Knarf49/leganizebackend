"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
//TODO: test ระบบ record เสียง
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

  const MAX_CHUNK_SIZE = 512 * 1024; // 512KB (smaller for testing)

  useEffect(() => {
    // Only connect if we have valid credentials
    if (!roomId || !accessToken) {
      return;
    }

    // Connect to WebSocket
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.host;
    const wsUrl = `${protocol}://${host}/ws?roomId=${roomId}&accessToken=${accessToken}`;

    console.log(`🔌 Connecting to WebSocket: ${wsUrl}`);

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (error) {
      console.error("❌ Failed to create WebSocket:", error);
      return;
    }

    ws.onopen = () => {
      console.log("✅ WebSocket connected");
      setStatus("Connected");
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("📨 Message from server:", data);

        if (data.type === "connected") {
          setStatus("Connected");
        } else if (data.type === "transcribing") {
          setStatus("🎤 Transcribing audio...");
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
          console.log("🚨 Legal risk alert:", data);
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
      console.error("❌ WebSocket error event:", event);
      const wsError = event as Event;
      console.error("Error details:", {
        type: wsError.type,
        target: (wsError.target as WebSocket)?.readyState,
      });
      console.error("Full ws state:", {
        readyState: ws.readyState,
        url: ws.url,
        protocol: ws.protocol,
      });
      setStatus("❌ WebSocket connection error");
    };

    ws.onclose = () => {
      console.log("🔌 WebSocket disconnected");
      setStatus("❌ Disconnected from server");
    };

    wsRef.current = ws;

    return () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, [roomId, accessToken]);

  const startRecording = async () => {
    try {
      console.log("🎙️ Start recording clicked");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log("✅ Got audio stream");

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });

      const chunks: Blob[] = [];

      mediaRecorder.ondataavailable = async (event) => {
        console.log(
          `📦 ondataavailable triggered, event.data.size: ${event.data.size}`
        );
        chunks.push(event.data);

        // Check if accumulated size exceeds threshold
        const totalSize = chunks.reduce((sum, chunk) => sum + chunk.size, 0);
        console.log(`📊 Total accumulated size: ${totalSize} bytes`);

        if (totalSize >= MAX_CHUNK_SIZE) {
          console.log(`🚀 Size threshold reached, sending...`);
          const audioBlob = new Blob(chunks, { type: "audio/webm" });
          await sendAudioChunk(audioBlob, false);
          chunks.length = 0; // Clear chunks
        }
      };

      mediaRecorder.onstop = async () => {
        console.log(`⏹️ Recording stopped, remaining chunks: ${chunks.length}`);
        if (chunks.length > 0) {
          const audioBlob = new Blob(chunks, { type: "audio/webm" });
          await sendAudioChunk(audioBlob, true);
        }
      };

      mediaRecorder.start(100); // Collect data every 100ms
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

  const sendAudioChunk = async (blob: Blob, isFinal: boolean) => {
    console.log(`🔍 sendAudioChunk called, checking WS Connection...`, {
      wsRef: !!wsRef.current,
      readyState: wsRef.current?.readyState,
      OPEN: WebSocket.OPEN,
      isOpen: wsRef.current?.readyState === WebSocket.OPEN,
    });

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error("❌ WebSocket not connected", {
        wsRef: !!wsRef.current,
        readyState: wsRef.current?.readyState,
      });
      setStatus("WebSocket not connected");
      return;
    }

    try {
      console.log(
        `📤 Sending audio chunk: ${blob.size} bytes, isFinal: ${isFinal}`,
      );

      // Convert blob to base64 using FileReader (more reliable for large files)
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const base64Data = result.split(',')[1];
          console.log(`✅ Base64 encoded: ${base64Data.length} chars`);
          resolve(base64Data);
        };
        reader.onerror = (error) => {
          console.error(`❌ FileReader error:`, error);
          reject(error);
        };
        reader.readAsDataURL(blob);
      });

      const message = {
        type: "audio-chunk",
        roomId,
        accessToken,
        audio: base64,
        isFinal,
      };

      console.log("📍 WebSocket state before send:", {
        readyState: wsRef.current.readyState,
        open: wsRef.current.readyState === WebSocket.OPEN,
      });
      
      wsRef.current.send(JSON.stringify(message));
      console.log(`✅ Audio message sent to WebSocket`);
      setStatus(`Sent ${blob.size} bytes`);
    } catch (error) {
      console.error("❌ Error sending audio chunk:", error);
      setStatus("Error sending audio");
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
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
