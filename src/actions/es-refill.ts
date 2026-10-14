import { getEnv } from "../config/env.js";
import { LIMITS } from "../config/limits.js";
import { ICP_EXCLUDE_PATTERNS } from "../config/icp.js";
import {
  ES_COUNTRIES,
  ES_HEADLINE_EXCLUDE_PATTERNS,
  ES_SEGMENTS,
  type EsCountry,
  type EsSegment,
} from "../config/es-icp.js";
import {
  isEsConfigured,
  searchEsPeople,
  type EsPerson,
} from "../clients/elasticsearch.js";
import {
  countEsQueue,
  getAgentState,
  insertEsCandidates,
  setAgentState,
} from "../db/store.js";

const ES_REFILL_AT_KEY = "es_last_refill_at";
const ES_SEGMENT_CURSOR_KEY = "es_segment_cursor";

export interface EsRefillResult {
  country: EsCountry;
  segment: EsSegment;
  fetched: number;
  filtered: number;
  inserted: number;
}

export function isEsPipelineActive(): boolean {
  return getEnv().ES_PIPELINE_ENABLED && isEsConfigured();
}

/** Due when enabled, not refilled recently, and a country's queue is low. */
export function shouldRefillEsQueue(): boolean {
  if (!isEsPipelineActive()) return false;

  const last = getAgentState(ES_REFILL_AT_KEY);
  const intervalMs = LIMITS.es.refillIntervalMinutes * 60_000;
  if (last && Date.now() - new Date(last).getTime() < intervalMs) {
    return false;
  }

  const perCountryLowWater = Math.ceil(LIMITS.es.queueLowWater / ES_COUNTRIES.length);
  return ES_COUNTRIES.some((c) => countEsQueue(c) < perCountryLowWater);
}

/** Pull one batch from Elasticsearch into the local candidate queue. */
export async function refillEsQueue(): Promise<EsRefillResult> {
  // Stamp first so a failing ES call is not retried every loop tick.
  setAgentState(ES_REFILL_AT_KEY, new Date().toISOString());

  const country = [...ES_COUNTRIES].sort(
    (a, b) => countEsQueue(a) - countEsQueue(b)
  )[0];
  const segment = nextSegment();

  const people = await searchEsPeople({
    country,
    segment,
    size: LIMITS.es.batchSize,
  });
  const kept = people.filter(passesLocalFilter);
  const inserted = insertEsCandidates(kept, segment);

  return {
    country,
    segment,
    fetched: people.length,
    filtered: people.length - kept.length,
    inserted,
  };
}

function nextSegment(): EsSegment {
  const cursor = parseInt(getAgentState(ES_SEGMENT_CURSOR_KEY) ?? "0", 10) || 0;
  setAgentState(ES_SEGMENT_CURSOR_KEY, String(cursor + 1));
  return ES_SEGMENTS[cursor % ES_SEGMENTS.length];
}

function passesLocalFilter(person: EsPerson): boolean {
  const text = `${person.jobTitle ?? ""} ${person.headline ?? ""}`;
  if (ICP_EXCLUDE_PATTERNS.some((re) => re.test(text))) return false;
  if (ES_HEADLINE_EXCLUDE_PATTERNS.some((re) => re.test(text))) return false;
  return true;
}
