import { prisma } from "@/lib/prisma";

// Access the global transcription queues (declared in websocket.ts)
// No need to re-declare, just use it
const transcriptionQueues =
  (globalThis as any).__transcriptionQueues ??
  new Map<string, { queue: any[]; processing: boolean }>();

// Agent API types
interface AgentPayload {
  assistant_id: string;
  input: {
    transcript: string;
    roomId: string;
  };
  command: {
    update: null;
    resume: null;
    goto: {
      node: string;
      input: null;
    };
  };
  metadata: {
    roomId: string;
  };
  config: {
    tags: string[];
    recursion_limit: number;
    configurable: Record<string, any>;
  };
  context: Record<string, any>;
  webhook: string;
  stream_mode: string[];
  feedback_keys: string[];
  stream_subgraphs: boolean;
  stream_resumable: boolean;
  on_completion: string;
  on_disconnect: string;
  after_seconds: number;
  checkpoint_during: boolean;
  durability: string;
}

/**
 * Call the agent API to generate a summary from the transcribed text
 */
export async function callAgentForSummary(
  roomId: string,
  transcriptText: string,
): Promise<void> {
  try {
    console.log(
      `🤖 Calling agent for room ${roomId}, text length: ${transcriptText.length}`,
    );

    // Get the base URL for webhook
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NODE_ENV === "production"
        ? "https://leganize.onrender.com"
        : "http://localhost:3000";

    const webhookUrl = `${baseUrl}/api/webhook/summary`;

    // Prepare the agent API call
    const agentPayload: AgentPayload = {
      assistant_id: "fe096781-5601-53d2-b2f6-0d3403f7e9ca", // Set this in your environment
      input: {
        transcript: transcriptText,
        roomId: roomId,
      },
      command: {
        update: null,
        resume: null,
        goto: {
          node: "",
          input: null,
        },
      },
      metadata: {
        roomId: roomId,
      },
      config: {
        tags: ["summary"],
        recursion_limit: 1,
        configurable: {},
      },
      context: {},
      webhook: webhookUrl,
      stream_mode: ["values"],
      feedback_keys: [""],
      stream_subgraphs: false,
      stream_resumable: false,
      on_completion: "delete",
      on_disconnect: "continue",
      after_seconds: 1,
      checkpoint_during: false,
      durability: "async",
    };

    console.log(`🌐 Calling agent API with webhook: ${webhookUrl}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    try {
      const response = await fetch("https://leganize.onrender.com/runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(agentPayload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Agent API call failed: ${response.status} ${response.statusText} - ${errorText}`,
        );
      }

      const result = await response.json();
      console.log(`✅ Agent API call initiated for room ${roomId}`, result);

      // Update room status to indicate processing
      await prisma.room.update({
        where: { id: roomId },
        data: {
          status: "ENDED", // Room is ended, processing summary
          endedAt: new Date(),
        },
      });
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  } catch (error) {
    console.error(`❌ Failed to call agent for room ${roomId}:`, error);

    // Update room with error status
    await prisma.room.update({
      where: { id: roomId },
      data: {
        finalSummary: `ข้อผิดพลาด: ไม่สามารถสรุปข้อมูลได้ (${error instanceof Error ? error.message : "Unknown error"})`,
        status: "ENDED",
        endedAt: new Date(),
      },
    });

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

    const checkComplete = async () => {
      const roomQueue = transcriptionQueues.get(roomId);

      if (
        !roomQueue ||
        (roomQueue.queue.length === 0 && !roomQueue.processing)
      ) {
        // Queue is empty and not processing, collect all transcribed text
        try {
          const transcriptChunks = await prisma.transcriptChunk.findMany({
            where: { roomId },
            orderBy: { createdAt: "asc" },
          });

          allTranscribedText = transcriptChunks
            .map((chunk) => chunk.content)
            .join(" ");
          console.log(
            `✅ All transcription complete for room ${roomId}, total text length: ${allTranscribedText.length}`,
          );
          resolve(allTranscribedText);
          return;
        } catch (error) {
          console.error("Error collecting transcribed text:", error);
          resolve("");
          return;
        }
      }

      waitTime += checkInterval;
      if (waitTime >= maxWaitTime) {
        console.log(
          `⏰ Timeout waiting for transcription to complete for room ${roomId}`,
        );
        // Still try to collect whatever text we have
        try {
          const transcriptChunks = await prisma.transcriptChunk.findMany({
            where: { roomId },
            orderBy: { createdAt: "asc" },
          });

          allTranscribedText = transcriptChunks
            .map((chunk) => chunk.content)
            .join(" ");
          resolve(allTranscribedText);
        } catch (error) {
          resolve("");
        }
        return;
      }

      setTimeout(checkComplete, checkInterval);
    };

    checkComplete();
  });
}
