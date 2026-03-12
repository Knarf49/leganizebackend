import { v2 } from "@google-cloud/speech";
import SpeechV1 from "@google-cloud/speech";
import { Storage } from "@google-cloud/storage";
import { readFileSync } from "fs";
import { basename } from "path";
import { EventEmitter } from "events";

/**
 * Returns Google service-account credentials parsed from the
 * GOOGLE_CREDENTIALS_JSON environment variable (used on Render / cloud deploys
 * where a credentials file cannot be placed on disk).
 * Falls back to undefined so the SDK picks up GOOGLE_APPLICATION_CREDENTIALS
 * or ADC as usual.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getGoogleCredentials(): any | undefined {
  const raw = process.env.GOOGLE_CREDENTIALS_JSON;
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    console.error(
      "⚠️  GOOGLE_CREDENTIALS_JSON is set but could not be parsed as JSON",
    );
    return undefined;
  }
}

/**
 * Transcribe audio to Thai text using Google Cloud Speech-to-Text V2 API
 * with chirp_2 model (supports speaker diarization + word offsets) via batchRecognize.
 * Audio is uploaded to GCS first, then deleted after completion.
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
  const REGION = process.env.GOOGLE_STT_REGION || "us";
  let gcsFile: ReturnType<ReturnType<Storage["bucket"]>["file"]> | null = null;

  try {
    console.error(
      `🔄 Initializing Google Cloud Speech client (V2 API, region: ${REGION})...`,
    );
    const apiEndpoint =
      REGION === "global"
        ? "speech.googleapis.com"
        : `${REGION}-speech.googleapis.com`;
    const credentials = getGoogleCredentials();
    const client = new v2.SpeechClient({
      apiEndpoint,
      ...(credentials ? { credentials } : {}),
    });

    console.error(`🎤 Transcribing audio: ${audioPath}`);
    const audioBuffer = readFileSync(audioPath);
    const fileSizeMB = audioBuffer.length / (1024 * 1024);
    console.error(`📁 Audio file size: ${fileSizeMB.toFixed(2)} MB`);

    // Upload to GCS (required by batchRecognize)
    const bucketName = process.env.GCS_BUCKET_NAME;
    if (!bucketName) {
      throw new Error(
        "GCS_BUCKET_NAME environment variable is required. See GCS_SETUP.md.",
      );
    }

    console.error("📤 Uploading audio to Google Cloud Storage...");
    const storage = new Storage({ ...(credentials ? { credentials } : {}) });
    const fileName = `audio-transcribe/${Date.now()}-${basename(audioPath)}`;
    gcsFile = storage.bucket(bucketName).file(fileName);
    await gcsFile.save(audioBuffer, { metadata: { contentType: "audio/wav" } });

    const gcsUri = `gs://${bucketName}/${fileName}`;
    console.error(`✅ Uploaded to GCS: ${gcsUri}`);

    // Build recognizer path
    const projectId = await client.getProjectId();
    const recognizer = `projects/${projectId}/locations/${REGION}/recognizers/_`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const batchRequest: any = {
      recognizer,
      config: {
        autoDecodingConfig: {},
        model: "chirp_2",
        languageCodes: ["th-TH"],
        features: {
          enableAutomaticPunctuation: true,
        },
      },
      files: [{ uri: gcsUri }],
      recognitionOutputConfig: { inlineResponseConfig: {} },
    };

    console.error(
      "🔄 Sending BatchRecognize request to Google Cloud Speech-to-Text V2 (chirp_3)...",
    );

    const [operation] = await client.batchRecognize(batchRequest);
    console.error("⏳ Waiting for BatchRecognize LRO to complete...");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [batchResponse] = await (operation as any).promise();

    // Clean up GCS file immediately after LRO finishes
    try {
      await gcsFile.delete();
      console.error(`🗑️ Deleted GCS file: ${gcsUri}`);
      gcsFile = null;
    } catch (err) {
      console.error(`⚠️ Failed to delete GCS file: ${err}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resultsMap: Record<string, any> = batchResponse?.results || {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let recognitionResults: any[] = [];

    for (const fileResult of Object.values(resultsMap)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fr = fileResult as any;
      recognitionResults =
        fr?.inlineResult?.results || fr?.transcript?.results || [];
      break;
    }

    if (recognitionResults.length === 0) {
      console.error("⚠️ No transcription results returned");
      return { success: false, error: "No transcription results" };
    }

    // Full transcript from all segments
    const fullTranscriptParts: string[] = [];
    for (const result of recognitionResults) {
      const transcript = result.alternatives?.[0]?.transcript;
      if (transcript) fullTranscriptParts.push(transcript);
    }
    const text = fullTranscriptParts.join(" ").trim();

    // Speaker segments from word-level data in the LAST result
    const speakerSegments: Array<{
      speakerTag: number;
      text: string;
      startTime: number;
      endTime: number;
    }> = [];

    const lastResult = recognitionResults[recognitionResults.length - 1];
    const words = lastResult?.alternatives?.[0]?.words || [];

    if (words.length > 0) {
      let currentSpeaker = -1;
      let currentText = "";
      let startTime = 0;
      let endTime = 0;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const wordInfo of words as any[]) {
        // V2 uses speakerLabel (string) — convert to stable number
        const speakerTag =
          (wordInfo.speakerLabel
            ? parseInt(wordInfo.speakerLabel.replace(/\D/g, ""), 10)
            : 0) || 0;
        const word = wordInfo.word || "";
        // V2 uses startOffset/endOffset
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
    // Best-effort cleanup if LRO failed before we could delete
    if (gcsFile) {
      gcsFile.delete().catch(() => {});
    }
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`❌ Google STT transcription error: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

export type SpeakerSegment = {
  speakerTag: number;
  text: string;
  startTime: number;
  endTime: number;
};

/**
 * Parse word-level data from a V1 StreamingRecognitionResult into grouped speaker segments.
 * Words are grouped consecutively by speakerTag.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseSpeakerSegments(words: any[]): SpeakerSegment[] {
  const segments: SpeakerSegment[] = [];
  let currentSpeaker = -1;
  let currentText = "";
  let startTime = 0;
  let endTime = 0;

  for (const wordInfo of words) {
    // V1 uses speakerTag (number); 0 means unassigned — treat as speaker 0
    const speakerTag: number = wordInfo.speakerTag ?? 0;
    const word: string = wordInfo.word ?? "";
    // V1 uses startTime/endTime (Duration object)
    const wordStart =
      Number(wordInfo.startTime?.seconds ?? 0) +
      (wordInfo.startTime?.nanos ?? 0) / 1e9;
    const wordEnd =
      Number(wordInfo.endTime?.seconds ?? 0) +
      (wordInfo.endTime?.nanos ?? 0) / 1e9;

    if (speakerTag !== currentSpeaker && currentSpeaker !== -1) {
      segments.push({
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
    segments.push({
      speakerTag: currentSpeaker,
      text: currentText.trim(),
      startTime,
      endTime,
    });
  }

  return segments;
}

/**
 * Create a Google Cloud Speech-to-Text V1 streaming session with speaker diarization.
 * Returns write/end helpers and an EventEmitter for transcript events.
 *
 * Events emitted:
 *   "transcript" { text: string, isFinal: boolean, speakers?: SpeakerSegment[] }
 *     - interim results: text only, speakers undefined
 *     - final results:   text + speakers array grouped by speakerTag
 *   "error"      Error
 *   "end"        (stream closed)
 *
 * Audio must be raw 16-bit signed PCM, mono, 16 000 Hz (LINEAR16).
 * Max session length: ~5 minutes — restart a new session as needed.
 *
 * @param options.minSpeakers  Minimum expected speakers (default: 2)
 * @param options.maxSpeakers  Maximum expected speakers (default: 6)
 */
export function createGoogleSTTStream(options?: {
  minSpeakers?: number;
  maxSpeakers?: number;
}): {
  write: (pcmBuffer: Buffer) => void;
  end: () => void;
  events: EventEmitter;
} {
  const creds = getGoogleCredentials();
  const client = new SpeechV1.SpeechClient({
    ...(creds ? { credentials: creds } : {}),
  });
  const events = new EventEmitter();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognizeStream = (client as any)
    .streamingRecognize({
      config: {
        encoding: "LINEAR16",
        sampleRateHertz: 16000,
        languageCode: "th-TH",
        model: "latest_long",
        enableAutomaticPunctuation: true,
        enableWordTimeOffsets: true,
        diarizationConfig: {
          enableSpeakerDiarization: true,
          minSpeakerCount: options?.minSpeakers ?? 1,
          maxSpeakerCount: options?.maxSpeakers ?? 6,
        },
      },
      interimResults: true,
    })
    .on(
      "data",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (data: any) => {
        const result = data.results?.[0];
        const transcript = result?.alternatives?.[0]?.transcript;
        if (!transcript) return;

        const isFinal: boolean = result?.isFinal ?? false;

        if (isFinal) {
          // For final results, diarization is on the word list of the LAST alternative
          // (Google writes speaker tags only on the final result)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const words: any[] = result?.alternatives?.[0]?.words ?? [];
          const speakers =
            words.length > 0 ? parseSpeakerSegments(words) : undefined;

          if (speakers && speakers.length > 0) {
            const uniqueSpeakers = new Set(speakers.map((s) => s.speakerTag))
              .size;
            console.error(
              `👥 Diarization: ${uniqueSpeakers} speaker(s) in final result`,
            );
          }

          events.emit("transcript", { text: transcript, isFinal, speakers });
        } else {
          // Interim results have no reliable speaker info yet
          events.emit("transcript", { text: transcript, isFinal });
        }
      },
    )
    .on("error", (err: Error) => {
      console.error("❌ STT stream error:", err.message);
      events.emit("error", err);
    })
    .on("end", () => {
      events.emit("end");
    });

  return {
    write: (pcmBuffer: Buffer) => {
      try {
        recognizeStream.write(pcmBuffer);
      } catch (e) {
        console.error("❌ Failed to write to STT stream:", e);
      }
    },
    end: () => {
      try {
        recognizeStream.end();
      } catch (e) {
        console.error("❌ Failed to end STT stream:", e);
      }
    },
    events,
  };
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
