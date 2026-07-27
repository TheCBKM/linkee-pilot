import { getEnv } from "../config/env.js";

export type DiscordSeverity = "info" | "warn" | "critical";

const COLORS: Record<DiscordSeverity, number> = {
  info: 0x3498db,
  warn: 0xe67e22,
  critical: 0xe74c3c,
};

export interface DiscordNotifyParams {
  title: string;
  description?: string;
  severity?: DiscordSeverity;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
}

/**
 * Post a Discord webhook embed. Never throws; no-ops if URL unset.
 * Safe to call without await (fire-and-forget); await on shutdown paths.
 */
export function notifyDiscord(params: DiscordNotifyParams): Promise<void> {
  return sendDiscord(params);
}

async function sendDiscord(params: DiscordNotifyParams): Promise<void> {
  let url = "";
  try {
    url = getEnv().DISCORD_WEBHOOK_URL ?? "";
  } catch {
    return;
  }
  if (!url) return;

  const severity = params.severity ?? "info";
  const body = {
    embeds: [
      {
        title: params.title.slice(0, 256),
        description: params.description?.slice(0, 2000),
        color: COLORS[severity],
        fields: params.fields?.slice(0, 25).map((f) => ({
          name: f.name.slice(0, 256),
          value: f.value.slice(0, 1024),
          inline: f.inline ?? false,
        })),
        timestamp: new Date().toISOString(),
      },
    ],
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`[discord] Webhook failed: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.warn("[discord] Webhook error:", err);
  }
}
