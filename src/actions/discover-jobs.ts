import { getJobPosting, linkedinSearch } from "../clients/unipile.js";
import { getEnv } from "../config/env.js";
import { pickPreferredRegionId } from "../config/icp.js";
import {
  JOB_DEDUP_WINDOW_DAYS,
  JOB_MAX_SCORED_PER_RUN,
  JOB_MIN_KEEP_SCORE,
  JOB_POSTED_WITHIN_DAYS,
  JOB_PRESENCE,
  JOB_SEARCH_PAGE_SIZE,
  JOB_STRONG_MATCH_SCORE,
  pickJobKeyword,
  pickJobSearchProfile,
} from "../config/jobs.js";
import { isExcludedLocation } from "../ai/icp-filter.js";
import { matchJob } from "../ai/job-matcher.js";
import {
  hasRecentOpportunity,
  markOpportunityNotified,
  upsertOpportunity,
} from "../db/store.js";
import { notifyDiscord } from "../notifications/discord.js";
import { canAct, recordAction } from "../rate-limiter/quota.js";

export interface JobDiscoveryResult {
  ran: boolean;
  reason?: string;
  keyword?: string;
  seen: number;
  scored: number;
  kept: number;
  strong: number;
  /** Rejected before scoring: wrong geo or not remote. */
  rejected: number;
}

interface ParsedJob {
  jobId: string;
  title: string;
  company?: string;
  companyUrl?: string;
  url?: string;
  location?: string;
  /** Derived from the "(Remote)" suffix LinkedIn puts in the location string. */
  presence?: string;
  postedAt?: string;
  raw: Record<string, unknown>;
}

const EMPTY: JobDiscoveryResult = {
  ran: false,
  seen: 0,
  scored: 0,
  kept: 0,
  strong: 0,
  rejected: 0,
};

export async function discoverJobs(): Promise<JobDiscoveryResult> {
  if (!getEnv().ENABLE_JOB_DISCOVERY) {
    return { ...EMPTY, reason: "job_discovery_disabled" };
  }
  if (!canAct("discover_jobs").allowed) {
    return { ...EMPTY, reason: "quota_exhausted" };
  }

  const profile = pickJobSearchProfile();
  const keyword = pickJobKeyword(profile);
  const region = pickPreferredRegionId();

  let seen = 0;
  let scored = 0;
  let kept = 0;
  let strong = 0;
  let rejected = 0;

  try {
    const response = (await linkedinSearch({
      category: "jobs",
      keywords: keyword,
      sort_by: "date",
      // Jobs search wants a day count here; the posts-style string is a 400.
      date_posted: JOB_POSTED_WITHIN_DAYS,
      presence: JOB_PRESENCE,
      job_type: profile.jobTypes,
      seniority: profile.seniority,
      // `region` is the only geography filter jobs search honors.
      region,
      limit: JOB_SEARCH_PAGE_SIZE,
    })) as { items?: Record<string, unknown>[] };

    recordAction("discover_jobs");

    for (const item of response.items ?? []) {
      const job = parseJobItem(item);
      if (!job) continue;
      seen++;

      if (hasRecentOpportunity(job.jobId, JOB_DEDUP_WINDOW_DAYS)) continue;

      /*
       * The `region` search filter is not airtight, so re-check geography and
       * presence locally. Rejecting here avoids spending an AI scoring call.
       * India is in scope now, but it still has to be a genuinely remote role.
       */
      const geoReject = job.location && isExcludedLocation(job.location);
      const presenceReject = job.presence && !/remote/i.test(job.presence);

      if (geoReject || presenceReject) {
        rejected++;
        storeFiltered(
          job,
          profile.family,
          geoReject
            ? `excluded location: ${job.location}`
            : `not remote: ${job.presence}`
        );
        continue;
      }

      if (scored >= JOB_MAX_SCORED_PER_RUN) break;

      // Search results carry no description; fit scoring needs the detail call.
      const detail = await getJobPosting(job.jobId);

      if (detail?.location && isExcludedLocation(detail.location)) {
        rejected++;
        storeFiltered(
          job,
          profile.family,
          `excluded location: ${detail.location}`
        );
        continue;
      }
      if (detail?.state && detail.state !== "active") {
        rejected++;
        storeFiltered(job, profile.family, `job state: ${detail.state}`);
        continue;
      }

      const match = await matchJob({
        title: job.title,
        company: job.company ?? detail?.company,
        location: detail?.location ?? job.location,
        presence: detail?.workplace ?? job.presence,
        seniority: detail?.seniority,
        skills: detail?.skills,
        salary: detail?.salary,
        description: detail?.description,
      });
      scored++;

      const belowBar = !match.isRemote || match.score < JOB_MIN_KEEP_SCORE;

      upsertOpportunity({
        ...toUpsert(job, profile.family),
        location: detail?.location ?? job.location ?? null,
        presence: detail?.workplace ?? job.presence ?? null,
        description: detail?.description?.slice(0, 8000) ?? null,
        url: detail?.applyUrl ?? job.url ?? null,
        matchScore: match.score,
        matchReasons: match.reasons,
        matchGaps: match.gaps,
        pitch: match.pitch || null,
        status: belowBar ? "filtered" : "new",
        metadata: {
          search_keyword: keyword,
          search_region: region,
          seniority: detail?.seniority,
          skills: detail?.skills,
          salary: detail?.salary,
          applicants: detail?.applicantsCount,
          hiring_team: detail?.hiringTeam,
          had_description: !!detail?.description,
          ...(belowBar && {
            filter_reason: !match.isRemote
              ? "matcher judged listing not remote"
              : `score ${match.score} below keep threshold`,
          }),
        },
      });

      if (belowBar) continue;
      kept++;

      if (match.score >= JOB_STRONG_MATCH_SCORE) {
        strong++;
        await notifyStrongMatch(job, detail?.applyUrl, match);
        markOpportunityNotified(job.jobId);
      }
    }
  } catch (err) {
    console.error("[discover-jobs] Job search failed:", err);
    return { ...EMPTY, ran: true, reason: "search_failed", keyword, seen };
  }

  return { ran: true, keyword, seen, scored, kept, strong, rejected };
}

function toUpsert(job: ParsedJob, roleFamily: string) {
  return {
    jobId: job.jobId,
    title: job.title,
    company: job.company ?? null,
    companyUrl: job.companyUrl ?? null,
    url: job.url ?? null,
    location: job.location ?? null,
    presence: job.presence ?? null,
    roleFamily,
    postedAt: job.postedAt ?? null,
  };
}

/** Record a reject so the dedupe window stops us re-examining it. */
function storeFiltered(
  job: ParsedJob,
  roleFamily: string,
  reason: string
): void {
  upsertOpportunity({
    ...toUpsert(job, roleFamily),
    matchScore: 0,
    status: "filtered",
    metadata: { filter_reason: reason },
  });
}

async function notifyStrongMatch(
  job: ParsedJob,
  applyUrl: string | undefined,
  match: { score: number; reasons: string[]; pitch: string }
): Promise<void> {
  await notifyDiscord({
    title: `Opportunity · ${match.score}/100 · ${job.title}`.slice(0, 256),
    description: [
      job.company ? `**${job.company}**` : null,
      applyUrl ?? job.url,
      match.reasons.length
        ? match.reasons.map((r) => `- ${r}`).join("\n")
        : null,
      match.pitch ? `\n_${match.pitch}_` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    severity: "info",
    fields: [
      { name: "Score", value: `${match.score}/100`, inline: true },
      { name: "Location", value: job.location ?? "unknown", inline: true },
      { name: "Posted", value: job.postedAt ?? "unknown", inline: true },
    ],
  });
}

function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

/**
 * Parse a jobs-search item. LinkedIn returns location as a single string with
 * the workplace type in parentheses, e.g. "Ireland (Remote)", so presence has
 * to be read out of it. There is no description or job_type at this stage.
 */
export function parseJobItem(
  item: Record<string, unknown>
): ParsedJob | null {
  const jobId = str(item.id) ?? str(item.job_id) ?? str(item.reference_id);
  const title = str(item.title);
  if (!jobId || !title) return null;

  const company = item.company as Record<string, unknown> | undefined;
  const rawLocation =
    str(item.location) ?? str(item.formatted_location) ?? undefined;

  const presenceMatch = rawLocation?.match(/\(([^)]+)\)\s*$/);
  const presence = presenceMatch?.[1]?.trim().toLowerCase();
  const location = presenceMatch
    ? rawLocation?.slice(0, presenceMatch.index).trim() || rawLocation
    : rawLocation;

  return {
    jobId,
    title,
    company:
      str(company?.name) ??
      (typeof item.company === "string" ? str(item.company) : undefined),
    companyUrl: str(company?.profile_url) ?? str(company?.url),
    url: str(item.url) ?? str(item.job_url),
    location,
    presence,
    postedAt: str(item.posted_at) ?? str(item.listed_at),
    raw: item,
  };
}
