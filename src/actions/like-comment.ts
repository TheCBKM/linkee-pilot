import { sendPostReaction, getPostComments } from "../clients/unipile.js";
import { executeWithRateLimit } from "../rate-limiter/index.js";
import type { Target } from "../db/store.js";

export async function likeComment(target: Target): Promise<boolean> {
  const postId = target.social_id ?? target.target_id;

  let commentId: string | undefined;
  try {
    const comments = (await getPostComments(postId, 5)) as {
      items?: { id: string }[];
    };
    const first = comments.items?.[0];
    if (!first?.id) return false;
    commentId = first.id;
  } catch {
    return false;
  }

  const result = await executeWithRateLimit({
    actionType: "like_comment",
    targetId: `${postId}:${commentId}`,
    execute: () =>
      sendPostReaction({ postId, commentId, reactionType: "like" }),
  });

  return result.success;
}
