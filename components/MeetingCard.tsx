"use client";

import { User, Circle } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";

interface MeetingCardProps {
  meeting: {
    title: string;
    company: string;
    type: string;
    no: string;
    date: string;
    time: string;
    location: string;
    tags: string[];
    isLive?: boolean;
    startedAt?: string;
  };
  isSelected?: boolean;
  onClick?: () => void;
}

export default function MeetingCard({
  meeting,
  isSelected,
  onClick,
}: MeetingCardProps) {
  const [isStarted, setIsStarted] = useState(() =>
    meeting.startedAt ? new Date(meeting.startedAt) <= new Date() : true,
  );

  useEffect(() => {
    if (!meeting.startedAt) return;
    const check = () =>
      setIsStarted(new Date(meeting.startedAt!) <= new Date());
    check();
    const interval = setInterval(check, 10000);
    return () => clearInterval(interval);
  }, [meeting.startedAt]);

  const tagColors: Record<string, string> = {
    red: "#ef4444",
    yellow: "#eab308",
    green: "#22c55e",
    blue: "#3b82f6",
  };

  return (
    <motion.div
      className={`meeting-card ${isSelected ? "meeting-card-selected" : ""}`}
      onClick={onClick}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.99 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      layout
    >
      {/* Color tag bars */}
      <div className="meeting-card-tags">
        {meeting.tags.map((tag, i) => (
          <div
            key={i}
            className="meeting-card-tag"
            style={{ backgroundColor: tagColors[tag] || tag }}
          />
        ))}
      </div>

      {/* Card body */}
      <div className="meeting-card-body">
        {/* Header row */}
        <div className="meeting-card-header">
          <div className="meeting-card-avatar">
            <User size={24} strokeWidth={1.5} />
          </div>
          <div className="meeting-card-title-block">
            {meeting.isLive && isStarted && (
              <motion.div
                className="meeting-card-live-badge"
                animate={{ opacity: [1, 0.5, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <Circle size={8} fill="currentColor" />
                <span>Live</span>
              </motion.div>
            )}
            {meeting.isLive && !isStarted && (
              <div className="meeting-card-upcoming-badge">
                <Circle size={8} fill="currentColor" />
                <span>Upcoming</span>
              </div>
            )}
            <h3 className="meeting-card-title">{meeting.title}</h3>
          </div>
        </div>

        {/* Details grid */}
        <div className="meeting-card-details">
          <div className="meeting-card-detail-row">
            <span className="meeting-card-detail-label">บริษัท:</span>
            <span className="meeting-card-detail-value">{meeting.company}</span>
          </div>
          <div className="meeting-card-detail-row">
            <span className="meeting-card-detail-label">ประเภท:</span>
            <span className="meeting-card-detail-value">{meeting.type}</span>
          </div>
          <div className="meeting-card-detail-row">
            <span className="meeting-card-detail-label">ครั้งที่:</span>
            <span className="meeting-card-detail-value">{meeting.no}</span>
          </div>
          <div className="meeting-card-detail-row">
            <span className="meeting-card-detail-label">วันที่:</span>
            <span className="meeting-card-detail-value">{meeting.date}</span>
          </div>
          <div className="meeting-card-detail-row">
            <span className="meeting-card-detail-label">เวลา:</span>
            <span className="meeting-card-detail-value">{meeting.time}</span>
          </div>
          <div className="meeting-card-detail-row">
            <span className="meeting-card-detail-label">สถานที่:</span>
            <span className="meeting-card-detail-value">
              {meeting.location}
            </span>
          </div>
        </div>

        {/* Connection hint */}
        <p className="meeting-card-hint">
          โปรดเชื่อมต่ออุปกรณ์เพื่อเริ่มประชุม
        </p>
      </div>
    </motion.div>
  );
}
