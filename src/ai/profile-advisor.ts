import {
  chatCompletion,
  systemPromptWithBrand,
  parseJsonResponse,
} from "../clients/openai.js";
import { getOwnProfile } from "../clients/unipile.js";
import { saveProfileSnapshot } from "../db/store.js";

export interface ProfileSuggestions {
  headlineVariants: string[];
  aboutRewrite: string;
  analysis: string;
}

export async function runProfileAudit(): Promise<ProfileSuggestions | null> {
  try {
    const profile = (await getOwnProfile()) as Record<string, unknown>;
    const headline = (profile.headline ?? profile.occupation ?? "") as string;
    const about = (profile.summary ?? profile.about ?? "") as string;

    const system = systemPromptWithBrand(
      `You are a LinkedIn profile optimization advisor.
Return JSON only:
{
  "headlineVariants": ["option1", "option2", "option3"],
  "aboutRewrite": "full about section rewrite",
  "analysis": "brief analysis of current profile vs brand goal"
}
Do not auto-apply changes — suggestions only.`
    );

    const user = `Current headline: ${headline || "(empty)"}
Current about: ${about || "(empty)"}

Suggest improvements aligned with the brand goal.`;

    const response = await chatCompletion({
      system,
      user,
      temperature: 0.7,
      maxTokens: 800,
    });

    const suggestions = await parseJsonResponse<ProfileSuggestions>(response);

    saveProfileSnapshot({
      headline: headline || null,
      about: about || null,
      followerCount: null,
      suggestions: JSON.stringify(suggestions),
    });

    console.log("\n=== Profile Audit Suggestions ===");
    console.log("Analysis:", suggestions.analysis);
    console.log("\nHeadline options:");
    suggestions.headlineVariants.forEach((h, i) =>
      console.log(`  ${i + 1}. ${h}`)
    );
    console.log("\nAbout rewrite:\n", suggestions.aboutRewrite);

    return suggestions;
  } catch (err) {
    console.error("[profile-advisor] Failed:", err);
    return null;
  }
}
