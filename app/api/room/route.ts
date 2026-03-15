import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "crypto";

const ALLOWED_COMPANY_TYPES = ["LIMITED", "PUBLIC_LIMITED"] as const;
const COMPANY_TYPE_LABELS = {
  LIMITED: "บริษัทจำกัด",
  PUBLIC_LIMITED: "บริษัทมหาชนจำกัด",
} as const;

type CompanyType = (typeof ALLOWED_COMPANY_TYPES)[number];

export async function POST(req: Request) {
  const startTime = Date.now();
  let roomId: string | undefined;

  try {
    console.log(`🏁 Room creation started at ${new Date().toISOString()}`);

    // 1️⃣ Parse FormData (to support file upload)
    const formData = await req.formData();
    const companyType = formData.get("companyType") as string | null;
    const meetingType = formData.get("meetingType") as string | null;
    const calledBy = formData.get("calledBy") as string | null;
    const location = formData.get("location") as string | null;
    const agendasRaw = formData.get("agendas") as string | null;
    const startedAt = formData.get("startedAt") as string | null;
    const aoaFile = formData.get("aoaFile") as File | null;

    const agendas = agendasRaw ? JSON.parse(agendasRaw) : [];

    if (!companyType) {
      return NextResponse.json(
        { error: "companyType is required" },
        { status: 400 },
      );
    }

    // Extract PDF text if AOA file is provided
    let aoaContent = "";
    if (aoaFile && aoaFile.size > 0) {
      try {
        console.log(`📄 Processing AOA file: ${aoaFile.name}`);
        const buffer = Buffer.from(await aoaFile.arrayBuffer());
        const { extractText, getDocumentProxy } = await import("unpdf");
        const pdf = await getDocumentProxy(new Uint8Array(buffer));
        const { text, totalPages } = await extractText(pdf, {
          mergePages: true,
        });
        aoaContent = text;
        console.log(
          `✅ Extracted ${totalPages} pages, ${aoaContent.length} characters`,
        );
        console.log("📄 AOA Content:\n", aoaContent);
      } catch (pdfError) {
        console.error("❌ Failed to parse AOA PDF:", pdfError);
        // Continue without AOA content
      }
    }

    // Validate meetingType if provided (accept enum values or Thai labels)
    const MEETING_TYPE_MAP: Record<string, string> = {
      AGM: "AGM",
      EGM: "EGM",
      BOD: "BOD",
      ประชุมสามัญผู้ถือหุ้น: "AGM",
      ประชุมวิสามัญผู้ถือหุ้น: "EGM",
      ประชุมคณะกรรมการ: "BOD",
    };
    let meetingTypeValue = "BOD";
    if (meetingType) {
      const mapped = MEETING_TYPE_MAP[meetingType];
      if (!mapped) {
        return NextResponse.json(
          {
            error: "Invalid meetingType",
            allowed: Object.keys(MEETING_TYPE_MAP),
          },
          { status: 400 },
        );
      }
      meetingTypeValue = mapped;
    }

    // Validate startedAt if provided
    let startedAtValue = new Date();
    if (startedAt) {
      const parsed = new Date(startedAt);
      if (isNaN(parsed.getTime())) {
        return NextResponse.json(
          { error: "Invalid startedAt timestamp" },
          { status: 400 },
        );
      }
      startedAtValue = parsed;
    }

    // Map Thai labels to enum values
    let enumValue: CompanyType;
    if (companyType.includes("บริษัทจำกัด")) {
      enumValue = "LIMITED";
    } else if (companyType.includes("บริษัทมหาชนจำกัด")) {
      enumValue = "PUBLIC_LIMITED";
    } else if (ALLOWED_COMPANY_TYPES.includes(companyType as CompanyType)) {
      enumValue = companyType as CompanyType;
    } else {
      return NextResponse.json(
        {
          error: "Invalid companyType",
          allowed: Object.values(COMPANY_TYPE_LABELS),
        },
        { status: 400 },
      );
    }

    // 2️⃣ Generate IDs
    roomId = randomUUID();
    const threadId = randomUUID();
    const accessToken = randomUUID();

    console.log(`🏗️  Generated room: ${roomId}, thread: ${threadId}`);

    // 3️⃣ Create Room
    await prisma.room.create({
      data: {
        id: roomId,
        threadId,
        accessToken,
        status: "ACTIVE",
        companyType: enumValue,
        meetingType: meetingTypeValue as "AGM" | "EGM" | "BOD",
        calledBy: calledBy || "System",
        location: location || "Not specified",
        agendas: Array.isArray(agendas) ? agendas : [],
        startedAt: startedAtValue,
      },
    });

    console.log(`✅ Room created in database: ${roomId}`);

    // 4️⃣ Create Thread with retry mechanism
    let threadRes;
    let retryCount = 0;
    const maxRetries = 3;
    let roomDeleted = false; // Track if room has been deleted

    while (retryCount < maxRetries) {
      try {
        threadRes = await fetch(`${process.env.LANGGRAPH_URL}/threads`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            thread_id: threadId,
          }),
        });

        if (threadRes.ok) {
          break; // Success, exit retry loop
        }

        const errorText = await threadRes.text();
        console.log(
          `Thread creation attempt ${retryCount + 1} failed:`,
          errorText,
        );

        // If it's a transaction error, retry after delay
        if (
          threadRes.status === 500 &&
          errorText.includes("failed to begin transaction")
        ) {
          retryCount++;
          if (retryCount < maxRetries) {
            console.log(
              `Retrying thread creation in ${retryCount * 1000}ms...`,
            );
            await new Promise((resolve) =>
              setTimeout(resolve, retryCount * 1000),
            );
            continue;
          }
        }

        // For other errors, don't retry - cleanup and throw
        if (!roomDeleted) {
          await prisma.room.delete({ where: { id: roomId } });
          roomDeleted = true;
        }
        throw new Error(`Thread creation failed: ${errorText}`);
      } catch (fetchError) {
        console.log(
          `Thread creation network error attempt ${retryCount + 1}:`,
          fetchError,
        );

        // If it's our own thrown error, re-throw it
        if (
          fetchError instanceof Error &&
          fetchError.message?.includes("Thread creation failed:")
        ) {
          throw fetchError;
        }

        retryCount++;
        if (retryCount >= maxRetries) {
          if (!roomDeleted) {
            await prisma.room.delete({ where: { id: roomId } });
            roomDeleted = true;
          }
          throw new Error(
            `Thread creation failed after ${maxRetries} attempts: ${fetchError}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, retryCount * 1000));
      }
    }

    if (!threadRes || !threadRes.ok) {
      const err = (await threadRes?.text()) || "Unknown error";
      if (!roomDeleted) {
        await prisma.room.delete({ where: { id: roomId } });
        roomDeleted = true;
      }
      throw new Error(
        `Thread creation failed after ${maxRetries} attempts: ${err}`,
      );
    }

    const ANALYSIS_OUTPUT_FORMAT = {
      instruction:
        "รูปแบบผลลัพธ์ที่ต้องแสดง: แยกแต่ละกรณีหรือแต่ละประเด็นอย่างชัดเจน ในแต่ละกรณี ต้องมีข้อมูลดังต่อไปนี้: ระดับความเสี่ยง (ต่ำ/กลาง/สูง), คำอธิบายพฤติการณ์, ฐานกฎหมาย, เหตุผลทางกฎหมาย, ข้อเสนอแนะ, ระดับความเร่งด่วน, และข้อความข้อจำกัด: 'ความเห็นนี้เป็นการประเมินเบื้องต้นในเชิงกระบวนการ ไม่ครอบคลุมข้อเท็จจริงเฉพาะบุคคลหรือเอกสารภายนอก' ผลลัพธ์ต้องแสดงในรูปแบบ JSON เท่านั้น",
      schema: {
        issues: [
          {
            riskLevel: "ต่ำ | กลาง | สูง",
            issueDescription: "",
            legalBasis: {
              type: "มาตรา | หลักเกณฑ์จากเอกสาร | ไม่พบกฎหมายที่เกี่ยวข้อง",
              reference: "",
            },
            legalReasoning: "",
            recommendation: "",
            urgencyLevel: "ต่ำ | กลาง | สูง",
            disclaimer:
              "ความเห็นนี้เป็นการประเมินเบื้องต้นในเชิงกระบวนการ ไม่ครอบคลุมข้อเท็จจริงเฉพาะบุคคลหรือเอกสารภายนอก",
          },
        ],
      },
    };

    console.log(`🧵 Thread created successfully: ${threadId}`);

    // 5️⃣ Create Assistant (ตามที่คุณต้องการ)
    console.log(`🤖 Creating assistant for room: ${roomId}`);
    const assistantRes = await fetch(
      `${process.env.LANGGRAPH_URL}/assistants`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assistant_id: roomId,
          graph_id: "retrieval_agent",
          config: {
            configurable: {
              context: {
                companyType: COMPANY_TYPE_LABELS[enumValue],
                outputFormat: ANALYSIS_OUTPUT_FORMAT,
                meetingType: meetingType,
                calledBy: calledBy,
                agendas: agendas,
                startedAt: startedAt,
                aoaContent: aoaContent, // Extracted PDF text for immediate use
              },
            },
          },
        }),
      },
    );

    if (!assistantRes.ok) {
      const err = await assistantRes.text();
      console.error(`❌ Assistant creation failed for room ${roomId}:`, err);

      // rollback ทั้งหมด
      await prisma.room.delete({ where: { id: roomId } });

      throw new Error(`Assistant creation failed: ${err}`);
    }

    console.log(`🤖 Assistant creation successful for room: ${roomId}`);

    const duration = Date.now() - startTime;
    console.log(
      `🎉 Room creation completed successfully in ${duration}ms: ${roomId}`,
    );

    return NextResponse.json(
      {
        id: roomId,
        roomId,
        threadId,
        accessToken,
        companyType: COMPANY_TYPE_LABELS[enumValue],
      },
      { status: 201 },
    );
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ Create room error after ${duration}ms:`, error);
    console.error(`❌ Room ID: ${roomId || "not created"}`);

    return NextResponse.json(
      {
        error: "Failed to create room",
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

export async function GET(req: Request) {
  try {
    // Get query parameters
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const companyType = searchParams.get("companyType");
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const skip = parseInt(searchParams.get("skip") || "0", 10);

    // Build where clause
    const where: Record<string, string> = {};
    if (status) {
      where.status = status;
    }
    if (companyType) {
      where.companyType = companyType;
    }

    // Get total count
    const total = await prisma.room.count({ where });

    // Get rooms with pagination
    const rooms = await prisma.room.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip,
    });

    return NextResponse.json(
      {
        total,
        count: rooms.length,
        skip,
        limit,
        rooms,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("❌ Get rooms error:", error);

    return NextResponse.json(
      {
        error: "Failed to fetch rooms",
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
