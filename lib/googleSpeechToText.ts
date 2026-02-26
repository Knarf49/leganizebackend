import { SpeechClient } from "@google-cloud/speech";
import { readFileSync } from "fs";
import * as protos from "@google-cloud/speech/build/protos/protos";

type ISpeechRecognitionAlternative =
  protos.google.cloud.speech.v1.ISpeechRecognitionAlternative;
type IWordInfo = protos.google.cloud.speech.v1.IWordInfo;

/**
 * Transcribe audio to Thai text using Google Cloud Speech-to-Text API
 * with speaker diarization support
 */
export async function transcribeWithGoogleSTT(audioPath: string): Promise<{
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
    console.error("🔄 Initializing Google Cloud Speech client...");

    // Initialize Google Cloud Speech client
    // Credentials should be set via GOOGLE_APPLICATION_CREDENTIALS env variable
    const client = new SpeechClient();

    console.error(`🎤 Transcribing audio: ${audioPath}`);

    // Read audio file
    const audioBuffer = readFileSync(audioPath);
    const audioBytes = audioBuffer.toString("base64");

    // Configure request with speaker diarization
    const request = {
      audio: {
        content: audioBytes,
      },
      config: {
        encoding: "LINEAR16" as const,
        sampleRateHertz: 16000,
        languageCode: "th-TH", // Thai language
        alternativeLanguageCodes: ["en-US"], // Support English as alternative
        enableAutomaticPunctuation: true,
        enableWordTimeOffsets: true,
        // Enable speaker diarization
        diarizationConfig: {
          enableSpeakerDiarization: true,
          minSpeakerCount: 2,
          maxSpeakerCount: 6,
        },
        model: "latest_long", // Use latest_long for better accuracy
        useEnhanced: true,
      },
    };

    console.error("🔄 Sending request to Google Cloud Speech-to-Text...");

    // Perform speech recognition
    const [response] = await client.recognize(request);

    if (!response.results || response.results.length === 0) {
      console.error("⚠️ No transcription results returned");
      return {
        success: false,
        error: "No transcription results",
      };
    }

    // Extract transcription with speaker information
    const fullTranscript: string[] = [];
    const speakerSegments: Array<{
      speakerTag: number;
      text: string;
      startTime: number;
      endTime: number;
    }> = [];

    // Process results with speaker diarization
    for (const result of response.results) {
      if (!result.alternatives || result.alternatives.length === 0) continue;

      const alternative = result
        .alternatives[0] as ISpeechRecognitionAlternative;
      const transcript = alternative.transcript || "";

      fullTranscript.push(transcript);

      // Extract speaker information from words
      if (alternative.words) {
        let currentSpeaker = -1;
        let currentText = "";
        let startTime = 0;
        let endTime = 0;

        for (const wordInfo of alternative.words as IWordInfo[]) {
          const speakerTag = wordInfo.speakerTag ?? 0;
          const word = wordInfo.word || "";
          const wordStart =
            Number(wordInfo.startTime?.seconds || 0) +
            (wordInfo.startTime?.nanos || 0) / 1e9;
          const wordEnd =
            Number(wordInfo.endTime?.seconds || 0) +
            (wordInfo.endTime?.nanos || 0) / 1e9;

          if (speakerTag !== currentSpeaker && currentSpeaker !== -1) {
            // Speaker changed, save previous segment
            speakerSegments.push({
              speakerTag: currentSpeaker,
              text: currentText.trim(),
              startTime,
              endTime,
            });
            currentText = "";
          }

          if (currentText === "") {
            startTime = wordStart;
          }

          currentSpeaker = speakerTag;
          currentText += (currentText ? " " : "") + word;
          endTime = wordEnd;
        }

        // Save last segment
        if (currentText) {
          speakerSegments.push({
            speakerTag: currentSpeaker,
            text: currentText.trim(),
            startTime,
            endTime,
          });
        }
      }
    }

    const text = fullTranscript.join(" ").trim();

    console.error(`✅ Transcribed: ${text}`);
    console.error(
      `👥 Identified ${new Set(speakerSegments.map((s) => s.speakerTag)).size} speakers`,
    );

    return {
      success: true,
      text,
      speakers: speakerSegments,
      fullTranscript: text,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`❌ Google STT transcription error: ${errorMsg}`);

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
        .substr(11, 8);
      return `[${time}] ผู้พูด ${segment.speakerTag + 1}: ${segment.text}`;
    })
    .join("\n");
}
