//TODO: get /api/room?limit=3 มี pagination ถ้าเกิน
"use client";

import { ChevronLeft, Share2 } from "lucide-react";
import Link from "next/link";
import MeetingSummaryCard from "@/components/MeetingSummaryCard";
import { motion } from "framer-motion";

const meetingItems = [
  {
    title: "พิจารณารับรองรายงานการประชุมผู้ถือหุ้นครั้งก่อน",
    company: "ABC จำกัด",
    type: "การประชุมสามัญประจำปี",
    no: "1/2569",
    date: "24 มกราคม 2569",
    time: "14:00 น. - 16:00 น.",
    location: "ห้องประชุม 2",
    tags: ["red", "yellow"],
  },
  {
    title: "พิจารณาเลือกตั้งกรรมการแทนกรรมการที่ครบวาระ",
    company: "ABC จำกัด",
    type: "การประชุมสามัญประจำปี",
    no: "1/2569",
    date: "24 กุมภาพันธ์ 2569",
    time: "12:00 น. - 13:00 น.",
    location: "ห้องประชุม 5 และสื่ออิเล็กทรอนิกส์",
    tags: ["yellow", "green"],
  },
  {
    title: "พิจารณากำหนดค่าตอบแทนคณะกรรมการบริษัท ประจำปี 2569",
    company: "ABC จำกัด",
    type: "การประชุมคณะกรรมการ",
    no: "2/2569",
    date: "25 มกราคม 2569",
    time: "13:30 น. - 16:30 น.",
    location: "ณ ห้องประชุมบอร์ดรูม",
    tags: ["red", "blue"],
  },
];

export default function SummaryPage() {
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
        {meetingItems.map((item, index) => (
            //TODO: add link to summary card
          <MeetingSummaryCard key={index} meeting={item} index={index} />
          //   <Link href={`/summarize/${roomId}`}>
          //     <MeetingSummaryCard key={index} meeting={item} index={index} />
          //   </Link>
        ))}
      </div>
    </motion.div>
  );
}
