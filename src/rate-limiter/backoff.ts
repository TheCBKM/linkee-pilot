import type { ActionType } from "../config/limits.js";
import { setBackoff, setGlobalHalt } from "../db/store.js";
import { parseErrorType, UnipileError } from "../clients/unipile.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const THIRTY_MIN_MS = 30 * 60 * 1000;

const SKIP_ERRORS = new Set([
  "errors/already_invited_recently",
  "errors/already_connected",
  "errors/action_already_performed",
]);

const HALT_ERRORS = new Set([
  "errors/account_restricted",
  "errors/disconnected_account",
]);

const DAY_BLOCK_ERRORS = new Set([
  "errors/limit_exceeded",
  "errors/cannot_resend_yet",
]);

export interface BackoffResult {
  shouldRetry: boolean;
  sleepMs: number;
  haltAgent: boolean;
  skipTarget: boolean;
}

export function handleApiError(
  err: unknown,
  actionType: ActionType
): BackoffResult {
  const errorType = parseErrorType(err);

  if (errorType && SKIP_ERRORS.has(errorType)) {
    return { shouldRetry: false, sleepMs: 0, haltAgent: false, skipTarget: true };
  }

  if (errorType && HALT_ERRORS.has(errorType)) {
    setGlobalHalt(errorType);
    return {
      shouldRetry: false,
      sleepMs: 0,
      haltAgent: true,
      skipTarget: false,
    };
  }

  if (err instanceof UnipileError && err.status === 429) {
    setBackoff(actionType, new Date(Date.now() + THIRTY_MIN_MS), "429 too_many_requests");
    return {
      shouldRetry: false,
      sleepMs: THIRTY_MIN_MS,
      haltAgent: false,
      skipTarget: false,
    };
  }

  if (errorType && DAY_BLOCK_ERRORS.has(errorType)) {
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    setBackoff(actionType, endOfDay, errorType);
    return {
      shouldRetry: false,
      sleepMs: endOfDay.getTime() - Date.now(),
      haltAgent: false,
      skipTarget: false,
    };
  }

  return { shouldRetry: false, sleepMs: 5000, haltAgent: false, skipTarget: false };
}

export function blockAllActions24h(reason: string): void {
  const until = new Date(Date.now() + DAY_MS);
  setBackoff("like_post" as ActionType, until, reason);
  setGlobalHalt(reason);
}
