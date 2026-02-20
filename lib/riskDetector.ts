import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import "dotenv/config";
import type { CompanyType } from "@/generated/prisma/enums";

const model = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0,
});

export type CompanyTypeInput = CompanyType | "บริษัทจำกัด" | "บริษัทมหาชนจำกัด";

// แปลง enum CompanyType เป็น Thai label
function companyTypeToThai(
  companyType: CompanyTypeInput,
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
  companyType: CompanyTypeInput,
): Promise<boolean> {
  try {
    const transcript = buffer.join("\n");
    // แปลง enum เป็น Thai label
    const companyTypeThai = companyTypeToThai(companyType);

    const systemPrompt = `
    บทบาท:
    คุณคือผู้ประเมินการปฏิบัติตามกฎหมายบริษัทของประเทศไทย
    หน้าที่ของคุณคือประเมินว่า "สถานการณ์การประชุมบริษัท" ที่ได้รับ
    มีความเสี่ยงหรือฝ่าฝืนกฎหมายหรือไม่

    หลักเกณฑ์การพิจารณา:

    1. องค์ประชุม (Quorum)
    - บริษัทจำกัด: ≥ 2 คน และถือหุ้นรวม ≥ 1/4 ของทุน (มาตรา 1178)
    - บริษัทมหาชน: ≥ 25 คน (หรือ ≥ กึ่งหนึ่ง) และถือหุ้นรวม ≥ 1/3 (มาตรา 103)

    2. การลงมติ (Voting)
    - มติธรรมดา: เสียงข้างมาก
    - มติพิเศษ/เรื่องสำคัญ: ≥ 3/4 ของผู้มาประชุม (มาตรา 1194, 107(2))
    - ถอดถอนกรรมการมหาชน: 3/4 ของคน และ ≥ 1/2 ของหุ้น (มาตรา 76)

    3. ส่วนได้เสีย
    - ผู้มีส่วนได้เสียห้ามออกเสียง (มาตรา 1185, มาตรา 33 วรรคสอง)

    4. วาระการประชุม
    - ต้องระบุในหนังสือนัดประชุม
    - ห้ามเพิ่มวาระใหม่ในการประชุมที่เลื่อนมา (มาตรา 1175, 1181)

    กติกาการตัดสิน:

    - หากฝ่าฝืนข้อใดข้อหนึ่ง → YES
    - หากถูกต้องตามกฎหมายทั้งหมด → NO
    - หากไม่เกี่ยวข้องกับการประชุมบริษัท → NO
    - หากข้อมูลไม่เพียงพอ → NO

    ข้อบังคับการตอบ (สำคัญมาก):

    - ต้องตอบเพียงคำเดียวเท่านั้น
    - อนุญาตให้ตอบได้แค่ YES หรือ NO
    - ห้ามอธิบาย
    - ห้ามสรุป
    - ห้ามใส่ข้อความอื่นใดเพิ่มเติม
    `;

    const humanPrompt = `
      ประเภทบริษัท:
      ${companyTypeThai}

      สถานการณ์การประชุม:
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

    return answer === "YES";
  } catch (error) {
    console.error("Risk detector error:", error);
    return false; // safe fallback
  }
}
