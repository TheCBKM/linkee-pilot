import { LIMITS } from "../config/limits.js";
import { chatCompletion, systemPromptWithBrand, parseJsonResponse } from "../clients/openai.js";
import type { DiscoveredTarget } from "./research.js";

export async function scoreTarget(target: DiscoveredTarget): Promise<number> {
  const system = systemPromptWithBrand(
    `You score LinkedIn targets for engagement relevance.
Return JSON only: {"score": number, "reason": string}
Score 0-100 based on: brand pillar relevance, author influence in engineering leadership, agile, or dev productivity, and engagement potential.
Prefer targets in US, Canada, UK, Western/Northern Europe, Australia, or Russia. Score India / South Asia locations much lower unless clearly a global exec based there temporarily.
Factor in existing post traction (reactions/comments) when present: higher engagement => higher score.
Only score >= ${LIMITS.minRelevanceScore} should proceed for discovery; likes/comments use an even higher bar.`
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
