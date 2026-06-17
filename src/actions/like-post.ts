import { sendPostReaction } from "../clients/unipile.js";
import { executeWithRateLimit, pickReactionType } from "../rate-limiter/index.js";
import { updateTargetStatus } from "../db/store.js";
import type { Target } from "../db/store.js";

export async function likePost(target: Target): Promise<boolean> {
  const postId = target.social_id ?? target.target_id;
  const reactionType = pickReactionType();

  const result = await executeWithRateLimit({
    actionType: "like_post",
    targetId: postId,
    execute: () =>
      sendPostReaction({ postId, reactionType }),
  });

  if (result.success) {
    updateTargetStatus(target.target_id, "engaged");
  }
  return result.success;
}
