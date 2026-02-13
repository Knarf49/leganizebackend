import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "crypto";
import { context } from "langchain";

const ALLOWED_COMPANY_TYPES = ["LIMITED", "PUBLIC_LIMITED"] as const;
const COMPANY_TYPE_LABELS = {
  LIMITED: "บริษัทจำกัด",
  PUBLIC_LIMITED: "บริษัทมหาชนจำกัด",
} as const;

type CompanyType = (typeof ALLOWED_COMPANY_TYPES)[number];

export async function POST(req: Request) {
  try {
    // 1️⃣ Parse body
    const body = await req.json();
    const { companyType } = body as { companyType?: string };

    if (!companyType) {
      return NextResponse.json(
        { error: "companyType is required" },
        { status: 400 },
      );
    }

    // Map Thai labels to enum values
    let enumValue: CompanyType;
    if (companyType === "บริษัทจำกัด") {
      enumValue = "LIMITED";
    } else if (companyType === "บริษัทมหาชนจำกัด") {
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
    const roomId = randomUUID();
    const threadId = randomUUID();
    const accessToken = randomUUID();

    // 3️⃣ Create Room
    const room = await prisma.room.create({
      data: {
        id: roomId,
        threadId,
        accessToken,
        status: "ACTIVE",
        companyType: enumValue,
      },
    });

    // 4️⃣ Create Thread
    const threadRes = await fetch(`${process.env.LANGGRAPH_URL}/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        thread_id: threadId,
      }),
    });

    if (!threadRes.ok) {
      const err = await threadRes.text();
      await prisma.room.delete({ where: { id: roomId } });
      throw new Error(`Thread creation failed: ${err}`);
    }

    // 5️⃣ Create Assistant (ตามที่คุณต้องการ)
    const assistantRes = await fetch(
      `${process.env.LANGGRAPH_URL}/assistants`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assistant_id: roomId,
          graph_id: "retrieval_agent",
          context: {
            companyType: companyType,
          },
        }),
      },
    );

    if (!assistantRes.ok) {
      const err = await assistantRes.text();

      // rollback ทั้งหมด
      await prisma.room.delete({ where: { id: roomId } });

      throw new Error(`Assistant creation failed: ${err}`);
    }

    return NextResponse.json(
      {
        roomId,
        threadId,
        accessToken,
        companyType: COMPANY_TYPE_LABELS[enumValue],
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Create room error:", error);

    return NextResponse.json(
      { error: "Failed to create room" },
      { status: 500 },
    );
  }
}
