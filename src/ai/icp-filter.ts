import {
  ICP_EXCLUDE_PATTERNS,
  ICP_EXCLUDED_LOCATION_PATTERNS,
  ICP_INCLUDE_PATTERNS,
  ICP_PREFERRED_LOCATION_PATTERNS,
} from "../config/icp.js";
import { LIMITS } from "../config/limits.js";

export interface IcpFilterInput {
  targetType: "post" | "person";
  headline?: string | null;
  content?: string | null;
  location?: string | null;
  reactionCount?: number | null;
  commentCount?: number | null;
  postedAt?: string | null;
  /** When true, people with a known non-preferred location are rejected. */
  requirePreferredGeo?: boolean;
}

export interface IcpFilterResult {
  pass: boolean;
  reason?: string;
}

function combinedText(input: IcpFilterInput): string {
  return [input.headline, input.content, input.location]
    .filter(Boolean)
    .join(" ");
}

function isExcludedLocation(location: string): boolean {
  return ICP_EXCLUDED_LOCATION_PATTERNS.some((p) => p.test(location));
}

function isPreferredLocation(location: string): boolean {
  return ICP_PREFERRED_LOCATION_PATTERNS.some((p) => p.test(location));
}

function isAmbiguousLocation(location: string): boolean {
  return /\bremote\b|\bworldwide\b|\bglobal\b|\beuropean?\s+union\b|\beurope\b/i.test(
    location
  );
}

function isVeryFreshPost(postedAt?: string | null): boolean {
  if (!postedAt) return false;
  const ts = Date.parse(postedAt);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < 6 * 60 * 60 * 1000;
}

/**
 * Soft engagement gate for posts we might like/comment on.
 * Fresh posts get a pass (still need relevance score later).
 */
export function passesEngagementGate(input: IcpFilterInput): IcpFilterResult {
  if (input.targetType !== "post") return { pass: true };

  const reactions = input.reactionCount ?? 0;
  const comments = input.commentCount ?? 0;

  if (isVeryFreshPost(input.postedAt)) {
    return { pass: true };
  }

  if (reactions + comments * 2 < LIMITS.minPostReactions) {
    return {
      pass: false,
      reason: `low engagement: ${reactions} reactions, ${comments} comments`,
    };
  }

  return { pass: true };
}

export function passesIcpFilter(input: IcpFilterInput): IcpFilterResult {
  const text = combinedText(input);
  const location = (input.location ?? "").trim();

  if (location && isExcludedLocation(location)) {
    return { pass: false, reason: `excluded location: ${location}` };
  }

  // Catch India etc. mentioned in headline when location field is empty
  if (!location && isExcludedLocation(text)) {
    return { pass: false, reason: "excluded location signal in profile/content" };
  }

  if (
    input.requirePreferredGeo &&
    location &&
    !isPreferredLocation(location) &&
    !isAmbiguousLocation(location)
  ) {
    return {
      pass: false,
      reason: `location outside preferred markets: ${location}`,
    };
  }

  for (const pattern of ICP_EXCLUDE_PATTERNS) {
    if (pattern.test(text)) {
      return { pass: false, reason: `excluded: ${pattern.source}` };
    }
  }

  if (input.targetType === "person") {
    const matchesInclude = ICP_INCLUDE_PATTERNS.some((p) => p.test(text));
    if (!matchesInclude) {
      return { pass: false, reason: "headline does not match ICP titles" };
    }
  }

  if (input.targetType === "post") {
    const headline = input.headline ?? "";
    if (headline) {
      for (const pattern of ICP_EXCLUDE_PATTERNS) {
        if (pattern.test(headline)) {
          return { pass: false, reason: `author excluded: ${pattern.source}` };
        }
      }
    }

    const engagement = passesEngagementGate(input);
    if (!engagement.pass) return engagement;
  }

  return { pass: true };
}
