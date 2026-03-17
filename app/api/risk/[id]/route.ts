// GET /api/LegalRisk/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: roomId } = await params;
    const { searchParams } = new URL(request.url);

    const limit = parseInt(searchParams.get("limit") ?? "10");
    const skip = parseInt(searchParams.get("skip") ?? "0");

    if (isNaN(limit) || isNaN(skip) || limit < 1 || skip < 0) {
      return NextResponse.json(
        { error: "Invalid limit or skip parameters" },
        { status: 400 },
      );
    }

    const [legalRisks, total] = await Promise.all([
      prisma.legalRisk.findMany({
        where: { roomId },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip,
      }),
      prisma.legalRisk.count({
        where: { roomId },
      }),
    ]);

    return NextResponse.json({
      data: legalRisks,
      meta: {
        total,
        limit,
        skip,
        hasMore: skip + limit < total,
      },
    });
  } catch (error) {
    console.error("[GET /api/risk/[id]]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  } finally {
    await prisma.$disconnect();
  }
}
