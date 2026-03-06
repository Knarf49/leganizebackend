"use client";

import MeetingCard from "@/components/MeetingCard";
import MeetingDetails from "@/components/MeetingDetail";
import { motion } from "framer-motion";

// TODO [BACKEND]: Replace with GET /api/room
const liveMeeting = {
  title: "พิจารณากำหนดค่าตอบแทน\nคณะกรรมการบริษัท",
  company: "ABC จำกัด",
  type: "การประชุมสามัญประจำปี",
  no: "2/2569",
  date: "25 มกราคม 2569",
  time: "13:30 น. - 16:30 น.",
  location: "ณ ห้องประชุมบอร์ดรูม",
  tags: ["red", "yellow"],
  isLive: true,
};

//TODO: เพิ่มให้ fetch room จากอันที่เวลาใกล้ปัจจุบันสุดมา
const meetingDetails = {
  title: "พิจารณากำหนดค่าตอบแทนคณะกรรมการบริษัท",
  time: "13:30 น. - 16:30 น.",
  date: "25 มกราคม 2569",
  agendas: [
    {
      no: 1,
      title: "เรื่องที่ประธานแจ้งให้ทราบ",
      description: "",
      subItems: [
        "1.1 รายงานภาพรวมผลประกอบการไตรมาส 1/2569",
        "1.2 แนวโน้มธุรกิจและสถานการณ์เศรษฐกิจที่เกี่ยวข้อง",
      ],
    },
    {
      no: 2,
      title: "รับรองรายงานการประชุมครั้งที่ผ่านมา",
      description: "",
      subItems: [
        "2.1 รับรองรายงานการประชุมคณะกรรมการบริษัท ครั้งที่ 1/2569 ซึ่งประชุมเมื่อวันที่ 20 มกราคม 2569",
      ],
    },
    {
      no: 3,
      title: "เรื่องเพื่อพิจารณา",
      description: "",
      subItems: [
        "3.1 พิจารณากำหนดอัตราค่าตอบแทนกรรมการ",
        "รายละเอียดตามเอกสารแนบ",
      ],
    },
  ],
  resolution:
    "ฝ่ายเลขานุบริษัทเสนอให้ที่ประชุมพิจารณาอนุมัติอัตราค่าตอบแทนคณะกรรมการบริษัท ประจำปี 2569 ตามรายละเอียดในเอกสารแนบ หรือพิจารณาปรับแก้ไขตามที่เห็นสมควร โดยให้มีผลตั้งแต่วันที่ 1 เมษายน 2569 เป็นต้นไป",
};

export default function Home() {
  return (
    <motion.div
      className="live-meeting-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35 }}
    >
      <div className="live-meeting-layout">
        <div className="live-meeting-left">
          <MeetingCard meeting={liveMeeting} isSelected />
        </div>
        <div className="live-meeting-right">
          <MeetingDetails meeting={meetingDetails} />
        </div>
      </div>

      <footer className="live-meeting-footer">
        <p>
          การประชุมทั้งหมดนี้ดำเนินการโดยสอดคล้องกับข้อกำหนดทางกฎหมายสำหรับบริษัทจำกัด
          และผ่านการพิจารณาตรวจสอบตามข้อบังคับบริษัท (Articles of Association)
        </p>
      </footer>
    </motion.div>
  );
}
