"use client";
import { useEffect, useRef, useState } from "react";

type PendingDevice = { deviceId: string };

export default function RoomMonitor({
  roomId,
  accessToken,
}: {
  roomId: string;
  accessToken: string;
}) {
  const ws = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState("disconnected");
  const [pendingDevices, setPendingDevices] = useState<PendingDevice[]>([]);
  const [linkedDevice, setLinkedDevice] = useState<string | null>(null);

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
      if (data.type === "connected") setStatus("connected");
      // ... handle message อื่นๆ เหมือนเดิม
    };

    return () => ws.current?.close();
  }, [roomId, accessToken]);

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
          <div className="bg-green-500/10 border border-green-500/30 backdrop-blur rounded-lg p-4 flex items-center gap-3">
            <span className="text-2xl">✅</span>
            <div>
              <p className="text-green-300 font-semibold">เชื่อมต่อสำเร็จ</p>
              <p className="text-green-200 text-sm">
                ESP32: <span className="font-mono">{linkedDevice}</span>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
