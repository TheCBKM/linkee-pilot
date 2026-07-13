import { sendPostComment } from "../clients/unipile.js";
import { executeWithRateLimit } from "../rate-limiter/index.js";
import {
  advanceSequenceStage,
  getPersonForPostTarget,
  updateTargetStatus,
  upsertPersonFromPostAuthor,
} from "../db/store.js";
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

    const personId =
      upsertPersonFromPostAuthor({
        providerId: target.author_provider_id,
        publicId: target.author_public_id,
        name: target.author_name,
        headline: target.author_headline,
        sourcePostId: target.target_id,
        relevanceScore: target.relevance_score,
      }) ?? getPersonForPostTarget(target)?.target_id;

    if (personId) {
      advanceSequenceStage(personId, "commented");
    }
  }
  return result.success;
}
