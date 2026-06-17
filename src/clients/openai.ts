import OpenAI from "openai";
import { getEnv } from "../config/env.js";
import { brandContextForPrompt } from "../config/brand.js";

let client: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: getEnv().OPENAI_API_KEY });
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
}

export async function moderateContent(text: string): Promise<boolean> {
  const openai = getOpenAIClient();
  const result = await openai.moderations.create({ input: text });
  return result.results[0]?.flagged ?? false;
}

export function systemPromptWithBrand(extra?: string): string {
  return `${brandContextForPrompt()}${extra ? `\n\n${extra}` : ""}`;
}

export async function parseJsonResponse<T>(text: string): Promise<T> {
  const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("No JSON in OpenAI response");
  return JSON.parse(jsonMatch[0]) as T;
}
