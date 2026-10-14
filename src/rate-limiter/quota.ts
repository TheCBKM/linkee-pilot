import { getEnv } from "../config/env.js";
import {
  type ActionType,
  backoffKeysFor,
  getDailyCap,
  isInviteAction,
  LIMITS,
} from "../config/limits.js";
import {
  getAccountAgeDays,
  getBackoff,
  getQuotaCount,
  incrementQuota,
  isHalted,
} from "../db/store.js";
import { isWithinWorkingHours, msUntilWorkingHours } from "./schedule.js";
import { getLocalDateString } from "../config/local-time.js";

export interface CanActResult {
  allowed: boolean;
  reason?: string;
  sleepMs?: number;
}

function todayDate(): string {
  return getLocalDateString();
}

export function canAct(actionType: ActionType): CanActResult {
  if (isHalted()) {
    return { allowed: false, reason: "agent_halted" };
  }

  if (getEnv().PAUSED) {
    return { allowed: false, reason: "paused" };
  }

  if (!isWithinWorkingHours()) {
    return {
      allowed: false,
      reason: "outside_working_hours",
      sleepMs: msUntilWorkingHours(),
    };
  }

  const backoff = backoffKeysFor(actionType)
    .map((key) => getBackoff(key))
    .find((b) => b !== null);
  if (backoff) {
    const sleepMs = new Date(backoff.blocked_until).getTime() - Date.now();
    return {
      allowed: false,
      reason: `backoff: ${backoff.reason}`,
      sleepMs: Math.max(sleepMs, 0),
    };
  }

  const accountAge = getAccountAgeDays();
  const cap = getDailyCap(actionType, accountAge);
  const used = getQuotaCount(actionType, todayDate());

  if (used >= cap) {
    return { allowed: false, reason: "quota_exhausted" };
  }

  // All invite sources share one daily budget on the account.
  if (isInviteAction(actionType)) {
    const inviteCap = getDailyCap("send_invite", accountAge);
    const invitesToday = LIMITS.inviteGroup.reduce(
      (sum, type) => sum + getQuotaCount(type, todayDate()),
      0
    );
    if (invitesToday >= inviteCap) {
      return { allowed: false, reason: "invite_quota_exhausted" };
    }
  }

  return { allowed: true };
}

export function recordAction(actionType: ActionType): void {
  incrementQuota(actionType, todayDate());
}

export function getAnyActionAvailable(
  actionTypes: ActionType[]
): CanActResult {
  for (const type of actionTypes) {
    const result = canAct(type);
    if (result.allowed) return result;
  }

  const outsideHours = !isWithinWorkingHours();
  if (outsideHours) {
    return {
      allowed: false,
      reason: "outside_working_hours",
      sleepMs: msUntilWorkingHours(),
    };
  }

  return { allowed: false, reason: "all_quotas_exhausted" };
}

export { LIMITS };
