// check-chirp3.ts
import { SpeechClient } from "@google-cloud/speech";
import { resolve } from "path";

// Set credentials path
process.env.GOOGLE_APPLICATION_CREDENTIALS = resolve(
  __dirname,
  "google-credentials.json",
);

const locations = [
  "global", // Try global endpoint
  "us-central1",
  "us-east1",
  "europe-west4",
  "europe-west2",
  "asia-southeast1",
  "asia-northeast1",
];

async function findWorkingLocation() {
  // สร้าง WAV header ขนาดเล็กที่ valid
  const silenceWav = Buffer.from([
    0x52,
    0x49,
    0x46,
    0x46,
    0x24,
    0x00,
    0x00,
    0x00, // RIFF header
    0x57,
    0x41,
    0x56,
    0x45,
    0x66,
    0x6d,
    0x74,
    0x20, // WAVE fmt
    0x10,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00, // PCM mono
    0x80,
    0x3e,
    0x00,
    0x00,
    0x00,
    0x7d,
    0x00,
    0x00, // 16000hz
    0x02,
    0x00,
    0x10,
    0x00,
    0x64,
    0x61,
    0x74,
    0x61, // data chunk
    0x00,
    0x00,
    0x00,
    0x00, // empty data
  ]);

  for (const location of locations) {
    try {
      const client = new SpeechClient({
        apiEndpoint: `${location}-speech.googleapis.com`,
      });
      const projectId = await client.getProjectId();

      await client.recognize({
        recognizer: `projects/${projectId}/locations/${location}/recognizers/_`,
        config: {
          model: "chirp_3",
          languageCodes: ["th-TH"],
          autoDecodingConfig: {},
        },
        content: new Uint8Array(silenceWav),
      } as any);

      console.log(`✅ ${location}: WORKS`);
    } catch (err: any) {
      const msg: string = err.message || "";
      if (msg.includes("UNIMPLEMENTED")) {
        console.log(`❌ ${location}: chirp_3 not supported`);
      } else if (
        msg.includes("INVALID_ARGUMENT") ||
        msg.includes("RecognitionAudio")
      ) {
        console.log(`✅ ${location}: chirp_3 SUPPORTED (audio issue only)`);
      } else {
        console.log(`⚠️  ${location}: ${msg.substring(0, 100)}`);
      }
    }
  }
}

findWorkingLocation();
