import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const room = await prisma.room.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        meetingType: true,
        calledBy: true,
        location: true,
        agendas: true,
        threadId: true,
        accessToken: true,
        startedAt: true,
        endedAt: true,
        finalSummary: true,
        companyType: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    return NextResponse.json({ room });
  } catch (error) {
    console.error("GET room error:", error);
    return NextResponse.json(
      { error: "Failed to fetch room" },
      { status: 500 },
    );
  }
}
