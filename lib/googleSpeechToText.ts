import { v2 } from "@google-cloud/speech";
import { Storage } from "@google-cloud/storage";
import { readFileSync } from "fs";
import { basename } from "path";
import * as protos from "@google-cloud/speech/build/protos/protos";

// V2 API types
type ISpeechRecognitionResult =
  protos.google.cloud.speech.v2.ISpeechRecognitionResult;
type ISpeechRecognitionAlternative =
  protos.google.cloud.speech.v2.ISpeechRecognitionAlternative;
type IWordInfo = protos.google.cloud.speech.v2.IWordInfo;

/**
 * Transcribe audio to Thai text using Google Cloud Speech-to-Text V2 API
 * with Chirp 3 model and speaker diarization via batchRecognize
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
    const REGION = process.env.GOOGLE_STT_REGION || "us";
    console.error(
      `🔄 Initializing Google Cloud Speech client (V2 API, region: ${REGION})...`,
    );
    // Chirp 3 does NOT support "global"; use "us" or "eu" multi-region, or
    // "asia-southeast1" / "asia-northeast1" (Preview) for Asian deployments.
    const client = new v2.SpeechClient({
      apiEndpoint: `${REGION}-speech.googleapis.com`,
    });

    console.error(`🎤 Transcribing audio: ${audioPath}`);

    // Read audio file
    const audioBuffer = readFileSync(audioPath);
    const fileSizeMB = audioBuffer.length / (1024 * 1024);

    console.error(`📁 Audio file size: ${fileSizeMB.toFixed(2)} MB`);

    // batchRecognize ALWAYS requires a GCS URI — inline content is not supported.
    const bucketName = process.env.GCS_BUCKET_NAME;
    if (!bucketName) {
      throw new Error(
        "GCS_BUCKET_NAME environment variable is required for batchRecognize. " +
          "Please set up a Google Cloud Storage bucket. See GCS_SETUP.md for instructions.",
      );
    }

    console.error("📤 Uploading audio to Google Cloud Storage...");
    const storage = new Storage();
    const bucket = storage.bucket(bucketName);
    const fileName = `audio-transcribe/${Date.now()}-${basename(audioPath)}`;
    const file = bucket.file(fileName);

    await file.save(audioBuffer, {
      metadata: { contentType: "audio/wav" },
    });

    const gcsUri = `gs://${bucketName}/${fileName}`;
    console.error(`✅ Uploaded to GCS: ${gcsUri}`);

    // Schedule deletion after 1 hour
    setTimeout(
      async () => {
        try {
          await file.delete();
          console.error(`🗑️ Deleted temporary GCS file: ${gcsUri}`);
        } catch (err) {
          console.error(`⚠️ Failed to delete GCS file: ${err}`);
        }
      },
      60 * 60 * 1000,
    );

    // Get project ID from credentials
    const projectId = await client.getProjectId();

    // The recognizer path — "_" means use the default inline recognizer
    const recognizer = `projects/${projectId}/locations/${REGION}/recognizers/_`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const batchRequest: any = {
      recognizer,
      config: {
        autoDecodingConfig: {},
        model: "chirp_3",
        languageCodes: ["th-TH"],
        features: {
          enableAutomaticPunctuation: true,
          enableWordTimeOffsets: true,
        },
        // Speaker diarization must be at config level, not inside features
        diarizationConfig: {
          minSpeakerCount: 2,
          maxSpeakerCount: 6,
        },
      },
      files: [{ uri: gcsUri }],
      // Return results inline in the response (no extra GCS output file)
      recognitionOutputConfig: {
        inlineResponseConfig: {},
      },
    };

    console.error(
      "🔄 Sending BatchRecognize request to Google Cloud Speech-to-Text V2 (Chirp 3)...",
    );

    // batchRecognize returns a long-running operation
    const [operation] = await client.batchRecognize(batchRequest);
    console.error("⏳ Waiting for BatchRecognize LRO to complete...");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [batchResponse] = await (operation as any).promise();

    // batchResponse.results is { [gcsUri]: BatchRecognizeFileResult }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resultsMap: Record<string, any> = batchResponse?.results || {};
    let recognitionResults: ISpeechRecognitionResult[] = [];

    for (const fileResult of Object.values(resultsMap)) {
      // Inline results live under inlineResult.results
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fr = fileResult as any;
      recognitionResults =
        (fr?.inlineResult?.results as ISpeechRecognitionResult[]) ||
        (fr?.transcript?.results as ISpeechRecognitionResult[]) ||
        [];
      break; // only one file submitted
    }

    if (recognitionResults.length === 0) {
      console.error("⚠️ No transcription results returned");
      return { success: false, error: "No transcription results" };
    }

    // Extract full transcript text from all result segments
    const fullTranscriptParts: string[] = [];
    for (const result of recognitionResults) {
      if (!result.alternatives || result.alternatives.length === 0) continue;
      const alternative = result
        .alternatives[0] as ISpeechRecognitionAlternative;
      if (alternative.transcript)
        fullTranscriptParts.push(alternative.transcript);
    }

    // Build speaker-labelled segments from word-level data in the LAST result.
    // Google places ALL words (with speakerLabel) in the final result's word list.
    const speakerSegments: Array<{
      speakerTag: number;
      text: string;
      startTime: number;
      endTime: number;
    }> = [];

    const lastResult = recognitionResults[
      recognitionResults.length - 1
    ] as ISpeechRecognitionResult;

    if (lastResult?.alternatives?.[0]?.words) {
      const words = lastResult.alternatives[0].words as IWordInfo[];
      let currentSpeaker = -1;
      let currentText = "";
      let startTime = 0;
      let endTime = 0;

      for (const wordInfo of words) {
        // V2 uses speakerLabel (string) — convert to a stable number
        const speakerTag =
          (wordInfo.speakerLabel
            ? parseInt(wordInfo.speakerLabel.replace(/\D/g, ""), 10)
            : 0) || 0;
        const word = wordInfo.word || "";
        // V2 uses startOffset/endOffset instead of startTime/endTime
        const wordStart =
          Number(wordInfo.startOffset?.seconds || 0) +
          (wordInfo.startOffset?.nanos || 0) / 1e9;
        const wordEnd =
          Number(wordInfo.endOffset?.seconds || 0) +
          (wordInfo.endOffset?.nanos || 0) / 1e9;

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

    const text = fullTranscriptParts.join(" ").trim();

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
        .substring(11, 19);
      return `[${time}] ผู้พูด ${segment.speakerTag + 1}: ${segment.text}`;
    })
    .join("\n");
}
