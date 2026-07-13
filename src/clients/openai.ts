import OpenAI from "openai";
import { getEnv } from "../config/env.js";
import { brandContextForPrompt } from "../config/brand.js";
import { sleep } from "../rate-limiter/human-delay.js";

let client: OpenAI | null = null;

const TRANSIENT_ERROR_CODES = new Set([
  "ERR_STREAM_PREMATURE_CLOSE",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
]);

function isTransientError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;

  const e = err as {
    code?: string;
    type?: string;
    status?: number;
    message?: string;
    cause?: unknown;
  };

  if (typeof e.status === "number" && (e.status >= 500 || e.status === 429)) {
    return true;
  }

  const codes = [e.code];
  if (e.cause && typeof e.cause === "object" && "code" in e.cause) {
    codes.push(String((e.cause as { code?: string }).code));
  }

  if (codes.some((code) => code && TRANSIENT_ERROR_CODES.has(code))) {
    return true;
  }

  const message = e.message ?? "";
  return (
    message.includes("Premature close") ||
    message.includes("socket hang up") ||
    message.includes("network")
  );
}

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts || !isTransientError(err)) {
        throw err;
      }

      const delayMs = 1000 * 2 ** (attempt - 1);
      console.warn(
        `[openai] ${label} failed (attempt ${attempt}/${maxAttempts}): ${err}. Retrying in ${delayMs}ms...`
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

function nativeFetch(
  url: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  return globalThis.fetch(url, init);
}

export function getOpenAIClient(): OpenAI {
  if (!client) {
    // Node 22 native fetch avoids node-fetch gzip stream errors (ERR_STREAM_PREMATURE_CLOSE).
    client = new OpenAI({
      apiKey: getEnv().OPENAI_API_KEY,
      fetch: nativeFetch as never,
    });
  }
  return client;
}

export function getModel(): string {
  return getEnv().OPENAI_MODEL;
}

export async function chatCompletion(params: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  return withRetry("chat completion", async () => {
    const openai = getOpenAIClient();
    const response = await openai.chat.completions.create({
      model: getModel(),
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.user },
      ],
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 500,
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) throw new Error("Empty OpenAI response");
    return content;
  });
}

export async function moderateContent(text: string): Promise<boolean> {
  return withRetry("moderation", async () => {
    const openai = getOpenAIClient();
    const result = await openai.moderations.create({ input: text });
    return result.results[0]?.flagged ?? false;
  });
}

export function systemPromptWithBrand(extra?: string): string {
  return `${brandContextForPrompt()}${extra ? `\n\n${extra}` : ""}`;
}

export async function parseJsonResponse<T>(text: string): Promise<T> {
  const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("No JSON in OpenAI response");
  return JSON.parse(jsonMatch[0]) as T;
}
