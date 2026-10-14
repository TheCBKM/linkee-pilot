import type { ActionType } from "../config/limits.js";
import { canAct, recordAction } from "./quota.js";
import {
  humanDelay,
  burstPauseMs,
  sleep,
  pickReactionType,
  randomBetween,
} from "./human-delay.js";
import { handleApiError, SOFT_SKIP_MAX_TRIES } from "./backoff.js";
import {
  countFailedActions,
  getAgentState,
  logAction,
  markPersonConnected,
  markTargetSkipped,
  setAgentState,
} from "../db/store.js";
import { LIMITS } from "../config/limits.js";

const LAST_LINKEDIN_CALL_KEY = "last_linkedin_call_at";

/**
 * Keep a minimum gap between LinkedIn calls across every process sharing the
 * DB (main and ES containers act on the same account).
 */
async function waitForActionGap(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const last = getAgentState(LAST_LINKEDIN_CALL_KEY);
    const waitMs = last
      ? new Date(last).getTime() + LIMITS.timing.minGapBetweenActionsMs - Date.now()
      : 0;
    if (waitMs <= 0) break;
    await sleep(waitMs + randomBetween(0, 5_000));
  }
  setAgentState(LAST_LINKEDIN_CALL_KEY, new Date().toISOString());
}
import { getEnv } from "../config/env.js";
import { notifyDiscord } from "../notifications/discord.js";
import { hasEmDash } from "../ai/humanize.js";
import { parseErrorType as parseUnipileErrorType } from "../clients/unipile.js";

let burstCount = 0;
let burstLimit = 5;

export function resetBurst(): void {
  burstCount = 0;
  burstLimit = randomBetween(3, 7);
}

export async function executeWithRateLimit<T>(params: {
  actionType: ActionType;
  targetId: string;
  content?: string;
  execute: () => Promise<T>;
}): Promise<{
  success: boolean;
  result?: T;
  skipped?: boolean;
  errorType?: string;
}> {
  const check = canAct(params.actionType);
  if (!check.allowed) {
    return { success: false, skipped: true };
  }

  // Hard gate: never dry-run or call the API with em/en dashes in content
  if (params.content && hasEmDash(params.content)) {
    console.warn(
      `[rate-limiter] Blocked ${params.actionType}: contains_em_dash`
    );
    logAction({
      actionType: params.actionType,
      targetId: params.targetId,
      content: params.content,
      result: "failed",
      errorType: "contains_em_dash",
    });
    return { success: false, skipped: true };
  }

  if (getEnv().DRY_RUN) {
    logAction({
      actionType: params.actionType,
      targetId: params.targetId,
      content: params.content,
      result: "dry_run",
    });
    recordAction(params.actionType);
    await humanDelay();
    return { success: true };
  }

  // Already exhausted soft-skip budget (e.g. deleted posts) — don't call the API again.
  for (const [errorType, maxTries] of Object.entries(SOFT_SKIP_MAX_TRIES)) {
    const failures = countFailedActions(
      params.actionType,
      params.targetId,
      errorType
    );
    if (failures >= maxTries) {
      const changed = markTargetSkipped(params.targetId);
      console.warn(
        `[rate-limiter] Pre-skip ${params.actionType} target after ${failures}× ${errorType}` +
          ` (${params.targetId.slice(0, 80)}${changed ? "" : "; no pending target matched"})`
      );
      logAction({
        actionType: params.actionType,
        targetId: params.targetId,
        content: params.content,
        result: "skipped",
        errorType,
      });
      return { success: false, skipped: true, errorType };
    }
  }

  try {
    await waitForActionGap();
    const result = await params.execute();
    logAction({
      actionType: params.actionType,
      targetId: params.targetId,
      content: params.content,
      result: "success",
    });
    recordAction(params.actionType);

    burstCount++;
    if (burstCount >= burstLimit) {
      resetBurst();
      await sleep(burstPauseMs());
    } else {
      await humanDelay();
    }

    return { success: true, result };
  } catch (err) {
    const backoff = handleApiError(err, params.actionType);
    const errorType = parseErrorType(err) ?? String(err);
    logAction({
      actionType: params.actionType,
      targetId: params.targetId,
      content: params.content,
      result: "failed",
      errorType,
    });

    if (
      errorType === "errors/already_connected" &&
      params.actionType === "send_invite"
    ) {
      markPersonConnected(params.targetId, new Date().toISOString());
    }

    // Soft-skip: after N failures of the same error (e.g. deleted posts),
    // mark the target skipped so we stop retrying it forever.
    const softSkipMax = SOFT_SKIP_MAX_TRIES[errorType];
    if (softSkipMax != null) {
      const failures = countFailedActions(
        params.actionType,
        params.targetId,
        errorType
      );
      if (failures >= softSkipMax) {
        const changed = markTargetSkipped(params.targetId);
        console.warn(
          `[rate-limiter] Skipping target after ${failures}× ${errorType}` +
            ` (${params.actionType} ${params.targetId.slice(0, 80)}` +
            `${changed ? "" : "; no pending target matched"})`
        );
        return { success: false, skipped: true, errorType };
      }
      // First failure(s): brief pause, keep target pending for one more try.
      if (backoff.sleepMs > 0) {
        await sleep(backoff.sleepMs);
      }
      return { success: false, skipped: true, errorType };
    }

    if (!backoff.skipTarget && !backoff.haltAgent && !backoff.discordNotified) {
      notifyDiscord({
        title: "Action · Failed",
        description: `Action ${params.actionType} failed.`,
        severity: "warn",
        fields: [
          { name: "Action", value: params.actionType, inline: true },
          { name: "Error", value: errorType.slice(0, 200), inline: true },
          { name: "Target", value: params.targetId.slice(0, 100), inline: true },
        ],
      });
    }

    if (backoff.haltAgent) {
      throw err;
    }

    if (backoff.skipTarget) {
      markTargetSkipped(params.targetId);
      return { success: false, skipped: true, errorType };
    }

    if (backoff.sleepMs > 0) {
      await sleep(backoff.sleepMs);
    }

    return { success: false, skipped: true, errorType };
  }
}

function parseErrorType(err: unknown): string | null {
  const fromUnipile = parseUnipileErrorType(err);
  if (fromUnipile) return fromUnipile;
  if (err && typeof err === "object" && "errorType" in err) {
    return (err as { errorType: string | null }).errorType;
  }
  return null;
}

export { canAct, humanDelay, sleep, pickReactionType };
