type LegalAnalyzeInput = {
  roomId: string;
  transcript: string[];
  threadId: string;
};

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 600_000; // 10 minutes max

export async function runRiskAnalyzer({
  roomId,
  transcript,
}: LegalAnalyzeInput) {
  const baseUrl = process.env.LANGGRAPH_URL;
  const combinedTranscript = transcript.join(" ");

  // 1️⃣ Create a temporary thread for this run
  const threadRes = await fetch(`${baseUrl}/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(10_000),
  });

  if (!threadRes.ok) {
    const errText = await threadRes.text();
    throw new Error(`Failed to create thread: ${errText}`);
  }

  const { thread_id } = await threadRes.json();
  console.log(`🧵 Created temporary thread: ${thread_id}`);

  try {
    // 2️⃣ Submit background run on that thread
    const submitRes = await fetch(`${baseUrl}/threads/${thread_id}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assistant_id: roomId,
        input: {
          messages: [{ role: "user", content: combinedTranscript }],
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text();
      throw new Error(`Legal analyze submit failed: ${errText}`);
    }

    const { run_id } = await submitRes.json();
    console.log(
      `🚀 Risk analyzer run started: ${run_id} (thread: ${thread_id})`,
    );

    // 3️⃣ Poll until done
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const pollRes = await fetch(
        `${baseUrl}/threads/${thread_id}/runs/${run_id}`,
        { signal: AbortSignal.timeout(10_000) },
      );

      if (!pollRes.ok) {
        const errText = await pollRes.text();
        throw new Error(`Failed to poll run status: ${errText}`);
      }

      const runData = await pollRes.json();
      const status: string = runData.status;
      console.log(`⏳ Run ${run_id} status: ${status}`);

      if (status === "error" || status === "interrupted") {
        throw new Error(`Run failed with status: ${status}`);
      }

      if (status !== "success") continue;

      // 4️⃣ Fetch thread state for output
      const stateRes = await fetch(`${baseUrl}/threads/${thread_id}/state`, {
        signal: AbortSignal.timeout(10_000),
      });

      if (!stateRes.ok) {
        const errText = await stateRes.text();
        throw new Error(`Failed to fetch thread state: ${errText}`);
      }

      const stateData = await stateRes.json();
      console.log(
        "LangGraph state response:",
        JSON.stringify(stateData, null, 2),
      );

      const messages: { type: string; content: string }[] =
        stateData?.values?.messages ?? [];

      const aiMessages = messages.filter((msg) => msg.type === "ai");
      if (aiMessages.length === 0) throw new Error("No AI response found");

      const latestAIMessage = aiMessages[aiMessages.length - 1];

      try {
        let content = latestAIMessage.content;
        const jsonMatch = content.match(/```json\s*\n([\s\S]*?)\n```/);
        if (jsonMatch) content = jsonMatch[1];
        console.log("Parsing JSON content:", content);
        return JSON.parse(content);
      } catch (error) {
        console.error("JSON parse error:", error);
        console.error("Raw content:", latestAIMessage.content);
        return latestAIMessage.content;
      }
    }

    throw new Error(`Risk analyzer timed out after ${POLL_TIMEOUT_MS / 1000}s`);
  } finally {
    // 5️⃣ Always clean up the temporary thread
    fetch(`${baseUrl}/threads/${thread_id}`, { method: "DELETE" }).catch((e) =>
      console.error(`⚠️ Failed to delete thread ${thread_id}:`, e),
    );
  }
}
