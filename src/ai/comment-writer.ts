import { chatCompletion, systemPromptWithBrand } from "../clients/openai.js";
import { LIMITS } from "../config/limits.js";
import { humanizeContent } from "./humanize.js";
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
- If the post is a job or hiring post, react to the technical substance only. NEVER say you are interested, available, applying, or ask them to consider you. Public begging kills the lead
- Match the working-engineer voice
- Sound human, not AI-generated:
  - Write like you typed this between builds: casual, direct, a little imperfect
  - Vary sentence length; one short sentence is fine
  - Use contractions naturally (it's, we're, don't) when they fit
  - No buzzwords (leverage, delve, landscape, game-changer, robust, synergy)
  - No formulaic openers ("Great point!", "This resonates", "Couldn't agree more")
  - NEVER use em dashes (—), en dashes (–), double-hyphen dashes (--), or semicolons. Use commas, periods, or a single hyphen.
  - Skip polished essay tone; sound like a real person reacting to the post`
  );

  const user = `Post by ${params.authorName ?? "someone"}:
${params.postContent}

Write one comment only. No quotes around it.`;

  let text = await chatCompletion({
    system,
    user,
    temperature: 0.9,
    maxTokens: 150,
  });

  text = humanizeContent(text.replace(/^["']|["']$/g, ""));

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

export async function draftCommentReply(params: {
  postContent: string;
  commentText: string;
  commenterName?: string;
}): Promise<string | null> {
  const system = systemPromptWithBrand(
    `You are replying to someone who commented on YOUR LinkedIn post. Rules:
- 1-2 sentences, max ${LIMITS.contentMaxLength.comment} characters
- Acknowledge their specific point; continue the conversation naturally
- No links, no self-promotion, no "DM me", no generic thanks-only replies
- Match the working-engineer voice
- Sound human, not AI-generated:
  - Write like you typed this between builds: casual, direct, a little imperfect
  - Vary sentence length; one short sentence is fine
  - Use contractions naturally (it's, we're, don't) when they fit
  - No buzzwords (leverage, delve, landscape, game-changer, robust, synergy)
  - No formulaic openers ("Thanks for sharing!", "Appreciate the comment!", "Great point!")
  - NEVER use em dashes (—), en dashes (–), double-hyphen dashes (--), or semicolons. Use commas, periods, or a single hyphen.
  - Skip polished essay tone; sound like a real person talking with a commenter`
  );

  const user = `Your post:
${params.postContent}

Comment by ${params.commenterName ?? "someone"}:
${params.commentText}

Write one reply only. No quotes around it.`;

  let text = await chatCompletion({
    system,
    user,
    temperature: 0.9,
    maxTokens: 150,
  });

  text = humanizeContent(text.replace(/^["']|["']$/g, ""));

  if (text.length > LIMITS.contentMaxLength.comment) {
    text = text.slice(0, LIMITS.contentMaxLength.comment - 3) + "...";
  }

  const safety = await safetyFilter({ text, contentType: "comment" });
  if (!safety.safe) {
    console.warn("[comment-writer] Reply blocked:", safety.reason);
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
- Personalized to their headline. Anchor on shared ground: AI agents in production, backend and platform engineering, or building remote engineering teams
- If they clearly hire engineers, you may reference the kind of work they hire for. NEVER ask for a job, an interview, a referral, or say you are available. That comes later, in conversation
- No links, no CV, no sales pitch, no "let's connect" clichés
- Warm, brief, and professional. Sound like a peer, not an applicant
- NEVER use em dashes (—), en dashes (–), or double-hyphen dashes (--). Use commas, periods, or a single hyphen.`
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

  text = humanizeContent(text.replace(/^["']|["']$/g, ""));

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

/**
 * Personal networking note for the ES invite pipeline. Deliberately not
 * Scrummer-branded: Rajaram reaching out as an engineer and CTO, peer to peer.
 */
export async function draftNetworkingInviteNote(params: {
  name?: string;
  title?: string;
  company?: string;
  headline?: string;
  /** Preview mode: run the safety checks without recording the note. */
  preview?: boolean;
}): Promise<string | null> {
  const system = `You are writing a LinkedIn connection request note on behalf of Rajaram Joshi, a CTO and hands-on engineer who builds AI systems and backend platforms.
Rules:
- Max ${LIMITS.contentMaxLength.invite} characters, 1-2 short sentences
- Purpose is genuine peer networking, nothing else
- Reference their role or company specifically, not generic flattery
- Do NOT mention any product, company of Rajaram's, or Scrummer
- No links, no sales pitch, no asks for calls or meetings, no "let's connect" or "I'd love to connect" clichés
- Casual and human, like typed quickly on a phone; contractions are fine
- Address them by first name only if a name is given
- They are senior (CXO, VP, founder, investor) and get many requests: be brief, specific, and confident, not fawning
- Pick ONE concrete hook (their company, a role shift, a domain like payments or cloud data) and say something real about it
- Vary the structure; do not open with "always interested", "always curious", "noticed your work", or "I came across"
- Never use: "swap insights", "share insights", "learn from your insights", "trade notes", "shaping the industry", "like you", "would be great to", "caught my eye", "caught my attention", "always keen", "swap notes", "impressed by"
- Write company names in normal capitalization
- NEVER use em dashes (—), en dashes (–), or double-hyphen dashes (--). Use commas, periods, or a single hyphen.`;

  const firstName = params.name?.split(/\s+/)[0];
  const user = `Connecting with: ${firstName ? capitalize(firstName) : "unknown"}
Title: ${params.title ?? "unknown"}
Company: ${params.company ?? "unknown"}
Headline: ${params.headline ?? "unknown"}

Write the note only. No quotes.`;

  let text = await chatCompletion({
    system,
    user,
    temperature: 0.9,
    maxTokens: 120,
  });

  text = humanizeContent(text.replace(/^["']|["']$/g, ""));

  if (text.length > LIMITS.contentMaxLength.invite) {
    text = text.slice(0, LIMITS.contentMaxLength.invite - 3) + "...";
  }

  const safety = await safetyFilter({
    text,
    contentType: "invite",
    record: !params.preview,
  });
  if (!safety.safe) {
    console.warn("[es-invite-writer] Blocked:", safety.reason);
    return null;
  }

  return text;
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}
