"use client";

import CalendarView from "@/components/CalendarView";
import { motion } from "framer-motion";
import { Clock, MapPin } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

type Room = {
  id: string;
  meetingType: "AGM" | "EGM" | "BOD";
  location: string;
  startedAt: string;
  status: string;
};

const MEETING_TYPE_LABELS: Record<string, string> = {
  AGM: "ประชุมสามัญผู้ถือหุ้น",
  EGM: "ประชุมวิสามัญผู้ถือหุ้น",
  BOD: "ประชุมคณะกรรมการบริษัท",
};

const MEETING_TYPE_COLORS: Record<string, string> = {
  AGM: "#22c55e",
  EGM: "#3b82f6",
  BOD: "#f97316",
};

// const upcomingMeetings = [
//   { title: "ประชุมคณะกรรมการบริษัท ครั้งที่ 3/2569", date: "15 กุมภาพันธ์ 2569", time: "10:00 น. - 12:00 น.", location: "ห้องประชุมชั้น 12", attendees: 8, status: "upcoming" },
//   { title: "ประชุมสามัญผู้ถือหุ้นครั้งที่ 1/2569", date: "21 กุมภาพันธ์ 2569", time: "14:00 น. - 17:00 น.", location: "ห้องประชุมใหญ่ ชั้น 5", attendees: 45, status: "upcoming" },
//   { title: "ประชุมวิสามัญ เรื่องงบประมาณ", date: "24 กุมภาพันธ์ 2569", time: "09:00 น. - 11:30 น.", location: "ห้อง Meeting Room B", attendees: 12, status: "upcoming" },
// ];

// const calendarEvents = [
//   { day: 15, color: "#f97316", label: "ประชุมคณะกรรมการ" },
//   { day: 21, color: "#22c55e", label: "ประชุมสามัญ" },
//   { day: 24, color: "#f97316", label: "ประชุมวิสามัญ" },
// ];

export default function Home() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [totalRooms, setTotalRooms] = useState<number>(0);

  useEffect(() => {
    fetch("/api/room?limit=3&status=ACTIVE")
      .then((res) => res.json())
      .then((data) => {
        const sorted = (data.rooms ?? []).slice().sort((a: Room, b: Room) => {
          const now = Date.now();
          return (
            Math.abs(new Date(a.startedAt).getTime() - now) -
            Math.abs(new Date(b.startedAt).getTime() - now)
          );
        });
        setRooms(sorted);
        setTotalRooms(data.total ?? sorted.length);
      })
      .catch((err) => console.error("Failed to fetch rooms:", err));
  }, []);

  const calendarEvents = rooms.map((room) => ({
    day: new Date(room.startedAt).getDate(),
    color: MEETING_TYPE_COLORS[room.meetingType] ?? "#f97316",
    label: MEETING_TYPE_LABELS[room.meetingType] ?? room.meetingType,
  }));

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
            <span className="dashboard-meeting-count">{totalRooms} รายการ</span>
          </div>

          <div className="dashboard-meetings-list">
            {rooms.map((room, index) => (
              <motion.div
                key={room.id}
                className="dashboard-meeting-item"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: index * 0.08 }}
                whileHover={{ x: 4 }}
              >
                <Link href="/dashboard">
                  <div className="dashboard-meeting-item-header">
                    <h3>
                      {MEETING_TYPE_LABELS[room.meetingType] ??
                        room.meetingType}
                    </h3>
                  </div>
                  <div className="dashboard-meeting-item-meta">
                    <span className="dashboard-meeting-meta-item">
                      <Clock size={14} />
                      {new Date(room.startedAt).toLocaleTimeString("th-TH", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      น.
                    </span>
                    <span className="dashboard-meeting-meta-item">
                      <MapPin size={14} />
                      {room.location}
                    </span>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
