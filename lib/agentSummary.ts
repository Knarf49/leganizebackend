import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

// Access the global transcription queues (declared in websocket.ts)
const transcriptionQueues =
  (globalThis as any).__transcriptionQueues ??
  new Map<string, { queue: any[]; processing: boolean }>();

const SUMMARIZE_PROMPT = `คุณคือผู้ช่วยสรุปการประชุมที่มีความเชี่ยวชาญด้านกฎหมายบริษัท

งานของคุณคือ:
1. แก้ไขคำผิดจากการ transcribe เสียงเป็นข้อความ (เช่น "เงินไข่" แก้เป็น "อย่างไร", "คราดแสง" แก้เป็น "คะแนนเสียง", "เลิกตั้ง" แก้เป็น "เลือกตั้ง")
2. สรุปเนื้อหาการประชุมอย่างชัดเจนและกระชับ
3. เน้นประเด็นสำคัญ เช่น วาระการประชุม มติที่ได้ ผู้เข้าร่วม เนื้อหาที่ประชุม และแผนงานต่อไป

รูปแบบการสรุป:
---
**สรุปการประชุม**

**หัวข้อหลัก:**
- [วาระสำคัญ]

**รายละเอียด:**
[สรุปเนื้อหาหลักที่ถูกต้องและชัดเจน]

**มติ/ข้อสรุป:**
- [มติหรือข้อตกลงที่ได้]

**การดำเนินการต่อไป:**
- [แผนงานหรือสิ่งที่ต้องทำต่อไป]
---

กรุณาสรุปข้อความต่อไปนี้:`;

/**
 * Generate summary using LangChain LLM directly
 */
export async function callAgentForSummary(
  roomId: string,
  transcriptText: string,
): Promise<void> {
  try {
    console.log(
      `🤖 Generating summary for room ${roomId}, text length: ${transcriptText.length}`,
    );

    if (!transcriptText || transcriptText.trim().length === 0) {
      throw new Error("No transcript text to summarize");
    }

    // Initialize OpenAI Chat Model
    const model = new ChatOpenAI({
      modelName: "gpt-4", // หรือใช้ "gpt-4" สำหรับผลลัพธ์ดีกว่า
      temperature: 0.3, // ต่ำหน่อยเพื่อให้ได้ผลลัพธ์ที่สม่ำเสมอ
      openAIApiKey: process.env.OPENAI_API_KEY,
    });

    console.log(`📝 Calling LLM to fix typos and summarize...`);

    // Call LLM with system and user messages
    const messages = [
      new SystemMessage(SUMMARIZE_PROMPT),
      new HumanMessage(transcriptText),
    ];

    const response = await model.invoke(messages);
    const summaryText = response.content as string;

    console.log(
      `✅ Summary generated for room ${roomId}, length: ${summaryText.length}`,
    );

    // Update room with final summary
    await prisma.room.update({
      where: { id: roomId },
      data: {
        finalSummary: summaryText,
        status: "ENDED",
        endedAt: new Date(),
      },
    });

    console.log(`✅ Room ${roomId} updated with summary`);
  } catch (error) {
    console.error(`❌ Failed to generate summary for room ${roomId}:`, error);

    // Update room with error status
    await prisma.room.update({
      where: { id: roomId },
      data: {
        finalSummary: `ข้อผิดพลาด: ไม่สามารถสรุปข้อมูลได้\n\nรายละเอียด: ${error instanceof Error ? error.message : "Unknown error"}\n\nข้อความต้นฉบับ:\n${transcriptText}`,
        status: "ENDED",
        endedAt: new Date(),
      },
    });

    throw error;
    throw error;
  }
}

/**
 * Wait for all transcription queues to finish for a specific room
 */
export async function waitForTranscriptionComplete(
  roomId: string,
): Promise<string> {
  return new Promise((resolve) => {
    const maxWaitTime = 30000; // 30 seconds max wait
    const checkInterval = 500; // Check every 500ms
    let waitTime = 0;
    let allTranscribedText = "";

    const fetchFromDB = async () => {
      const dbChunks = await prisma.transcriptChunk.findMany({
        where: { roomId },
        orderBy: { createdAt: "asc" },
      });
      return dbChunks
        .map((c) => c.content)
        .join(" ")
        .trim();
    };

    const checkComplete = async () => {
      const roomQueue = transcriptionQueues.get(roomId);

      if (
        !roomQueue ||
        (roomQueue.queue.length === 0 && !roomQueue.processing)
      ) {
        // Queue is empty — read from DB instead of Redis for better consistency
        allTranscribedText = await fetchFromDB();

        // Also cleanup Redis just in case
        const redisKey = `transcript:${roomId}`;
        await redis.del(redisKey);

        console.log(
          `✅ All transcription complete for room ${roomId}, total text length: ${allTranscribedText.length} from DB`,
        );
        resolve(allTranscribedText);
        return;
      }

      waitTime += checkInterval;
      if (waitTime >= maxWaitTime) {
        console.log(
          `⏰ Timeout waiting for transcription to complete for room ${roomId}`,
        );
        allTranscribedText = await fetchFromDB();

        const redisKey = `transcript:${roomId}`;
        await redis.del(redisKey);

        resolve(allTranscribedText);
        return;
      }

      setTimeout(checkComplete, checkInterval);
    };

    checkComplete();
  });
}
