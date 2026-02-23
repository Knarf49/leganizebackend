// app/api/esp32/pending/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getPendingESP32List } from "@/websocket";

/**
 * GET /api/esp32/pending
 * Get list of pending ESP32 devices waiting for configuration
 */
export async function GET(request: NextRequest) {
  try {
    const pendingDevices = getPendingESP32List();

    return NextResponse.json({
      success: true,
      count: pendingDevices.length,
      devices: pendingDevices,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error getting pending ESP32 list:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to get pending ESP32 list",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
