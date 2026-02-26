"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

type PendingDevice = { deviceId: string };

export default function RoomMonitor() {
  const searchParams = useSearchParams();
  const roomId = searchParams.get("roomId") || "";
  const accessToken = searchParams.get("accessToken") || "";
  const ws = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const esp32AudioChunksRef = useRef<string[]>([]); // Store base64 chunks from ESP32

  const [status, setStatus] = useState("disconnected");
  const [pendingDevices, setPendingDevices] = useState<PendingDevice[]>([]);
  const [linkedDevice, setLinkedDevice] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [esp32Recording, setEsp32Recording] = useState(false);
  const [esp32AudioUrl, setEsp32AudioUrl] = useState<string | null>(null);
  const [esp32RecordingTime, setEsp32RecordingTime] = useState(0);
  const [esp32ChunkCount, setEsp32ChunkCount] = useState(0);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);

  // Create test room automatically
  const createTestRoom = async () => {
    setIsCreatingRoom(true);
    try {
      const response = await fetch("/api/room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyType: "LIMITED" }),
      });

      if (!response.ok) {
        throw new Error("Failed to create room");
      }

      const data = await response.json();

      // Redirect to this page with the new room credentials
      window.location.href = `/connect?roomId=${data.roomId}&accessToken=${data.accessToken}`;
    } catch (error) {
      console.error("Error creating test room:", error);
      alert("ไม่สามารถสร้าง room ได้ กรุณาลองใหม่อีกครั้ง");
      setIsCreatingRoom(false);
    }
  };

  // Poll หา ESP32 ที่รออยู่
  useEffect(() => {
    const interval = setInterval(async () => {
      const res = await fetch("/api/esp32/pending");
      const data = await res.json();
      setPendingDevices(data.devices);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // Connect WebSocket (browser)
  useEffect(() => {
    const wsBaseUrl =
      process.env.NODE_ENV === "production"
        ? "wss://leganizebackend.onrender.com"
        : "ws://localhost:3000";

    const url = `${wsBaseUrl}/ws?type=browser&roomId=${roomId}&accessToken=${accessToken}`;
    ws.current = new WebSocket(url);

    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "connected") {
        setStatus("connected");
      } else if (data.type === "esp32-audio-chunk") {
        // รับ audio chunk จาก ESP32
        if (data.audio && esp32Recording) {
          esp32AudioChunksRef.current.push(data.audio);
          setEsp32ChunkCount(esp32AudioChunksRef.current.length);
          console.log(
            `📦 Received ESP32 audio chunk, total: ${esp32AudioChunksRef.current.length}`,
          );
        }
      }
    };

    return () => ws.current?.close();
  }, [roomId, accessToken, esp32Recording]);

  // Timer for recording
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    if (isRecording) {
      interval = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording]);

  // Timer for ESP32 recording
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    if (esp32Recording) {
      interval = setInterval(() => {
        setEsp32RecordingTime((prev) => prev + 1);
      }, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [esp32Recording]);

  // กดเชื่อม ESP32 → ส่ง config ไปให้
  const linkDevice = async (deviceId: string) => {
    const wsBaseUrl =
      process.env.NODE_ENV === "production"
        ? "wss://leganizebackend.onrender.com"
        : "ws://localhost:3000";

    // เปิด WS connection พิเศษเพื่อส่ง config
    const configWs = new WebSocket(
      `${wsBaseUrl}/ws?type=browser&roomId=${roomId}&accessToken=${accessToken}&targetDeviceId=${deviceId}`,
    );

    configWs.onopen = () => {
      setLinkedDevice(deviceId);
      setPendingDevices((prev) => prev.filter((d) => d.deviceId !== deviceId));
      configWs.close();
    };
  };

  // เริ่มอัดเสียง
  const startRecording = async () => {
    try {
      setRecordingTime(0);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, {
          type: "audio/webm",
        });
        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);

        // Stop all tracks
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error("Error starting recording:", error);
      alert("ไม่สามารถเข้าถึงไมโครโฟนได้");
    }
  };

  // หยุดอัดเสียง
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setRecordingTime(0);
    }
  };

  // Format time as MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Check if roomId and accessToken are provided
  if (!roomId || !accessToken) {
    return (
      <div className="min-h-screen bg-linear-to-br from-slate-900 via-slate-800 to-slate-900 p-8 flex items-center justify-center">
        <div className="max-w-md w-full bg-slate-800/50 border border-slate-700 backdrop-blur rounded-lg p-6">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-3xl">🎙️</span>
            <h2 className="text-2xl font-bold text-white">ทดสอบอัดเสียง</h2>
          </div>

          <p className="text-gray-300 mb-6">
            คุณสามารถสร้าง room ทดสอบสำหรับอัดเสียงด้วย ESP32 ได้ทันที
          </p>

          <button
            onClick={createTestRoom}
            disabled={isCreatingRoom}
            className={`w-full px-6 py-3 ${
              isCreatingRoom
                ? "bg-gray-600 cursor-not-allowed"
                : "bg-linear-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600"
            } text-white font-medium rounded-lg transition transform hover:scale-105 active:scale-95 disabled:transform-none flex items-center justify-center gap-2`}
          >
            {isCreatingRoom ? (
              <>
                <span className="animate-spin">⏳</span>
                <span>กำลังสร้าง Room...</span>
              </>
            ) : (
              <>
                <span>🚀</span>
                <span>สร้าง Room สำหรับทดสอบ</span>
              </>
            )}
          </button>

          <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <p className="text-blue-300 text-sm mb-2">
              💡 หรือใช้ URL พร้อม parameters:
            </p>
            <code className="text-cyan-300 text-xs break-all block">
              /connect?roomId=xxx&accessToken=xxx
            </code>
          </div>

          <Link
            href="/"
            className="block text-center mt-4 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-gray-300 rounded-lg transition"
          >
            กลับหน้าหลัก
          </Link>
        </div>
      </div>
    );
  }

  // เริ่มอัดเสียงจาก ESP32
  const startEsp32Recording = () => {
    if (!linkedDevice) {
      alert("กรุณาเชื่อมต่อ ESP32 ก่อน");
      return;
    }

    esp32AudioChunksRef.current = [];
    setEsp32RecordingTime(0);
    setEsp32ChunkCount(0);
    setEsp32Recording(true);

    // ส่งคำสั่งไปที่ ESP32 ผ่าน WebSocket
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(
        JSON.stringify({
          type: "start-recording",
          targetDeviceId: linkedDevice,
        }),
      );
      console.log("🎙️ Sent start recording command to ESP32");
    }
  };

  // หยุดอัดเสียงจาก ESP32
  const stopEsp32Recording = () => {
    setEsp32Recording(false);
    setEsp32RecordingTime(0);
    setEsp32ChunkCount(0);

    // ส่งคำสั่งหยุดไปที่ ESP32
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(
        JSON.stringify({
          type: "stop-recording",
          targetDeviceId: linkedDevice,
        }),
      );
      console.log("⏹️ Sent stop recording command to ESP32");
    }

    // แปลง base64 chunks เป็น audio blob
    if (esp32AudioChunksRef.current.length > 0) {
      try {
        // Concatenate all base64 strings
        const combinedBase64 = esp32AudioChunksRef.current.join("");

        // Convert base64 to binary
        const binaryString = atob(combinedBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        // Create audio blob
        const audioBlob = new Blob([bytes], { type: "audio/wav" });
        const url = URL.createObjectURL(audioBlob);
        setEsp32AudioUrl(url);

        console.log(
          `✅ Created audio from ${esp32AudioChunksRef.current.length} chunks`,
        );
      } catch (error) {
        console.error("❌ Error creating audio from ESP32 chunks:", error);
        alert("เกิดข้อผิดพลาดในการสร้างไฟล์เสียง");
      }
    }
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">
            Room:{" "}
            <span className="bg-linear-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
              {roomId}
            </span>
          </h1>

          {/* Status Indicator */}
          <div className="flex items-center gap-3 mt-4">
            <div
              className={`h-3 w-3 rounded-full ${
                status === "connected"
                  ? "bg-green-500 animate-pulse"
                  : "bg-red-500"
              }`}
            />
            <span className="text-gray-300">
              Status:{" "}
              <span
                className={`font-semibold ${
                  status === "connected" ? "text-green-400" : "text-red-400"
                }`}
              >
                {status === "connected" ? "เชื่อมต่อแล้ว" : "ยังไม่เชื่อมต่อ"}
              </span>
            </span>
          </div>
        </div>

        {/* ESP32 pending devices */}
        <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <span>📡</span> ESP32 ที่รอการเชื่อมต่อ
          </h2>

          {pendingDevices.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-400">ไม่มี ESP32 ที่รอการเชื่อมต่อ</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pendingDevices.map((device) => (
                <div
                  key={device.deviceId}
                  className="flex items-center justify-between bg-slate-700/50 border border-slate-600 rounded-lg p-4 hover:bg-slate-700 transition"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg">🔌</span>
                    <span className="font-mono text-sm text-cyan-300">
                      {device.deviceId}
                    </span>
                  </div>
                  <button
                    onClick={() => linkDevice(device.deviceId)}
                    className="px-4 py-2 bg-linear-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-medium rounded-lg transition transform hover:scale-105 active:scale-95"
                  >
                    เชื่อมต่อ
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Linked device success message */}
        {linkedDevice && (
          <div className="bg-green-500/10 border border-green-500/30 backdrop-blur rounded-lg p-4 flex items-center gap-3 mb-6">
            <span className="text-2xl">✅</span>
            <div>
              <p className="text-green-300 font-semibold">เชื่อมต่อสำเร็จ</p>
              <p className="text-green-200 text-sm">
                ESP32: <span className="font-mono">{linkedDevice}</span>
              </p>
            </div>
          </div>
        )}

        {/* Audio Recording Section */}
        <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <span>🎙️</span> ทดสอบอัดเสียง (Browser)
          </h2>

          <div className="space-y-4">
            {/* Recording Controls */}
            <div className="flex items-center gap-4">
              {!isRecording ? (
                <button
                  onClick={startRecording}
                  className="px-6 py-3 bg-linear-to-r from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600 text-white font-medium rounded-lg transition transform hover:scale-105 active:scale-95 flex items-center gap-2"
                >
                  <span className="text-xl">⏺️</span>
                  เริ่มอัดเสียง
                </button>
              ) : (
                <>
                  <button
                    onClick={stopRecording}
                    className="px-6 py-3 bg-linear-to-r from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 text-white font-medium rounded-lg transition transform hover:scale-105 active:scale-95 flex items-center gap-2"
                  >
                    <span className="text-xl">⏹️</span>
                    หยุดอัด
                  </button>
                  <div className="flex items-center gap-2 px-4 py-2 bg-red-500/20 border border-red-500/50 rounded-lg">
                    <div className="h-3 w-3 bg-red-500 rounded-full animate-pulse" />
                    <span className="text-red-300 font-mono font-semibold">
                      {formatTime(recordingTime)}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Audio Player */}
            {audioUrl && !isRecording && (
              <div className="mt-6 p-4 bg-slate-700/50 border border-slate-600 rounded-lg">
                <p className="text-gray-300 mb-3 flex items-center gap-2">
                  <span>🎵</span>
                  <span className="font-semibold">เสียงที่อัดไว้</span>
                </p>
                <audio
                  ref={audioRef}
                  controls
                  src={audioUrl}
                  className="w-full"
                  style={{
                    filter: "invert(0.9) hue-rotate(180deg)",
                    borderRadius: "8px",
                  }}
                />
                <button
                  onClick={() => {
                    setAudioUrl(null);
                    setRecordingTime(0);
                    if (audioRef.current) {
                      URL.revokeObjectURL(audioUrl);
                    }
                  }}
                  className="mt-3 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/50 rounded-lg transition text-sm"
                >
                  ลบการอัดเสียงนี้
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ESP32 Audio Recording Section */}
        {linkedDevice && (
          <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-lg p-6">
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <span>📡</span> ทดสอบอัดเสียงจาก ESP32
            </h2>

            <div className="space-y-4">
              {/* ESP32 Recording Controls */}
              <div className="flex items-center gap-4">
                {!esp32Recording ? (
                  <button
                    onClick={startEsp32Recording}
                    className="px-6 py-3 bg-linear-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-medium rounded-lg transition transform hover:scale-105 active:scale-95 flex items-center gap-2"
                  >
                    <span className="text-xl">⏺️</span>
                    เริ่มอัดจาก ESP32
                  </button>
                ) : (
                  <>
                    <button
                      onClick={stopEsp32Recording}
                      className="px-6 py-3 bg-linear-to-r from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 text-white font-medium rounded-lg transition transform hover:scale-105 active:scale-95 flex items-center gap-2"
                    >
                      <span className="text-xl">⏹️</span>
                      หยุดอัด
                    </button>
                    <div className="flex items-center gap-2 px-4 py-2 bg-blue-500/20 border border-blue-500/50 rounded-lg">
                      <div className="h-3 w-3 bg-blue-500 rounded-full animate-pulse" />
                      <span className="text-blue-300 font-mono font-semibold">
                        {formatTime(esp32RecordingTime)}
                      </span>
                      <span className="text-blue-300 text-sm ml-2">
                        ({esp32ChunkCount} chunks)
                      </span>
                    </div>
                  </>
                )}
              </div>

              {/* ESP32 Audio Player */}
              {esp32AudioUrl && !esp32Recording && (
                <div className="mt-6 p-4 bg-slate-700/50 border border-slate-600 rounded-lg">
                  <p className="text-gray-300 mb-3 flex items-center gap-2">
                    <span>🎵</span>
                    <span className="font-semibold">เสียงจาก ESP32</span>
                  </p>
                  <audio
                    controls
                    src={esp32AudioUrl}
                    className="w-full"
                    style={{
                      filter: "invert(0.9) hue-rotate(180deg)",
                      borderRadius: "8px",
                    }}
                  />
                  <button
                    onClick={() => {
                      setEsp32AudioUrl(null);
                      setEsp32RecordingTime(0);
                      setEsp32ChunkCount(0);
                      esp32AudioChunksRef.current = [];
                      if (esp32AudioUrl) {
                        URL.revokeObjectURL(esp32AudioUrl);
                      }
                    }}
                    className="mt-3 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/50 rounded-lg transition text-sm"
                  >
                    ลบการอัดเสียงนี้
                  </button>
                </div>
              )}

              {/* Info Note */}
              <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                <p className="text-blue-300 text-sm">
                  💡 ESP32 ต้องส่ง message รูปแบบ:{" "}
                  <code className="text-xs bg-slate-700 px-2 py-1 rounded">
                    {`{"type": "esp32-audio-chunk", "audio": "base64_data"}`}
                  </code>
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
