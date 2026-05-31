import { type AnalysisStatus } from "@/app/dashboard/page";
export default function AnalysisStatusBanner({
  status,
}: {
  status: AnalysisStatus;
}) {
  const config = {
    analyzing: {
      icon: "🔍",
      text: "กำลังตรวจสอบความเสี่ยงทางกฎหมาย...",
      color: "var(--color-accent)",
      bg: "var(--color-accent-light)",
      border: "rgba(79,70,229,0.25)",
      pulse: true,
      pulseColor: "var(--color-accent)",
    },
    "deep-analyzing": {
      icon: "⚠️",
      text: "ตรวจพบความเสี่ยง กำลังวิเคราะห์...",
      color: "var(--color-warning)",
      bg: "rgba(245,158,11,0.08)",
      border: "rgba(245,158,11,0.35)",
      pulse: true,
      pulseColor: "var(--color-warning)",
    },
    "no-risk": {
      icon: "✅",
      text: "ไม่พบความเสี่ยง",
      color: "var(--color-success)",
      bg: "rgba(34,197,94,0.08)",
      border: "rgba(34,197,94,0.3)",
      pulse: false,
      pulseColor: "var(--color-success)",
    },
    idle: null,
  }[status.type];

  if (!config) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        marginTop: "var(--space-3)",
        padding: "var(--space-2) var(--space-4)",
        borderRadius: "var(--radius-lg)",
        background: config.bg,
        border: `1px solid ${config.border}`,
        width: "fit-content",
        transition: `all var(--duration-normal) var(--ease-out)`,
        boxShadow: "var(--shadow-sm)",
      }}
    >
      {config.pulse && (
        <span
          style={{
            width: "0.5rem",
            height: "0.5rem",
            borderRadius: "var(--radius-full)",
            background: config.pulseColor,
            display: "inline-block",
            flexShrink: 0,
            animation: "pulse 1.4s ease-in-out infinite",
          }}
        />
      )}
      <span style={{ fontSize: "0.875rem" }}>{config.icon}</span>
      <span
        style={{
          color: config.color,
          fontSize: "0.82rem",
          fontWeight: 600,
          fontFamily: "var(--font-sans)",
        }}
      >
        {config.text}
      </span>
    </div>
  );
}
