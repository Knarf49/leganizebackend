import { runRiskDetector } from "../lib/riskDetector";

async function testRiskDetector() {
  try {
    console.log("🧪 Testing riskDetector...");

    // Test 1: ทดสอบกับข้อมูล hardcoded
    const result1 = await runRiskDetector(["สวัสดีครับ"], "บริษัทจำกัด");
    console.log("✅ Test 1 Result:", result1);

    // Test 2: ทดสอบกับข้อมูลจริง
    const buffer = ["ลูกค้าต้องการทำสัญญาจำหน่าย", "มีความเสี่ยงด้านการเงิน"];
    const result2 = await runRiskDetector(buffer, "บริษัทจำกัด");
    console.log("✅ Test 2 Result:", result2);
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  }
}

testRiskDetector();
