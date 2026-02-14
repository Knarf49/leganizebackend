type LegalAnalyzeInput = {
  roomId: string;
  threadId: string;
  transcript: string[];
};

export async function runRiskAnalyzer({
  roomId,
  threadId,
  transcript,
}: LegalAnalyzeInput) {
  const url = `${process.env.LANGGRAPH_URL}/threads/${threadId}/runs/wait`;

  // รวม transcript chunks เป็น message เดียว
  const combinedTranscript = transcript.join(" ");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      assistant_id: roomId,
      checkpoint: {
        thread_id: threadId,
      },
      input: {
        messages: [
          {
            role: "user",
            content: `กรุณาวิเคราะห์ความเสี่ยงทางกฎหมายจากการประชุมนี้: ${combinedTranscript}`,
          },
        ],
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Legal analyze failed: ${errText}`);
  }

  const data = await res.json();

  // Debug log to see actual response structure
  console.log("LangGraph API Response:", JSON.stringify(data, null, 2));

  // Validate response structure
  if (!data.messages || !Array.isArray(data.messages)) {
    throw new Error(
      `Invalid response format. Expected messages array but got: ${JSON.stringify(data)}`,
    );
  }

  const aiMessages = data.messages.filter((msg: any) => msg.type === "ai");

  if (aiMessages.length === 0) {
    throw new Error("No AI response found");
  }

  const latestAIMessage = aiMessages[aiMessages.length - 1];

  try {
    let content = latestAIMessage.content;

    // Extract JSON from markdown code blocks
    const jsonMatch = content.match(/```json\s*\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      content = jsonMatch[1];
    }

    console.log("Parsing JSON content:", content);
    return JSON.parse(content);
  } catch (error) {
    console.error("JSON parse error:", error);
    console.error("Raw content:", latestAIMessage.content);
    // ถ้าไม่ใช่ JSON ก็ return text ปกติ
    return latestAIMessage.content;
  }
}
