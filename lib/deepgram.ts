import { readFileSync } from "fs";

/**
 * Transcribe audio to Thai text using Deepgram Nova-3 API
 * with speaker diarization support
 */
export async function transcribeWithDeepgram(audioPath: string): Promise<{
  success: boolean;
  text?: string;
  error?: string;
  speakers?: Array<{
    speakerTag: number;
    text: string;
    startTime: number;
    endTime: number;
  }>;
  fullTranscript?: string;
}> {
  try {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      throw new Error(
        "DEEPGRAM_API_KEY environment variable is required. " +
          "Sign up at https://deepgram.com and get your API key.",
      );
    }

    console.error(`🎤 Transcribing audio with Deepgram Nova-3: ${audioPath}`);

    // Read audio file
    const audioBuffer = readFileSync(audioPath);
    const fileSizeMB = audioBuffer.length / (1024 * 1024);
    console.error(`📁 Audio file size: ${fileSizeMB.toFixed(2)} MB`);

    // Deepgram API endpoint with Nova-2 model and Thai language
    // Nova-3 does NOT support Thai — must use nova-2 (general tier) for th
    // https://developers.deepgram.com/docs/models-languages-overview
    const url = new URL("https://api.deepgram.com/v1/listen");
    url.searchParams.set("model", "nova-2");
    url.searchParams.set("language", "th");
    url.searchParams.set("punctuate", "true");
    url.searchParams.set("diarize", "true"); // Enable speaker diarization
    url.searchParams.set("smart_format", "true");
    url.searchParams.set("utterances", "true"); // Get utterances for better speaker segments

    console.error("🔄 Sending request to Deepgram API (Nova-3)...");

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "audio/wav",
      },
      body: audioBuffer,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Deepgram API error (${response.status}): ${errorText}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await response.json();

    // Extract transcript and speaker information
    const channel = result?.results?.channels?.[0];
    if (!channel || !channel.alternatives?.[0]) {
      console.error("⚠️ No transcription results returned");
      return {
        success: false,
        error: "No transcription results",
      };
    }

    const alternative = channel.alternatives[0];
    const fullTranscript = alternative.transcript || "";

    // Build speaker segments from utterances (preferred) or words.
    // NOTE: Deepgram puts utterances at results.utterances (top-level),
    // NOT inside channel.alternatives[0].
    const speakerSegments: Array<{
      speakerTag: number;
      text: string;
      startTime: number;
      endTime: number;
    }> = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const utterances: any[] = result?.results?.utterances ?? [];

    if (utterances.length > 0) {
      for (const utterance of utterances) {
        speakerSegments.push({
          speakerTag: utterance.speaker ?? 0,
          text: utterance.transcript || "",
          startTime: utterance.start || 0,
          endTime: utterance.end || 0,
        });
      }
    } else if (alternative.words && alternative.words.length > 0) {
      // Fallback: build segments from words
      let currentSpeaker = -1;
      let currentText = "";
      let startTime = 0;
      let endTime = 0;

      for (const wordInfo of alternative.words) {
        const speakerTag = wordInfo.speaker ?? 0;
        const word = wordInfo.word || "";
        const wordStart = wordInfo.start || 0;
        const wordEnd = wordInfo.end || 0;

        if (speakerTag !== currentSpeaker && currentSpeaker !== -1) {
          speakerSegments.push({
            speakerTag: currentSpeaker,
            text: currentText.trim(),
            startTime,
            endTime,
          });
          currentText = "";
        }

        if (currentText === "") startTime = wordStart;
        currentSpeaker = speakerTag;
        currentText += (currentText ? " " : "") + word;
        endTime = wordEnd;
      }

      if (currentText) {
        speakerSegments.push({
          speakerTag: currentSpeaker,
          text: currentText.trim(),
          startTime,
          endTime,
        });
      }
    }

    const uniqueSpeakers = new Set(speakerSegments.map((s) => s.speakerTag))
      .size;

    console.error(`✅ Transcribed: ${fullTranscript}`);
    console.error(`👥 Identified ${uniqueSpeakers} speakers`);

    return {
      success: true,
      text: fullTranscript,
      speakers: speakerSegments,
      fullTranscript,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`❌ Deepgram transcription error: ${errorMsg}`);

    return {
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Format transcription results with speaker labels for display
 */
export function formatTranscriptWithSpeakers(
  speakers: Array<{
    speakerTag: number;
    text: string;
    startTime: number;
    endTime: number;
  }>,
): string {
  return speakers
    .map((segment) => {
      const time = new Date(segment.startTime * 1000)
        .toISOString()
        .substring(11, 19);
      return `[${time}] ผู้พูด ${segment.speakerTag + 1}: ${segment.text}`;
    })
    .join("\n");
}
