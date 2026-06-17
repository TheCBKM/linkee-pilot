import { createPost } from "../clients/unipile.js";
import { executeWithRateLimit } from "../rate-limiter/index.js";
import { savePost } from "../db/store.js";
import { draftPost } from "../ai/post-writer.js";

export async function publishPost(recentTrends?: string): Promise<boolean> {
  const draft = await draftPost(recentTrends);
  if (!draft) return false;

  const result = await executeWithRateLimit({
    actionType: "create_post",
    targetId: `post-${Date.now()}`,
    content: draft.content,
    execute: async () => {
      const response = (await createPost(draft.content)) as {
        post_id?: string;
      };
      savePost(draft.content, draft.pillar, response.post_id);
      return response;
    },
  });

  return result.success;
}
