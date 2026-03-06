"use client";

import { Clock } from "lucide-react";
import { motion } from "framer-motion";
import { useRef, useEffect, useState } from "react";

interface Agenda {
  no: number;
  title: string;
  description: string;
  subItems?: string[];
}

interface MeetingDetailsProps {
  meeting: {
    title: string;
    time: string;
    date: string;
    agendas: Agenda[];
    resolution?: string;
  };
}

function WaveformVisualization() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = canvas.offsetWidth * 2;
      canvas.height = canvas.offsetHeight * 2;
      ctx.scale(2, 2);
    };
    resize();

    let time = 0;
    const draw = () => {
      if (!ctx || !canvas) return;
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      ctx.clearRect(0, 0, w, h);

      // Draw dual waveforms
      const waves = [
        {
          color: "rgba(99, 102, 241, 0.35)",
          amp: 18,
          freq: 0.02,
          speed: 0.03,
          yOffset: 0,
        },
        {
          color: "rgba(239, 68, 68, 0.3)",
          amp: 14,
          freq: 0.025,
          speed: 0.02,
          yOffset: 5,
        },
      ];

      waves.forEach((wave) => {
        ctx.beginPath();
        ctx.strokeStyle = wave.color;
        ctx.lineWidth = 1.5;
        for (let x = 0; x < w; x++) {
          const y =
            h / 2 +
            wave.yOffset +
            Math.sin(x * wave.freq + time * wave.speed) * wave.amp +
            Math.sin(x * wave.freq * 2.3 + time * wave.speed * 1.5) *
              (wave.amp * 0.4);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });

      // Center line
      ctx.beginPath();
      ctx.strokeStyle = "rgba(148, 163, 184, 0.2)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      ctx.setLineDash([]);

      time++;
      if (isActive) {
        animationRef.current = requestAnimationFrame(draw);
      }
    };

    draw();
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(animationRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [isActive]);

  return (
    <div className="waveform-container">
      <canvas ref={canvasRef} className="waveform-canvas" />
    </div>
  );
}

export default function MeetingDetails({ meeting }: MeetingDetailsProps) {
  const agendaContainerRef = useRef<HTMLDivElement>(null);

  return (
    <motion.div
      className="meeting-details"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay: 0.15, ease: "easeOut" }}
    >
      <h2 className="meeting-details-title">รายละเอียดการประชุม</h2>

      {/* Time info */}
      <div className="meeting-details-time">
        <Clock size={20} strokeWidth={1.5} />
        <div>
          <p className="meeting-details-time-label">
            การประชุมกำลังจะเริ่มเร็ว ๆ นี้
          </p>
          <p className="meeting-details-time-value">{meeting.time}</p>
        </div>
      </div>

      {/* Agenda items - horizontal scroll */}
      <div className="meeting-details-agendas-wrapper">
        <div className="meeting-details-agendas" ref={agendaContainerRef}>
          {meeting.agendas.map((agenda, index) => (
            <motion.div
              key={agenda.no}
              className="meeting-details-agenda-card"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 * index }}
            >
              <h4 className="agenda-card-title">ระเบียบวาระที่ {agenda.no}</h4>
              <p className="agenda-card-subtitle">{agenda.title}</p>
              {agenda.subItems && agenda.subItems.length > 0 && (
                <ul className="agenda-card-subitems">
                  {agenda.subItems.map((sub, si) => (
                    <li key={si}>{sub}</li>
                  ))}
                </ul>
              )}
            </motion.div>
          ))}
        </div>
        <div className="meeting-details-agendas-fade" />
      </div>

      {/* Resolution text */}
      {meeting.resolution && (
        <motion.p
          className="meeting-details-resolution"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          {meeting.resolution}
        </motion.p>
      )}

      {/* Waveform */}
      <WaveformVisualization />
    </motion.div>
  );
}
