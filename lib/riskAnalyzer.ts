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
        transcript,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Legal analyze failed: ${errText}`);
  }

  const data = await res.json();

  const aiMessages = data.messages.filter((msg: any) => msg.type === "ai");

  if (aiMessages.length === 0) {
    throw new Error("No AI response found");
  }

  const latestAIMessage = aiMessages[aiMessages.length - 1];

  try {
    return JSON.parse(latestAIMessage.content);
  } catch {
    // ถ้าไม่ใช่ JSON ก็ return text ปกติ
    return latestAIMessage.content;
  }
}
