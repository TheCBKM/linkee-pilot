/**
 * Targeting for the Elasticsearch invite pipeline.
 *
 * Personal networking for Rajaram, not Scrummer outreach: senior,
 * high-influence people in tech (CXOs, VPs, founders, investors) across
 * India and the US, split roughly 50/50.
 *
 * Field values come from the `person` index (lowercase, PDL-style), e.g.
 * location_country = "united states", job_company_industry = "computer software".
 */

export const ES_COUNTRIES = ["united states", "india"] as const;
export type EsCountry = (typeof ES_COUNTRIES)[number];

export type EsSegment =
  | "tech_cxo"
  | "eng_executives"
  | "founders"
  | "product_executives"
  | "investors";

export const ES_SEGMENTS: readonly EsSegment[] = [
  "tech_cxo",
  "eng_executives",
  "founders",
  "product_executives",
  "investors",
];

/** Current-company industries that count as "tech". */
const TECH_INDUSTRIES = [
  "computer software",
  "information technology and services",
  "internet",
  "computer & network security",
  "computer networking",
  "computer games",
  "e-learning",
  "financial services",
] as const;

const INVESTOR_INDUSTRIES = ["venture capital & private equity"] as const;

/** job_company_size buckets in the index. */
const SIZE_50_PLUS = ["51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+"];
const SIZE_10_PLUS = ["11-50", ...SIZE_50_PLUS];

export interface EsSegmentSpec {
  /** Phrases matched against job_title (any one must match). */
  titles: readonly string[];
  industries: readonly string[];
  /** Allowed job_company_size buckets; omit for any size. */
  companySizes?: readonly string[];
}

/**
 * job_title_levels / job_title_role are too noisy to use alone (students
 * tagged "director", etc.), so title phrases are the primary signal and
 * company size keeps out one-person "CEOs" and tiny-shop "Directors".
 */
export const ES_SEGMENT_SPECS: Record<EsSegment, EsSegmentSpec> = {
  tech_cxo: {
    titles: [
      "cto",
      "chief technology officer",
      "chief information officer",
      "chief product officer",
      "chief digital officer",
      "chief data officer",
      "chief ai officer",
      "chief operating officer",
    ],
    industries: TECH_INDUSTRIES,
    companySizes: SIZE_50_PLUS,
  },
  eng_executives: {
    titles: [
      "vp engineering",
      "vp of engineering",
      "vice president of engineering",
      "vice president engineering",
      "svp engineering",
      "senior vice president engineering",
      "head of engineering",
      "director of engineering",
      "senior director of engineering",
      "engineering director",
      "head of technology",
      "head of ai",
      "head of platform",
    ],
    industries: TECH_INDUSTRIES,
    companySizes: SIZE_50_PLUS,
  },
  founders: {
    titles: [
      "founder",
      "co-founder",
      "cofounder",
      "chief executive officer",
      "ceo",
    ],
    industries: TECH_INDUSTRIES,
    companySizes: SIZE_10_PLUS,
  },
  product_executives: {
    titles: [
      "vp product",
      "vp of product",
      "vice president of product",
      "head of product",
      "director of product",
      "senior director of product",
    ],
    industries: TECH_INDUSTRIES,
    companySizes: SIZE_50_PLUS,
  },
  investors: {
    titles: [
      "general partner",
      "managing partner",
      "founding partner",
      "venture partner",
      "partner",
    ],
    industries: INVESTOR_INDUSTRIES,
  },
};

/** Reject when job_title matches any of these (ES must_not). */
export const ES_TITLE_EXCLUDES = [
  "intern",
  "student",
  "trainee",
  "assistant",
  "associate",
  "recruiter",
  "talent acquisition",
  "freelance",
  "freelancer",
  "teacher",
  "professor",
  "sales",
  "former",
  "ex-",
] as const;

/** Local post-filter on headline/title after ES returns results. */
export const ES_HEADLINE_EXCLUDE_PATTERNS = [
  /#?open\s*to\s*work\b/i,
  /\bseeking\b.*\b(role|opportunit)/i,
  /\blooking for (a )?(new )?(role|job|opportunit)/i,
  /\bundergrad\b/i,
  /\bstudent\b/i,
  /\bintern\b/i,
] as const;
