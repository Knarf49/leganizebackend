/**
 * Text processing utilities for transcription cleanup and deduplication
 */

import { franc } from "franc-min";

/**
 * Fix Thai text where characters are separated by spaces — a common STT artifact.
 * Simply removes spaces between Thai characters until none remain.
 *
 * Example: "ได ้ ส ร ้ าง" → "ได้สร้าง"
 */
export function fixThaiSpacing(text: string): string {
  if (!text) return "";
  let result = text;
  let prev: string;
  do {
    prev = result;
    result = result.replace(/([\u0E00-\u0E7F]) (?=[\u0E00-\u0E7F])/g, "$1");
  } while (result !== prev);
  return result;
}

/**
 * Clean transcription text by removing unwanted characters and patterns
 */
export function cleanTranscription(text: string): string {
  if (!text) return "";

  // 0. Fix Thai spacing artifacts from STT (diacritics / single chars separated by spaces)
  let cleaned = fixThaiSpacing(text);

  // 1. ลบอักขระแปลกๆ ที่ไม่ใช่ไทย/อังกฤษ/ตัวเลข/เครื่องหมาย
  cleaned = cleaned.replace(
    /[^\u0E00-\u0E7Fa-zA-Z0-9\s\.\,\!\?\-\(\)\:\;]/g,
    "",
  );

  // 2. ลบคำซ้ำติดกันมากเกินไป (เช่น "คือ คือ คือ" -> "คือ")
  cleaned = cleaned.replace(/(\b\w+\b)(\s+\1\b){2,}/gi, "$1");

  // 3. ลบช่องว่างเกินที่ซ้ำกัน
  cleaned = cleaned.replace(/\s+/g, " ");

  return cleaned.trim();
}

/**
 * Filter out sentences that are not in Thai or English
 */
export function filterNonThaiEnglishSentences(text: string): string {
  if (!text) return "";

  const sentences = text.split(/(?<=[\.!?])\s+/);
  const filtered = sentences.filter((sentence) => {
    const trimmed = sentence.trim();
    if (trimmed.length < 3) return true; // Keep short phrases

    const lang = franc(trimmed);
    // Keep Thai (tha), English (eng), or undetermined (und)
    return lang === "tha" || lang === "eng" || lang === "und";
  });

  return filtered.join(" ").trim();
}

/**
 * Remove overlap between previous and current chunk
 * Checks if the beginning of current chunk matches the end of previous chunk
 */
export function removeOverlap(
  previousChunk: string,
  currentChunk: string,
): string {
  if (!previousChunk || !currentChunk) return currentChunk;

  const prevWords = previousChunk.split(/\s+/);
  const currWords = currentChunk.split(/\s+/);

  // Check for overlaps of 3-15 words
  for (let overlapSize = 15; overlapSize >= 3; overlapSize--) {
    if (prevWords.length < overlapSize) continue;

    const lastNWords = prevWords.slice(-overlapSize).join(" ");
    const firstNWords = currWords.slice(0, overlapSize).join(" ");

    // Exact match
    if (lastNWords === firstNWords) {
      return currWords.slice(overlapSize).join(" ");
    }

    // Fuzzy match (allowing minor differences)
    const similarity = calculateSimilarity(lastNWords, firstNWords);
    if (similarity > 0.8) {
      return currWords.slice(overlapSize).join(" ");
    }
  }

  return currentChunk;
}

/**
 * Calculate similarity between two strings (0-1 range)
 */
function calculateSimilarity(str1: string, str2: string): number {
  const words1 = str1.toLowerCase().split(/\s+/);
  const words2 = str2.toLowerCase().split(/\s+/);

  if (words1.length !== words2.length) return 0;

  let matches = 0;
  for (let i = 0; i < words1.length; i++) {
    if (words1[i] === words2[i]) matches++;
  }

  return matches / words1.length;
}

/**
 * Deduplicate across multiple chunks
 * Removes sentences from current chunk that already appear in previous chunks
 */
export function deduplicateAcrossChunks(
  currentChunk: string,
  previousChunks: string[],
): string {
  if (!previousChunks || previousChunks.length === 0) return currentChunk;

  const combinedPrevious = previousChunks.join(" ");
  const prevSentences = new Set(
    combinedPrevious
      .split(/(?<=[\.!?])\s+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 5),
  );

  const currentSentences = currentChunk.split(/(?<=[\.!?])\s+/);
  const unique = currentSentences.filter((sentence) => {
    const normalized = sentence.trim().toLowerCase();
    return !prevSentences.has(normalized);
  });

  return unique.join(" ").trim();
}

/**
 * Filter segments by confidence score
 * Only keeps segments with confidence above threshold
 */
export function filterLowConfidenceSegments(
  segments: Array<{ text: string; no_speech_prob?: number }>,
  threshold: number = 0.5,
): string {
  const filtered = segments.filter((segment) => {
    // no_speech_prob: probability that segment contains no speech
    // Keep if no_speech_prob is low (meaning it likely contains speech)
    if (segment.no_speech_prob !== undefined) {
      return segment.no_speech_prob < threshold;
    }
    return true; // Keep if no confidence score available
  });

  return filtered
    .map((s) => s.text)
    .join(" ")
    .trim();
}

/**
 * Generate context prompt from previous transcriptions
 */
export function generateContextPrompt(previousTexts: string[]): string {
  if (!previousTexts || previousTexts.length === 0) {
    return "นี่คือการสนทนาทางธุรกิจเป็นภาษาไทย อาจมีคำภาษาอังกฤษปนอยู่บ้าง";
  }

  // Take last 2 chunks and combine
  const recentChunks = previousTexts.slice(-2);
  const combinedText = recentChunks.join(" ");

  // Limit to last 200 characters for context
  const contextText =
    combinedText.length > 200 ? combinedText.slice(-200) : combinedText;

  return `บริบทก่อนหน้า: ${contextText}`;
}
