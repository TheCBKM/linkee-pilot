import { LIMITS } from "../config/limits.js";
import { chatCompletion, systemPromptWithBrand, parseJsonResponse } from "../clients/openai.js";
import type { DiscoveredTarget } from "./research.js";

export async function scoreTarget(target: DiscoveredTarget): Promise<number> {
  const system = systemPromptWithBrand(
    `You score LinkedIn targets for a remote job and freelance search.
Return JSON only: {"score": number, "reason": string}

Score 0-100 on how likely this target moves the career goal forward:
- Highest: people who can hire or refer right now. Technical recruiters and sourcers, talent acquisition, heads of talent, hiring managers, engineering managers and directors, founders and CTOs at remote-friendly companies, and agency or consultancy owners who buy contract engineering work.
- Highest for posts: live remote hiring posts, contract or freelance requests, and "we're looking for" posts in AI, LLM, backend, platform, or DevOps.
- High: people whose work overlaps the target roles, where a genuine technical conversation is credible.
- Low: pure personal-brand accounts, career coaches, resume writers, and fellow job seekers. They cannot hire.
- Low: roles or posts that are clearly on-site only. Remote is non-negotiable.

Geography: US, Canada, UK, Western and Northern Europe, Australia, and India are all in scope. Do not penalize a target for being based in India. What matters is that the role or company is remote, not where it sits. Score much lower only for the rest of South Asia.
Post traction matters less than hiring intent. A fresh hiring post with two reactions still scores high.
Only score >= ${LIMITS.minRelevanceScore} proceeds to discovery; likes and comments use an even higher bar.`
  );

  const engagement =
    target.target_type === "post"
      ? `Reactions: ${target.reaction_count ?? "unknown"}; Comments: ${target.comment_count ?? "unknown"}`
      : "N/A";

  const user = `Target type: ${target.target_type}
Author: ${target.author_name ?? "unknown"}
Headline: ${target.author_headline ?? "unknown"}
Location: ${target.location ?? "unknown"}
${engagement}
Content: ${target.content_preview ?? "N/A"}`;

  try {
    const response = await chatCompletion({ system, user, temperature: 0.3 });
    const parsed = await parseJsonResponse<{ score: number }>(response);
    return Math.min(100, Math.max(0, Math.round(parsed.score)));
  } catch {
    return target.target_type === "post" ? 50 : 40;
  }
}

export async function scoreTargets(
  targets: DiscoveredTarget[]
): Promise<(DiscoveredTarget & { relevance_score: number })[]> {
  const scored = await Promise.all(
    targets.map(async (t) => ({
      ...t,
      relevance_score: await scoreTarget(t),
    }))
  );
  return scored.filter((t) => t.relevance_score >= LIMITS.minRelevanceScore);
}
