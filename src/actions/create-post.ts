import { createPost } from "../clients/unipile.js";
import { executeWithRateLimit } from "../rate-limiter/index.js";
import { savePost, setAgentState, setBackoff } from "../db/store.js";
import { draftPost } from "../ai/post-writer.js";

const POST_DRAFT_BACKOFF_MS = 30 * 60 * 1000;
export const POST_BOOST_MS = 45 * 60 * 1000;
export const POST_BOOST_UNTIL_KEY = "post_boost_until";
export const LAST_PUBLISHED_POST_ID_KEY = "last_published_post_id";

export async function publishPost(recentTrends?: string): Promise<boolean> {
  let draft;
  try {
    draft = await draftPost(recentTrends);
  } catch (err) {
    console.error("[create-post] Failed to draft post:", err);
    setBackoff(
      "create_post",
      new Date(Date.now() + POST_DRAFT_BACKOFF_MS),
      "openai_draft_failed"
    );
    return false;
  }

  if (!draft) return false;

  const result = await executeWithRateLimit({
    actionType: "create_post",
    targetId: `post-${Date.now()}`,
    content: draft.content,
    execute: async () => {
      return (await createPost({
        text: draft.content,
        ...(draft.repostPostId && { repost: draft.repostPostId }),
      })) as { post_id?: string };
    },
  });

  if (!result.success) return false;

  const postId = result.result?.post_id;
  savePost({
    content: draft.content,
    pillar: draft.pillar,
    postId,
    format: draft.format,
    sourcePostId: draft.sourcePostId,
  });

  const boostUntil = new Date(Date.now() + POST_BOOST_MS).toISOString();
  setAgentState(POST_BOOST_UNTIL_KEY, boostUntil);
  if (postId) {
    setAgentState(LAST_PUBLISHED_POST_ID_KEY, postId);
  }
  console.log(`[create-post] Post boost until ${boostUntil}`);

  return true;
}
