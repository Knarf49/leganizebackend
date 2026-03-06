"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { motion } from "framer-motion";

interface CalendarEvent {
  day: number;
  color: string;
  label?: string;
}

interface CalendarViewProps {
  events?: CalendarEvent[];
  onDateSelect?: (date: Date) => void;
}

export default function CalendarView({
  events = [],
  onDateSelect,
}: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());

  const prevMonth = () => {
    setCurrentDate(
      new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1),
    );
  };

  const nextMonth = () => {
    setCurrentDate(
      new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1),
    );
  };

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const monthName = new Intl.DateTimeFormat("th-TH", { month: "long" }).format(
    currentDate,
  );
  const yearThai = year + 543;

  const firstDay = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const daysArray = Array.from({ length: totalDays }, (_, i) => i + 1);
  const emptySlots = Array.from({ length: firstDay }, (_, i) => i);

  const isToday = (day: number) => {
    const today = new Date();
    return (
      day === today.getDate() &&
      month === today.getMonth() &&
      year === today.getFullYear()
    );
  };

  const getEventsForDay = (day: number) => {
    return events.filter((e) => e.day === day);
  };

  return (
    <motion.div
      className="calendar-card"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <div className="calendar-header">
        <button
          onClick={prevMonth}
          className="calendar-nav-btn"
          aria-label="Previous month"
        >
          <ChevronLeft size={20} />
        </button>
        <h2 className="calendar-month-label">
          {monthName} {yearThai}
        </h2>
        <button
          onClick={nextMonth}
          className="calendar-nav-btn"
          aria-label="Next month"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      <div className="calendar-weekdays">
        {["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."].map((d) => (
          <div key={d} className="calendar-weekday">
            {d}
          </div>
        ))}
      </div>

      <div className="calendar-grid">
        {emptySlots.map((slot) => (
          <div key={`empty-${slot}`} className="calendar-day-empty" />
        ))}
        {daysArray.map((day) => {
          const dayEvents = getEventsForDay(day);
          return (
            <motion.div
              key={day}
              className="calendar-day-cell"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
            >
              <button
                onClick={() => {
                  const d = new Date(year, month, day);
                  onDateSelect?.(d);
                }}
                className={`calendar-day ${isToday(day) ? "calendar-day-today" : ""}`}
              >
                {day}
              </button>
              {dayEvents.length > 0 && (
                <div className="calendar-day-dots">
                  {dayEvents.map((ev, i) => (
                    <div
                      key={i}
                      className="calendar-day-dot"
                      style={{ backgroundColor: ev.color }}
                    />
                  ))}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
