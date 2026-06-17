import { chatCompletion, systemPromptWithBrand } from "../clients/openai.js";
import { LIMITS } from "../config/limits.js";
import { safetyFilter } from "./safety-filter.js";

export async function draftComment(params: {
  postContent: string;
  authorName?: string;
}): Promise<string | null> {
  const system = systemPromptWithBrand(
    `Write a LinkedIn comment. Rules:
- 1-3 sentences, max ${LIMITS.contentMaxLength.comment} characters
- Add genuine insight or a thoughtful question
- Reference a specific point from the post
- No links, no self-promotion, no "DM me", no generic praise
- Match the builder/innovator voice`
  );

  const user = `Post by ${params.authorName ?? "someone"}:
${params.postContent}

Write one comment only. No quotes around it.`;

  let text = await chatCompletion({
    system,
    user,
    temperature: 0.8,
    maxTokens: 150,
  });

  text = text.replace(/^["']|["']$/g, "").trim();

  if (text.length > LIMITS.contentMaxLength.comment) {
    text = text.slice(0, LIMITS.contentMaxLength.comment - 3) + "...";
  }

  const safety = await safetyFilter({ text, contentType: "comment" });
  if (!safety.safe) {
    console.warn("[comment-writer] Blocked:", safety.reason);
    return null;
  }

  return text;
}

export async function draftInviteNote(params: {
  name?: string;
  headline?: string;
}): Promise<string | null> {
  const system = systemPromptWithBrand(
    `Write a LinkedIn connection request note. Rules:
- Max ${LIMITS.contentMaxLength.invite} characters
- Personalized, mention shared interest in recruiting/workforce tech
- No links, no sales pitch, no "let's connect" clichés
- Warm but professional`
  );

  const user = `Connecting with: ${params.name ?? "professional"}
Headline: ${params.headline ?? "unknown"}

Write the note only. No quotes.`;

  let text = await chatCompletion({
    system,
    user,
    temperature: 0.8,
    maxTokens: 120,
  });

  text = text.replace(/^["']|["']$/g, "").trim();

  if (text.length > LIMITS.contentMaxLength.invite) {
    text = text.slice(0, LIMITS.contentMaxLength.invite - 3) + "...";
  }

  const safety = await safetyFilter({ text, contentType: "invite" });
  if (!safety.safe) {
    console.warn("[invite-writer] Blocked:", safety.reason);
    return null;
  }

  return text;
}
