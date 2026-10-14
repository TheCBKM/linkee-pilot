import type {
  JobPresence,
  JobSeniority,
  JobType,
} from "../clients/unipile.js";

/** Remote is non-negotiable. Never widen this. */
export const JOB_PRESENCE: JobPresence[] = ["remote"];

export const JOB_TYPES: JobType[] = ["full_time", "contract", "part_time"];

export const JOB_SENIORITY: JobSeniority[] = [
  "mid_senior",
  "director",
  "executive",
];

export type JobRoleFamily =
  | "ai_engineer"
  | "backend"
  | "platform_devops"
  | "engineering_leadership"
  | "founding_engineer"
  | "freelance_contract";

export interface JobSearchProfile {
  family: JobRoleFamily;
  /** Relative pick weight during discovery. */
  weight: number;
  keywords: readonly string[];
  jobTypes: JobType[];
  seniority: JobSeniority[];
}

export const JOB_SEARCH_PROFILES: readonly JobSearchProfile[] = [
  {
    family: "ai_engineer",
    weight: 30,
    keywords: [
      "AI engineer",
      "LLM engineer",
      "machine learning engineer LLM",
      "AI agent engineer",
      "generative AI engineer",
      "applied AI engineer",
    ],
    jobTypes: ["full_time", "contract"],
    seniority: ["mid_senior", "director"],
  },
  {
    family: "backend",
    weight: 25,
    keywords: [
      "senior backend engineer",
      "staff backend engineer",
      "backend engineer Node TypeScript",
      "backend engineer Python",
      "senior software engineer distributed systems",
      "Go backend engineer",
    ],
    jobTypes: ["full_time", "contract"],
    seniority: ["mid_senior", "director"],
  },
  {
    family: "platform_devops",
    weight: 12,
    keywords: [
      "platform engineer",
      "DevOps engineer",
      "site reliability engineer",
      "infrastructure engineer AWS",
    ],
    jobTypes: ["full_time", "contract"],
    seniority: ["mid_senior", "director"],
  },
  {
    family: "engineering_leadership",
    weight: 13,
    keywords: [
      "engineering manager",
      "head of engineering",
      "director of engineering",
      "CTO startup",
      "VP engineering",
    ],
    jobTypes: ["full_time"],
    seniority: ["director", "executive", "mid_senior"],
  },
  {
    family: "founding_engineer",
    weight: 10,
    keywords: [
      "founding engineer",
      "founding backend engineer",
      "first engineer startup",
      "early stage engineer AI",
    ],
    jobTypes: ["full_time"],
    seniority: ["mid_senior", "director"],
  },
  {
    family: "freelance_contract",
    weight: 10,
    keywords: [
      "contract AI engineer",
      "freelance backend developer",
      "contract software engineer remote",
      "AI automation consultant",
      "fractional CTO",
    ],
    jobTypes: ["contract", "part_time"],
    seniority: ["mid_senior", "director"],
  },
] as const;

export function pickJobSearchProfile(): JobSearchProfile {
  const total = JOB_SEARCH_PROFILES.reduce((sum, p) => sum + p.weight, 0);
  let roll = Math.random() * total;
  for (const profile of JOB_SEARCH_PROFILES) {
    roll -= profile.weight;
    if (roll <= 0) return profile;
  }
  return JOB_SEARCH_PROFILES[0];
}

export function pickJobKeyword(profile: JobSearchProfile): string {
  const { keywords } = profile;
  return keywords[Math.floor(Math.random() * keywords.length)];
}

/** Score at or above this is worth a Discord ping and recruiter follow-up. */
export const JOB_STRONG_MATCH_SCORE = 78;

/** Below this the opportunity is stored as filtered and never surfaced. */
export const JOB_MIN_KEEP_SCORE = 55;

/** Skip re-scoring a job id seen within this window. */
export const JOB_DEDUP_WINDOW_DAYS = 45;

/** Jobs pulled per discovery run. */
export const JOB_SEARCH_PAGE_SIZE = 25;

/**
 * Only look at recent postings. Jobs search takes a day count here, unlike
 * posts search which takes a string enum such as "past_week".
 */
export const JOB_POSTED_WITHIN_DAYS = 7;

/** Cap AI scoring calls per run so one search cannot burn the OpenAI budget. */
export const JOB_MAX_SCORED_PER_RUN = 8;
