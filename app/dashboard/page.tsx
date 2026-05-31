"use client";

import AnalysisStatusBanner from "@/components/AnalysisStatusBanner";
import MeetingCard from "@/components/MeetingCard";
import MeetingDetails from "@/components/MeetingDetail";
import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";

export type AnalysisStatus =
  | { type: "idle" }
  | { type: "analyzing" }
  | { type: "deep-analyzing" }
  | { type: "no-risk" };

type Room = {
  id: string;
  meetingType: "AGM" | "EGM" | "BOD";
  meetingNo: string;
  calledBy: string;
  location: string;
  agendas: string[];
  startedAt: string;
  endedAt: string | null;
  status: "ACTIVE" | "ENDED" | "ABORTED";
  companyType: "LIMITED" | "PUBLIC_LIMITED";
  accessToken: string;
};

const MEETING_TYPE_LABELS: Record<string, string> = {
  AGM: "การประชุมสามัญผู้ถือหุ้น",
  EGM: "การประชุมวิสามัญผู้ถือหุ้น",
  BOD: "การประชุมคณะกรรมการบริษัท",
};

const COMPANY_TYPE_LABELS: Record<string, string> = {
  LIMITED: "บริษัทจำกัด",
  PUBLIC_LIMITED: "บริษัทมหาชนจำกัด",
};

function roomToCard(room: Room) {
  const start = new Date(room.startedAt);
  const end = room.endedAt ? new Date(room.endedAt) : null;
  const date = start.toLocaleDateString("th-TH", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const startTime = start.toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const endTime = end
    ? end.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })
    : "...";
  return {
    title: MEETING_TYPE_LABELS[room.meetingType] ?? room.meetingType,
    company: COMPANY_TYPE_LABELS[room.companyType] ?? room.companyType,
    type: MEETING_TYPE_LABELS[room.meetingType] ?? room.meetingType,
    no: room.meetingNo,
    date,
    time: `${startTime} น. - ${endTime} น.`,
    location: room.location,
    tags: ["green"],
    isLive: room.status === "ACTIVE",
    startedAt: room.startedAt,
  };
}

function roomToDetails(room: Room) {
  const start = new Date(room.startedAt);
  const end = room.endedAt ? new Date(room.endedAt) : null;
  const date = start.toLocaleDateString("th-TH", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const startTime = start.toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const endTime = end
    ? end.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })
    : "...";
  return {
    title: MEETING_TYPE_LABELS[room.meetingType] ?? room.meetingType,
    time: `${startTime} น. - ${endTime} น.`,
    date,
    agendas: room.agendas.map((agenda, i) => ({
      no: i + 1,
      title: agenda,
      description: "",
    })),
    resolution: undefined,
  };
}

// const liveMeeting = {
//   title: "พิจารณากำหนดค่าตอบแทน\nคณะกรรมการบริษัท",
//   company: "ABC จำกัด",
//   type: "การประชุมสามัญประจำปี",
//   no: "2/2569",
//   date: "25 มกราคม 2569",
//   time: "13:30 น. - 16:30 น.",
//   location: "ณ ห้องประชุมบอร์ดรูม",
//   tags: ["red", "yellow"],
//   isLive: true,
// };
// const meetingDetails = {
//   title: "พิจารณากำหนดค่าตอบแทนคณะกรรมการบริษัท",
//   time: "13:30 น. - 16:30 น.",
//   date: "25 มกราคม 2569",
//   agendas: [
//     { no: 1, title: "เรื่องที่ประธานแจ้งให้ทราบ", description: "", subItems: ["1.1 รายงานภาพรวมผลประกอบการไตรมาส 1/2569", "1.2 แนวโน้มธุรกิจและสถานการณ์เศรษฐกิจที่เกี่ยวข้อง"] },
//     { no: 2, title: "รับรองรายงานการประชุมครั้งที่ผ่านมา", description: "", subItems: ["2.1 รับรองรายงานการประชุมคณะกรรมการบริษัท ครั้งที่ 1/2569 ซึ่งประชุมเมื่อวันที่ 20 มกราคม 2569"] },
//     { no: 3, title: "เรื่องเพื่อพิจารณา", description: "", subItems: ["3.1 พิจารณากำหนดอัตราค่าตอบแทนกรรมการ", "รายละเอียดตามเอกสารแนบ"] },
//   ],
//   resolution: "ฝ่ายเลขานุบริษัทเสนอให้ที่ประชุมพิจารณาอนุมัติอัตราค่าตอบแทนคณะกรรมการบริษัท ประจำปี 2569...",
// };

export default function DashboardPage() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const [isEndingMeeting, setIsEndingMeeting] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [transcriptChunks, setTranscriptChunks] = useState<
    { id: string; content: string; createdAt: string }[]
  >([]);
  const [isLoadingTranscript] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>({
    type: "idle",
  });

  // ESP32 auto-recording state
  const esp32DeviceIdRef = useRef<string | null>(null);
  const [isEsp32Recording, setIsEsp32Recording] = useState(false);
  const [linkedDeviceId, setLinkedDeviceId] = useState<string | null>(null);
  const [pendingDevices, setPendingDevices] = useState<{ deviceId: string }[]>(
    [],
  );
  const [connectedDevices, setConnectedDevices] = useState<
    { deviceId: string; roomId: string }[]
  >([]);

  // Audio recording refs
  const audioContextRef = useRef<AudioContext | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const processorRef = useRef<any>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const isStoppingRef = useRef(false);
  const [isRecording, setIsRecording] = useState(false);
  const [partialTranscript, setPartialTranscript] = useState("");
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  const stopRecording = useCallback(() => {
    if (isStoppingRef.current) return;
    isStoppingRef.current = true;
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "stop-stream" }));
    }
    setIsRecording(false);
    isStoppingRef.current = false;
  }, []);

  const startRecording = useCallback(async () => {
    if (isStoppingRef.current) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      ws.send(JSON.stringify({ type: "start-stream" }));
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        const currentWs = wsRef.current;
        if (!currentWs || currentWs.readyState !== WebSocket.OPEN) return;
        const float32 = e.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          int16[i] = Math.max(
            -32768,
            Math.min(32767, Math.round(float32[i] * 32767)),
          );
        }
        const bytes = new Uint8Array(int16.buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++)
          binary += String.fromCharCode(bytes[i]);
        currentWs.send(
          JSON.stringify({ type: "audio-data", audio: btoa(binary) }),
        );
      };
      source.connect(processor);
      processor.connect(audioContext.destination);
      setIsRecording(true);
    } catch {
      console.error("❌ Microphone access denied");
    }
  }, []);

  // Auto-scroll transcript to bottom when new chunks or partial text arrive
  useEffect(() => {
    if (showTranscript) {
      transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [transcriptChunks, partialTranscript, showTranscript]);

  const handleShowTranscript = () => {
    setShowTranscript(true);
  };

  const handleEndMeeting = async (room: Room) => {
    if (
      !confirm(
        `ยืนยันการปิดการประชุม "${MEETING_TYPE_LABELS[room.meetingType] ?? room.meetingType}"?`,
      )
    )
      return;
    setIsEndingMeeting(true);
    try {
      // ส่ง stop-recording ให้ ESP32 ก่อนปิดห้อง
      const ws = wsRef.current;
      if (esp32DeviceIdRef.current && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "stop-recording",
            targetDeviceId: esp32DeviceIdRef.current,
          }),
        );
      }
      esp32DeviceIdRef.current = null;
      setIsEsp32Recording(false);
      setLinkedDeviceId(null);
      // ลบ ESP32 config ออกจาก localStorage
      try {
        localStorage.removeItem(`esp32:${room.id}`);
      } catch {}

      const res = await fetch(`/api/room/${room.id}/end`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to end room");
      setRooms((prev) => prev.filter((r) => r.id !== room.id));
      setSelectedIndex(0);
    } catch (err) {
      console.error(err);
      alert("ไม่สามารถปิดการประชุมได้ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsEndingMeeting(false);
    }
  };

  const selectedRoom = rooms[selectedIndex] ?? null;

  // เชื่อม ESP32 จากหน้า dashboard โดยตรง
  const linkDevice = useCallback(
    (deviceId: string) => {
      if (!selectedRoom) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const configWs = new WebSocket(
        `${proto}//${window.location.host}/ws?type=browser&roomId=${selectedRoom.id}&accessToken=${selectedRoom.accessToken}&targetDeviceId=${deviceId}`,
      );
      configWs.onopen = () => {
        setPendingDevices((prev) =>
          prev.filter((d) => d.deviceId !== deviceId),
        );
        setConnectedDevices((prev) =>
          prev.filter((d) => d.deviceId !== deviceId),
        );
        try {
          // Clear esp32 binding for ALL other rooms so only this room auto-starts
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (
              key &&
              key.startsWith("esp32:") &&
              key !== `esp32:${selectedRoom.id}`
            ) {
              const val = localStorage.getItem(key);
              if (val) {
                try {
                  const parsed = JSON.parse(val) as { deviceId: string };
                  if (parsed.deviceId === deviceId)
                    localStorage.removeItem(key);
                } catch {}
              }
            }
          }
          localStorage.setItem(
            `esp32:${selectedRoom.id}`,
            JSON.stringify({ deviceId }),
          );
        } catch {}
        // Update UI immediately — device is now configured
        esp32DeviceIdRef.current = deviceId;
        setLinkedDeviceId(deviceId);
        setIsEsp32Recording(false); // waiting for ESP32 to reconnect
        configWs.close();

        // Try to send start-recording once ESP32 has time to reconnect; retry a few times
        const tryStart = (attemptsLeft: number) => {
          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "start-recording",
                targetDeviceId: deviceId,
              }),
            );
            setIsEsp32Recording(true);
            console.log(`🎙️ Sent start-recording to ESP32: ${deviceId}`);
          } else if (attemptsLeft > 0) {
            setTimeout(() => tryStart(attemptsLeft - 1), 1000);
          }
        };
        setTimeout(() => tryStart(4), 1500);
      };
      configWs.onerror = () => {
        console.error(`❌ Failed to link ESP32: ${deviceId}`);
      };
    },
    [selectedRoom],
  );

  useEffect(() => {
    fetch("/api/room?limit=5&status=ACTIVE")
      .then((res) => res.json())
      .then((data) => setRooms(data.rooms ?? []))
      .catch((err) => console.error("Failed to fetch rooms:", err));
  }, []);

  // Poll หา ESP32 ที่รอการเชื่อมต่อ (เฉพาะเมื่อมีห้องประชุม active และยังไม่ได้เชื่อม)
  useEffect(() => {
    if (!selectedRoom || selectedRoom.status !== "ACTIVE") return;
    const poll = async () => {
      try {
        const [pendingRes, connectedRes] = await Promise.all([
          fetch("/api/esp32/pending"),
          fetch("/api/esp32/connected"),
        ]);
        const pendingData = await pendingRes.json();
        const connectedData = await connectedRes.json();
        setPendingDevices(pendingData.devices ?? []);
        // Only show ESP32s that are in a DIFFERENT room
        setConnectedDevices(
          (
            connectedData.devices as { deviceId: string; roomId: string }[]
          ).filter((d) => d.roomId !== selectedRoom.id),
        );
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [selectedRoom?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep a WebSocket connection to the selected ACTIVE room and auto-start recording
  useEffect(() => {
    stopRecording();
    setTranscriptChunks([]);

    if (!selectedRoom || selectedRoom.status !== "ACTIVE") return;

    // Pre-load existing transcript chunks from DB
    fetch(`/api/room/${selectedRoom.id}/summarize`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.transcripts) && data.transcripts.length > 0) {
          setTranscriptChunks(data.transcripts);
        }
      })
      .catch(() => {});

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(
      `${proto}//${window.location.host}/ws?roomId=${selectedRoom.id}&accessToken=${selectedRoom.accessToken}`,
    );
    wsRef.current = ws;

    ws.onopen = () => {
      // ถ้ามี ESP32 ที่ลิงก์ไว้กับ room นี้ใน localStorage → auto-start recording
      try {
        const stored = localStorage.getItem(`esp32:${selectedRoom.id}`);
        if (stored) {
          const { deviceId } = JSON.parse(stored) as { deviceId: string };
          if (deviceId) {
            esp32DeviceIdRef.current = deviceId;
            setLinkedDeviceId(deviceId);
            ws.send(
              JSON.stringify({
                type: "start-recording",
                targetDeviceId: deviceId,
              }),
            );
            setIsEsp32Recording(true);
            console.log(`🎙️ Auto-started ESP32 recording: ${deviceId}`);
          }
        }
      } catch {}
    };

    ws.onerror = (e) => {
      console.error("[Dashboard WS] error", e);
    };

    ws.onclose = (e) => {
      console.warn("[Dashboard WS] closed", e.code, e.reason);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        // console.log("[Dashboard WS] msg", msg.type, msg);
        if (msg.type === "partial-transcript") {
          setPartialTranscript(msg.text ?? "");
        } else if (msg.type === "transcribed") {
          const newChunk = {
            id: `live-${Date.now()}`,
            content: msg.text ?? "",
            createdAt: new Date(msg.timestamp ?? Date.now()).toISOString(),
          };
          setTranscriptChunks((prev) => {
            // Deduplicate: skip if last chunk has same content (direct + broadcast both fire)
            if (
              prev.length > 0 &&
              prev[prev.length - 1].content === newChunk.content
            ) {
              return prev;
            }
            return [...prev, newChunk];
          });
          setPartialTranscript("");
        } else if (msg.type === "esp32-audio-chunk") {
          // ESP32 is actively sending audio → confirm recording state
          if (esp32DeviceIdRef.current) {
            setIsEsp32Recording(true);
          }
        } else if (msg.type === "esp32-started-recording") {
          // Server confirmed start-recording was delivered to ESP32
          if (
            msg.deviceId === esp32DeviceIdRef.current ||
            esp32DeviceIdRef.current
          ) {
            setIsEsp32Recording(true);
          }
        } else if (msg.type === "analyzing") {
          setAnalysisStatus({ type: "analyzing" });
        } else if (msg.type === "deep-analyzing") {
          setAnalysisStatus({ type: "deep-analyzing" });
        } else if (msg.type === "analysis-complete" && msg.hasRisks === false) {
          setAnalysisStatus({ type: "no-risk" });
          setTimeout(() => setAnalysisStatus({ type: "idle" }), 4000);
        } else if (msg.type === "legal-risk") {
          // risk found → reset status (the legal-risk alert UI handles display)
          setAnalysisStatus({ type: "idle" });
        }
      } catch {
        // ignore non-JSON messages
      }
    };

    return () => {
      setAnalysisStatus({ type: "idle" });
      // บอก ESP32 ให้กลับ pending mode แล้วค่อย close WS
      if (esp32DeviceIdRef.current && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "go-pending",
            targetDeviceId: esp32DeviceIdRef.current,
          }),
        );
      }
      // ลบ ESP32 binding ของห้องนี้ออกจาก localStorage เมื่อออกจากห้อง
      try {
        if (selectedRoom?.id)
          localStorage.removeItem(`esp32:${selectedRoom.id}`);
      } catch {}
      esp32DeviceIdRef.current = null;
      setIsEsp32Recording(false);
      setLinkedDeviceId(null);
      setPendingDevices([]);
      setConnectedDevices([]);
      stopRecording();
      setPartialTranscript("");
      wsRef.current = null;
      ws.close();
    };
  }, [selectedRoom?.id, startRecording, stopRecording]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <motion.div
      className="live-meeting-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35 }}
    >
      <div className="live-meeting-layout">
        <div className="live-meeting-left">
          {rooms.map((room, index) => (
            <MeetingCard
              key={room.id}
              meeting={roomToCard(room)}
              isSelected={index === selectedIndex}
              onClick={() => setSelectedIndex(index)}
            />
          ))}
          {rooms.length === 0 && (
            <p style={{ color: "var(--text-muted)" }}>
              ไม่มีการประชุมที่กำลังดำเนินอยู่
            </p>
          )}
        </div>
        <div className="live-meeting-right">
          {selectedRoom && (
            <MeetingDetails
              meeting={roomToDetails(selectedRoom)}
              roomId={selectedRoom.id}
              accessToken={selectedRoom.accessToken}
            />
          )}
          {partialTranscript && (
            <div
              style={{
                marginTop: "0.75rem",
                padding: "0.55rem 0.9rem",
                borderRadius: "0.5rem",
                background: "rgba(99,102,241,0.08)",
                border: "1px solid rgba(99,102,241,0.25)",
                color: "#6366f1",
                fontSize: "0.85rem",
                fontStyle: "italic",
              }}
            >
              🎙 <span style={{ opacity: 0.8 }}>{partialTranscript}</span>
            </div>
          )}
          {analysisStatus.type !== "idle" && (
            <AnalysisStatusBanner status={analysisStatus} />
          )}
          {selectedRoom && (
            <div
              style={{
                display: "flex",
                gap: "0.6rem",
                marginTop: "1rem",
                flexWrap: "wrap",
              }}
            >
              <button
                className="transcript-btn"
                onClick={() => handleShowTranscript()}
              >
                📄 แสดง Transcript
                {transcriptChunks.length > 0
                  ? ` (${transcriptChunks.length})`
                  : ""}
              </button>
              <button
                onClick={isRecording ? stopRecording : startRecording}
                style={{
                  padding: "0.45rem 1.1rem",
                  borderRadius: "0.5rem",
                  border: `1px solid ${isRecording ? "var(--color-danger)" : "#4f46e5"}`,
                  background: isRecording
                    ? "var(--color-danger-light)"
                    : "rgba(79, 70, 229, 0.1)",
                  color: isRecording ? "var(--color-danger)" : "#4f46e5",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontSize: "0.85rem",
                }}
              >
                {isRecording
                  ? "⏹ หยุดไมค์คอมฯ"
                  : "🎙️ เปิดไมค์คอมฯ (ถ้าไม่มี ESP32)"}
              </button>
            </div>
          )}
          {/* ESP32 status bar + discovery panel */}
          {selectedRoom?.status === "ACTIVE" && (
            <div style={{ marginTop: "0.75rem" }}>
              {linkedDeviceId ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.6rem",
                    padding: "0.45rem 0.9rem",
                    borderRadius: "0.5rem",
                    background: isEsp32Recording
                      ? "rgba(99,102,241,0.1)"
                      : "rgba(156,163,175,0.15)",
                    border: `1px solid ${isEsp32Recording ? "rgba(99,102,241,0.35)" : "rgba(156,163,175,0.4)"}`,
                    width: "fit-content",
                  }}
                >
                  {isEsp32Recording && (
                    <span
                      style={{
                        width: "0.55rem",
                        height: "0.55rem",
                        borderRadius: "50%",
                        background: "#6366f1",
                        display: "inline-block",
                        flexShrink: 0,
                        animation: "pulse 1.4s ease-in-out infinite",
                      }}
                    />
                  )}
                  <span
                    style={{
                      color: isEsp32Recording ? "#6366f1" : "#6b7280",
                      fontSize: "0.82rem",
                      fontWeight: 600,
                    }}
                  >
                    {isEsp32Recording
                      ? `📡 ESP32 กำลังอัดเสียง · ${linkedDeviceId}`
                      : `📡 ESP32 หยุดชั่วคราว · ${linkedDeviceId}`}
                  </span>
                  <button
                    onClick={() => {
                      const ws = wsRef.current;
                      if (!ws || ws.readyState !== WebSocket.OPEN) return;
                      if (isEsp32Recording) {
                        ws.send(
                          JSON.stringify({
                            type: "stop-recording",
                            targetDeviceId: linkedDeviceId,
                          }),
                        );
                        setIsEsp32Recording(false);
                      } else {
                        ws.send(
                          JSON.stringify({
                            type: "start-recording",
                            targetDeviceId: linkedDeviceId,
                          }),
                        );
                        esp32DeviceIdRef.current = linkedDeviceId;
                        setIsEsp32Recording(true);
                      }
                    }}
                    style={{
                      padding: "0.2rem 0.6rem",
                      borderRadius: "0.35rem",
                      border: `1px solid ${isEsp32Recording ? "rgba(99,102,241,0.4)" : "rgba(99,102,241,0.4)"}`,
                      background: "transparent",
                      color: "#6366f1",
                      fontWeight: 600,
                      fontSize: "0.75rem",
                      cursor: "pointer",
                    }}
                  >
                    {isEsp32Recording ? "⏸ หยุดชั่วคราว" : "▶ อัดต่อ"}
                  </button>
                </div>
              ) : (
                // ยังไม่มี ESP32 ที่ลิงก์ → แสดง pending devices + connected elsewhere
                <div>
                  {pendingDevices.length > 0 && (
                    <>
                      <p
                        style={{
                          fontSize: "0.8rem",
                          color: "var(--text-muted, #9ca3af)",
                          marginBottom: "0.4rem",
                          fontWeight: 600,
                        }}
                      >
                        📡 ESP32 ที่รอการเชื่อมต่อ
                      </p>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "0.45rem",
                          marginBottom: "0.6rem",
                        }}
                      >
                        {pendingDevices.map((device) => (
                          <button
                            key={device.deviceId}
                            onClick={() => linkDevice(device.deviceId)}
                            style={{
                              padding: "0.3rem 0.8rem",
                              borderRadius: "0.45rem",
                              border: "1px solid #6366f1",
                              background: "rgba(99,102,241,0.08)",
                              color: "#6366f1",
                              fontWeight: 600,
                              fontSize: "0.8rem",
                              cursor: "pointer",
                              fontFamily: "monospace",
                            }}
                          >
                            🔌 {device.deviceId}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {connectedDevices.length > 0 && (
                    <>
                      <p
                        style={{
                          fontSize: "0.8rem",
                          color: "var(--text-muted, #9ca3af)",
                          marginBottom: "0.4rem",
                          fontWeight: 600,
                        }}
                      >
                        🔄 ESP32 ที่ใช้งานอยู่ใน room อื่น (คลิกเพื่อย้ายมายัง
                        room นี้)
                      </p>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "0.45rem",
                          marginBottom: "0.6rem",
                        }}
                      >
                        {connectedDevices.map((device) => (
                          <button
                            key={device.deviceId}
                            onClick={() => linkDevice(device.deviceId)}
                            style={{
                              padding: "0.3rem 0.8rem",
                              borderRadius: "0.45rem",
                              border: "1px solid #f59e0b",
                              background: "rgba(245,158,11,0.08)",
                              color: "#d97706",
                              fontWeight: 600,
                              fontSize: "0.8rem",
                              cursor: "pointer",
                              fontFamily: "monospace",
                            }}
                          >
                            🔄 {device.deviceId}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {pendingDevices.length === 0 &&
                    connectedDevices.length === 0 && (
                      <p
                        style={{
                          fontSize: "0.8rem",
                          color: "var(--text-muted, #9ca3af)",
                          fontWeight: 600,
                        }}
                      >
                        📡 ESP32 ที่รอการเชื่อมต่อ{" "}
                        <span style={{ fontWeight: 400 }}>(กำลังค้นหา...)</span>
                      </p>
                    )}
                </div>
              )}
            </div>
          )}
          {selectedRoom?.status === "ACTIVE" && isRecording && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                marginTop: "0.75rem",
                padding: "0.4rem 0.9rem",
                borderRadius: "0.5rem",
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.35)",
                width: "fit-content",
              }}
            >
              <span
                style={{
                  width: "0.55rem",
                  height: "0.55rem",
                  borderRadius: "50%",
                  background: "#ef4444",
                  display: "inline-block",
                  animation: "pulse 1.4s ease-in-out infinite",
                }}
              />
              <span
                style={{
                  color: "#ef4444",
                  fontSize: "0.82rem",
                  fontWeight: 600,
                }}
              >
                กำลังอัดเสียง
              </span>
            </div>
          )}
          {selectedRoom?.status === "ACTIVE" && (
            <div
              style={{
                display: "flex",
                gap: "0.6rem",
                marginTop: "1rem",
                flexWrap: "wrap",
              }}
            >
              <button
                onClick={() =>
                  wsRef.current?.send(JSON.stringify({ type: "test-alert" }))
                }
                style={{
                  padding: "0.45rem 1.1rem",
                  borderRadius: "0.5rem",
                  border: "1px solid #f59e0b",
                  background: "rgba(245,158,11,0.12)",
                  color: "#f59e0b",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontSize: "0.85rem",
                }}
              >
                ⚡ ส่ง Alert ทดสอบ
              </button>
              <button
                onClick={() => handleEndMeeting(selectedRoom)}
                disabled={isEndingMeeting}
                style={{
                  padding: "0.45rem 1.1rem",
                  borderRadius: "0.5rem",
                  border: "1px solid var(--color-danger)",
                  background: "var(--color-danger-light)",
                  color: "var(--color-danger)",
                  fontWeight: 600,
                  cursor: isEndingMeeting ? "not-allowed" : "pointer",
                  fontSize: "0.85rem",
                  opacity: isEndingMeeting ? 0.6 : 1,
                  transition: "opacity 150ms ease",
                }}
              >
                {isEndingMeeting ? "กำลังปิด..." : "⏹ ปิดการประชุม"}
              </button>
            </div>
          )}
        </div>
      </div>

      {showTranscript && selectedRoom && (
        <div
          className="transcript-modal-overlay"
          onClick={() => setShowTranscript(false)}
        >
          <div
            className="transcript-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="transcript-modal-header">
              <span className="transcript-modal-title">
                📄 Transcript —{" "}
                {MEETING_TYPE_LABELS[selectedRoom.meetingType] ??
                  selectedRoom.meetingType}
              </span>
              <button
                className="transcript-modal-close"
                onClick={() => setShowTranscript(false)}
              >
                ✕
              </button>
            </div>
            <div className="transcript-modal-body">
              {isLoadingTranscript ? (
                <p className="transcript-empty">กำลังโหลด...</p>
              ) : transcriptChunks.length === 0 && !partialTranscript ? (
                <p className="transcript-empty">ยังไม่มีข้อความถอดเสียง</p>
              ) : (
                <>
                  {transcriptChunks.map((chunk) => (
                    <div key={chunk.id} className="transcript-chunk">
                      <span className="transcript-chunk-time">
                        {new Date(chunk.createdAt).toLocaleTimeString("th-TH", {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                      <p className="transcript-chunk-text">{chunk.content}</p>
                    </div>
                  ))}
                  {partialTranscript && (
                    <div className="transcript-chunk" style={{ opacity: 0.55 }}>
                      <span className="transcript-chunk-time">◌</span>
                      <p
                        className="transcript-chunk-text"
                        style={{ fontStyle: "italic" }}
                      >
                        {partialTranscript}
                      </p>
                    </div>
                  )}
                  <div ref={transcriptEndRef} />
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <footer className="live-meeting-footer">
        <p>
          การประชุมทั้งหมดนี้ดำเนินการโดยสอดคล้องกับข้อกำหนดทางกฎหมายสำหรับบริษัทจำกัด
          และผ่านการพิจารณาตรวจสอบตามข้อบังคับบริษัท (Articles of Association)
        </p>
      </footer>
    </motion.div>
  );
}
