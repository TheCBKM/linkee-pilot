import { sendPostComment } from "../clients/unipile.js";
import { executeWithRateLimit } from "../rate-limiter/index.js";
import { updateTargetStatus } from "../db/store.js";
import { draftComment } from "../ai/comment-writer.js";
import type { Target } from "../db/store.js";

export async function commentOnPost(target: Target): Promise<boolean> {
  const postId = target.social_id ?? target.target_id;
  const content = target.content_preview ?? "";

  const comment = await draftComment({
    postContent: content,
    authorName: target.author_name ?? undefined,
  });

  if (!comment) return false;

  const result = await executeWithRateLimit({
    actionType: "comment_post",
    targetId: postId,
    content: comment,
    execute: () => sendPostComment({ postId, text: comment }),
  });

  if (result.success) {
    updateTargetStatus(target.target_id, "engaged");
  }
  return result.success;
}
