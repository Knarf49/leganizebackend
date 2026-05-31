import { NextRequest, NextResponse } from "next/server";

const ASR_URL = process.env.ASR_SERVICE_URL ?? "http://localhost:8000";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const asrForm = new FormData();
    asrForm.append("audio", file, file.name);

    const res = await fetch(`${ASR_URL}/transcribe`, {
      method: "POST",
      body: asrForm,
    });

    const data = (await res.json()) as {
      text: string;
      speaker: string;
      speaker_confidence: number;
    };

    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    return NextResponse.json({ success: true, text: data.text, speaker: data.speaker });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}
