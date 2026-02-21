import "dotenv/config";

/**
 * Test script to send a sample transcript to the summarize agent
 * and log the response
 */

const AGENT_API_URL = "https://leganize.onrender.com/runs";
const TEST_ROOM_ID = "test-room-" + Date.now();

// Sample transcript for testing
const TEST_TRANSCRIPT = `
ประธาน: เริ่มการประชุมคณะกรรมการบริษัท ABC จำกัด ครั้งที่ 1/2567
วันนี้เรามีวาระสำคัญคือการพิจารณาการเพิ่มทุนจดทะเบียน

กรรมการ A: ผมเห็นด้วยกับการเพิ่มทุน แต่อยากให้พิจารณาสัดส่วนการถือหุ้นของผู้ถือหุ้นเดิมด้วย

กรรมการ B: การเพิ่มทุนครั้งนี้จำเป็นสำหรับการขยายธุรกิจไปยังต่างจังหวัด
เราควรเพิ่มทุนจาก 1 ล้านบาท เป็น 5 ล้านบาท

ประธาน: มีใครคัดค้านหรือไม่? ถ้าไม่มีเราจะลงมติ

กรรมการ C: ผมเห็นด้วย แต่ขอให้จัดทำรายงานผลกระทบทางการเงินมาแสดงด้วย

ประธาน: มติเป็นเอกฉันท์ อนุมัติการเพิ่มทุนจดทะเบียน
ให้ฝ่ายกฎหมายดำเนินการจดทะเบียนกับกรมพัฒนาธุรกิจการค้าภายใน 14 วัน
`;

// Get webhook URL for local testing
const WEBHOOK_URL =
  process.env.NODE_ENV === "production"
    ? "https://leganize.onrender.com/api/webhook/summary"
    : "http://localhost:3000/api/webhook/summary";

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
    configurable: Record<string, unknown>;
  };
  context: Record<string, unknown>;
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

async function testAgentSummary() {
  console.log("🚀 Starting Agent Summary Test");
  console.log("=".repeat(50));
  console.log(`Test Room ID: ${TEST_ROOM_ID}`);
  console.log(`Webhook URL: ${WEBHOOK_URL}`);
  console.log(`Agent API URL: ${AGENT_API_URL}`);
  console.log("=".repeat(50));

  const payload: AgentPayload = {
    assistant_id: "fe096781-5601-53d2-b2f6-0d3403f7e9ca",
    input: {
      transcript: TEST_TRANSCRIPT,
      roomId: TEST_ROOM_ID,
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
      roomId: TEST_ROOM_ID,
    },
    config: {
      tags: ["summary", "test"],
      recursion_limit: 1,
      configurable: {},
    },
    context: {},
    webhook: WEBHOOK_URL,
    stream_mode: ["values"],
    feedback_keys: [],
    stream_subgraphs: false,
    stream_resumable: false,
    on_completion: "delete",
    on_disconnect: "continue",
    after_seconds: 1,
    checkpoint_during: false,
    durability: "async",
  };

  console.log("\n📤 Sending request to agent...");
  console.log("Payload:", JSON.stringify(payload, null, 2));

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    const response = await fetch(AGENT_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    console.log("\n📥 Response received:");
    console.log("Status:", response.status, response.statusText);
    console.log("Headers:", Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const errorText = await response.text();
      console.error("\n❌ Error Response:");
      console.error(errorText);
      throw new Error(
        `Agent API call failed: ${response.status} ${response.statusText}`,
      );
    }

    const result = await response.json();
    console.log("\n✅ Success! Agent Response:");
    console.log(JSON.stringify(result, null, 2));

    if (result.run_id) {
      console.log(`\n🔗 Run ID: ${result.run_id}`);
      console.log(
        "The agent is processing in the background. Results will be sent to webhook.",
      );
    }

    console.log("\n" + "=".repeat(50));
    console.log("✅ Test completed successfully");
    console.log("=".repeat(50));

    // Note about webhook
    console.log(
      "\n💡 Note: The actual summary will be received via webhook at:",
    );
    console.log(`   ${WEBHOOK_URL}`);
    console.log(
      "   Make sure your server is running to receive the webhook callback.",
    );
  } catch (error) {
    console.error("\n❌ Test failed:");
    if (error instanceof Error) {
      console.error("Error:", error.message);
      console.error("Stack:", error.stack);
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}

// Run the test
testAgentSummary();
