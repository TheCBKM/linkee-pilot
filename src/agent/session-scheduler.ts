import type { ActionType } from "../config/limits.js";
import { isPostDay, isProfileAuditDay } from "../config/limits.js";
import { getRandomPendingTarget } from "../db/store.js";
import { canAct } from "../rate-limiter/quota.js";
import { getTimeWindow } from "../rate-limiter/schedule.js";
import { humanDelayMs, weightedPick } from "../rate-limiter/human-delay.js";
import type { Target } from "../db/store.js";

export type ScheduledAction =
  | { type: "research" }
  | { type: "like_post"; target: Target }
  | { type: "like_comment"; target: Target }
  | { type: "comment_post"; target: Target }
  | { type: "send_invite"; target: Target }
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

  const { candidates, weights } = buildEligibleCandidates(window);

  if (candidates.length === 0) {
    if (canAct("search").allowed) {
      return { type: "research" };
    }
    return { type: "idle", reason: "all_quotas_exhausted" };
  }

  if (Math.random() < BROWSE_PAUSE_CHANCE) {
    return { type: "sleep", reason: "browse_pause", ms: humanDelayMs() };
  }

  const picked = weightedPick(candidates, weights);
  return picked ?? { type: "idle", reason: "all_quotas_exhausted" };
}

function buildEligibleCandidates(
  window: ReturnType<typeof getTimeWindow>
): { candidates: ScheduledAction[]; weights: number[] } {
  const candidates: ScheduledAction[] = [];
  const weights: number[] = [];

  for (const { actionType, weight } of getWeightsForWindow(window)) {
    if (!canAct(actionType).allowed) continue;

    if (actionType === "search") {
      candidates.push({ type: "research" });
      weights.push(weight);
      continue;
    }

    const targetType = actionType === "send_invite" ? "person" : "post";
    const target = getRandomPendingTarget(targetType);
    if (!target) continue;

    const action = toTargetAction(actionType, target);
    if (!action) continue;

    candidates.push(action);
    weights.push(weight);
  }

  return { candidates, weights };
}

function toTargetAction(
  actionType: ActionType,
  target: Target
): ScheduledAction | null {
  switch (actionType) {
    case "like_post":
      return { type: "like_post", target };
    case "like_comment":
      return { type: "like_comment", target };
    case "comment_post":
      return { type: "comment_post", target };
    case "send_invite":
      return { type: "send_invite", target };
    default:
      return null;
  }
}

function getWeightsForWindow(
  window: ReturnType<typeof getTimeWindow>
): WindowWeight[] {
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
        { actionType: "send_invite", weight: 3 },
        { actionType: "like_post", weight: 2 },
        { actionType: "search", weight: 2 },
      ];
    case "late_afternoon":
      return [
        { actionType: "like_post", weight: 2 },
        { actionType: "comment_post", weight: 2 },
        { actionType: "like_comment", weight: 2 },
      ];
    default:
      return [{ actionType: "search", weight: 1 }];
  }
}
