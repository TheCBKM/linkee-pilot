import { getEnv } from "../config/env.js";
import {
  ES_SEGMENT_SPECS,
  ES_TITLE_EXCLUDES,
  type EsCountry,
  type EsSegment,
} from "../config/es-icp.js";

export interface EsPerson {
  esId: string;
  linkedinUsername: string;
  linkedinUrl: string | null;
  fullName: string | null;
  jobTitle: string | null;
  company: string | null;
  headline: string | null;
  country: string;
}

const SOURCE_FIELDS = [
  "full_name",
  "linkedin_username",
  "linkedin_url",
  "job_title",
  "job_company_name",
  "headline",
  "location_country",
];

export class ElasticsearchError extends Error {
  constructor(
    public status: number,
    public body: string
  ) {
    super(`Elasticsearch error ${status}: ${body.slice(0, 500)}`);
    this.name = "ElasticsearchError";
  }
}

export function isEsConfigured(): boolean {
  const env = getEnv();
  return !!env.ES_URL && !!env.ES_USERNAME && !!env.ES_PASSWORD;
}

function buildQuery(params: {
  country: EsCountry;
  segment: EsSegment;
  size: number;
  seed: number;
}): Record<string, unknown> {
  const spec = ES_SEGMENT_SPECS[params.segment];

  return {
    size: params.size,
    _source: SOURCE_FIELDS,
    query: {
      function_score: {
        query: {
          bool: {
            filter: [
              { term: { "location_country.keyword": params.country } },
              { terms: { "job_company_industry.keyword": [...spec.industries] } },
              ...(spec.companySizes
                ? [{ terms: { "job_company_size.keyword": [...spec.companySizes] } }]
                : []),
              { exists: { field: "linkedin_username" } },
            ],
            must: [
              {
                bool: {
                  should: spec.titles.map((t) => ({ match_phrase: { job_title: t } })),
                  minimum_should_match: 1,
                },
              },
            ],
            must_not: ES_TITLE_EXCLUDES.map((t) => ({
              match_phrase: { job_title: t },
            })),
          },
        },
        // Random sample of the matching pool so each refill brings new people.
        random_score: { seed: params.seed, field: "_seq_no" },
        boost_mode: "replace",
      },
    },
  };
}

export async function searchEsPeople(params: {
  country: EsCountry;
  segment: EsSegment;
  size: number;
}): Promise<EsPerson[]> {
  const env = getEnv();
  const url = `${env.ES_URL.replace(/\/+$/, "")}/${encodeURIComponent(env.ES_INDEX)}/_search`;
  const auth = Buffer.from(`${env.ES_USERNAME}:${env.ES_PASSWORD}`).toString("base64");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(
      buildQuery({
        ...params,
        seed: Math.floor(Math.random() * 2 ** 31),
      })
    ),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new ElasticsearchError(response.status, await response.text());
  }

  const data = (await response.json()) as {
    hits?: { hits?: { _id: string; _source?: Record<string, unknown> }[] };
  };

  const people: EsPerson[] = [];
  for (const hit of data.hits?.hits ?? []) {
    const src = hit._source ?? {};
    const username = str(src.linkedin_username);
    if (!username) continue;
    people.push({
      esId: hit._id,
      linkedinUsername: username,
      linkedinUrl: str(src.linkedin_url),
      fullName: str(src.full_name),
      jobTitle: str(src.job_title),
      company: str(src.job_company_name),
      headline: str(src.headline),
      country: str(src.location_country) ?? params.country,
    });
  }
  return people;
}

function str(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}
