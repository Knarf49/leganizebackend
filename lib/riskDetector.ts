import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import "dotenv/config";

const model = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0,
});

// แปลง enum CompanyType เป็น Thai label
function companyTypeToThai(
  companyType:
    | "LIMITED"
    | "PUBLIC_LIMITED"
    | "บริษัทจำกัด"
    | "บริษัทมหาชนจำกัด",
): "บริษัทจำกัด" | "บริษัทมหาชนจำกัด" {
  const mapping: Record<string, "บริษัทจำกัด" | "บริษัทมหาชนจำกัด"> = {
    LIMITED: "บริษัทจำกัด",
    PUBLIC_LIMITED: "บริษัทมหาชนจำกัด",
    บริษัทจำกัด: "บริษัทจำกัด",
    บริษัทมหาชนจำกัด: "บริษัทมหาชนจำกัด",
  };
  return mapping[companyType] || "บริษัทจำกัด";
}

export async function runRiskDetector(
  buffer: string[],
  companyType:
    | "LIMITED"
    | "PUBLIC_LIMITED"
    | "บริษัทจำกัด"
    | "บริษัทมหาชนจำกัด",
): Promise<boolean> {
  try {
    const transcript = buffer.join("\n");
    // แปลง enum เป็น Thai label
    const companyTypeThai = companyTypeToThai(companyType);

    const systemPrompt = `
Role:
คุณคือผู้เชี่ยวชาญด้านกฎหมายบริษัทในประเทศไทย (Corporate Legal Compliance)

หน้าที่ของคุณคือตรวจสอบสถานการณ์การประชุมที่ได้รับ 
และวิเคราะห์ว่ามีการกระทำที่ฝ่าฝืนกฎหมายหรือไม่

Evaluation Logic:
- หากสถานการณ์ "ฝ่าฝืน" ข้อใดข้อหนึ่ง ให้ตอบ "YES"
- หากสถานการณ์ "ถูกต้อง" ตามเกณฑ์ทั้งหมด ให้ตอบ "NO"
- ตอบเพียงคำเดียวเท่านั้น: YES หรือ NO
`;

    const humanPrompt = `
Task:
วิเคราะห์สถานการณ์ต่อไปนี้ตามเกณฑ์กฎหมาย:

1. ประเภทบริษัท:
${companyTypeThai}

2. องค์ประชุม (Quorum):
- บริษัทจำกัด: อย่างน้อย 2 คน และถือหุ้น ≥ 1/4 ของทุน (มาตรา 1178)
- บริษัทมหาชน: อย่างน้อย 25 คน (หรือกึ่งหนึ่ง) และถือหุ้น ≥ 1/3 (มาตรา 103)

3. การลงมติ (Voting):
- มติปกติ: เสียงข้างมาก
- มติพิเศษ/เรื่องสำคัญ: ≥ 3/4 ของผู้มาประชุม (มาตรา 1194, 107(2))
- ถอดถอนกรรมการมหาชน: 3/4 ของคน + ≥ 1/2 ของหุ้น (มาตรา 76)

4. ส่วนได้เสีย (Conflict of Interest):
- ผู้มีส่วนได้เสียห้ามออกเสียง (มาตรา 1185, มาตรา 33 วรรคสอง)

5. วาระการประชุม (Agenda):
- ต้องระบุในหนังสือนัดประชุม
- ห้ามเพิ่มวาระใหม่ในการประชุมที่เลื่อนมา (มาตรา 1175, 1181)

สถานการณ์:
"""
${transcript}
"""
`;

    const response = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(humanPrompt),
    ]);

    const answer =
      typeof response.content === "string"
        ? response.content.trim().toUpperCase()
        : "";

    return answer.includes("YES");
  } catch (error) {
    console.error("Risk detector error:", error);
    return false; // safe fallback
  }
}
