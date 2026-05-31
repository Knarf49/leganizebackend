import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

export async function GET(req: Request, { params }: RouteParams) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    // Get room with summary info
    const room = await prisma.room.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        meetingType: true,
        calledBy: true,
        location: true,
        agendas: true,
        finalSummary: true,
        companyType: true,
        startedAt: true,
        endedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    // Get transcript chunks for this room
    const transcripts = await prisma.transcriptChunk.findMany({
      where: { roomId: id },
      orderBy: { createdAt: "asc" },
    });

    // Get legal risks for this room
    const legalRisks = await prisma.legalRisk.findMany({
      where: { roomId: id },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json(
      {
        room,
        transcripts,
        legalRisks,
        metadata: {
          transcriptCount: transcripts.length,
          legalRiskCount: legalRisks.length,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error(
      `❌ Get room summarize error for ${(await (params as any)).id}:`,
      error,
    );

    return NextResponse.json(
      {
        error: "Failed to fetch room summary",
        details:
          process.env.NODE_ENV === "development"
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500 },
    );
  }
}
