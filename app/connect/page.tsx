"use client";
import { useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

type PendingDevice = { deviceId: string };

function RoomMonitorContent() {
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
      const formData = new FormData();
      formData.append("companyType", "LIMITED");
      formData.append("meetingType", "BOD");
      formData.append("location", "Test Room");

      const response = await fetch("/api/room", {
        method: "POST",
        body: formData,
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
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const url = `${protocol}//${host}/ws?type=browser&roomId=${roomId}&accessToken=${accessToken}`;
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
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;

    // เปิด WS connection พิเศษเพื่อส่ง config
    const configWs = new WebSocket(
      `${protocol}//${host}/ws?type=browser&roomId=${roomId}&accessToken=${accessToken}&targetDeviceId=${deviceId}`,
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
      <div className="flex items-center justify-center min-h-[70vh] p-4 md:p-8">
        <div className="max-w-xl w-full bg-white border border-gray-200 shadow-xl rounded-3xl p-8 md:p-12">
          <div className="flex flex-col items-center gap-4 mb-8">
            <div className="bg-indigo-50 p-4 rounded-full">
              <span className="text-4xl block">🎙️</span>
            </div>
            <h2 className="text-3xl font-bold text-gray-900 text-center">
              ทดสอบอัดเสียง
            </h2>
          </div>

          <p className="text-gray-600 mb-10 text-center text-lg px-4">
            คุณสามารถสร้าง room ทดสอบสำหรับอัดเสียงด้วย ESP32 ได้ทันที
          </p>

          <button
            onClick={createTestRoom}
            disabled={isCreatingRoom}
            className={`w-full px-8 py-4 ${
              isCreatingRoom
                ? "bg-gray-100 text-gray-500 cursor-not-allowed"
                : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-md hover:shadow-lg"
            } font-semibold rounded-2xl transition-all flex items-center justify-center gap-3 text-lg`}
          >
            {isCreatingRoom ? (
              <>
                <span className="animate-spin text-xl">⏳</span>
                <span>กำลังสร้าง Room...</span>
              </>
            ) : (
              <>
                <span className="text-xl">🚀</span>
                <span>สร้าง Room สำหรับทดสอบ</span>
              </>
            )}
          </button>

          <div className="mt-10 p-6 bg-blue-50/50 border border-blue-100 rounded-2xl">
            <p className="text-blue-800 font-medium mb-3 flex items-center gap-2">
              <span className="text-lg">💡</span> หรือใช้ URL พร้อม parameters:
            </p>
            <code className="text-blue-600 text-sm break-all block bg-white p-4 rounded-xl border border-blue-100 shadow-sm font-mono">
              /connect?roomId=xxx&accessToken=xxx
            </code>
          </div>

          <Link
            href="/"
            className="block text-center mt-8 px-6 py-3 text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-xl transition-colors font-medium text-lg"
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
    <div className="p-6 md:p-10 max-w-6xl mx-auto min-h-screen">
      {/* Header Section */}
      <div className="bg-white rounded-3xl p-8 mb-8 shadow-sm border border-gray-200">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <p className="text-sm font-medium text-indigo-600 mb-2 uppercase tracking-wider">
              Connection Setup
            </p>
            <h1 className="text-3xl font-bold text-gray-900 mb-3 flex items-center gap-3">
              Room ID:
              <span className="text-indigo-600 bg-indigo-50 px-4 py-2 rounded-xl border border-indigo-100 font-mono text-2xl font-bold">
                {roomId}
              </span>
            </h1>
          </div>

          {/* Status Indicator */}
          <div className="flex items-center gap-4 bg-gray-50 px-6 py-4 rounded-2xl border border-gray-100">
            <div
              className={`h-3 w-3 rounded-full ${
                status === "connected"
                  ? "bg-green-500 shadow-[0_0_12px_rgba(34,197,94,0.6)] animate-pulse"
                  : "bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.6)]"
              }`}
            />
            <div className="flex flex-col">
              <span className="text-xs text-gray-500 font-medium uppercase">
                System Status
              </span>
              <span
                className={`font-semibold ${status === "connected" ? "text-green-600" : "text-red-600"}`}
              >
                {status === "connected"
                  ? "เชื่อมต่อกับระบบแล้ว"
                  : "ขาดการเชื่อมต่อ"}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Device Connection (1/3 width on large screens) */}
        <div className="lg:col-span-1 space-y-8">
          {/* ESP32 pending devices */}
          <div className="bg-white border border-gray-200 shadow-sm rounded-3xl p-6 transition-all hover:shadow-md h-full">
            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100">
              <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0"
                  ></path>
                </svg>
              </div>
              <h2 className="text-xl font-bold text-gray-900">ค้นหา ESP32</h2>
            </div>

            {pendingDevices.length === 0 ? (
              <div className="text-center py-12 bg-gray-50 rounded-2xl border border-gray-100 border-dashed">
                <div className="animate-pulse flex justify-center mb-3">
                  <svg
                    className="w-8 h-8 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    ></path>
                  </svg>
                </div>
                <p className="text-gray-500 font-medium">รอการเชื่อมต่อ...</p>
              </div>
            ) : (
              <div className="space-y-4">
                {pendingDevices.map((device) => (
                  <div
                    key={device.deviceId}
                    className="flex flex-col gap-4 bg-white border border-gray-200 shadow-sm rounded-2xl p-5 hover:border-indigo-300 transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl bg-gray-50 p-2 rounded-xl group-hover:bg-indigo-50 transition-colors">
                        🔌
                      </span>
                      <div className="flex flex-col">
                        <span className="text-xs text-gray-500 mb-1 font-medium">
                          Device ID
                        </span>
                        <span className="font-mono text-sm font-bold text-gray-800 bg-gray-100 px-2 py-1 rounded w-fit">
                          {device.deviceId}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => linkDevice(device.deviceId)}
                      className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-all shadow-sm hover:shadow-md"
                    >
                      เชื่อมต่ออุปกรณ์นี้
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Linked device success message */}
            {linkedDevice && (
              <div className="mt-6 bg-green-50 border border-green-200 rounded-2xl p-5 shadow-sm">
                <div className="flex items-center gap-3 mb-3">
                  <div className="bg-white p-2 rounded-full shadow-sm text-green-500">
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M5 13l4 4L19 7"
                      ></path>
                    </svg>
                  </div>
                  <p className="text-green-800 font-bold">
                    เทิร์นเปิดใช้งานเรียบร้อย
                  </p>
                </div>
                <div className="bg-white rounded-xl p-3 border border-green-100">
                  <p className="text-xs text-gray-500 mb-1">เชื่อมต่อกับ:</p>
                  <p className="font-mono text-sm font-bold text-green-700">
                    {linkedDevice}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Audio Recorders (2/3 width on large screens) */}
        <div className="lg:col-span-2 space-y-8">
          <div className="grid md:grid-cols-2 gap-8 h-full">
            {/* Audio Recording Section (Browser) */}
            <div className="bg-white border border-gray-200 shadow-sm rounded-3xl p-6 md:p-8 transition-all hover:shadow-md flex flex-col h-full">
              <div className="flex items-center gap-4 mb-6 pb-4 border-b border-gray-100">
                <div className="p-3 bg-red-50 text-red-500 rounded-xl">
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                    ></path>
                  </svg>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">
                    Browser Mic
                  </h2>
                  <p className="text-sm text-gray-500">
                    บันทึกเสียงผ่านคอมพิวเตอร์
                  </p>
                </div>
              </div>

              <div className="flex-1 flex flex-col justify-center">
                {/* Recording Controls */}
                <div className="flex flex-col items-center gap-6">
                  {!isRecording ? (
                    <button
                      onClick={startRecording}
                      className="w-32 h-32 bg-red-50 hover:bg-red-100 border-4 border-red-100 hover:border-red-200 text-red-500 rounded-full transition-all flex flex-col items-center justify-center gap-2 group"
                    >
                      <div className="w-8 h-8 bg-red-500 rounded-full group-hover:scale-110 transition-transform shadow-md"></div>
                      <span className="font-bold text-sm">เริ่มอัด</span>
                    </button>
                  ) : (
                    <div className="flex flex-col items-center gap-6 w-full">
                      <div className="bg-red-50 border border-red-100 rounded-2xl p-6 w-full text-center">
                        <div className="flex justify-center items-center gap-3 mb-2">
                          <div className="h-3 w-3 bg-red-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
                          <span className="text-red-600 font-bold uppercase tracking-wider text-sm">
                            Recording
                          </span>
                        </div>
                        <span className="font-mono font-bold text-4xl text-gray-900 tracking-wider">
                          {formatTime(recordingTime)}
                        </span>
                      </div>

                      <button
                        onClick={stopRecording}
                        className="w-full py-4 bg-gray-900 hover:bg-black text-white font-bold rounded-2xl transition-all shadow-md flex items-center justify-center gap-3"
                      >
                        <div className="w-4 h-4 bg-red-500 rounded-sm"></div>
                        หยุดบันทึก
                      </button>
                    </div>
                  )}
                </div>

                {/* Audio Player */}
                {audioUrl && !isRecording && (
                  <div className="mt-8 p-5 bg-gray-50 border border-gray-200 rounded-2xl animate-fade-in">
                    <p className="text-gray-700 mb-4 flex items-center gap-2 font-bold text-sm">
                      <span className="bg-white p-1.5 rounded-lg shadow-sm">
                        🎵
                      </span>
                      ไฟล์เสียงที่บันทึก
                    </p>
                    <audio
                      ref={audioRef}
                      controls
                      src={audioUrl}
                      className="w-full h-12 mb-4"
                    />
                    <button
                      onClick={() => {
                        setAudioUrl(null);
                        setRecordingTime(0);
                        if (audioRef.current) {
                          URL.revokeObjectURL(audioUrl);
                        }
                      }}
                      className="w-full py-2.5 bg-white hover:bg-red-50 text-red-600 border border-red-200 hover:border-red-300 rounded-xl transition-colors text-sm font-bold shadow-sm"
                    >
                      ลบไฟล์ทิ้ง
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* ESP32 Audio Recording Section */}
            <div
              className={`bg-white border rounded-3xl p-6 md:p-8 transition-all flex flex-col h-full ${linkedDevice ? "border-gray-200 shadow-sm hover:shadow-md" : "border-gray-100 opacity-60 bg-gray-50"}`}
            >
              <div className="flex items-center gap-4 mb-6 pb-4 border-b border-gray-100">
                <div
                  className={`p-3 rounded-xl ${linkedDevice ? "bg-indigo-50 text-indigo-600" : "bg-gray-200 text-gray-400"}`}
                >
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
                    ></path>
                  </svg>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">ESP32 Mic</h2>
                  <p className="text-sm text-gray-500">
                    บันทึกเสียงผ่านอุปกรณ์
                  </p>
                </div>
              </div>

              {!linkedDevice ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                  <div className="bg-gray-200 p-4 rounded-full mb-4">
                    <svg
                      className="w-8 h-8 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                      ></path>
                    </svg>
                  </div>
                  <p className="text-gray-500 font-medium">
                    กรุณาเชื่อมต่อ ESP32 ก่อน
                  </p>
                </div>
              ) : (
                <div className="flex-1 flex flex-col justify-center">
                  {/* ESP32 Recording Controls */}
                  <div className="flex flex-col items-center gap-6">
                    {!esp32Recording ? (
                      <button
                        onClick={startEsp32Recording}
                        className="w-32 h-32 bg-indigo-50 hover:bg-indigo-100 border-4 border-indigo-100 hover:border-indigo-200 text-indigo-600 rounded-full transition-all flex flex-col items-center justify-center gap-2 group"
                      >
                        <div className="w-8 h-8 bg-indigo-600 rounded-full group-hover:scale-110 transition-transform shadow-md"></div>
                        <span className="font-bold text-sm">เริ่มอัด</span>
                      </button>
                    ) : (
                      <div className="flex flex-col items-center gap-6 w-full">
                        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-6 w-full text-center relative overflow-hidden">
                          <div className="absolute top-0 right-0 bg-indigo-600 text-white text-[10px] font-bold px-3 py-1 rounded-bl-lg">
                            {esp32ChunkCount} PKG
                          </div>
                          <div className="flex justify-center items-center gap-3 mb-2">
                            <div className="h-3 w-3 bg-indigo-600 rounded-full animate-pulse shadow-[0_0_8px_rgba(79,70,229,0.8)]" />
                            <span className="text-indigo-700 font-bold uppercase tracking-wider text-sm">
                              Receiving
                            </span>
                          </div>
                          <span className="font-mono font-bold text-4xl text-gray-900 tracking-wider">
                            {formatTime(esp32RecordingTime)}
                          </span>
                        </div>

                        <button
                          onClick={stopEsp32Recording}
                          className="w-full py-4 bg-gray-900 hover:bg-black text-white font-bold rounded-2xl transition-all shadow-md flex items-center justify-center gap-3"
                        >
                          <div className="w-4 h-4 bg-indigo-500 rounded-sm"></div>
                          หยุดบันทึก
                        </button>
                      </div>
                    )}
                  </div>

                  {/* ESP32 Audio Player */}
                  {esp32AudioUrl && !esp32Recording && (
                    <div className="mt-8 p-5 bg-indigo-50/50 border border-indigo-100 rounded-2xl animate-fade-in">
                      <p className="text-indigo-900 mb-4 flex items-center gap-2 font-bold text-sm">
                        <span className="bg-white p-1.5 rounded-lg shadow-sm text-indigo-500">
                          🎵
                        </span>
                        ไฟล์เสียงจากอุปกรณ์
                      </p>
                      <audio
                        controls
                        src={esp32AudioUrl}
                        className="w-full h-12 mb-4"
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
                        className="w-full py-2.5 bg-white hover:bg-red-50 text-red-600 border border-red-200 hover:border-red-300 rounded-xl transition-colors text-sm font-bold shadow-sm"
                      >
                        ลบไฟล์ทิ้ง
                      </button>
                    </div>
                  )}

                  {/* Info Note */}
                  <div className="mt-auto pt-6">
                    <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
                      <p className="text-gray-500 text-xs flex items-start gap-2">
                        <span className="text-indigo-400 mt-0.5">💡</span>
                        <span className="leading-relaxed">
                          ESP32 ต้องส่ง message ผ่าน WebSocket ในรูปแบบ:
                          <br />
                          <code className="mt-2 block bg-white border border-gray-200 text-gray-800 px-3 py-2 rounded-lg font-mono text-[10px] break-all">
                            &#123;$#34;type$#34;: $#34;esp32-audio-chunk$#34;,
                            $#34;audio$#34;: $#34;base64_data$#34;&#125;
                          </code>
                        </span>
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Loading component for Suspense fallback
function LoadingComponent() {
  return (
    <div className="min-h-[70vh] p-8 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin h-10 w-10 border-4 border-indigo-600 border-t-white rounded-full mx-auto mb-4 shadow-sm"></div>
        <p className="text-gray-600 font-medium">กำลังโหลด...</p>
      </div>
    </div>
  );
}

// Wrap with Suspense for useSearchParams
export default function RoomMonitor() {
  return (
    <Suspense fallback={<LoadingComponent />}>
      <RoomMonitorContent />
    </Suspense>
  );
}
