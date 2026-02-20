import { OpenAI } from "openai";
import { readFileSync } from "fs";

/**
 * Transcribe audio to Thai text using OpenAI Whisper API
 */
export async function transcribeAudio(
  audioPath: string,
  apiKey: string,
): Promise<{
  success: boolean;
  text?: string;
  error?: string;
  language?: string;
}> {
  try {
    console.error("🔄 Initializing OpenAI client...");
    const client = new OpenAI({ apiKey });

    console.error(`🎤 Transcribing audio: ${audioPath}`);

    // Read audio file
    const audioBuffer = readFileSync(audioPath);
    const audioFile = new File(
      [audioBuffer],
      audioPath.split("/").pop() || "audio.webm",
    );

    // Call OpenAI Whisper API
    const transcription = await client.audio.transcriptions.create({
      model: "whisper-1",
      file: audioFile,
      language: "th",
    });

    // Extract text
    const text = transcription.text.trim();
    console.error(`✅ Transcribed: ${text}`);

    return {
      success: true,
      text,
      language: "th",
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`❌ Transcription error: ${errorMsg}`);

    return {
      success: false,
      error: errorMsg,
    };
  }
}

// CLI usage support
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log(
      JSON.stringify({
        success: false,
        error: "Usage: tsx transcribe.ts <audio_file_path> <api_key>",
      }),
    );
    process.exit(1);
  }

  const [audioFile, apiKey] = args;

  transcribeAudio(audioFile, apiKey)
    .then((result) => {
      console.log(JSON.stringify(result));
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      console.log(
        JSON.stringify({
          success: false,
          error: error.message,
        }),
      );
      process.exit(1);
    });
}
