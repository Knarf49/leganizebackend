"use client";

import { ChevronLeft, Share2 } from "lucide-react";
import Link from "next/link";
import MeetingSummaryCard from "@/components/MeetingSummaryCard";
import { motion } from "framer-motion";
import { useEffect, useRef, useState, useTransition } from "react";
import Markdown from "react-markdown";

//TODO: เพิ่มให้ fetch การแจ้งเตือนตาม roomId
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
    no: "-",
    date,
    time: `${startTime} น. - ${endTime} น.`,
    location: room.location,
    tags: STATUS_TAGS[room.status] ?? ["blue"],
  };
}
// const meetingItems = [
//   { title: "พิจารณารับรองรายงานการประชุมผู้ถือหุ้นครั้งก่อน", company: "ABC จำกัด", type: "การประชุมสามัญประจำปี", no: "1/2569", date: "24 มกราคม 2569", time: "14:00 น. - 16:00 น.", location: "ห้องประชุม 2", tags: ["red", "yellow"] },
//   { title: "พิจารณาเลือกตั้งกรรมการแทนกรรมการที่ครบวาระ", company: "ABC จำกัด", type: "การประชุมสามัญประจำปี", no: "1/2569", date: "24 กุมภาพันธ์ 2569", time: "12:00 น. - 13:00 น.", location: "ห้องประชุม 5 และสื่ออิเล็กทรอนิกส์", tags: ["yellow", "green"] },
//   { title: "พิจารณากำหนดค่าตอบแทนคณะกรรมการบริษัท ประจำปี 2569", company: "ABC จำกัด", type: "การประชุมคณะกรรมการ", no: "2/2569", date: "25 มกราคม 2569", time: "13:30 น. - 16:30 น.", location: "ณ ห้องประชุมบอร์ดรูม", tags: ["red", "blue"] },
// ];

type Meeting = ReturnType<typeof roomToMeeting>;

const TAG_COLORS: Record<string, string> = {
  red: "#ef4444",
  yellow: "#eab308",
  green: "#22c55e",
  blue: "#3b82f6",
};

function MeetingDetailView({
  meeting,
  legalRiskCount,
}: {
  meeting: Meeting | undefined;
  legalRiskCount: number | null;
}) {
  if (!meeting) {
    return <div className="text-gray-400 p-6">กำลังโหลดการประชุม...</div>;
  }
  return (
    <div className="flex flex-col w-full h-150 overflow-y-auto pt-5 space-y-4">
      {/* Header: แจ้งเตือน */}
      <div className="flex items-center gap-3 bg-white border border-gray-200 p-3 rounded-lg shadow-sm">
        <div className="w-1 bg-red-500 self-stretch rounded-full" />
        <div className="text-sm">
          <p className="font-semibold text-gray-800">
            {legalRiskCount === null
              ? "กำลังโหลด..."
              : `ทั้งหมด ${legalRiskCount} การแจ้งเตือน`}
          </p>
          <p className="text-gray-500 truncate">{meeting.title}</p>
        </div>
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

  useEffect(() => {
    fetch("/api/room?limit=5")
      .then((res) => res.json())
      .then((data) => {
        const mapped = (data.rooms ?? []).map(roomToMeeting);
        setMeetings(mapped);
        if (mapped.length > 0) setSelectedMeeting(mapped[0]);
      })
      .catch((err) => console.error("Failed to fetch rooms:", err));
  }, []);

  useEffect(() => {
    if (!selectedMeeting) return;

    // reset ก่อน
    setSummary(null);
    setLegalRiskCount(null);

    // ยิงพร้อมกันด้วย Promise.all
    startSummaryTransition(async () => {
      const [summaryRes, legalRes] = await Promise.all([
        fetch(`/api/room/${selectedMeeting.id}/summarize`),
        fetch(`/api/risk/${selectedMeeting.id}?limit=1&skip=0`),
      ]);

      const [summaryData, legalData] = await Promise.all([
        summaryRes.json(),
        legalRes.json(),
      ]);

      setSummary(summaryData.room?.finalSummary ?? null);
      setLegalRiskCount(legalData.meta?.total ?? 0);
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
              <MeetingSummaryCard meeting={item} index={index} />
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
