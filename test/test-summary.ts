import "dotenv/config";
import { callAgentForSummary } from "../lib/agentSummary";
import { prisma } from "../lib/prisma";

/**
 * Test script to generate summary using LangChain LLM
 * This will fix typos and summarize the transcript
 */

const TEST_ROOM_ID = "test-room-" + Date.now();

// Sample transcript with typical transcription errors
const TEST_TRANSCRIPT = `
ต้องมี 2 เงินไขก็คือ 1 ถ้าเดี๋ยวคุณจะเลิกตั้งนะ คราดแสงคุณไม่สามารถที่จะย้อนกลับบอกได้ว่าคุณโปรดอะไร 
และก็เป็นสาเหตุว่าทำไมมาถึงภิกฎหมายวิลาร์ที่คุณถ่ายรูปกับบัตรเลิกตั้งที่กาแล้ว 
เพราะว่าตามคุณหมายแ้วน่ะครับ นี้ คราดนี้คือ 1 และก็ให้เซอร์เบอร์มาดูนะครับ 
ว่านี่คือประติบประเทศเซอร์เบอร์อะไร นับทีละใบจดคะเนนให้ทุกคนดูนะครับ แล้วก็รวมกันได้
`;

async function testSummarize() {
  console.log("🚀 Starting LangChain Summary Test");
  console.log("=".repeat(60));
  console.log(`Test Room ID: ${TEST_ROOM_ID}`);
  console.log(`Transcript length: ${TEST_TRANSCRIPT.trim().length} characters`);
  console.log("=".repeat(60));

  try {
    // First, create a test room in database
    console.log("\n📦 Creating test room in database...");
    await prisma.room.create({
      data: {
        id: TEST_ROOM_ID,
        accessToken: "test-token-" + Date.now(),
        threadId: "test-thread-" + Date.now(),
        status: "ACTIVE",
        companyType: "LIMITED",
      },
    });
    console.log("✅ Test room created");

    console.log("\n📝 Generating summary with LangChain...");
    console.log("   - Fixing transcription errors");
    console.log("   - Summarizing content");
    
    // Call the summary function (it will update the database)
    await callAgentForSummary(TEST_ROOM_ID, TEST_TRANSCRIPT);

    // Fetch the updated room to show the summary
    const updatedRoom = await prisma.room.findUnique({
      where: { id: TEST_ROOM_ID },
      select: {
        finalSummary: true,
        status: true,
        endedAt: true,
      },
    });

    console.log("\n✅ Summary generated successfully!");
    console.log("=".repeat(60));
    console.log("\n📄 **Generated Summary:**\n");
    console.log(updatedRoom?.finalSummary || "No summary found");
    console.log("\n" + "=".repeat(60));
    
    console.log("\n📊 Room Status:");
    console.log(`   Status: ${updatedRoom?.status}`);
    console.log(`   Ended At: ${updatedRoom?.endedAt?.toISOString()}`);
    
  } catch (error) {
    console.error("\n❌ Test failed:");
    if (error instanceof Error) {
      console.error("Error:", error.message);
      console.error("Stack:", error.stack);
    } else {
      console.error(error);
    }
    process.exit(1);
  } finally {
    // Cleanup: delete test room
    try {
      await prisma.room.delete({
        where: { id: TEST_ROOM_ID },
      });
      console.log("\n🧹 Test room cleaned up");
    } catch (cleanupError) {
      console.error("Warning: Failed to cleanup test room:", cleanupError);
    }
    
    await prisma.$disconnect();
  }
}

// Run the test
testSummarize();
