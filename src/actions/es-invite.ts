import { lookupProfile, sendInvitation, UnipileError } from "../clients/unipile.js";
import type { LookedUpProfile } from "../clients/unipile.js";
import { executeWithRateLimit } from "../rate-limiter/index.js";
import { canAct } from "../rate-limiter/quota.js";
import { LIMITS } from "../config/limits.js";
import { ES_COUNTRIES } from "../config/es-icp.js";
import { getEnv } from "../config/env.js";
import { isOwnProviderId } from "../config/identity.js";
import { draftNetworkingInviteNote } from "../ai/comment-writer.js";
import {
  countEsInvited24h,
  countEsQueue,
  getNextEsCandidate,
  isAlreadyEngagedPerson,
  markEsCandidateInvited,
  markEsCandidateResolved,
  markEsCandidateSkipped,
  recordEsInviteFailure,
  type EsCandidate,
} from "../db/store.js";
import { isEsPipelineActive } from "./es-refill.js";

const SKIP_INVITE_ERRORS = new Set([
  "errors/already_invited_recently",
  "errors/already_connected",
  "errors/action_already_performed",
]);

export interface EsInviteResult {
  sent: boolean;
  candidate?: string;
  country?: string;
  reason?: string;
}

/** True when the scheduler can offer an es_invite action. */
export function hasEsInviteWork(): boolean {
  if (!isEsPipelineActive() || !canAct("es_invite").allowed) return false;
  return countEsQueue(undefined, !canLookup()) > 0;
}

/** Without lookup quota only already-resolved candidates can progress. */
function canLookup(): boolean {
  return canAct("es_lookup").allowed;
}

/** Keep India / US roughly 50/50 by inviting from whichever is behind today. */
function pickCountry(resolvedOnly: boolean): string | null {
  const withQueue = ES_COUNTRIES.filter((c) => countEsQueue(c, resolvedOnly) > 0);
  if (withQueue.length === 0) return null;
  const shuffled = [...withQueue].sort(() => Math.random() - 0.5);
  return shuffled.sort((a, b) => countEsInvited24h(a) - countEsInvited24h(b))[0];
}

export async function sendEsInvite(): Promise<EsInviteResult> {
  const resolvedOnly = !canLookup();
  const country = pickCountry(resolvedOnly);
  if (!country) return { sent: false, reason: "queue_empty" };

  const candidate = getNextEsCandidate(country, resolvedOnly);
  if (!candidate) return { sent: false, reason: "queue_empty" };

  const base = { candidate: candidate.linkedin_username, country };

  let providerId = candidate.provider_id;
  let headline = candidate.headline;

  if (candidate.status === "queued") {
    const resolved = await resolveCandidate(candidate);
    if (!resolved.ok) return { ...base, sent: false, reason: resolved.reason };
    providerId = resolved.providerId;
    headline = resolved.headline ?? headline;
  }

  // Lookup may have used the last invite slot window; re-check before drafting.
  if (!canAct("es_invite").allowed) {
    return { ...base, sent: false, reason: "invite_quota" };
  }

  const note = await draftNetworkingInviteNote({
    name: candidate.full_name ?? undefined,
    title: candidate.job_title ?? undefined,
    company: candidate.company ?? undefined,
    headline: headline ?? undefined,
  });

  if (!providerId) {
    // Dry run: lookups return no profile. Log the drafted note, leave the candidate queued.
    await executeWithRateLimit({
      actionType: "es_invite",
      targetId: candidate.linkedin_username,
      content: note ?? undefined,
      execute: async () => null,
    });
    return { ...base, sent: false, reason: "dry_run" };
  }

  const result = await executeWithRateLimit({
    actionType: "es_invite",
    targetId: providerId,
    content: note ?? undefined,
    execute: () =>
      sendInvitation({
        providerId: providerId!,
        ...(note && { message: note }),
      }),
  });

  if (result.success) {
    markEsCandidateInvited(candidate.id, note);
    return { ...base, sent: true };
  }

  if (result.errorType && SKIP_INVITE_ERRORS.has(result.errorType)) {
    markEsCandidateSkipped(candidate.id, result.errorType, providerId);
  } else if (result.errorType) {
    recordEsInviteFailure(candidate.id, result.errorType, LIMITS.es.maxInviteAttempts);
  }
  return { ...base, sent: false, reason: result.errorType ?? "skipped" };
}

type ResolveResult =
  | { ok: true; providerId: string | null; headline: string | null }
  | { ok: false; reason: string };

/**
 * Look up the LinkedIn profile (shows as a profile view, like a person would
 * before connecting) and drop anyone already connected or invited.
 */
async function resolveCandidate(candidate: EsCandidate): Promise<ResolveResult> {
  if (!canAct("es_lookup").allowed) {
    return { ok: false, reason: "lookup_quota" };
  }

  const lookup = await executeWithRateLimit({
    actionType: "es_lookup",
    targetId: candidate.linkedin_username,
    execute: async (): Promise<LookedUpProfile | null> => {
      try {
        return await lookupProfile(candidate.linkedin_username, { notify: true });
      } catch (err) {
        // Stale ES record: profile gone or renamed. Not an account problem.
        if (err instanceof UnipileError && (err.status === 404 || err.status === 422)) {
          return null;
        }
        throw err;
      }
    },
  });

  if (getEnv().DRY_RUN) {
    return { ok: true, providerId: null, headline: null };
  }

  if (!lookup.success) {
    if (lookup.errorType) {
      recordEsInviteFailure(
        candidate.id,
        `lookup: ${lookup.errorType}`,
        LIMITS.es.maxInviteAttempts
      );
    }
    return { ok: false, reason: lookup.errorType ?? "lookup_skipped" };
  }

  const profile = lookup.result;
  const providerId = profile?.provider_id ?? null;
  if (!profile || !providerId) {
    markEsCandidateSkipped(candidate.id, "profile_not_found");
    return { ok: false, reason: "profile_not_found" };
  }

  const skipReason = getSkipReason(profile, providerId);
  if (skipReason) {
    markEsCandidateSkipped(candidate.id, skipReason, providerId);
    return { ok: false, reason: skipReason };
  }

  markEsCandidateResolved(candidate.id, providerId, profile.headline ?? null);
  return { ok: true, providerId, headline: profile.headline ?? null };
}

function getSkipReason(profile: LookedUpProfile, providerId: string): string | null {
  if (profile.is_self || isOwnProviderId(providerId)) return "self";
  if (
    profile.is_relationship ||
    profile.network_distance === "FIRST_DEGREE" ||
    profile.network_distance === "DISTANCE_1"
  ) {
    return "already_connected";
  }
  if (profile.invitation) {
    return `invitation_${profile.invitation.type.toLowerCase()}_${profile.invitation.status.toLowerCase()}`;
  }
  if (isAlreadyEngagedPerson(providerId)) return "already_engaged";
  return null;
}
