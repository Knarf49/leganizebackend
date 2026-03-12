"use client";

import MeetingCard from "@/components/MeetingCard";
import MeetingDetails from "@/components/MeetingDetail";
import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
//TODO: แก้ summary page
//TODO: connect all routing
//TODO: เปลี่ยน google cloud stt --> typhoon asr api

type Room = {
  id: string;
  meetingType: "AGM" | "EGM" | "BOD";
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
    no: "-",
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

  useEffect(() => {
    fetch("/api/room?limit=5&status=ACTIVE")
      .then((res) => res.json())
      .then((data) => setRooms(data.rooms ?? []))
      .catch((err) => console.error("Failed to fetch rooms:", err));
  }, []);

  const selectedRoom = rooms[selectedIndex] ?? null;

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
      // console.log("[Dashboard WS] connected to room", selectedRoom.id);
      // ไม่บังคับ auto start PC mic เพื่อให้สามารถใช้ ESP32 เพียวๆ ได้
      // startRecording(); 
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
        }
      } catch {
        // ignore non-JSON messages
      }
    };

    return () => {
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
              </button>
              <button
                onClick={isRecording ? stopRecording : startRecording}
                style={{
                  padding: "0.45rem 1.1rem",
                  borderRadius: "0.5rem",
                  border: `1px solid ${isRecording ? 'var(--color-danger)' : '#4f46e5'}`,
                  background: isRecording ? 'var(--color-danger-light)' : 'rgba(79, 70, 229, 0.1)',
                  color: isRecording ? 'var(--color-danger)' : '#4f46e5',
                  fontWeight: 600,
                  cursor: "pointer",
                  fontSize: "0.85rem",
                }}
              >
                {isRecording ? "⏹ หยุดไมค์คอมฯ" : "🎙️ เปิดไมค์คอมฯ (ถ้าไม่มี ESP32)"}
              </button>
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
