// app/api/esp32/connected/route.ts
import { NextResponse } from "next/server";
import { getConnectedESP32List } from "@/websocket";

/**
 * GET /api/esp32/connected
 * Get list of ESP32 devices already connected to a room
 */
export async function GET() {
  try {
    const connectedDevices = getConnectedESP32List();

    return NextResponse.json({
      success: true,
      count: connectedDevices.length,
      devices: connectedDevices,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error getting connected ESP32 list:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to get connected ESP32 list",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
