"use client";
import { useState } from "react";
import Markdown from "react-markdown";
export default function AskPage() {
  const [message, setMessage] = useState("");
  const [response, setResponse] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.SubmitEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      const res = await fetch("https://leganize.onrender.com/runs/wait", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          assistant_id: "b12faf45-1d31-5322-bb04-0c6c49ace86b",
          input: {
            messages: [
              {
                role: "user",
                content: message,
              },
            ],
          },
        }),
      });

      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }

      const data = await res.json();
      setResponse(data);
    } catch (err: any) {
      setError(err.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const aiAnswer = Array.isArray(response?.messages)
    ? response.messages.find((msg: any) => msg?.type === "ai")?.content
    : null;
  const retrievedDocs = Array.isArray(response?.retrievedDocs)
    ? response.retrievedDocs
    : null;
  const responseView = response
    ? {
        aiAnswer: aiAnswer ?? "",
        retrievedDocs: retrievedDocs ?? [],
      }
    : null;

  return (
    <div className="max-w-xl mx-auto p-6">
      <h1 className="text-xl font-bold mb-4">ลองถามกฏหมายกับ AI</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <textarea
          className="w-full border p-2 rounded"
          rows={4}
          placeholder="Enter your message..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
        />

        <button
          type="submit"
          className="bg-black text-white px-4 py-2 rounded"
          disabled={loading}
        >
          {loading ? "Running..." : "Submit"}
        </button>
      </form>

      {error && <div className="mt-4 text-red-600">❌ {error}</div>}

      {responseView && (
        <>
          <pre className="mt-6 bg-gray-100 p-4 rounded text-sm overflow-auto whitespace-pre-wrap">
            <Markdown>{responseView.aiAnswer}</Markdown>
          </pre>
          <pre className="mt-4 bg-gray-100 p-4 rounded text-sm overflow-auto">
            {JSON.stringify(responseView.retrievedDocs, null, 2)}
          </pre>
        </>
      )}
    </div>
  );
}
