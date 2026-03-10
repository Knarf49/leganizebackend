"use client";

import { ChevronLeft, Share2 } from "lucide-react";
import Link from "next/link";
import MeetingSummaryCard from "@/components/MeetingSummaryCard";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";

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

export default function SummaryPage() {
  const [meetings, setMeetings] = useState<ReturnType<typeof roomToMeeting>[]>(
    [],
  );

  useEffect(() => {
    fetch("/api/room?limit=5")
      .then((res) => res.json())
      .then((data) => setMeetings((data.rooms ?? []).map(roomToMeeting)))
      .catch((err) => console.error("Failed to fetch rooms:", err));
  }, []);

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

      <div className="summary-cards-grid">
        {meetings.map((item, index) => (
          <Link key={item.id} href={`/summarize/${item.id}`}>
            <MeetingSummaryCard meeting={item} index={index} />
          </Link>
        ))}
      </div>
    </motion.div>
  );
}
