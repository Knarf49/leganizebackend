"use client";

import { User } from "lucide-react";
import { motion } from "framer-motion";
import { getRiskBarColors } from "@/lib/utils";

interface MeetingSummaryData {
  title: string;
  company: string;
  type: string;
  no: string;
  date: string;
  time: string;
  location: string;
  tags: string[];
  riskLevels: string[];
}

interface MeetingSummaryCardProps {
  meeting: MeetingSummaryData;
  index: number;
  riskLevels: string[];
}

export default function MeetingSummaryCard({
  meeting,
  index,
}: MeetingSummaryCardProps) {
  const tagColors = getRiskBarColors(meeting.riskLevels);

  return (
    <motion.div
      className="summary-card-wrapper"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.1 }}
    >
      {/* Color tag bars at top */}
      <div className="summary-card-tags">
        {tagColors.map((color, i) => (
          <div
            key={i}
            className="summary-card-tag"
            style={{ backgroundColor: color }}
          />
        ))}
      </div>

      {/* Card body */}
      <div className="summary-card-body">
        {/* Header */}
        <div className="summary-card-header">
          <div className="summary-card-avatar">
            <User size={24} strokeWidth={1.5} />
          </div>
          <h3 className="summary-card-title">{meeting.title}</h3>
        </div>

        {/* Details */}
        <div className="summary-card-details">
          <div className="summary-card-row">
            <span className="summary-card-label">บริษัท:</span>
            <span className="summary-card-value">{meeting.company}</span>
          </div>
          <div className="summary-card-row">
            <span className="summary-card-label">ประเภท:</span>
            <span className="summary-card-value">{meeting.type}</span>
          </div>
          <div className="summary-card-row">
            <span className="summary-card-label">ครั้งที่:</span>
            <span className="summary-card-value">{meeting.no}</span>
          </div>
          <div className="summary-card-row">
            <span className="summary-card-label">วันที่:</span>
            <span className="summary-card-value">{meeting.date}</span>
          </div>
          <div className="summary-card-row">
            <span className="summary-card-label">เวลา:</span>
            <span className="summary-card-value">{meeting.time}</span>
          </div>
          <div className="summary-card-row">
            <span className="summary-card-label">สถานที่:</span>
            <span className="summary-card-value">{meeting.location}</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
