import { getEnv, loadEnv } from "../config/env.js";
import { isHalted } from "../db/store.js";
import { sleep } from "../rate-limiter/human-delay.js";
import { resetBurst } from "../rate-limiter/index.js";
import { msUntilWorkingHours, isWithinWorkingHours } from "../rate-limiter/schedule.js";
import { getNextScheduledAction } from "./session-scheduler.js";
import {
  setupLifecycle,
  writePidFile,
  writeHeartbeat,
  isShuttingDown,
  setCurrentAction,
} from "./lifecycle.js";
import { runResearch } from "../ai/research.js";
import { runProfileAudit } from "../ai/profile-advisor.js";
import { recordAction } from "../rate-limiter/quota.js";
import { likePost } from "../actions/like-post.js";
import { likeComment } from "../actions/like-comment.js";
import { commentOnPost } from "../actions/comment-post.js";
import { sendConnectionRequest } from "../actions/send-invite.js";
import { viewProfile } from "../actions/view-profile.js";
import { publishPost } from "../actions/create-post.js";
import { fetchAndRecordProfile } from "../actions/fetch-profile.js";
import { gatherPostTrends } from "../ai/post-trends.js";

const IDLE_SLEEP_MS = 60_000;
const MIN_SLEEP_MS = 5_000;

export async function startDaemon(): Promise<void> {
  loadEnv({ requireApiKeys: true });
  const env = getEnv();
  console.log("[agent] Starting LinkedIn Profile Enhancer");
  console.log(`[agent] Dry run: ${env.DRY_RUN}, Paused: ${env.PAUSED}`);

  writePidFile();
  resetBurst();
  setupLifecycle(async () => {
    console.log("[agent] Shutdown complete");
  });

  // Initial profile snapshot
  await fetchAndRecordProfile();

  while (!isShuttingDown()) {
    writeHeartbeat();

    if (isHalted()) {
      console.error("[agent] Halted due to account restriction. Manual restart required.");
      break;
    }

    if (env.PAUSED) {
      console.log("[agent] Paused (PAUSED=true). Sleeping...");
      await sleep(IDLE_SLEEP_MS);
      continue;
    }

    if (!isWithinWorkingHours()) {
      const ms = msUntilWorkingHours();
      console.log(`[agent] Outside working hours. Sleeping ${Math.round(ms / 60000)}min`);
      await sleep(Math.max(ms, MIN_SLEEP_MS));
      continue;
    }

    const scheduled = getNextScheduledAction();

    if (scheduled.type === "idle") {
      console.log(`[agent] Idle: ${scheduled.reason}`);
      await sleep(IDLE_SLEEP_MS);
      continue;
    }

    const actionPromise = executeAction(scheduled);
    setCurrentAction(actionPromise);
    try {
      await actionPromise;
    } catch (err) {
      console.error(`[agent] Action "${scheduled.type}" failed:`, err);
    } finally {
      setCurrentAction(Promise.resolve());
    }
  }
}

async function executeAction(
  action: ReturnType<typeof getNextScheduledAction>
): Promise<void> {
  switch (action.type) {
    case "research": {
      console.log("[agent] Running research...");
      const found = await runResearch();
      console.log(`[agent] Discovered ${found.length} targets`);
      writeHeartbeat("research");
      break;
    }
    case "like_post": {
      console.log(`[agent] Liking post by ${action.target.author_name ?? "unknown"}`);
      await likePost(action.target);
      writeHeartbeat("like_post");
      break;
    }
    case "like_comment": {
      console.log(`[agent] Liking comment on post ${action.target.target_id}`);
      await likeComment(action.target);
      writeHeartbeat("like_comment");
      break;
    }
    case "comment_post": {
      console.log(`[agent] Commenting on post by ${action.target.author_name ?? "unknown"}`);
      await commentOnPost(action.target);
      writeHeartbeat("comment_post");
      break;
    }
    case "send_invite": {
      console.log(`[agent] Sending invite to ${action.target.author_name ?? "unknown"}`);
      await sendConnectionRequest(action.target);
      writeHeartbeat("send_invite");
      break;
    }
    case "view_profile": {
      console.log(`[agent] Viewing profile of ${action.target.author_name ?? "unknown"}`);
      await viewProfile(action.target);
      writeHeartbeat("view_profile");
      break;
    }
    case "create_post": {
      console.log("[agent] Publishing original post...");
      const trends = await gatherPostTrends();
      if (trends) {
        console.log("[agent] Using research trends for draft");
      }
      await publishPost(trends);
      writeHeartbeat("create_post");
      break;
    }
    case "profile_audit": {
      console.log("[agent] Running profile audit...");
      await runProfileAudit();
      recordAction("profile_audit");
      writeHeartbeat("profile_audit");
      break;
    }
    case "sleep": {
      console.log(
        `[agent] Pausing: ${action.reason} (${Math.round(action.ms / 1000)}s)`
      );
      await sleep(action.ms);
      break;
    }
    default:
      break;
  }
}
