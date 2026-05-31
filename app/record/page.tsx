"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

async function playFileAsMic(file: File): Promise<{
  stream: MediaStream;
  stop: () => void;
}> {
  const audioCtx = new AudioContext({ sampleRate: 16000 });
  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

  const destination = audioCtx.createMediaStreamDestination();
  const source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(destination);
  source.start();

  return {
    stream: destination.stream,
    stop: () => {
      source.stop();
      audioCtx.close();
    },
  };
}

// ---------------------------------------------------------------------------
// EnrollmentPanel
// ---------------------------------------------------------------------------

function EnrollmentPanel() {
  const [name, setName] = useState("");
  const [enrollFile, setEnrollFile] = useState<File | null>(null);
  const [speakers, setSpeakers] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchSpeakers = useCallback(async () => {
    try {
      const res = await fetch("/api/enroll");
      const data = (await res.json()) as { speakers: string[] };
      setSpeakers(data.speakers ?? []);
    } catch {
      setSpeakers([]);
    }
  }, []);

  useEffect(() => {
    fetchSpeakers();
  }, [fetchSpeakers]);

  const handleEnroll = async () => {
    if (!name.trim() || !enrollFile) {
      setStatus("ต้องใส่ชื่อและไฟล์เสียง");
      return;
    }
    setLoading(true);
    setStatus("กำลัง enroll...");
    try {
      const form = new FormData();
      form.append("name", name.trim());
      form.append("audio", enrollFile, enrollFile.name);
      const res = await fetch("/api/enroll", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Enroll failed");
      setStatus(`✅ Enrolled: ${name}`);
      setName("");
      setEnrollFile(null);
      await fetchSpeakers();
    } catch (e) {
      setStatus(`❌ ${e instanceof Error ? e.message : "Error"}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (speaker: string) => {
    try {
      const res = await fetch(`/api/enroll?name=${encodeURIComponent(speaker)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      await fetchSpeakers();
    } catch (e) {
      setStatus(`❌ ${e instanceof Error ? e.message : "Error"}`);
    }
  };

  return (
    <div className="rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-sm space-y-4">
      <h2 className="text-lg font-semibold">Speaker Enrollment</h2>

      <div className="space-y-3">
        <Input
          placeholder="ชื่อผู้พูด เช่น สมชาย"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-xl"
        />
        <div className="space-y-1">
          <p className="text-xs text-slate-500">
            อัปโหลดเสียง 30+ วินาที (webm / mp3 / wav)
          </p>
          <input
            type="file"
            accept="audio/*"
            className="text-sm"
            onChange={(e) => setEnrollFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <Button
          onClick={handleEnroll}
          disabled={loading || !name.trim() || !enrollFile}
          className="w-full rounded-xl bg-amber-500 text-slate-900 hover:bg-amber-400"
        >
          {loading ? "Enrolling..." : "Enroll Speaker"}
        </Button>
        {status && <p className="text-sm text-slate-600">{status}</p>}
      </div>

      {speakers.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">Enrolled speakers</p>
          {speakers.map((s) => (
            <div
              key={s}
              className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
            >
              <span className="text-sm">{s}</span>
              <Button
                variant="ghost"
                size="sm"
                className="text-red-500 hover:text-red-700"
                onClick={() => handleDelete(s)}
              >
                ลบ
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AudioRecorder
// ---------------------------------------------------------------------------

function AudioRecorder({
  roomId,
  accessToken,
}: {
  roomId: string;
  accessToken: string;
}) {
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const fileStopRef = useRef<(() => void) | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [legalRisks, setLegalRisks] = useState<any[]>([]);
  const [transcripts, setTranscripts] = useState<string[]>([]);
  const [testFile, setTestFile] = useState<File | null>(null);
  const allChunksRef = useRef<Blob[]>([]);
  const sentSizeRef = useRef<number>(0);

  const CHUNK_SIZE = 200 * 1024;

  const ensureWebSocketConnected = async (): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        resolve(wsRef.current);
        return;
      }
      const timeout = setTimeout(() => {
        reject(new Error("WebSocket connection timeout after 15 seconds"));
      }, 15000);
      const checkConnection = () => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          clearTimeout(timeout);
          resolve(wsRef.current!);
        } else if (
          wsRef.current?.readyState === WebSocket.CLOSED ||
          wsRef.current?.readyState === WebSocket.CLOSING
        ) {
          clearTimeout(timeout);
          reject(new Error("WebSocket is closed or closing"));
        } else {
          setTimeout(checkConnection, 200);
        }
      };
      checkConnection();
    });
  };

  useEffect(() => {
    if (!roomId || !accessToken) return;
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) return;

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const wsUrl = `${protocol}://${window.location.host}/ws?roomId=${roomId}&accessToken=${accessToken}`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      return;
    }

    ws.onopen = () => setStatus("Connected");
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "connected") setStatus("Connected");
        else if (data.type === "queue-status") setStatus(`📋 ${data.message}`);
        else if (data.type === "transcribing") setStatus(data.message ?? "🎤 Transcribing...");
        else if (data.type === "transcribed") {
          setStatus(`✅ ${data.text}`);
          setTranscripts((prev) => [...prev, data.text]);
        } else if (data.type === "analyzing") setStatus("🔍 Checking legal risks...");
        else if (data.type === "deep-analyzing") setStatus("🧠 Deep legal analysis...");
        else if (data.type === "buffer-status") setStatus(`📊 Buffer: ${data.bufferLength}/${data.totalNeeded}`);
        else if (data.type === "cooldown-active") setStatus("⏱️ Cooldown active...");
        else if (data.type === "legal-risk") {
          setStatus("🚨 Legal Risks Found!");
          setLegalRisks(data.issues ?? []);
        } else if (data.type === "analysis-complete") {
          setStatus((data.hasRisks ? "⚠️ " : "✅ ") + data.message);
        } else if (data.type === "error") {
          setStatus(`❌ ${data.message}`);
        }
      } catch {}
    };
    ws.onerror = () => setStatus("❌ WebSocket error");
    ws.onclose = () => {
      setStatus("⚠️ WebSocket disconnected");
      setTimeout(() => {
        const protocol = window.location.protocol === "https:" ? "wss" : "ws";
        const newWs = new WebSocket(
          `${protocol}://${window.location.host}/ws?roomId=${roomId}&accessToken=${accessToken}`,
        );
        wsRef.current = newWs;
        newWs.onopen = () => setStatus("Connected");
        newWs.onerror = () => setStatus("❌ WebSocket error");
        newWs.onclose = () => setStatus("❌ WebSocket disconnected");
      }, 2000);
    };

    wsRef.current = ws;
    return () => {
      if (ws.readyState === WebSocket.OPEN) ws.close(1000, "Component unmounting");
    };
  }, [roomId, accessToken]);

  const transcribeAudioChunk = async (blob: Blob) => {
    try {
      const ws = await ensureWebSocketConnected();
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      ws.send(JSON.stringify({
        type: "audio-chunk",
        roomId,
        accessToken,
        audio: base64,
        mimeType: blob.type,
        isFinal: false,
      }));
      setStatus("📡 Audio sent, waiting...");
    } catch (e) {
      setStatus(`❌ ${e instanceof Error ? e.message : "Error"}`);
    }
  };

  const startRecording = async () => {
    try {
      allChunksRef.current = [];
      sentSizeRef.current = 0;

      let stream: MediaStream;

      if (testFile) {
        // Simulate mic with uploaded file
        setStatus("▶️ Playing file as mic...");
        const result = await playFileAsMic(testFile);
        stream = result.stream;
        fileStopRef.current = result.stop;
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        fileStopRef.current = null;
      }

      const mimeType = "audio/webm;codecs=opus";
      const mediaRecorder = MediaRecorder.isTypeSupported(mimeType)
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size === 0) return;
        allChunksRef.current.push(event.data);
        const totalSize = allChunksRef.current.reduce((s, c) => s + c.size, 0);
        const newDataSize = totalSize - sentSizeRef.current;
        if (newDataSize >= CHUNK_SIZE) {
          const audioBlob = new Blob(allChunksRef.current, { type: mediaRecorder.mimeType });
          if (audioBlob.size >= 30 * 1024) {
            await transcribeAudioChunk(audioBlob);
            sentSizeRef.current = totalSize;
          }
        }
      };

      mediaRecorder.onstop = async () => {
        const totalSize = allChunksRef.current.reduce((s, c) => s + c.size, 0);
        const remainingSize = totalSize - sentSizeRef.current;
        if (remainingSize >= 30 * 1024) {
          const audioBlob = new Blob(allChunksRef.current, {
            type: mediaRecorderRef.current?.mimeType ?? "",
          });
          await transcribeAudioChunk(audioBlob);
        }
        allChunksRef.current = [];
        sentSizeRef.current = 0;
        fileStopRef.current?.();
        fileStopRef.current = null;
      };

      mediaRecorder.start(250);
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      setStatus(testFile ? "▶️ Playing file..." : "🔴 Recording...");
      setLegalRisks([]);
      setTranscripts([]);
    } catch (e) {
      setStatus(`❌ ${e instanceof Error ? e.message : "Error"}`);
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    setIsRecording(false);
    setStatus("Stopped");
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-4 items-center">
        <p className="text-lg font-semibold">Status: {status}</p>
      </div>

      {/* Test audio file upload */}
      <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 space-y-2">
        <p className="text-sm font-medium text-blue-700">
          🎵 Test with audio file (optional)
        </p>
        <p className="text-xs text-blue-500">
          อัปโหลดไฟล์เสียงเพื่อจำลองเป็นไมค์ — ถ้าไม่อัปโหลดจะใช้ไมค์จริง
        </p>
        <input
          type="file"
          accept="audio/*"
          className="text-sm"
          onChange={(e) => setTestFile(e.target.files?.[0] ?? null)}
        />
        {testFile && (
          <p className="text-xs text-blue-600">
            ✅ ไฟล์: {testFile.name} ({(testFile.size / 1024).toFixed(0)} KB)
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <Button
          onClick={startRecording}
          disabled={isRecording}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50 hover:bg-blue-600"
        >
          {testFile ? "▶️ Play File" : "Start Recording"}
        </Button>
        <Button
          onClick={stopRecording}
          disabled={!isRecording}
          className="px-4 py-2 bg-red-500 text-white rounded disabled:opacity-50 hover:bg-red-600"
        >
          Stop
        </Button>
      </div>

      {transcripts.length > 0 && (
        <div className="bg-blue-50 border border-blue-300 rounded p-4">
          <h3 className="font-bold text-blue-700 mb-3">
            📝 Transcription ({transcripts.length} chunks)
          </h3>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {transcripts.map((text, idx) => (
              <div key={idx} className="bg-white p-3 rounded border border-blue-200">
                <span className="text-xs text-blue-500 font-semibold">Chunk {idx + 1}:</span>
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
              <div key={idx} className="bg-white p-3 rounded border border-red-200">
                <p className="font-semibold text-red-600">Risk Level: {issue.riskLevel}</p>
                <p className="mt-1"><strong>Issue:</strong> {issue.issueDescription}</p>
                <p className="mt-1">
                  <strong>Legal Basis:</strong> {issue.legalBasis?.type} - {issue.legalBasis?.reference}
                </p>
                <p className="mt-1"><strong>Reasoning:</strong> {issue.legalReasoning}</p>
                <p className="mt-1"><strong>Recommendation:</strong> {issue.recommendation}</p>
                <p className="mt-1 text-amber-600"><strong>Urgency:</strong> {issue.urgencyLevel}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RecordPage
// ---------------------------------------------------------------------------

export default function RecordPage() {
  const [roomId, setRoomId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [formData, setFormData] = useState<{
    companyType: "บริษัทจำกัด" | "บริษัทมหาชนจำกัด";
  }>({ companyType: "บริษัทจำกัด" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitResult, setSubmitResult] = useState<Record<string, unknown> | null>(null);

  const handleConnect = () => {
    if (roomId.trim() && accessToken.trim()) setIsConnected(true);
  };

  const handleDisconnect = () => {
    setIsConnected(false);
    setRoomId("");
    setAccessToken("");
  };

  const handleSubmit = async (event: React.FormEvent) => {
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
        setSubmitError(typeof data.error === "string" ? data.error : "Failed to create room");
        setSubmitResult(data);
        return;
      }
      setSubmitResult(data);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Unexpected error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-6xl space-y-6">

        {/* Row 1: Create Room + Enrollment */}
        <div className="grid gap-6 lg:grid-cols-2">

          {/* Create Room */}
          <section className="rounded-3xl border border-amber-100 bg-white/90 p-6 shadow-[0_18px_45px_-30px_rgba(15,23,42,0.6)] backdrop-blur">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.2em] text-amber-600">Create Room</p>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">Step 01</span>
            </div>
            <h1 className="mt-4 text-2xl font-semibold">เลือกประเภทบริษัทก่อนเริ่มประชุม</h1>
            <p className="mt-2 text-sm text-slate-600">
              ระบบจะสร้างห้องพร้อมโครงสร้างการวิเคราะห์ให้เหมาะกับประเภทบริษัทของคุณ
            </p>
            <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Company type</label>
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
                      <SelectItem value="บริษัทมหาชนจำกัด">บริษัทมหาชนจำกัด</SelectItem>
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
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{submitError}</p>
              )}
              {submitResult && (
                <pre className="rounded-xl bg-slate-900/90 p-3 text-xs text-slate-100 overflow-x-auto">
                  {JSON.stringify(submitResult, null, 2)}
                </pre>
              )}
            </form>
          </section>

          {/* Enrollment */}
          <EnrollmentPanel />
        </div>

        {/* Row 2: Recording */}
        <section className="rounded-3xl border border-slate-200 bg-white/95 p-8 shadow-[0_22px_60px_-40px_rgba(15,23,42,0.6)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-3xl font-semibold" style={{ fontFamily: '"Fraunces", serif' }}>
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
              <div className="grid gap-5 max-w-md">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Room ID</label>
                  <Input
                    placeholder="Enter room ID"
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value)}
                    className="rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Access Token</label>
                  <Input
                    type="password"
                    placeholder="Enter access token"
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    className="rounded-xl"
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
                    <strong className="text-slate-700">Room ID:</strong> {roomId}
                  </p>
                  <p className="text-sm text-slate-600 mt-2">
                    <strong className="text-slate-700">Access Token:</strong> {accessToken.substring(0, 10)}...
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
