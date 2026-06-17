import crypto from "node:crypto";
import { LIMITS } from "../config/limits.js";
import {
  hasContentHash,
  saveContentHash,
  getRecentContent,
} from "../db/store.js";
import { moderateContent } from "../clients/openai.js";

const SPAM_PHRASES = [
  "check out my",
  "dm me",
  "link in bio",
  "great post!",
  "great post.",
  "thanks for sharing!",
  "follow me",
  "click here",
  "sign up now",
  "limited time",
];

const URL_PATTERN = /https?:\/\/|www\./i;
const EMAIL_PATTERN = /[\w.-]+@[\w.-]+\.\w+/;
const PHONE_PATTERN = /\+?\d[\d\s()-]{8,}/;

export interface SafetyCheckResult {
  safe: boolean;
  reason?: string;
}

function contentHash(text: string): string {
  return crypto.createHash("sha256").update(text.trim().toLowerCase()).digest("hex");
}

export async function safetyFilter(params: {
  text: string;
  contentType: "comment" | "invite" | "post";
}): Promise<SafetyCheckResult> {
  const { text, contentType } = params;
  const trimmed = text.trim();

  if (!trimmed) {
    return { safe: false, reason: "empty_content" };
  }

  const maxLen =
    contentType === "comment"
      ? LIMITS.contentMaxLength.commentApi
      : contentType === "invite"
        ? LIMITS.contentMaxLength.invite
        : 3000;

  if (trimmed.length > maxLen) {
    return { safe: false, reason: "too_long" };
  }

  if (URL_PATTERN.test(trimmed)) {
    return { safe: false, reason: "contains_url" };
  }

  if (EMAIL_PATTERN.test(trimmed)) {
    return { safe: false, reason: "contains_email" };
  }

  if (PHONE_PATTERN.test(trimmed)) {
    return { safe: false, reason: "contains_phone" };
  }

  const lower = trimmed.toLowerCase();
  for (const phrase of SPAM_PHRASES) {
    if (lower.includes(phrase)) {
      return { safe: false, reason: `spam_phrase: ${phrase}` };
    }
  }

  const hash = contentHash(trimmed);
  if (hasContentHash(hash)) {
    return { safe: false, reason: "duplicate_content" };
  }

  const recent = getRecentContent(30);
  for (const prev of recent) {
    if (prev && similarity(trimmed, prev) > 0.85) {
      return { safe: false, reason: "similar_to_recent" };
    }
  }

  const flagged = await moderateContent(trimmed);
  if (flagged) {
    return { safe: false, reason: "moderation_flagged" };
  }

  saveContentHash(hash, contentType);
  return { safe: true };
}

function similarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union === 0 ? 0 : intersection / union;
}
