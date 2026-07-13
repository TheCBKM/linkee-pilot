import { BRAND } from "../config/brand.js";
import {
  ICP_PEOPLE_SEARCH_KEYWORDS,
  pickLocationBatch,
  pickPreferredRegionId,
} from "../config/icp.js";
import { LIMITS } from "../config/limits.js";
import { linkedinSearch, type LinkedInSearchParams } from "../clients/unipile.js";
import {
  hasRecentTarget,
  upsertTarget,
  upsertPersonFromPostAuthor,
  getQuotaCount,
  getAccountAgeDays,
} from "../db/store.js";
import { canAct, recordAction } from "../rate-limiter/quota.js";
import { getDailyCap } from "../config/limits.js";
import { passesIcpFilter } from "./icp-filter.js";
import { scoreTarget } from "./target-scorer.js";

export interface DiscoveredTarget {
  target_type: "post" | "person";
  target_id: string;
  provider_id?: string;
  social_id?: string;
  author_name?: string;
  author_headline?: string;
  author_provider_id?: string;
  author_public_id?: string;
  content_preview?: string;
  posted_at?: string;
  person_source?: "post" | "search";
  location?: string;
  reaction_count?: number;
  comment_count?: number;
  metadata?: Record<string, unknown>;
}

const SEARCH_PAGE_SIZE = 25;
const MIN_CANDIDATES_FOR_PAGINATION = 5;

interface SearchStrategy {
  weight: number;
  category: "posts" | "people";
  buildParams: () => LinkedInSearchParams;
}

function pickStrategy(): SearchStrategy {
  const keywords = [...BRAND.searchKeywords];
  const keyword = keywords[Math.floor(Math.random() * keywords.length)];
  const peopleKeyword =
    ICP_PEOPLE_SEARCH_KEYWORDS[
      Math.floor(Math.random() * ICP_PEOPLE_SEARCH_KEYWORDS.length)
    ];
  const locationBatch = pickLocationBatch();
  const region = pickPreferredRegionId();

  const strategies: SearchStrategy[] = [
    {
      weight: 45,
      category: "posts",
      buildParams: () => ({
        category: "posts",
        keywords: keyword,
        sort_by: "date",
        region,
        limit: SEARCH_PAGE_SIZE,
      }),
    },
    {
      weight: 25,
      category: "posts",
      buildParams: () => ({
        category: "posts",
        keywords: keyword,
        sort_by: "date",
        date_posted: "past_week",
        region,
        limit: SEARCH_PAGE_SIZE,
      }),
    },
    {
      weight: 30,
      category: "people",
      buildParams: () => ({
        category: "people",
        keywords: peopleKeyword,
        location: locationBatch,
        profile_language: ["en"],
        limit: SEARCH_PAGE_SIZE,
      }),
    },
  ];

  const total = strategies.reduce((sum, s) => sum + s.weight, 0);
  let roll = Math.random() * total;
  for (const strategy of strategies) {
    roll -= strategy.weight;
    if (roll <= 0) return strategy;
  }
  return strategies[0];
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function extractLocation(item: Record<string, unknown>): string | undefined {
  const direct = item.location;
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const author = item.author as Record<string, unknown> | undefined;
  const authorLoc = author?.location;
  if (typeof authorLoc === "string" && authorLoc.trim()) return authorLoc.trim();

  return undefined;
}

export async function runResearch(): Promise<DiscoveredTarget[]> {
  const check = canAct("search");
  if (!check.allowed) return [];

  const discovered: DiscoveredTarget[] = [];
  const strategy = pickStrategy();
  const params = strategy.buildParams();

  try {
    let acceptedCount = 0;
    let cursor: string | undefined;

    for (let page = 0; page < 2; page++) {
      if (page > 0) {
        const paginateCheck = canAct("search");
        if (!paginateCheck.allowed || acceptedCount >= MIN_CANDIDATES_FOR_PAGINATION) {
          break;
        }
        if (!cursor) break;
      }

      const result = (await linkedinSearch({
        ...params,
        cursor,
      })) as { items?: Record<string, unknown>[]; cursor?: string };

      recordAction("search");

      const items = result.items ?? [];
      for (const item of items) {
        const parsed = parseSearchItem(item, strategy.category);
        if (!parsed) continue;
        if (hasRecentTarget(parsed.target_id, LIMITS.dedupWindowDays)) continue;

        const icp = passesIcpFilter({
          targetType: parsed.target_type,
          headline: parsed.author_headline,
          content: parsed.content_preview,
          location: parsed.location,
          reactionCount: parsed.reaction_count,
          commentCount: parsed.comment_count,
          postedAt: parsed.posted_at,
          requirePreferredGeo: parsed.target_type === "person",
        });
        if (!icp.pass) {
          upsertTarget({
            target_type: parsed.target_type,
            target_id: parsed.target_id,
            provider_id: parsed.provider_id ?? null,
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
            sequence_stage: "discovered",
            author_provider_id: parsed.author_provider_id ?? null,
            author_public_id: parsed.author_public_id ?? null,
            posted_at: parsed.posted_at ?? null,
            person_source: parsed.person_source ?? null,
          });
          continue;
        }

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
          person_source: parsed.person_source ?? null,
        });

        if (parsed.target_type === "post") {
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

        discovered.push(parsed);
        acceptedCount++;
      }

      cursor = result.cursor;
      if (acceptedCount >= MIN_CANDIDATES_FOR_PAGINATION) break;
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
    const socialId = String(
      item.social_id ?? item.id ?? item.post_id ?? ""
    ).replace(/^urn:li:activity:/, "");
    if (!socialId) return null;

    const author = item.author as Record<string, unknown> | undefined;
    const authorPublicId = author?.public_identifier as string | undefined;
    const authorProviderId = (author?.provider_id ?? author?.id) as
      | string
      | undefined;

    const reactionCount =
      typeof item.reaction_counter === "number" ? item.reaction_counter : undefined;
    const commentCount =
      typeof item.comment_counter === "number" ? item.comment_counter : undefined;

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
      reaction_count: reactionCount,
      comment_count: commentCount,
      metadata: item,
    };
  }

  const providerId = (item.provider_id ?? item.id) as string | undefined;
  const publicId = item.public_identifier as string | undefined;
  const personId = providerId ?? (publicId ? `person:${publicId}` : null);
  if (!personId) return null;

  const name =
    (item.name as string | undefined) ??
    (`${item.first_name ?? ""} ${item.last_name ?? ""}`.trim() || undefined);

  return {
    target_type: "person",
    target_id: personId,
    provider_id: providerId,
    author_name: name,
    author_headline: (item.headline ?? item.occupation) as string | undefined,
    content_preview: (item.headline ?? item.occupation) as string | undefined,
    author_public_id: publicId,
    person_source: "search",
    location: extractLocation(item),
    metadata: item,
  };
}

export function researchQuotaRemaining(): number {
  const used = getQuotaCount("search", todayDate());
  const cap = getDailyCap("search", getAccountAgeDays());
  return Math.max(0, cap - used);
}

export function canSharePost(metadata: string | null): boolean {
  if (!metadata) return true;
  try {
    const parsed = JSON.parse(metadata) as {
      permissions?: { can_share?: boolean };
    };
    return parsed.permissions?.can_share !== false;
  } catch {
    return true;
  }
}
