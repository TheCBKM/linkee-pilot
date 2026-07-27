import type { ActionType } from "../config/limits.js";
import { isPostDay, isProfileAuditDay, LIMITS } from "../config/limits.js";
import {
  getAgentState,
  getFreshPostTargetForEngagement,
  getNurturePostTargetForEngagement,
  getPersonForInvite,
  getPersonForProfileView,
  getRandomPendingTarget,
  hasRecentOwnPosts,
} from "../db/store.js";
import { canAct } from "../rate-limiter/quota.js";
import { getTimeWindow } from "../rate-limiter/schedule.js";
import { humanDelayMs, weightedPick } from "../rate-limiter/human-delay.js";
import type { Target } from "../db/store.js";
import { POST_BOOST_UNTIL_KEY } from "../actions/create-post.js";
import { WITHDRAW_INVITE_IDLE_DATE_KEY } from "../actions/withdraw-invite.js";
import { shouldSyncConnections } from "../actions/sync-connections.js";

export type ScheduledAction =
  | { type: "research" }
  | { type: "like_post"; target: Target }
  | { type: "like_comment"; target: Target }
  | { type: "comment_post"; target: Target }
  | { type: "reply_comment" }
  | { type: "send_invite"; target: Target }
  | { type: "withdraw_invite" }
  | { type: "sync_connections" }
  | { type: "view_profile"; target: Target }
  | { type: "create_post" }
  | { type: "profile_audit" }
  | { type: "sleep"; reason: string; ms: number }
  | { type: "idle"; reason: string };

const BROWSE_PAUSE_CHANCE = 0.08;

type WindowWeight = { actionType: ActionType; weight: number };

function isPostBoostActive(): boolean {
  const boostUntil = getAgentState(POST_BOOST_UNTIL_KEY);
  return !!boostUntil && Date.now() < new Date(boostUntil).getTime();
}

export function getNextScheduledAction(): ScheduledAction {
  const window = getTimeWindow();

  if (window === "off_hours") {
    return { type: "idle", reason: "outside_working_hours" };
  }

  if (isProfileAuditDay(new Date()) && canAct("profile_audit").allowed) {
    return { type: "profile_audit" };
  }

  if (isPostDay(new Date()) && canAct("create_post").allowed) {
    return { type: "create_post" };
  }

  const today = new Date().toISOString().slice(0, 10);
  if (
    canAct("withdraw_invite").allowed &&
    getAgentState(WITHDRAW_INVITE_IDLE_DATE_KEY) !== today
  ) {
    return { type: "withdraw_invite" };
  }

  // Low-priority background sync: run when due, before weighted engagement.
  // Does not consume like/comment/invite quotas.
  if (shouldSyncConnections()) {
    return { type: "sync_connections" };
  }

  const boostActive = isPostBoostActive();
  const { candidates, weights } = buildEligibleCandidates(window, boostActive);

  if (candidates.length === 0) {
    if (canAct("search").allowed) {
      return { type: "research" };
    }
    return { type: "idle", reason: "all_quotas_exhausted" };
  }

  if (!boostActive && Math.random() < BROWSE_PAUSE_CHANCE) {
    return { type: "sleep", reason: "browse_pause", ms: humanDelayMs() };
  }

  const picked = weightedPick(candidates, weights);
  return picked ?? { type: "idle", reason: "all_quotas_exhausted" };
}

function buildEligibleCandidates(
  window: ReturnType<typeof getTimeWindow>,
  boostActive: boolean
): { candidates: ScheduledAction[]; weights: number[] } {
  const candidates: ScheduledAction[] = [];
  const weights: number[] = [];

  for (const { actionType, weight } of getWeightsForWindow(
    window,
    boostActive
  )) {
    if (!canAct(actionType).allowed) continue;

    if (actionType === "search") {
      candidates.push({ type: "research" });
      weights.push(weight);
      continue;
    }

    if (actionType === "reply_comment") {
      if (!hasRecentOwnPosts(LIMITS.ownPostReplyWindowHours)) continue;
      candidates.push({ type: "reply_comment" });
      weights.push(weight);
      continue;
    }

    const action = toTargetAction(actionType);
    if (!action) continue;

    candidates.push(action);
    weights.push(weight);
  }

  return { candidates, weights };
}

function pickEngagementTarget(): Target | null {
  const nurture = getNurturePostTargetForEngagement();
  if (nurture && Math.random() < LIMITS.nurture.engagementChance) {
    return nurture;
  }
  return (
    getFreshPostTargetForEngagement() ??
    getRandomPendingTarget("post") ??
    nurture
  );
}

function toTargetAction(actionType: ActionType): ScheduledAction | null {
  switch (actionType) {
    case "like_post": {
      const target = pickEngagementTarget();
      return target ? { type: "like_post", target } : null;
    }
    case "like_comment": {
      const target = getRandomPendingTarget("post");
      return target ? { type: "like_comment", target } : null;
    }
    case "comment_post": {
      const target = pickEngagementTarget();
      return target ? { type: "comment_post", target } : null;
    }
    case "view_profile": {
      const target = getPersonForProfileView();
      return target ? { type: "view_profile", target } : null;
    }
    case "send_invite": {
      const target = getPersonForInvite();
      return target ? { type: "send_invite", target } : null;
    }
    default:
      return null;
  }
}

function getWeightsForWindow(
  window: ReturnType<typeof getTimeWindow>,
  boostActive: boolean
): WindowWeight[] {
  // Prefer replies + engagement after our own publish (no invites).
  if (boostActive && window !== "off_hours") {
    return [
      { actionType: "reply_comment", weight: 8 },
      { actionType: "like_post", weight: 4 },
      { actionType: "comment_post", weight: 3 },
      { actionType: "view_profile", weight: 2 },
      { actionType: "like_comment", weight: 1 },
      { actionType: "search", weight: 1 },
    ];
  }

  switch (window) {
    case "morning":
      return [
        { actionType: "reply_comment", weight: 4 },
        { actionType: "search", weight: 3 },
        { actionType: "like_post", weight: 2 },
        { actionType: "comment_post", weight: 2 },
      ];
    case "midday":
      return [
        { actionType: "reply_comment", weight: 4 },
        { actionType: "comment_post", weight: 3 },
        { actionType: "like_comment", weight: 2 },
        { actionType: "like_post", weight: 2 },
      ];
    case "afternoon":
      return [
        { actionType: "view_profile", weight: 3 },
        { actionType: "send_invite", weight: 3 },
        { actionType: "like_post", weight: 2 },
        { actionType: "search", weight: 2 },
        { actionType: "reply_comment", weight: 2 },
      ];
    case "late_afternoon":
      return [
        { actionType: "reply_comment", weight: 3 },
        { actionType: "like_post", weight: 2 },
        { actionType: "comment_post", weight: 2 },
        { actionType: "view_profile", weight: 2 },
        { actionType: "like_comment", weight: 2 },
      ];
    default:
      return [{ actionType: "search", weight: 1 }];
  }
}
