import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getRiskBarColors(levels: string[]): string[] {
  const has = (l: string) =>
    levels.some((r) => r.toLowerCase() === l.toLowerCase());

  if (levels.length === 0) return ["#3b82f6"]; // น้ำเงิน
  if (has("สูง") && !has("กลาง") && !has("ต่ำ")) return ["#ef4444"];
  if (has("สูง") && has("กลาง") && !has("ต่ำ")) return ["#ef4444", "#eab308"];
  if (has("สูง") && has("กลาง") && has("ต่ำ"))
    return ["#ef4444", "#eab308", "#22c55e"];
  // กรณีอื่นๆ ที่ไม่มี สูง
  if (has("กลาง")) return ["#eab308"];
  if (has("ต่ำ")) return ["#22c55e"];
  return ["#3b82f6"];
}
