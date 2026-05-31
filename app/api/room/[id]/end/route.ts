import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  waitForTranscriptionComplete,
  callAgentForSummary,
} from "@/lib/agentSummary";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const room = await prisma.room.findUnique({
      where: { id },
    });

    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    if (room.status !== "ACTIVE") {
      return NextResponse.json(
        { error: "Room is not active" },
        { status: 400 },
      );
    }

    await prisma.room.update({
      where: { id },
      data: {
        status: "ENDED",
        endedAt: new Date(),
      },
    });

    // Trigger summary generation in background (non-blocking)
    waitForTranscriptionComplete(id)
      .then(async (transcriptText) => {
        if (transcriptText && transcriptText.trim().length > 0) {
          await callAgentForSummary(id, transcriptText);
        } else {
          await prisma.room.update({
            where: { id },
            data: { finalSummary: "ไม่มีข้อความที่จะสรุป" },
          });
        }
      })
      .catch((err) => {
        console.error(`❌ Error during summary for room ${id}:`, err);
      });

    return NextResponse.json({ success: true, roomId: id });
  } catch (error) {
    console.error("End room error:", error);
    return NextResponse.json({ error: "Failed to end room" }, { status: 500 });
  }
}
