export type ActionType =
  | "like_post"
  | "like_comment"
  | "comment_post"
  | "reply_comment"
  | "send_invite"
  | "withdraw_invite"
  | "create_post"
  | "search"
  | "profile_audit"
  | "view_profile";

export const LIMITS = {
  rampUpDays: 14,
  rampUpMultiplier: 0.5,

  /** Withdraw pending connection invites older than this many days. */
  staleInviteDays: 21,

  dailyCaps: {
    like_post: { rampUp: 30, steady: 60 },
    like_comment: { rampUp: 15, steady: 30 },
    comment_post: { rampUp: 5, steady: 15 },
    reply_comment: { rampUp: 5, steady: 10 },
    send_invite: { rampUp: 10, steady: 25 },
    withdraw_invite: { rampUp: 10, steady: 20 },
    create_post: { rampUp: 0, steady: 0 }, // weekly, handled separately
    search: { rampUp: 40, steady: 80 },
    profile_audit: { rampUp: 1, steady: 1 },
    view_profile: { rampUp: 8, steady: 20 },
  } as Record<ActionType, { rampUp: number; steady: number }>,

  weeklyPostDays: [2, 4, 5] as const, // Tue, Thu, Fri (0=Sun)

  /** Reply to comments on own posts published within this many hours. */
  ownPostReplyWindowHours: 48,

  timing: {
    minDelayMs: 45_000,
    maxDelayMs: 240_000,
    meanDelayMs: 90_000,
    burstMinActions: 3,
    burstMaxActions: 7,
    burstPauseMinMs: 600_000,
    burstPauseMaxMs: 1_500_000,
  },

  workingHours: {
    startHour: 8,
    endHour: 19,
    workDays: [1, 2, 3, 4, 5] as const, // Mon-Fri
  },

  dedupWindowDays: 30,
  /** Minimum AI relevance to keep a discovery at all. */
  minRelevanceScore: 75,
  /** Likes/comments only on targets at or above this score. */
  minEngagementRelevanceScore: 80,
  /**
   * Prefer posts that already have traction. Very fresh posts (<6h) may
   * skip this; older posts need at least this many reactions.
   */
  minPostReactions: 5,

  contentMaxLength: {
    comment: 250,
    invite: 300,
    commentApi: 1250,
  },

  reactionMix: {
    like: 0.8,
    insightful: 0.1,
    celebrate: 0.1,
  },

  /**
   * First-degree network nurture (likes/comments on connections).
   * Shares like_post / comment_post daily caps; kept occasional via
   * selection probability and per-connection cooldowns.
   */
  nurture: {
    /** Chance to prefer a nurture post when one is available. */
    engagementChance: 0.28,
    /** Boost recent accepts for this many days. */
    recentAcceptDays: 14,
    /** Min days between nurture engagements on the same connection. */
    connectionCooldownDays: 7,
    /** Fixed relevance for confirmed first-degree posts (bypass AI). */
    defaultRelevanceScore: 88,
    /** Research strategy weight for network_distance=[1] posts. */
    researchWeight: 10,
    /** Max relation syncs per workday after initial backfill. */
    syncMaxPerDay: 3,
    /** Random delay between syncs (hours). */
    syncMinIntervalHours: 3,
    syncMaxIntervalHours: 8,
  },
} as const;

export function getDailyCap(actionType: ActionType, accountAgeDays: number): number {
  if (actionType === "create_post") {
    return isPostDay(new Date()) ? 1 : 0;
  }
  if (actionType === "profile_audit") {
    return isProfileAuditDay(new Date()) ? 1 : 0;
  }
  const caps = LIMITS.dailyCaps[actionType];
  const multiplier =
    accountAgeDays < LIMITS.rampUpDays ? LIMITS.rampUpMultiplier : 1;
  const base = accountAgeDays < LIMITS.rampUpDays ? caps.rampUp : caps.steady;
  return Math.floor(base * multiplier);
}

export function isPostDay(date: Date): boolean {
  return (LIMITS.weeklyPostDays as readonly number[]).includes(date.getDay());
}

export function isProfileAuditDay(date: Date): boolean {
  return date.getDay() === 1; // Monday
}
