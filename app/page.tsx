"use client";

import { useEffect, useRef, useState } from "react";
//TODO: ทำหน้าทีถาม chat เพื่อให้ทีมกฏหมาย test & เอา response format prompt แยกออกมา chain ทีหลัง
type LegalRiskEvent = {
  roomId: string;
  type: "legal-risk";
  createdAt: string;
  issues?: Array<{
    riskLevel?: string;
    issueDescription?: string;
    urgencyLevel?: string;
  }>;
};

export default function Home() {
  const [roomIdInput, setRoomIdInput] = useState("");
  const [activeRoomId, setActiveRoomId] = useState("");
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  //TODO: แก้เรื่อง alert ไม่ขึ้น
  useEffect(() => {
    if (!activeRoomId) {
      return;
    }

    console.log(`🔌 Connecting to SSE: /rooms/${activeRoomId}/events`);
    console.log(`🌐 Current URL: ${window.location.origin}`);

    const es = new EventSource(`/rooms/${activeRoomId}/events`);
    eventSourceRef.current = es;

    const onConnected = (event: Event) => {
      console.log(`✅ SSE Connected event received:`, event);
      const messageEvent = event as MessageEvent<string>;
      console.log(`📝 Connected event data:`, messageEvent.data);
      console.log(`✅ SSE Connected to room: ${activeRoomId}`);
      setConnected(true);
    };

    const onLegalRisk = (event: Event) => {
      console.log(`🚨 Legal Risk Event Received:`, event);
      const messageEvent = event as MessageEvent<string>;
      const payload = JSON.parse(messageEvent.data) as LegalRiskEvent;
      console.log(`📊 Legal Risk Payload:`, payload);
      const firstIssue = payload.issues?.[0];
      const alertMessage = firstIssue
        ? `แจ้งเตือนความเสี่ยง: ${firstIssue.riskLevel ?? "ไม่ระบุ"}\n${firstIssue.issueDescription ?? ""}`
        : "พบความเสี่ยงทางกฎหมาย";

      // console.log(`🔔 Alert!`, alertMessage);
      alert(alertMessage);
    };

    const onError = (error: Event) => {
      console.error(`❌ SSE Error:`, error);
      console.error(`❌ SSE ReadyState:`, es.readyState);
      setConnected(false);
    };

    const onOpen = () => {
      console.log(`🎯 SSE onOpen triggered - ReadyState: ${es.readyState}`);
      console.log(`🎯 SSE URL: ${es.url}`);
    };

    es.addEventListener("connected", onConnected);
    es.addEventListener("legal-risk", onLegalRisk);
    es.addEventListener("open", onOpen);

    // Fallback - handle all messages
    es.onmessage = (event) => {
      console.log(`📨 SSE raw message received:`, event);
      console.log(`📨 Event type: ${event.type}, data: ${event.data}`);

      // Try to parse as connected event
      try {
        const data = JSON.parse(event.data);
        if (data.roomId === activeRoomId) {
          console.log(
            `✅ Manual connected detection for room: ${activeRoomId}`,
          );
          setConnected(true);
        }
      } catch (e) {
        console.log(`🔍 Non-JSON message: ${event.data}`);
      }
    };

    es.onopen = () => {
      console.log(`🔗 SSE onopen handler - connection established`);
    };

    es.onerror = onError;

    console.log(`⏱️ SSE ReadyState after creation:`, es.readyState);

    return () => {
      console.log(`🔌 Cleaning up SSE connection for room: ${activeRoomId}`);
      es.removeEventListener("connected", onConnected);
      es.removeEventListener("legal-risk", onLegalRisk);
      es.removeEventListener("open", onOpen);
      es.close();
      eventSourceRef.current = null;
      setConnected(false);
    };
  }, [activeRoomId]);

  const connect = () => {
    const nextRoomId = roomIdInput.trim();
    if (!nextRoomId) {
      return;
    }

    setActiveRoomId(nextRoomId);
  };

  const disconnect = () => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setConnected(false);
    setActiveRoomId("");
  };

  const testSSE = async () => {
    if (!activeRoomId) {
      alert("กรุณา Connect ก่อน");
      return;
    }

    try {
      console.log(`🧪 Sending test SSE to room: ${activeRoomId}`);
      const response = await fetch("/api/test/sse", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          roomId: activeRoomId,
          message: "🧪 Test Alert - ทดสอบระบบแจ้งเตือน",
        }),
      });

      const result = await response.json();
      console.log(`✅ Test SSE response:`, result);

      if (!response.ok) {
        alert(`Error: ${result.error}`);
      }
    } catch (error) {
      console.error(`❌ Test SSE failed:`, error);
      alert(`Test failed: ${error}`);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex min-h-screen w-full max-w-3xl flex-col gap-4 px-16 py-32 bg-white dark:bg-black">
        <h1 className="text-2xl font-semibold">SSE Legal Risk Alert</h1>

        <input
          value={roomIdInput}
          onChange={(event) => setRoomIdInput(event.target.value)}
          placeholder="ใส่ roomId"
          className="w-full rounded border border-zinc-300 px-3 py-2 text-black dark:text-white"
        />

        <div className="flex gap-2">
          <button
            onClick={connect}
            className="rounded bg-black px-4 py-2 text-white dark:bg-white dark:text-black"
          >
            Connect
          </button>
          <button
            onClick={disconnect}
            className="rounded border border-zinc-300 px-4 py-2"
          >
            Disconnect
          </button>
          <button
            onClick={testSSE}
            disabled={!connected}
            className="rounded bg-green-600 px-4 py-2 text-white disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            🧪 Test Alert
          </button>
        </div>

        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Status: {connected ? "connected" : "disconnected"}
          {activeRoomId ? ` (room: ${activeRoomId})` : ""}
        </p>

        {activeRoomId && (
          <div className="text-xs text-gray-500 mt-2">
            <p>SSE URL: /rooms/{activeRoomId}/events</p>
            <p>Connection State: {eventSourceRef.current?.readyState}</p>
          </div>
        )}
      </main>
    </div>
  );
}
