import {
  chatCompletion,
  parseJsonResponse,
  systemPromptWithBrand,
} from "../clients/openai.js";
import { BRAND } from "../config/brand.js";

export interface JobMatchInput {
  title: string;
  company?: string | null;
  location?: string | null;
  presence?: string | null;
  jobType?: string | null;
  seniority?: string | null;
  salary?: string | null;
  skills?: string[] | null;
  description?: string | null;
}

export interface JobMatch {
  score: number;
  /** Why this is a fit, in the candidate's own terms. */
  reasons: string[];
  /** Honest gaps worth knowing before applying. */
  gaps: string[];
  /** One-paragraph tailored pitch, reusable for an application or a DM. */
  pitch: string;
  /** False when the listing is not genuinely remote. */
  isRemote: boolean;
}

const FALLBACK: JobMatch = {
  score: 0,
  reasons: [],
  gaps: ["Scoring failed, review manually"],
  pitch: "",
  isRemote: false,
};

export async function matchJob(input: JobMatchInput): Promise<JobMatch> {
  const system = systemPromptWithBrand(
    `You evaluate a LinkedIn job listing against this candidate's profile and goals.

Return JSON only:
{
  "score": number,
  "reasons": ["short concrete fit reason", "..."],
  "gaps": ["short honest gap", "..."],
  "pitch": "one paragraph, 60-90 words",
  "isRemote": boolean
}

Scoring rules:
- 85-100: strong fit on stack and seniority, genuinely remote, and the work is AI/LLM, backend, platform, or engineering leadership.
- 70-84: good fit with one or two gaps that a strong portfolio can cover.
- 40-69: adjacent. Wrong seniority, thin overlap, or a stack the candidate has not shipped.
- 0-39: wrong domain, not remote, or requires credentials the candidate does not have.
- Cap the score at 35 if the role is not genuinely remote, or if it requires being in a specific office or country the candidate cannot be in. Remote is non-negotiable.
- Do not inflate. A useful score is one that lets the candidate ignore most listings.
- If no description is available, score on title, skills, and seniority alone, and say so in "gaps". Do not guess at unstated requirements.

Rules for "reasons" and "gaps": be specific and short. Reference the actual stack or scale, never generic phrases like "strong technical background". Only cite a gap the listing actually implies; never invent a constraint the candidate stated they do not have, and note that the candidate already overlaps US, UK, EU, and AU hours.

Rules for "pitch": write in first person as the candidate, addressed to the hiring side. Lead with the single most relevant shipped system and its scale, connect it to what this role needs, and close with availability in one clause. No greeting, no sign-off, no flattery, no buzzwords. NEVER use em dashes, en dashes, or double-hyphen dashes.`
  );

  const user = `Job title: ${input.title}
Company: ${input.company ?? "unknown"}
Location: ${input.location ?? "unknown"}
Workplace type: ${input.presence ?? "unknown"}
Employment type: ${input.jobType ?? "unknown"}
Seniority: ${input.seniority ?? "unknown"}
Salary: ${input.salary ?? "not stated"}
Listed skills: ${input.skills?.length ? input.skills.join(", ") : "none listed"}

Description:
${(input.description ?? "(no description available)").slice(0, 6000)}

Candidate target roles: ${BRAND.targetRoles.join("; ")}
Candidate availability: ${BRAND.availability}`;

  try {
    const response = await chatCompletion({
      system,
      user,
      temperature: 0.3,
      maxTokens: 600,
    });

    const parsed = await parseJsonResponse<Partial<JobMatch>>(response);

    return {
      score: clampScore(parsed.score),
      reasons: toStringArray(parsed.reasons),
      gaps: toStringArray(parsed.gaps),
      pitch: typeof parsed.pitch === "string" ? parsed.pitch.trim() : "",
      isRemote: parsed.isRemote !== false,
    };
  } catch (err) {
    console.warn(`[job-matcher] Scoring failed for "${input.title}":`, err);
    return { ...FALLBACK };
  }
}

function clampScore(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 5);
}
