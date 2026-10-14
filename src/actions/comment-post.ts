import { sendPostComment } from "../clients/unipile.js";
import { executeWithRateLimit } from "../rate-limiter/index.js";
import {
  advanceSequenceStage,
  getPersonForPostTarget,
  isNurtureTarget,
  markTargetSkipped,
  touchConnectionEngaged,
  updateTargetStatus,
  upsertPersonFromPostAuthor,
} from "../db/store.js";
import { draftComment } from "../ai/comment-writer.js";
import type { Target } from "../db/store.js";
import { isGroupPost, resolvePostSocialId } from "../ai/research.js";

export async function commentOnPost(target: Target): Promise<boolean> {
  const postId = resolvePostSocialId(target) ?? target.social_id ?? target.target_id;
  const content = target.content_preview ?? "";
  const nurture = isNurtureTarget(target);

  // Commenting would fail with errors/invalid_post, so skip before paying for
  // an AI draft.
  if (isGroupPost(target)) {
    console.log(
      `[comment] Skipping group post ${postId.slice(0, 60)}: comments unsupported`
    );
    markTargetSkipped(target.target_id);
    return false;
  }

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

    if (nurture) {
      if (target.author_provider_id) {
        touchConnectionEngaged(target.author_provider_id);
      }
      // Nurture comments must not advance the cold-outreach invite sequence.
      return true;
    }

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
