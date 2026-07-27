import {
  sendPostReaction,
  getPostComments,
  parseCommentAuthor,
} from "../clients/unipile.js";
import { executeWithRateLimit } from "../rate-limiter/index.js";
import type { Target } from "../db/store.js";
import { isOwnProviderId } from "../config/identity.js";

export async function likeComment(target: Target): Promise<boolean> {
  const postId = target.social_id ?? target.target_id;

  let commentId: string | undefined;
  try {
    const comments = await getPostComments(postId, 5);
    const pick = (comments.items ?? []).find((c) => {
      if (!c.id) return false;
      const author = parseCommentAuthor(c);
      if (author.isCompany) return false;
      if (isOwnProviderId(author.providerId)) return false;
      return true;
    });
    if (!pick?.id) return false;
    commentId = pick.id;
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
