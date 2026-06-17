export type ActionType =
  | "like_post"
  | "like_comment"
  | "comment_post"
  | "send_invite"
  | "create_post"
  | "search"
  | "profile_audit";

export const LIMITS = {
  rampUpDays: 14,
  rampUpMultiplier: 0.5,

  dailyCaps: {
    like_post: { rampUp: 30, steady: 60 },
    like_comment: { rampUp: 15, steady: 30 },
    comment_post: { rampUp: 5, steady: 15 },
    send_invite: { rampUp: 10, steady: 25 },
    create_post: { rampUp: 0, steady: 0 }, // weekly, handled separately
    search: { rampUp: 20, steady: 50 },
    profile_audit: { rampUp: 1, steady: 1 },
  } as Record<ActionType, { rampUp: number; steady: number }>,

  weeklyPostDays: [2, 4, 6] as const, // Tue, Thu, Sat (0=Sun)

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
  minRelevanceScore: 70,

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
