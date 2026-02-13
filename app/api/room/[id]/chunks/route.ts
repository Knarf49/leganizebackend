import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { runRiskDetector } from "@/lib/riskDetector";
import { runRiskAnalyzer } from "@/lib/riskAnalyzer";
import { emitLegalEvent } from "@/sse";

type AnalyzerIssue = {
  riskLevel?: string;
  issueDescription?: string;
  legalBasis?: {
    type?: string;
    reference?: string;
  };
  legalReasoning?: string;
  recommendation?: string;
  urgencyLevel?: string;
  disclaimer?: string;
};

const BUFFER_SIZE = 3; // วิเคราะห์ทุก 3 chunk
const COOLDOWN_MS = 60_000; // แจ้งเตือนได้ไม่ถี่กว่า 1 นาที

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    /* --------------------------------
       1️⃣ Auth: accessToken
    -------------------------------- */
    const auth = req.headers.get("authorization");
    if (!auth?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Missing access token" },
        { status: 401 },
      );
    }
    const accessToken = auth.replace("Bearer ", "");

    /* --------------------------------
       2️⃣ Parse body
    -------------------------------- */
    const body = await req.json();
    const { text, isFinal = true } = body as {
      text?: string;
      isFinal?: boolean;
    };

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    // ignore partial transcript
    if (!isFinal) {
      return NextResponse.json({ ok: true });
    }

    /* --------------------------------
       3️⃣ Validate room
    -------------------------------- */
    const room = await prisma.room.findFirst({
      where: {
        id: id,
        accessToken,
        status: "ACTIVE",
      },
      select: {
        id: true,
        threadId: true,
        companyType: true,
      },
    });

    if (!room) {
      return NextResponse.json(
        { error: "Invalid room or access token" },
        { status: 401 },
      );
    }

    await prisma.transcriptChunk.create({
      data: {
        roomId: id,
        content: text,
      },
    });

    /* --------------------------------
       4️⃣ Redis keys
    -------------------------------- */
    const bufferKey = `room:${id}:buffer`; // list
    const cooldownKey = `room:${id}:cooldown`; // string (timestamp)

    /* --------------------------------
       5️⃣ Push chunk into buffer (atomic)
    -------------------------------- */
    await redis.rpush(bufferKey, text);
    await redis.ltrim(bufferKey, -BUFFER_SIZE, -1);

    const bufferLength = await redis.llen(bufferKey);

    // ยังไม่ครบ buffer → จบ
    if (bufferLength < BUFFER_SIZE) {
      return NextResponse.json({ ok: true });
    }

    /* --------------------------------
       6️⃣ Cooldown check
    -------------------------------- */
    const lastAlertAtRaw = await redis.get(cooldownKey);
    if (lastAlertAtRaw) {
      const lastAlertAt = Number(lastAlertAtRaw);
      if (Date.now() - lastAlertAt < COOLDOWN_MS) {
        // clear buffer แล้วออก
        await redis.del(bufferKey);
        return NextResponse.json({ ok: true });
      }
    }

    /* --------------------------------
       7️⃣ Read buffer snapshot
    -------------------------------- */
    const buffer = await redis.lrange(bufferKey, 0, -1);

    /* --------------------------------
       8️⃣ Risk Detector (เบา / เร็ว)
    -------------------------------- */
    console.log(
      `🔍 Running risk detector for room: ${id}, companyType: ${room.companyType}`,
    );
    const signal = await runRiskDetector(buffer, room.companyType);
    console.log(`📊 Risk detector result: ${signal}`);

    if (!signal) {
      console.log(`✅ No risk detected, clearing buffer for room: ${id}`);
      await redis.del(bufferKey);
      return NextResponse.json({ ok: true });
    }

    /* --------------------------------
       9️⃣ Risk Analyzer (หนัก)
    -------------------------------- */
    console.log(`🧠 Running risk analyzer for room: ${id}`);
    const analyzerResult = await runRiskAnalyzer({
      roomId: id,
      transcript: buffer,
      threadId: room.threadId,
    });
    console.log(`📋 Analyzer result:`, analyzerResult);

    //TODO: alert ไปที่ frontend ผ่าน sse
    if (
      analyzerResult &&
      typeof analyzerResult === "object" &&
      Array.isArray((analyzerResult as { issues?: unknown[] }).issues) &&
      (analyzerResult as { issues: unknown[] }).issues.length > 0
    ) {
      console.log(
        `🚨 Found ${(analyzerResult as { issues: unknown[] }).issues.length} legal issues`,
      );
      const issues = (analyzerResult as { issues: AnalyzerIssue[] }).issues;

      console.log(`💾 Saving legal risks to database...`);
      await prisma.legalRisk.createMany({
        data: issues.map((issue) => ({
          roomId: id,
          riskLevel: issue.riskLevel ?? "ไม่ระบุ",
          issueDescription: issue.issueDescription ?? "",
          legalBasisType: issue.legalBasis?.type ?? "ไม่ระบุ",
          legalBasisReference: issue.legalBasis?.reference ?? "",
          legalReasoning: issue.legalReasoning ?? "",
          recommendation: issue.recommendation ?? "",
          urgencyLevel: issue.urgencyLevel ?? "ไม่ระบุ",
          rawJson: issue,
        })),
      });
      console.log(`✅ Saved ${issues.length} legal risks to database`);

      console.log(`📡 Emitting legal event via SSE for room: ${id}`);
      emitLegalEvent(id, {
        roomId: id,
        type: "legal-risk",
        createdAt: new Date().toISOString(),
        ...analyzerResult, // จะได้ { issues: [...] } ตาม format ที่คุณให้มา
      });
      console.log(`📤 Legal event emitted successfully`);

      console.log(`⏰ Setting cooldown for room: ${id}`);
      await redis.set(cooldownKey, Date.now().toString(), "PX", COOLDOWN_MS);
    } else {
      console.log(`ℹ️ No issues found in analyzer result`);
    }

    // clear buffer หลัง analyze
    await redis.del(bufferKey);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Chunk ingest error:", error);
    return NextResponse.json(
      { error: "Failed to process chunk" },
      { status: 500 },
    );
  }
}
