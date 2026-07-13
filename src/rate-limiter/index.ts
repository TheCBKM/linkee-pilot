import type { ActionType } from "../config/limits.js";
import { canAct, recordAction } from "./quota.js";
import {
  humanDelay,
  burstPauseMs,
  sleep,
  pickReactionType,
  randomBetween,
} from "./human-delay.js";
import { handleApiError } from "./backoff.js";
import { logAction } from "../db/store.js";
import { getEnv } from "../config/env.js";

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
}): Promise<{ success: boolean; result?: T; skipped?: boolean }> {
  const check = canAct(params.actionType);
  if (!check.allowed) {
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

  try {
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
    logAction({
      actionType: params.actionType,
      targetId: params.targetId,
      content: params.content,
      result: "failed",
      errorType: parseErrorType(err) ?? String(err),
    });

    if (backoff.haltAgent) {
      throw err;
    }

    if (backoff.skipTarget) {
      return { success: false, skipped: true };
    }

    if (backoff.sleepMs > 0) {
      await sleep(backoff.sleepMs);
    }

    return { success: false, skipped: true };
  }
}

function parseErrorType(err: unknown): string | null {
  if (err && typeof err === "object" && "errorType" in err) {
    return (err as { errorType: string | null }).errorType;
  }
  return null;
}

export { canAct, humanDelay, sleep, pickReactionType };
