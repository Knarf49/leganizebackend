"use client";

import { ChevronLeft, Share2, ChevronDown } from "lucide-react";
import Link from "next/link";
import MeetingSummaryCard from "@/components/MeetingSummaryCard";
import { motion } from "framer-motion";
import { useEffect, useRef, useState, useTransition } from "react";
import Markdown from "react-markdown";
import { AnimatePresence } from "framer-motion";
import { cn, getRiskBarColors } from "@/lib/utils";

//TODO: เพิ่ม alert ตอนกด จบการประชุม
type Room = {
  id: string;
  meetingType: "AGM" | "EGM" | "BOD";
  calledBy: string;
  location: string;
  no: string;
  agendas: string[];
  startedAt: string;
  endedAt: string | null;
  status: "ACTIVE" | "ENDED" | "ABORTED";
  companyType: "LIMITED" | "PUBLIC_LIMITED";
};

const MEETING_TYPE_LABELS: Record<string, string> = {
  AGM: "การประชุมสามัญผู้ถือหุ้น",
  EGM: "การประชุมวิสามัญผู้ถือหุ้น",
  BOD: "การประชุมคณะกรรมการบริษัท",
};

const STATUS_TAGS: Record<string, string[]> = {
  ACTIVE: ["green"],
  ENDED: ["blue"],
  ABORTED: ["red"],
};

function roomToMeeting(room: Room) {
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
    id: room.id,
    title:
      room.agendas[0] ??
      MEETING_TYPE_LABELS[room.meetingType] ??
      room.meetingType,
    company: room.calledBy,
    type: MEETING_TYPE_LABELS[room.meetingType] ?? room.meetingType,
    no: room.meetingNo, // Use meetingNo from API response
    date,
    time: `${startTime} น. - ${endTime} น.`,
    location: room.location,
    tags: STATUS_TAGS[room.status] ?? ["blue"],
    riskLevels: [] as string[],
  };
}

type Meeting = ReturnType<typeof roomToMeeting>;

const TAG_COLORS: Record<string, string> = {
  red: "#ef4444",
  yellow: "#eab308",
  green: "#22c55e",
  blue: "#3b82f6",
};

type LegalRisk = {
  id: string;
  riskLevel: string;
  issueDescription: string;
  legalBasisType: string;
  legalBasisReference: string;
  legalReasoning: string;
  recommendation: string;
  urgencyLevel: string;
};

function MeetingDetailView({
  meeting,
  legalRiskCount,
  riskLevels,
  legalRisks,
}: {
  meeting: Meeting | undefined;
  legalRiskCount: number | null;
  riskLevels: string[];
  legalRisks: LegalRisk[];
}) {
  if (meeting) {
    console.log("Meeting No:", meeting.no);
  }
  const [isOpen, setIsOpen] = useState(false);
  if (!meeting) {
    return <div className="text-gray-400 p-6">กำลังโหลดการประชุม...</div>;
  }
  const RISK_COLORS: Record<
    string,
    { bg: string; text: string; border: string }
  > = {
    สูง: { bg: "bg-red-50", text: "text-red-600", border: "border-red-200" },
    กลาง: {
      bg: "bg-yellow-50",
      text: "text-yellow-600",
      border: "border-yellow-200",
    },
    ต่ำ: {
      bg: "bg-green-50",
      text: "text-green-600",
      border: "border-green-200",
    },
  };
  return (
    <div className="flex flex-col w-full h-150 overflow-y-auto pt-5 space-y-4">
      {/* Header: แจ้งเตือน */}
      <div
        className={cn(
          "bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden flex",
          isOpen && "flex-col",
        )}
      >
        {/* clickable header */}
        {!isOpen && (
          <div className="flex self-stretch">
            {getRiskBarColors(riskLevels).map((color, i) => (
              <div
                key={i}
                className="w-3 flex-1 min-h-2"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        )}
        <button
          className="w-full flex items-center gap-3 p-3 hover:bg-gray-50 transition-colors text-left"
          onClick={() => setIsOpen((prev) => !prev)}
        >
          <div className="text-sm flex-1">
            <p className="font-semibold text-gray-800">
              {legalRiskCount === null
                ? "กำลังโหลด..."
                : `ทั้งหมด ${legalRiskCount} การแจ้งเตือน`}
            </p>
            <p className="text-gray-500 truncate">{meeting.title}</p>
          </div>
          <motion.div
            animate={{ rotate: isOpen ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="text-gray-400 shrink-0"
          >
            <ChevronDown size={16} />
          </motion.div>
        </button>

        {/* dropdown content */}
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              <div className="max-h-72 overflow-y-auto border-t border-gray-100 divide-y divide-gray-100">
                {legalRisks.length === 0 ? (
                  <p className="text-gray-400 text-sm p-4">ไม่มีการแจ้งเตือน</p>
                ) : (
                  legalRisks.map((risk) => {
                    const level = risk.riskLevel.toLowerCase();
                    const color = RISK_COLORS[level] ?? RISK_COLORS["low"];
                    return (
                      <div key={risk.id} className="p-4 space-y-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-xs font-medium px-2 py-0.5 rounded-full border ${color.bg} ${color.text} ${color.border}`}
                          >
                            {risk.riskLevel}
                          </span>
                          <span className="text-xs text-gray-400">
                            {risk.urgencyLevel}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-gray-800">
                          {risk.issueDescription}
                        </p>
                        <p className="text-xs text-gray-500">
                          {risk.legalReasoning}
                        </p>
                        <div className="text-xs text-gray-400 bg-gray-50 rounded p-2 border border-gray-100">
                          <span className="font-medium">อ้างอิง:</span>{" "}
                          {risk.legalBasisReference}
                        </div>
                        <p className="text-xs text-blue-600 bg-blue-50 rounded p-2 border border-blue-100">
                          <span className="font-medium">คำแนะนำ:</span>{" "}
                          {risk.recommendation}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {/* ข้อมูลการประชุมหลัก */}
      <div className="bg-white border border-gray-200 p-6 rounded-2xl shadow-sm">
        {/* ส่วนแสดงแท็กสี */}
        <div className="flex items-center gap-2 mb-3">
          {meeting.tags?.map((tag: string, i: number) => (
            <div
              key={i}
              className="w-4 h-4 rounded-full"
              style={{ backgroundColor: TAG_COLORS[tag] || tag }}
            />
          ))}
        </div>

        <h2 className="text-xl font-bold mb-4">{meeting.title}</h2>
        <div className="grid grid-cols-2 gap-y-3 text-sm">
          <p className="text-gray-400">
            บริษัท: <span className="text-gray-700">{meeting.company}</span>
          </p>
          <p className="text-gray-400">
            ประเภท: <span className="text-gray-700">{meeting.type}</span>
          </p>
          <p className="text-gray-400">
            ครั้งที่: <span className="text-gray-700">{meeting.no}</span>
          </p>
          <p className="text-gray-400">
            วันที่: <span className="text-gray-700">{meeting.date}</span>
          </p>
          <p className="text-gray-400">
            เวลา: <span className="text-gray-700">{meeting.time}</span>
          </p>
          <p className="text-gray-400">
            สถานที่: <span className="text-gray-700">{meeting.location}</span>
          </p>
        </div>
      </div>

      {/* ส่วนสรุปตอนปิดประชุม */}
      <p className="text-sm text-gray-600 bg-gray-50 p-4 rounded-xl border border-gray-100">
        {(meeting as Meeting & { closing?: string }).closing}
      </p>
    </div>
  );
}

export default function SummaryPage() {
  const [meetings, setMeetings] = useState<ReturnType<typeof roomToMeeting>[]>(
    [],
  );
  const [selectedMeeting, setSelectedMeeting] = useState<
    ReturnType<typeof roomToMeeting> | undefined
  >(undefined);
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, startSummaryTransition] = useTransition();
  const markdownRef = useRef<HTMLDivElement>(null);
  const [legalRiskCount, setLegalRiskCount] = useState<number | null>(null);
  const [legalRisks, setLegalRisks] = useState<LegalRisk[]>([]);
  const [riskLevels, setRiskLevels] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/room?limit=5")
      .then((res) => res.json())
      .then(async (data) => {
        const mapped = (data.rooms ?? []).map(roomToMeeting);
        setMeetings(mapped);
        if (mapped.length > 0) setSelectedMeeting(mapped[0]);

        // fetch risk ของทุก room แล้ว update meetings
        const riskResults = await Promise.all(
          mapped.map((m: Meeting) =>
            fetch(`/api/risk/${m.id}?limit=100&skip=0`)
              .then((res) => (res.ok ? res.json() : null))
              .then((data) => ({
                id: m.id,
                levels: (data?.data ?? []).map(
                  (r: { riskLevel: string }) => r.riskLevel,
                ) as string[],
              }))
              .catch(() => ({ id: m.id, levels: [] as string[] })),
          ),
        );

        setMeetings((prev) =>
          prev.map((m) => ({
            ...m,
            riskLevels: riskResults.find((r) => r.id === m.id)?.levels ?? [],
          })),
        );
      })
      .catch((err) => console.error("Failed to fetch rooms:", err));
  }, []);

  useEffect(() => {
    if (!selectedMeeting) return;

    // reset
    setSummary(null);
    setLegalRiskCount(null);
    setRiskLevels([]);
    setLegalRisks([]);

    startSummaryTransition(async () => {
      const [summaryRes, legalRes] = await Promise.all([
        fetch(`/api/room/${selectedMeeting.id}/summarize`),
        fetch(`/api/risk/${selectedMeeting.id}?limit=100&skip=0`),
      ]);

      const [summaryData, legalData] = await Promise.all([
        summaryRes.ok ? summaryRes.json() : null,
        legalRes.ok ? legalRes.json() : null,
      ]);

      console.log("legalData:", legalData);
      console.log("risks:", legalData?.data);

      setSummary(summaryData?.room?.finalSummary ?? null);
      setLegalRiskCount(legalData?.meta?.total ?? 0);
      const levels: string[] = (legalData?.data ?? []).map(
        (r: { riskLevel: string }) => r.riskLevel,
      );
      setRiskLevels(levels);

      const risks: LegalRisk[] = legalData?.data ?? [];
      setLegalRisks(risks);
      setLegalRiskCount(legalData?.meta?.total ?? 0);
      setRiskLevels(risks.map((r) => r.riskLevel));
    });
  }, [selectedMeeting]);

  return (
    <motion.div
      className="summary-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35 }}
    >
      <header className="summary-page-header">
        <Link href="/" className="summary-back-link">
          <ChevronLeft size={22} />
          <h1>สรุปการประชุมทั้งหมด</h1>
        </Link>
        <motion.button
          className="summary-share-btn"
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
        >
          <Share2 size={16} />
          <span>Share</span>
        </motion.button>
      </header>

      <div className="flex gap-6 mt-6 ">
        <div className="w-76 h-150 p-2   overflow-y-auto ">
          {meetings.map((item, index) => (
            <div
              key={index}
              className="mb-2 cursor-pointer"
              onClick={() => setSelectedMeeting(item)}
            >
              <MeetingSummaryCard
                meeting={item}
                index={index}
                riskLevels={item.riskLevels}
              />
            </div>
          ))}
        </div>

        {/* ฝั่งขวาแสดงผลตาม state */}
        <div className="flex-1 flex gap-6">
          {/* คอลัมน์ย่อย 1: ข้อมูลหลัก */}
          <div className="flex-1 min-w-0">
            <MeetingDetailView
              meeting={selectedMeeting}
              legalRiskCount={legalRiskCount}
              riskLevels={riskLevels}
              legalRisks={legalRisks}
            />
          </div>

          {/* คอลัมน์ย่อย 2: สรุปวาระ (ตามรูป) */}
          <div className="w-96 bg-white border border-gray-200 rounded-2xl mt-5 p-6 shadow-sm flex flex-col h-150">
            <div className="flex justify-between items-center mb-6 shrink-0">
              <h3 className="font-bold text-lg">สรุปวาระต่างๆ</h3>
              <button
                className="text-xs border px-2 py-1 rounded text-gray-500 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                disabled={!summary}
                onClick={async () => {
                  if (!summary || !markdownRef.current) return;
                  const html2pdf = (await import("html2pdf.js")).default;
                  html2pdf()
                    .set({
                      margin: 16,
                      filename: `${selectedMeeting?.title ?? "summary"}.pdf`,
                      html2canvas: { scale: 2, useCORS: true },
                      jsPDF: {
                        unit: "mm",
                        format: "a4",
                        orientation: "portrait",
                      },
                    })
                    .from(markdownRef.current)
                    .save();
                }}
              >
                PDF
              </button>
            </div>

            {/* สรุปวาระทั้งหมด: ให้ส่วนนี้เลื่อนได้ (Scrollable Content) */}
            <div className="flex-1 overflow-y-auto pr-2 scroll-container">
              {summaryLoading ? (
                <p className="text-gray-400 text-sm">กำลังโหลดสรุป...</p>
              ) : summary ? (
                <div ref={markdownRef}>
                  <Markdown>{summary}</Markdown>
                </div>
              ) : (
                <p className="text-gray-400 text-sm">
                  {selectedMeeting
                    ? "ยังไม่มีสรุปสำหรับการประชุมนี้"
                    : "เลือกการประชุมเพื่อดูสรุป"}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
