import { config } from "dotenv";
import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../../.env") });

const discordWebhookSchema = z
  .union([z.string().url(), z.literal("")])
  .optional()
  .default("");

const fullEnvSchema = z.object({
  UNIPILE_BASE_URL: z.string().url(),
  UNIPILE_API_KEY: z.string().min(1),
  UNIPILE_ACCOUNT_ID: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default("gpt-4.1"),
  TIMEZONE: z.string().default("America/Los_Angeles"),
  DRY_RUN: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  PAUSED: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  DISCORD_WEBHOOK_URL: discordWebhookSchema,
  /** LinkedIn provider_id for the account owner — never invite / target this profile. */
  OWN_PROVIDER_ID: z.string().default(""),
});

const minimalEnvSchema = z.object({
  UNIPILE_BASE_URL: z.string().url().default("https://api1.unipile.com:13111"),
  UNIPILE_API_KEY: z.string().default(""),
  UNIPILE_ACCOUNT_ID: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_MODEL: z.string().default("gpt-4.1"),
  TIMEZONE: z.string().default("America/Los_Angeles"),
  DRY_RUN: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  PAUSED: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  DISCORD_WEBHOOK_URL: discordWebhookSchema,
  OWN_PROVIDER_ID: z.string().default(""),
});

export type Env = z.infer<typeof fullEnvSchema>;

let cached: Env | null = null;

export function loadEnv(options?: { requireApiKeys?: boolean }): void {
  if (options?.requireApiKeys) {
    cached = fullEnvSchema.parse(process.env);
  } else {
    cached = minimalEnvSchema.parse(process.env) as Env;
  }
}

export function getEnv(): Env {
  if (!cached) {
    loadEnv({ requireApiKeys: false });
  }
  return cached!;
}

export function getDataDir(): string {
  return path.resolve(__dirname, "../../data");
}

export function getDbPath(): string {
  return path.join(getDataDir(), "linkedin-auto.db");
}

export function getPidPath(): string {
  return path.resolve(__dirname, "../../agent.pid");
}
