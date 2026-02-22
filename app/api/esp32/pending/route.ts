// app/api/esp32/pending/route.ts
import { NextResponse } from "next/server";
import { getPendingESP32List } from "@/websocket";

export async function GET() {
  return NextResponse.json({ devices: getPendingESP32List() });
}
