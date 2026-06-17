import { BRAND } from "../config/brand.js";
import { chatCompletion, systemPromptWithBrand } from "../clients/openai.js";
import { safetyFilter } from "./safety-filter.js";

export async function draftPost(recentTrends?: string): Promise<{
  content: string;
  pillar: string;
} | null> {
  const pillar =
    BRAND.contentPillars[
      Math.floor(Math.random() * BRAND.contentPillars.length)
    ];

  const system = systemPromptWithBrand(
    `Write a LinkedIn thought-leadership post. Rules:
- Hook + insight + takeaway format
- 150-300 words
- Pillar for this post: ${pillar}
- No links, no hashtags spam, no self-promotion
- Share a genuine builder perspective`
  );

  const user = recentTrends
    ? `Recent trends spotted in feed:\n${recentTrends}\n\nWrite the post.`
    : `Write an original post about: ${pillar}. Output the post text only.`;

  let content = await chatCompletion({
    system,
    user,
    temperature: 0.85,
    maxTokens: 600,
  });

  content = content.trim();

  const safety = await safetyFilter({ text: content, contentType: "post" });
  if (!safety.safe) {
    console.warn("[post-writer] Blocked:", safety.reason);
    return null;
  }

  return { content, pillar };
}
