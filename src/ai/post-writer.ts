import { BRAND } from "../config/brand.js";
import { chatCompletion, systemPromptWithBrand } from "../clients/openai.js";
import { getRepostCandidate } from "../db/store.js";
import { canSharePost } from "./research.js";
import { safetyFilter } from "./safety-filter.js";
import type { Target } from "../db/store.js";

export type PostFormat = "text" | "repost";

export interface PostDraft {
  format: PostFormat;
  content: string;
  pillar: string;
  repostPostId?: string;
  sourcePostId?: string;
}

const REPOST_CHANCE = 0.15;

export async function draftPost(recentTrends?: string): Promise<PostDraft | null> {
  if (Math.random() < REPOST_CHANCE) {
    const candidate = getRepostCandidate();
    if (candidate && canSharePost(candidate.metadata)) {
      const repost = await draftRepostCommentary(candidate);
      if (repost) return repost;
    }
  }

  return draftTextPost(recentTrends);
}

async function draftTextPost(recentTrends?: string): Promise<PostDraft | null> {
  const pillar =
    BRAND.contentPillars[
      Math.floor(Math.random() * BRAND.contentPillars.length)
    ];

  const trendRule = recentTrends
    ? `- React to at least one real theme from the research bullets below — do not invent a topic in a vacuum`
    : `- Anchor the post in this pillar: ${pillar}`;

  const system = systemPromptWithBrand(
    `Write a LinkedIn thought-leadership post built for early engagement. Rules:
- Hook first: open with a specific observation, number, failure, or contrarian claim in the first 1-2 lines
- Structure: hook → one concrete story/detail → takeaway → soft ask
- 80-180 words (tight beats long essays)
- ${trendRule}
- No links, no hashtag spam, no self-promotion
- Do not mention Scrummer by name or include a product CTA
- Soft engagement closer: end with one sharp question or "curious how you handle X" — never a generic "thoughts?" / "agree?" CTA
- Share a CTO/builder perspective:
  - Write like a busy CTO sharing a real observation — not a content marketer
  - Short paragraphs with line breaks; avoid bullet lists and numbered lists
  - Include one specific, concrete detail (a scenario, mistake, or small win from building)
  - Vary rhythm — mix short punchy lines with longer ones
  - Contractions and first person are fine when natural
  - No buzzword soup (leverage, delve, landscape, unlock, game-changer, paradigm, robust)
  - No cliché hooks ("In today's fast-paced world", "Let me be honest", "Here's the truth")
  - No inspirational sign-offs or neat bows`
  );

  const user = recentTrends
    ? `Research themes from recent high-relevance feed posts:\n${recentTrends}\n\nWrite the post text only.`
    : `Write an original post about: ${pillar}. Output the post text only.`;

  let content = await chatCompletion({
    system,
    user,
    temperature: 0.92,
    maxTokens: 500,
  });

  content = content.trim();

  const safety = await safetyFilter({ text: content, contentType: "post" });
  if (!safety.safe) {
    console.warn("[post-writer] Blocked:", safety.reason);
    return null;
  }

  return { format: "text", content, pillar };
}

async function draftRepostCommentary(
  candidate: Target
): Promise<PostDraft | null> {
  const postId = candidate.social_id ?? candidate.target_id;
  const original = candidate.content_preview ?? "";

  const system = systemPromptWithBrand(
    `Write a short LinkedIn repost commentary (your take on someone else's post). Rules:
- 2-4 sentences, max 400 characters
- Add a genuine insight or sharp question — don't just agree
- Reference a specific point from the original post
- No links, no self-promotion, no "great post" openers
- Sound like a CTO reacting between meetings`
  );

  const user = `Original post by ${candidate.author_name ?? "someone"}:
${original}

Write commentary only. This will appear above a repost.`;

  let content = await chatCompletion({
    system,
    user,
    temperature: 0.88,
    maxTokens: 200,
  });

  content = content.replace(/^["']|["']$/g, "").trim();

  const safety = await safetyFilter({ text: content, contentType: "post" });
  if (!safety.safe) {
    console.warn("[post-writer] Repost blocked:", safety.reason);
    return null;
  }

  return {
    format: "repost",
    content,
    pillar: "repost",
    repostPostId: postId,
    sourcePostId: postId,
  };
}
