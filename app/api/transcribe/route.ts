import { NextRequest, NextResponse } from "next/server";
import { mkdirSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    console.log(
      `🎤 [Transcribe API] Received file: ${file.name}, size: ${file.size}`,
    );

    // Create temp file
    const tempDir = join(process.cwd(), "tmp");
    const tempPath = join(tempDir, `audio_${Date.now()}.webm`);

    // Ensure temp directory exists
    try {
      mkdirSync(tempDir, { recursive: true });
    } catch (e) {
      // dir might already exist
    }

    // Save uploaded file to temp location
    const buffer = await file.arrayBuffer();
    writeFileSync(tempPath, Buffer.from(buffer));
    console.log(`✅ Saved temp file: ${tempPath}`);

    try {
      // Call Python transcribe script with API key
      console.log(`🔄 Calling Python transcribe script...`);
      const pythonPath = join(process.cwd(), ".venv", "Scripts", "python");
      const scriptPath = join(process.cwd(), "lib", "transcribe.py");
      const openaiApiKey = process.env.OPENAI_API_KEY;

      if (!openaiApiKey) {
        throw new Error("OPENAI_API_KEY not set in environment");
      }

      const output = execSync(
        `"${pythonPath}" "${scriptPath}" "${tempPath}" "${openaiApiKey}"`,
        {
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        },
      );

      console.log(`📋 Python output: ${output}`);

      // Parse result
      const result = JSON.parse(output);

      if (result.success) {
        console.log(`✅ Transcription successful: ${result.text}`);
        return NextResponse.json({
          success: true,
          text: result.text,
          language: result.language,
        });
      } else {
        console.error(`❌ Transcription failed: ${result.error}`);
        return NextResponse.json(
          { error: result.error || "Transcription failed" },
          { status: 500 },
        );
      }
    } finally {
      // Clean up temp file
      try {
        unlinkSync(tempPath);
        console.log(`🗑️ Cleaned up temp file`);
      } catch (e) {
        console.error(`Failed to delete temp file:`, e);
      }
    }
  } catch (error) {
    console.error(`❌ [Transcribe API] Error:`, error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
