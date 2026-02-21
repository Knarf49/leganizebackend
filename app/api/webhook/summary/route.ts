import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { broadcastToRoom } from "@/websocket";

export async function POST(req: Request) {
  try {
    console.log("📨 Webhook summary received");

    const body = await req.json();
    console.log("📨 Webhook body received:", JSON.stringify(body, null, 2));

    // Extract the summary response from the agent
    // The structure might need adjustment based on actual agent response format
    const { metadata, output, result, data } = body;

    let roomId: string | null = null;

    // Try to get roomId from various possible locations
    if (metadata?.roomId) {
      roomId = metadata.roomId;
    } else if (body.roomId) {
      roomId = body.roomId;
    } else if (output?.roomId) {
      roomId = output.roomId;
    }

    if (!roomId) {
      console.error("❌ roomId not found in webhook payload");
      return NextResponse.json(
        { error: "roomId not found in webhook payload" },
        { status: 400 },
      );
    }

    let summaryText = "";

    // Extract summary text from agent response (try multiple formats)
    if (output?.summary) {
      summaryText = output.summary;
    } else if (output && typeof output === "string") {
      summaryText = output;
    } else if (result?.summary) {
      summaryText = result.summary;
    } else if (result && typeof result === "string") {
      summaryText = result;
    } else if (data?.summary) {
      summaryText = data.summary;
    } else if (body.summary) {
      summaryText = body.summary;
    } else if (typeof body === "string") {
      summaryText = body;
    } else {
      // Fallback: stringify the entire output/result
      summaryText = JSON.stringify(output || result || body, null, 2);
    }

    console.log(
      `📝 Processing summary for room ${roomId}, length: ${summaryText.length}`,
    );

    // Update room with final summary
    const updatedRoom = await prisma.room.update({
      where: { id: roomId },
      data: {
        finalSummary: summaryText,
        status: "ENDED",
        endedAt: new Date(),
      },
    });

    console.log(`✅ Room ${roomId} updated with summary`);

    // Broadcast to any connected WebSocket clients
    broadcastToRoom(roomId, {
      type: "summary-complete",
      roomId,
      summary: summaryText,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      roomId,
      summaryLength: summaryText.length,
    });
  } catch (error) {
    console.error("❌ Webhook summary error:", error);
    return NextResponse.json(
      { error: "Failed to process summary webhook" },
      { status: 500 },
    );
  }
}
