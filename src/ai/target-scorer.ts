import { chatCompletion, systemPromptWithBrand, parseJsonResponse } from "../clients/openai.js";
import type { DiscoveredTarget } from "./research.js";

export async function scoreTarget(target: DiscoveredTarget): Promise<number> {
  const system = systemPromptWithBrand(
    `You score LinkedIn targets for engagement relevance.
Return JSON only: {"score": number, "reason": string}
Score 0-100 based on: brand pillar relevance, author influence in recruiting/workforce tech, engagement potential.
Only score >= 70 should proceed.`
  );

  const user = `Target type: ${target.target_type}
Author: ${target.author_name ?? "unknown"}
Headline: ${target.author_headline ?? "unknown"}
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
  return scored.filter((t) => t.relevance_score >= 70);
}
