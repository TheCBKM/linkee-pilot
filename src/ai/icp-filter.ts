import {
  hasHiringSignal,
  hasRemoteSignal,
  ICP_EXCLUDE_PATTERNS,
  ICP_EXCLUDED_LOCATION_PATTERNS,
  ICP_INCLUDE_PATTERNS,
  ICP_PREFERRED_LOCATION_PATTERNS,
  isJobBoardAuthor,
} from "../config/icp.js";
import { LIMITS } from "../config/limits.js";

export interface IcpFilterInput {
  targetType: "post" | "person";
  headline?: string | null;
  /**
   * Post author display name. Aggregator accounts often carry their giveaway
   * wording here with an empty headline, so the job-board check needs both.
   */
  authorName?: string | null;
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

export function isExcludedLocation(location: string): boolean {
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
 * A hiring post is an opportunity regardless of traction. Most "we're hiring"
 * posts never get many reactions, so the traction gate would discard exactly
 * the posts worth engaging with. Remote is non-negotiable, so require it here.
 */
export function isRemoteHiringPost(input: IcpFilterInput): boolean {
  const text = [input.content, input.headline].filter(Boolean).join(" ");
  if (!hasHiringSignal(text)) return false;
  return hasRemoteSignal(text) || hasRemoteSignal(input.location);
}

/**
 * Soft engagement gate for posts we might like/comment on.
 * Fresh posts and remote hiring posts get a pass (still need relevance later).
 */
export function passesEngagementGate(input: IcpFilterInput): IcpFilterResult {
  if (input.targetType !== "post") return { pass: true };

  const reactions = input.reactionCount ?? 0;
  const comments = input.commentCount ?? 0;

  if (isVeryFreshPost(input.postedAt)) {
    return { pass: true };
  }

  if (isRemoteHiringPost(input)) {
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

  // Catch an excluded region named in the headline when location is empty
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

    const author = [headline, input.authorName].filter(Boolean).join(" ");
    if (isJobBoardAuthor(author)) {
      return {
        pass: false,
        reason: `job board aggregator: ${author.slice(0, 60)}`,
      };
    }

    // Remote only: a hiring post with no remote signal is not an opportunity.
    if (hasHiringSignal(input.content) && !isRemoteHiringPost(input)) {
      return { pass: false, reason: "hiring post without a remote signal" };
    }

    const engagement = passesEngagementGate(input);
    if (!engagement.pass) return engagement;
  }

  return { pass: true };
}
