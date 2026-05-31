import { NextRequest, NextResponse } from "next/server";

const ASR_URL = process.env.ASR_SERVICE_URL ?? "http://localhost:8000";

// GET /api/enroll — list enrolled speakers
export async function GET() {
  const res = await fetch(`${ASR_URL}/speakers`);
  const data = await res.json();
  return NextResponse.json(data);
}

// POST /api/enroll — enroll a new speaker
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const name = formData.get("name") as string | null;
  const audio = formData.get("audio") as File | null;

  if (!name || !audio) {
    return NextResponse.json({ error: "name and audio required" }, { status: 400 });
  }

  const asrForm = new FormData();
  asrForm.append("name", name);
  asrForm.append("audio", audio, audio.name);

  const res = await fetch(`${ASR_URL}/enroll`, { method: "POST", body: asrForm });
  const data = await res.json();

  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  return NextResponse.json(data);
}

// DELETE /api/enroll?name=xxx — remove a speaker
export async function DELETE(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name");
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  const res = await fetch(`${ASR_URL}/speakers/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  const data = await res.json();

  return NextResponse.json(data, { status: res.status });
}
