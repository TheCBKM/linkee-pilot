import type { ActionType } from "../config/limits.js";
import { isPostDay, isProfileAuditDay } from "../config/limits.js";
import {
  getAgentState,
  getFreshPostTargetForEngagement,
  getPersonForInvite,
  getPersonForProfileView,
  getRandomPendingTarget,
} from "../db/store.js";
import { canAct } from "../rate-limiter/quota.js";
import { getTimeWindow } from "../rate-limiter/schedule.js";
import { humanDelayMs, weightedPick } from "../rate-limiter/human-delay.js";
import type { Target } from "../db/store.js";
import { POST_BOOST_UNTIL_KEY } from "../actions/create-post.js";

export type ScheduledAction =
  | { type: "research" }
  | { type: "like_post"; target: Target }
  | { type: "like_comment"; target: Target }
  | { type: "comment_post"; target: Target }
  | { type: "send_invite"; target: Target }
  | { type: "view_profile"; target: Target }
  | { type: "create_post" }
  | { type: "profile_audit" }
  | { type: "sleep"; reason: string; ms: number }
  | { type: "idle"; reason: string };

const BROWSE_PAUSE_CHANCE = 0.08;

type WindowWeight = { actionType: ActionType; weight: number };

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

  const boostActive = isPostBoostActive();
  const { candidates, weights } = buildEligibleCandidates(window, boostActive);

  if (candidates.length === 0) {
    if (canAct("search").allowed) {
      return { type: "research" };
    }
    return { type: "idle", reason: "all_quotas_exhausted" };
  }

  if (Math.random() < BROWSE_PAUSE_CHANCE && !boostActive) {
    return { type: "sleep", reason: "browse_pause", ms: humanDelayMs() };
  }

  const picked = weightedPick(candidates, weights);
  return picked ?? { type: "idle", reason: "all_quotas_exhausted" };
}

export function isPostBoostActive(): boolean {
  const until = getAgentState(POST_BOOST_UNTIL_KEY);
  if (!until) return false;
  return Date.now() < new Date(until).getTime();
}

function buildEligibleCandidates(
  window: ReturnType<typeof getTimeWindow>,
  boostActive: boolean
): { candidates: ScheduledAction[]; weights: number[] } {
  const candidates: ScheduledAction[] = [];
  const weights: number[] = [];

  for (const { actionType, weight } of getWeightsForWindow(window, boostActive)) {
    if (!canAct(actionType).allowed) continue;

    if (actionType === "search") {
      candidates.push({ type: "research" });
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

function toTargetAction(actionType: ActionType): ScheduledAction | null {
  switch (actionType) {
    case "like_post": {
      const target = getFreshPostTargetForEngagement() ?? getRandomPendingTarget("post");
      return target ? { type: "like_post", target } : null;
    }
    case "like_comment": {
      const target = getRandomPendingTarget("post");
      return target ? { type: "like_comment", target } : null;
    }
    case "comment_post": {
      const target = getFreshPostTargetForEngagement() ?? getRandomPendingTarget("post");
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
  if (boostActive) {
    // Warm the network after publishing — like/comment ICP posts, soft views; skip invites
    return [
      { actionType: "like_post", weight: 5 },
      { actionType: "comment_post", weight: 5 },
      { actionType: "view_profile", weight: 2 },
      { actionType: "like_comment", weight: 1 },
      { actionType: "search", weight: 1 },
    ];
  }

  switch (window) {
    case "morning":
      return [
        { actionType: "search", weight: 3 },
        { actionType: "like_post", weight: 2 },
        { actionType: "comment_post", weight: 2 },
      ];
    case "midday":
      return [
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
      ];
    case "late_afternoon":
      return [
        { actionType: "like_post", weight: 2 },
        { actionType: "comment_post", weight: 2 },
        { actionType: "view_profile", weight: 2 },
        { actionType: "like_comment", weight: 2 },
      ];
    default:
      return [{ actionType: "search", weight: 1 }];
  }
}
