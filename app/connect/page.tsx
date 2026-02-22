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
    <div>
      <h2>Room: {roomId}</h2>
      <p>Status: {status}</p>

      {/* ESP32 ที่รอการเชื่อมต่อ */}
      <div>
        <h3>ESP32 ที่รอการเชื่อมต่อ</h3>
        {pendingDevices.length === 0 ? (
          <p>ไม่มี ESP32 ที่รอ...</p>
        ) : (
          pendingDevices.map((device) => (
            <div key={device.deviceId}>
              <span>📡 {device.deviceId}</span>
              <button onClick={() => linkDevice(device.deviceId)}>
                เชื่อมต่อ
              </button>
            </div>
          ))
        )}
      </div>

      {linkedDevice && <p>✅ เชื่อม ESP32: {linkedDevice} แล้ว</p>}
    </div>
  );
}
