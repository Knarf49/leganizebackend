"use client";

import CalendarView from "@/components/CalendarView";
import { motion } from "framer-motion";
import { Clock, MapPin, Users } from "lucide-react";

// TODO [BACKEND]: Replace with GET /api/room?limit=3
// TODO เอาวันที่ของแต่ละการประชุมที่ GET มาไปใส่ใน calendar
const upcomingMeetings = [
  {
    title: "ประชุมคณะกรรมการบริษัท ครั้งที่ 3/2569",
    date: "15 กุมภาพันธ์ 2569",
    time: "10:00 น. - 12:00 น.",
    location: "ห้องประชุมชั้น 12",
    attendees: 8,
    status: "upcoming" as const,
  },
  {
    title: "ประชุมสามัญผู้ถือหุ้นครั้งที่ 1/2569",
    date: "21 กุมภาพันธ์ 2569",
    time: "14:00 น. - 17:00 น.",
    location: "ห้องประชุมใหญ่ ชั้น 5",
    attendees: 45,
    status: "upcoming" as const,
  },
  {
    title: "ประชุมวิสามัญ เรื่องงบประมาณ",
    date: "24 กุมภาพันธ์ 2569",
    time: "09:00 น. - 11:30 น.",
    location: "ห้อง Meeting Room B",
    attendees: 12,
    status: "upcoming" as const,
  },
];

const calendarEvents = [
  { day: 15, color: "#f97316", label: "ประชุมคณะกรรมการ" },
  { day: 21, color: "#22c55e", label: "ประชุมสามัญ" },
  { day: 24, color: "#f97316", label: "ประชุมวิสามัญ" },
];

export default function DashboardPage() {
  return (
    <motion.div
      className="dashboard-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35 }}
    >
      <header className="dashboard-header">
        <h1>ภาพรวมข้อมูล</h1>
        <p className="dashboard-subtitle">สรุปกำหนดการประชุมและข้อมูลสำคัญ</p>
      </header>

      <div className="dashboard-grid">
        <div className="dashboard-calendar-section">
          <CalendarView events={calendarEvents} />
        </div>

        <div className="dashboard-meetings-section">
          <div className="dashboard-meetings-header">
            <h2>การประชุมครั้งต่อไป</h2>
            <span className="dashboard-meeting-count">
              {upcomingMeetings.length} รายการ
            </span>
          </div>

          <div className="dashboard-meetings-list">
            {upcomingMeetings.map((meeting, index) => (
              <motion.div
                key={index}
                className="dashboard-meeting-item"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: index * 0.08 }}
                whileHover={{ x: 4 }}
              >
                <div className="dashboard-meeting-item-header">
                  <h3>{meeting.title}</h3>
                </div>
                <div className="dashboard-meeting-item-meta">
                  <span className="dashboard-meeting-meta-item">
                    <Clock size={14} />
                    {meeting.time}
                  </span>
                  <span className="dashboard-meeting-meta-item">
                    <MapPin size={14} />
                    {meeting.location}
                  </span>
                  <span className="dashboard-meeting-meta-item">
                    <Users size={14} />
                    {meeting.attendees} คน
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
