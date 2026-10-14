import { chatCompletion, systemPromptWithBrand } from "../clients/openai.js";
import { LIMITS } from "../config/limits.js";
import { humanizeContent } from "./humanize.js";
import { safetyFilter } from "./safety-filter.js";

/** Shared voice rules so first-touch and follow-up read like the same person. */
const DM_VOICE_RULES = `- Sound like a real person typing quickly, not a template
- Vary sentence length. One short sentence is fine
- Use contractions naturally
- No greeting boilerplate beyond a first name, no sign-off, no "hope you're well"
- No buzzwords (leverage, delve, landscape, synergy, game-changer, robust)
- No flattery, no "I came across your profile", no "I was impressed by"
- No links, no email addresses, no phone numbers
- NEVER use em dashes, en dashes, or double-hyphen dashes. Use commas, periods, or a single hyphen`;

export interface FirstTouchDmInput {
  name?: string | null;
  headline?: string | null;
  /** Their recent post or hiring context, when we have it. */
  context?: string | null;
}

/**
 * Soft first message to a fresh connection. Deliberately makes no ask:
 * no availability pitch, no CV, no "are you hiring". The goal is a reply.
 */
export async function draftFirstTouchDm(
  input: FirstTouchDmInput
): Promise<string | null> {
  const system = systemPromptWithBrand(
    `Write the first LinkedIn direct message to someone who just accepted your
connection request. They can hire engineers or buy contract work, but this
message is NOT a pitch.

Hard rules:
- 2-3 sentences, max ${LIMITS.contentMaxLength.dm} characters
- Open with their first name only
- Reference something concrete: what their team builds, what they hire for, or a point from their recent post
- Offer one genuine observation or ask one specific question a peer would ask
- Make NO ask. Never mention that you are looking for work, open to roles, available for contracts, or want to be considered. Never attach or offer a CV. Never ask for a call, a referral, or their time
- If they are a recruiter, talk about the engineering problem behind the roles they fill, not the roles
- The only goal is a reply that starts a real conversation
${DM_VOICE_RULES}`
  );

  const user = `Recipient: ${input.name ?? "unknown"}
Headline: ${input.headline ?? "unknown"}
Context: ${input.context?.slice(0, 1200) ?? "(none available)"}

Write the message only. No quotes around it.`;

  return finalize(system, user, "first_touch");
}

export interface DmFollowupInput {
  name?: string | null;
  headline?: string | null;
  /** What we said first. */
  previousMessage: string;
  /** What they replied. */
  theirReply: string;
}

/**
 * Reply after they answer. Availability may be mentioned once, plainly, and
 * only when their reply actually opens the door to it.
 */
export async function draftDmFollowup(
  input: DmFollowupInput
): Promise<string | null> {
  const system = systemPromptWithBrand(
    `Continue a LinkedIn conversation. They replied to your first message.

Hard rules:
- 2-4 sentences, max ${LIMITS.contentMaxLength.dm} characters
- Answer or engage with what they actually said. Never restart the conversation
- If, and only if, their reply opens the door (they mention a role, a project, hiring, or ask what you do), state your availability once in a single plain clause and name the most relevant thing you have shipped. Otherwise keep talking shop and make no ask
- Never oversell. One concrete detail beats three adjectives
- Never ask for a call in the first follow-up. Let them propose it
${DM_VOICE_RULES}`
  );

  const user = `Recipient: ${input.name ?? "unknown"}
Headline: ${input.headline ?? "unknown"}

You wrote:
${input.previousMessage}

They replied:
${input.theirReply.slice(0, 1200)}

Write your reply only. No quotes around it.`;

  return finalize(system, user, "followup");
}

async function finalize(
  system: string,
  user: string,
  label: string
): Promise<string | null> {
  let text: string;
  try {
    text = await chatCompletion({
      system,
      user,
      temperature: 0.85,
      maxTokens: 220,
    });
  } catch (err) {
    console.warn(`[dm-writer] Generation failed (${label}):`, err);
    return null;
  }

  text = humanizeContent(text.replace(/^["']|["']$/g, ""));

  if (text.length > LIMITS.contentMaxLength.dm) {
    text = trimToSentence(text, LIMITS.contentMaxLength.dm);
  }

  const safety = await safetyFilter({ text, contentType: "dm" });
  if (!safety.safe) {
    console.warn(`[dm-writer] Blocked (${label}):`, safety.reason);
    return null;
  }

  return text;
}

/** Prefer cutting at a sentence end so an over-long draft still reads whole. */
function trimToSentence(text: string, maxLength: number): string {
  const clipped = text.slice(0, maxLength);
  const lastStop = Math.max(
    clipped.lastIndexOf("."),
    clipped.lastIndexOf("?"),
    clipped.lastIndexOf("!")
  );
  if (lastStop > maxLength * 0.5) return clipped.slice(0, lastStop + 1).trim();
  return clipped.trim();
}
