import { NextRequest, NextResponse } from "next/server";
import { emitLegalEvent } from "@/sse";

// Debug: Verify import
console.log(
  `📦 [API] test/sse route loaded, emitLegalEvent:`,
  typeof emitLegalEvent,
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { roomId, message = "Test alert message" } = body as {
      roomId?: string;
      message?: string;
    };

    if (!roomId || typeof roomId !== "string") {
      return NextResponse.json(
        { error: "roomId is required" },
        { status: 400 },
      );
    }

    console.log(`🧪 Test SSE emit for room: ${roomId}`);
    console.log(`🧪 Test message: ${message}`);

    // ส่ง test event
    const testData = {
      roomId,
      type: "legal-risk",
      createdAt: new Date().toISOString(),
      issues: [
        {
          riskLevel: "สูง",
          issueDescription: message,
          urgencyLevel: "สูง",
        },
      ],
    };

    console.log(`🧪 Sending test data:`, testData);
    emitLegalEvent(roomId, testData);
    console.log(`🧪 Test event emission completed`);

    return NextResponse.json({
      success: true,
      message: `Test event sent to room: ${roomId}`,
      data: testData,
    });
  } catch (error) {
    console.error("Test SSE error:", error);
    return NextResponse.json(
      { error: "Failed to send test event" },
      { status: 500 },
    );
  }
}
