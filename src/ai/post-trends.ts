import { BRAND } from "../config/brand.js";
import { pickPreferredRegionId } from "../config/icp.js";
import { LIMITS } from "../config/limits.js";
import { linkedinSearch } from "../clients/unipile.js";
import { chatCompletion } from "../clients/openai.js";
import {
  getTopPendingPostPreviews,
  hasRecentTarget,
  upsertTarget,
  upsertPersonFromPostAuthor,
} from "../db/store.js";
import { canAct, recordAction } from "../rate-limiter/quota.js";
import { passesIcpFilter } from "./icp-filter.js";
import { scoreTarget } from "./target-scorer.js";
import type { DiscoveredTarget } from "./research.js";

const MIN_TREND_PREVIEWS = 5;
const TREND_PREVIEW_LIMIT = 12;

/**
 * Build a compact trends string for the post writer from high-score
 * discovered posts, refreshing the pool with one keyword search if thin.
 */
export async function gatherPostTrends(): Promise<string | undefined> {
  let previews = getTopPendingPostPreviews(TREND_PREVIEW_LIMIT);

  if (previews.length < MIN_TREND_PREVIEWS && canAct("search").allowed) {
    console.log("[post-trends] Pool thin — running supplemental post search");
    await refreshPostPool();
    previews = getTopPendingPostPreviews(TREND_PREVIEW_LIMIT);
  }

  if (previews.length === 0) return undefined;

  const rawBullets = previews
    .slice(0, TREND_PREVIEW_LIMIT)
    .map((p, i) => {
      const who = p.author_name ?? "someone";
      const role = p.author_headline ? ` (${p.author_headline.slice(0, 60)})` : "";
      const text = (p.content_preview ?? "").replace(/\s+/g, " ").slice(0, 220);
      return `${i + 1}. [${p.relevance_score}] ${who}${role}: ${text}`;
    })
    .join("\n");

  try {
    const summary = await chatCompletion({
      system: `You distill LinkedIn feed snippets into posting angles for a CTO
writing thought leadership about: ${BRAND.topics.slice(0, 6).join(", ")}.

Return 5-8 short bullet points. Each bullet is one concrete theme, tension,
or observable pattern (not generic advice). No intro, no numbering — just
"- " bullets. Max 60 words total.`,
      user: `Recent high-relevance posts from research:\n${rawBullets}\n\nExtract themes:`,
      temperature: 0.4,
      maxTokens: 280,
    });
    const trimmed = summary.trim();
    return trimmed || rawBullets;
  } catch (err) {
    console.warn("[post-trends] Summarization failed, using raw previews:", err);
    return rawBullets;
  }
}

async function refreshPostPool(): Promise<void> {
  const keywords = [...BRAND.searchKeywords];
  const keyword = keywords[Math.floor(Math.random() * keywords.length)];
  const region = pickPreferredRegionId();

  try {
    const result = (await linkedinSearch({
      category: "posts",
      keywords: keyword,
      sort_by: "date",
      date_posted: "past_week",
      region,
      limit: 25,
    })) as { items?: Record<string, unknown>[] };

    recordAction("search");

    for (const item of result.items ?? []) {
      const parsed = parsePostItem(item);
      if (!parsed) continue;
      if (hasRecentTarget(parsed.target_id, LIMITS.dedupWindowDays)) continue;

      const icp = passesIcpFilter({
        targetType: "post",
        headline: parsed.author_headline,
        content: parsed.content_preview,
        location: parsed.location,
        reactionCount: parsed.reaction_count,
        commentCount: parsed.comment_count,
        postedAt: parsed.posted_at,
      });
      if (!icp.pass) {
        upsertTarget({
          target_type: "post",
          target_id: parsed.target_id,
          social_id: parsed.social_id ?? null,
          author_name: parsed.author_name ?? null,
          author_headline: parsed.author_headline ?? null,
          content_preview: parsed.content_preview ?? null,
          relevance_score: 0,
          status: "filtered",
          metadata: JSON.stringify({
            ...(parsed.metadata ?? {}),
            location: parsed.location,
            reaction_counter: parsed.reaction_count,
            comment_counter: parsed.comment_count,
            icp_reject_reason: icp.reason ?? "icp_filter",
          }),
          author_provider_id: parsed.author_provider_id ?? null,
          author_public_id: parsed.author_public_id ?? null,
          posted_at: parsed.posted_at ?? null,
        });
        continue;
      }

      const score = await scoreTarget(parsed);
      if (score < LIMITS.minRelevanceScore) continue;

      upsertTarget({
        target_type: "post",
        target_id: parsed.target_id,
        social_id: parsed.social_id ?? null,
        author_name: parsed.author_name ?? null,
        author_headline: parsed.author_headline ?? null,
        content_preview: parsed.content_preview ?? null,
        relevance_score: score,
        status: "pending",
        metadata: JSON.stringify({
          ...(parsed.metadata ?? {}),
          location: parsed.location,
          reaction_counter: parsed.reaction_count,
          comment_counter: parsed.comment_count,
        }),
        sequence_stage: "discovered",
        author_provider_id: parsed.author_provider_id ?? null,
        author_public_id: parsed.author_public_id ?? null,
        posted_at: parsed.posted_at ?? null,
      });

      upsertPersonFromPostAuthor({
        providerId: parsed.author_provider_id,
        publicId: parsed.author_public_id,
        name: parsed.author_name,
        headline: parsed.author_headline,
        sourcePostId: parsed.target_id,
        relevanceScore: score,
        location: parsed.location,
      });
    }
  } catch (err) {
    console.error("[post-trends] Supplemental search failed:", err);
  }
}

function extractLocation(item: Record<string, unknown>): string | undefined {
  const direct = item.location;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const author = item.author as Record<string, unknown> | undefined;
  const authorLoc = author?.location;
  if (typeof authorLoc === "string" && authorLoc.trim()) return authorLoc.trim();
  return undefined;
}

function parsePostItem(item: Record<string, unknown>): DiscoveredTarget | null {
  const socialId = String(
    item.social_id ?? item.id ?? item.post_id ?? ""
  ).replace(/^urn:li:activity:/, "");
  if (!socialId) return null;

  const author = item.author as Record<string, unknown> | undefined;
  const authorPublicId = author?.public_identifier as string | undefined;
  const authorProviderId = (author?.provider_id ?? author?.id) as
    | string
    | undefined;

  return {
    target_type: "post",
    target_id: socialId,
    social_id: socialId,
    author_name: (item.author_name ?? author?.name) as string | undefined,
    author_headline: (item.author_headline ?? author?.headline) as
      | string
      | undefined,
    author_provider_id: authorProviderId,
    author_public_id: authorPublicId,
    content_preview: (item.text ?? item.content ?? item.commentary) as
      | string
      | undefined,
    posted_at: (item.parsed_datetime ?? item.posted_at) as string | undefined,
    location: extractLocation(item),
    reaction_count:
      typeof item.reaction_counter === "number" ? item.reaction_counter : undefined,
    comment_count:
      typeof item.comment_counter === "number" ? item.comment_counter : undefined,
    metadata: item,
  };
}
