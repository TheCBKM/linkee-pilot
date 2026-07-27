import { BRAND } from "../config/brand.js";
import { chatCompletion, systemPromptWithBrand } from "../clients/openai.js";
import { getRepostCandidate } from "../db/store.js";
import { canSharePost, resolvePostSocialId } from "./research.js";
import { humanizeContent } from "./humanize.js";
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
    ? `- React to at least one real theme from the research bullets below. Do not invent a topic in a vacuum`
    : `- Anchor the post in this pillar: ${pillar}`;

  const system = systemPromptWithBrand(
    `Write a LinkedIn thought-leadership post built for credibility and useful discussion. Rules:
- Hook first: open with a specific observation, number, failure, or contrarian claim in the first 1-2 lines
- Choose ONE structure and vary it across drafts: technical teardown, before/after workflow, contrarian opinion, build-in-public update, failure analysis, or concise field note
- 80-180 words (tight beats long essays)
- ${trendRule}
- No links, no hashtag spam, no self-promotion
- Do not mention Scrummer by name or include a product CTA
- A closing question is optional. Never use a generic "thoughts?", "agree?", or repeated "curious how you handle X" CTA
- NEVER use em dashes (—), en dashes (–), or double-hyphen dashes (--). Use commas, periods, or a single hyphen.
- Share a CTO/builder perspective:
  - Write like a busy CTO sharing a real observation, not a content marketer
  - Short paragraphs with line breaks; avoid bullet lists and numbered lists
  - Include one specific, concrete detail only when it is supplied by research or the selected pillar
  - Never invent customer stories, team experiments, dates, metrics, quotes, or phrases such as "last quarter we tried"
  - If no verified story is available, frame the post as an engineering principle, design tradeoff, or open technical question
  - Explain mechanism, not just symptoms: show why a workflow or system fails and what design choice improves it
  - Vary rhythm: mix short punchy lines with longer ones
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

  content = humanizeContent(content.trim());

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
  const repostPostId = resolvePostSocialId(candidate);
  if (!repostPostId) {
    console.warn("[post-writer] Repost skipped: missing social_id for target");
    return null;
  }

  // Keep the DB key stable (matches targets.social_id used by getRepostCandidate).
  const sourcePostId = candidate.social_id ?? candidate.target_id;
  const original = candidate.content_preview ?? "";

  const system = systemPromptWithBrand(
    `Write a short LinkedIn repost commentary (your take on someone else's post). Rules:
- 2-4 sentences, max 400 characters
- Add a genuine insight or sharp question. Don't just agree
- Reference a specific point from the original post
- No links, no self-promotion, no "great post" openers
- NEVER use em dashes (—), en dashes (–), or double-hyphen dashes (--). Use commas, periods, or a single hyphen.
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

  content = humanizeContent(content.replace(/^["']|["']$/g, "").trim());

  const safety = await safetyFilter({ text: content, contentType: "post" });
  if (!safety.safe) {
    console.warn("[post-writer] Repost blocked:", safety.reason);
    return null;
  }

  return {
    format: "repost",
    content,
    pillar: "repost",
    repostPostId,
    sourcePostId,
  };
}
