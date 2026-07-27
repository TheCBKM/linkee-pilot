import { sendPostReaction } from "../clients/unipile.js";
import { executeWithRateLimit, pickReactionType } from "../rate-limiter/index.js";
import {
  advanceSequenceStage,
  getPersonForPostTarget,
  isNurtureTarget,
  touchConnectionEngaged,
  updateTargetStatus,
  upsertPersonFromPostAuthor,
} from "../db/store.js";
import type { Target } from "../db/store.js";
import { resolvePostSocialId } from "../ai/research.js";

export async function likePost(target: Target): Promise<boolean> {
  const postId = resolvePostSocialId(target) ?? target.social_id ?? target.target_id;
  const reactionType = pickReactionType();
  const nurture = isNurtureTarget(target);

  const result = await executeWithRateLimit({
    actionType: "like_post",
    targetId: postId,
    execute: () =>
      sendPostReaction({ postId, reactionType }),
  });

  if (result.success) {
    updateTargetStatus(target.target_id, "engaged");

    if (nurture) {
      if (target.author_provider_id) {
        touchConnectionEngaged(target.author_provider_id);
      }
      // Nurture likes must not advance the cold-outreach invite sequence.
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
      advanceSequenceStage(personId, "liked");
    }
  }
  return result.success;
}
