import { BRAND } from "../config/brand.js";
import { LIMITS } from "../config/limits.js";
import {
  linkedinSearch,
} from "../clients/unipile.js";
import {
  hasRecentTarget,
  upsertTarget,
  getQuotaCount,
} from "../db/store.js";
import { canAct, recordAction } from "../rate-limiter/quota.js";
import { scoreTarget } from "./target-scorer.js";

export interface DiscoveredTarget {
  target_type: "post" | "person";
  target_id: string;
  provider_id?: string;
  social_id?: string;
  author_name?: string;
  author_headline?: string;
  content_preview?: string;
  metadata?: Record<string, unknown>;
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function runResearch(): Promise<DiscoveredTarget[]> {
  const check = canAct("search");
  if (!check.allowed) return [];

  const discovered: DiscoveredTarget[] = [];
  const keywords = [...BRAND.searchKeywords];
  const keyword = keywords[Math.floor(Math.random() * keywords.length)];
  const category: "posts" | "people" =
    Math.random() > 0.4 ? "posts" : "people";

  try {
    const result = (await linkedinSearch({
      keywords: keyword,
      category,
      limit: 10,
    })) as { items?: Record<string, unknown>[] };

    recordAction("search");

    const items = result.items ?? [];
    for (const item of items) {
      const parsed = parseSearchItem(item, category);
      if (!parsed) continue;
      if (hasRecentTarget(parsed.target_id, LIMITS.dedupWindowDays)) continue;

      const score = await scoreTarget(parsed);
      if (score < LIMITS.minRelevanceScore) continue;

      upsertTarget({
        target_type: parsed.target_type,
        target_id: parsed.target_id,
        provider_id: parsed.provider_id ?? null,
        social_id: parsed.social_id ?? null,
        author_name: parsed.author_name ?? null,
        author_headline: parsed.author_headline ?? null,
        content_preview: parsed.content_preview ?? null,
        relevance_score: score,
        status: "pending",
        metadata: parsed.metadata ? JSON.stringify(parsed.metadata) : null,
      });

      discovered.push(parsed);
    }
  } catch (err) {
    console.error("[research] Search failed:", err);
  }

  return discovered;
}

function parseSearchItem(
  item: Record<string, unknown>,
  category: string
): DiscoveredTarget | null {
  if (category === "posts") {
    const socialId = (item.social_id ?? item.id ?? item.post_id) as string;
    if (!socialId) return null;
    return {
      target_type: "post",
      target_id: socialId,
      social_id: socialId,
      author_name: (item.author_name ??
        (item.author as Record<string, unknown> | undefined)?.name) as
        | string
        | undefined,
      author_headline: (item.author_headline ??
        (item.author as Record<string, unknown> | undefined)?.headline) as
        | string
        | undefined,
      content_preview: (item.text ?? item.content ?? item.commentary) as
        | string
        | undefined,
      metadata: item,
    };
  }

  const providerId = (item.provider_id ?? item.id ?? item.public_identifier) as string;
  if (!providerId) return null;

  return {
    target_type: "person",
    target_id: providerId,
    provider_id: providerId,
    author_name: (item.name ?? item.first_name
      ? `${item.first_name ?? ""} ${item.last_name ?? ""}`.trim()
      : undefined) as string | undefined,
    author_headline: (item.headline ?? item.occupation) as string | undefined,
    content_preview: item.headline as string | undefined,
    metadata: item,
  };
}

export function researchQuotaRemaining(): number {
  const used = getQuotaCount("search", todayDate());
  return Math.max(0, 50 - used);
}
