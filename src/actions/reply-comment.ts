import {
  getPostComments,
  parseCommentAuthor,
  sendPostComment,
  type PostComment,
} from "../clients/unipile.js";
import { executeWithRateLimit } from "../rate-limiter/index.js";
import {
  getRecentOwnPosts,
  hasCompletedAction,
  upsertPersonFromPostAuthor,
  type OwnPostRow,
} from "../db/store.js";
import { draftCommentReply } from "../ai/comment-writer.js";
import { isOwnProviderId } from "../config/identity.js";
import { LIMITS } from "../config/limits.js";
import { normalizeLinkedInPostId } from "../ai/research.js";

const COMMENT_FETCH_LIMIT = 15;
/** Warm-lead relevance so ICP-passing commenters enter the pending pool. */
const COMMENTER_RELEVANCE = 85;

export interface ReplyCandidate {
  post: OwnPostRow;
  postSocialId: string;
  comment: PostComment;
  author: ReturnType<typeof parseCommentAuthor>;
}

function isEligibleComment(comment: PostComment): boolean {
  if (!comment.id || !comment.text?.trim()) return false;

  const author = parseCommentAuthor(comment);
  if (author.isCompany) return false;
  if (isOwnProviderId(author.providerId)) return false;
  if (isOwnProviderId(author.publicId ? `person:${author.publicId}` : null)) {
    return false;
  }
  if (
    hasCompletedAction(
      "reply_comment",
      comment.id,
      LIMITS.dedupWindowDays
    )
  ) {
    return false;
  }
  return true;
}

/** Find the first unreplied top-level comment on a recent own post. */
export async function findReplyCandidate(): Promise<ReplyCandidate | null> {
  const posts = getRecentOwnPosts(LIMITS.ownPostReplyWindowHours);
  for (const post of posts) {
    const postSocialId = normalizeLinkedInPostId(post.post_id);
    if (!postSocialId) continue;

    let items: PostComment[] = [];
    try {
      const list = await getPostComments(postSocialId, COMMENT_FETCH_LIMIT);
      items = list.items ?? [];
    } catch (err) {
      console.warn(
        `[reply-comment] Failed to list comments for ${postSocialId}:`,
        err instanceof Error ? err.message : err
      );
      continue;
    }

    for (const comment of items) {
      if (!isEligibleComment(comment)) continue;
      return {
        post,
        postSocialId,
        comment,
        author: parseCommentAuthor(comment),
      };
    }
  }
  return null;
}

export async function replyToOwnPostComment(): Promise<boolean> {
  const candidate = await findReplyCandidate();
  if (!candidate) return false;

  const { post, postSocialId, comment, author } = candidate;
  const reply = await draftCommentReply({
    postContent: post.content,
    commentText: comment.text!.trim(),
    commenterName: author.name ?? undefined,
  });
  if (!reply) return false;

  const result = await executeWithRateLimit({
    actionType: "reply_comment",
    targetId: comment.id,
    content: reply,
    execute: () =>
      sendPostComment({
        postId: postSocialId,
        text: reply,
        commentId: comment.id,
      }),
  });

  if (result.success) {
    upsertPersonFromPostAuthor({
      providerId: author.providerId,
      publicId: author.publicId,
      name: author.name,
      headline: author.headline,
      sourcePostId: postSocialId,
      relevanceScore: COMMENTER_RELEVANCE,
      personSource: "comment",
    });
    console.log(
      `[reply-comment] Replied to ${author.name ?? comment.id} on ${postSocialId}`
    );
  }

  return result.success;
}
