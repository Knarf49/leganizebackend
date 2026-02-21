import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

//TODO: ทำให้สามารถ disconnect websocket แล้วรอ process queue ให้หมด แล้วเอา chunk สุดท้ายไปให้ llm summary
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

    const updatedRoom = await prisma.room.update({
      where: { id },
      data: {
        status: "ENDED",
        endedAt: new Date(),
      },
      select: {
        id: true,
        status: true,
        startedAt: true,
        endedAt: true,
        finalSummary: true,
      },
    });

    return NextResponse.json(updatedRoom);
  } catch (error) {
    console.error("End room error:", error);
    return NextResponse.json({ error: "Failed to end room" }, { status: 500 });
  }
}
