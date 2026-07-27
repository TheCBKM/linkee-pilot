import { listRelations } from "../clients/unipile.js";
import { LIMITS } from "../config/limits.js";
import { getEnv } from "../config/env.js";
import {
  getAgentState,
  setAgentState,
  upsertConnection,
} from "../db/store.js";

export const CONNECTIONS_BACKFILL_DONE_KEY = "connections_backfill_done";
export const CONNECTIONS_NEXT_SYNC_AT_KEY = "connections_next_sync_at";
export const CONNECTIONS_SYNC_COUNT_DATE_KEY = "connections_sync_count_date";
export const CONNECTIONS_SYNC_COUNT_KEY = "connections_sync_count";

export type SyncConnectionsResult = {
  ran: boolean;
  mode: "backfill" | "refresh" | "skipped";
  reason?: string;
  pages: number;
  upserted: number;
  inserted: number;
  accepted: number;
};

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function randomSyncDelayMs(): number {
  const minH = LIMITS.nurture.syncMinIntervalHours;
  const maxH = LIMITS.nurture.syncMaxIntervalHours;
  const hours = minH + Math.random() * (maxH - minH);
  return Math.round(hours * 60 * 60 * 1000);
}

function scheduleNextSync(): void {
  const next = new Date(Date.now() + randomSyncDelayMs()).toISOString();
  setAgentState(CONNECTIONS_NEXT_SYNC_AT_KEY, next);
}

function getSyncCountToday(): number {
  const today = todayUtc();
  if (getAgentState(CONNECTIONS_SYNC_COUNT_DATE_KEY) !== today) return 0;
  const raw = getAgentState(CONNECTIONS_SYNC_COUNT_KEY);
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(n) ? n : 0;
}

function incrementSyncCountToday(): void {
  const today = todayUtc();
  const prev =
    getAgentState(CONNECTIONS_SYNC_COUNT_DATE_KEY) === today
      ? getSyncCountToday()
      : 0;
  setAgentState(CONNECTIONS_SYNC_COUNT_DATE_KEY, today);
  setAgentState(CONNECTIONS_SYNC_COUNT_KEY, String(prev + 1));
}

/**
 * Whether the scheduler should run a connection sync now.
 * Does not consume LinkedIn engagement quotas.
 */
export function shouldSyncConnections(): boolean {
  if (getEnv().DRY_RUN) {
    // Still allow dry-run sync scheduling to exercise logic, but caller
    // will no-op API if desired — we allow eligibility checks.
  }

  const backfillDone = getAgentState(CONNECTIONS_BACKFILL_DONE_KEY) === "true";
  if (!backfillDone) return true;

  if (getSyncCountToday() >= LIMITS.nurture.syncMaxPerDay) return false;

  const nextAt = getAgentState(CONNECTIONS_NEXT_SYNC_AT_KEY);
  if (!nextAt) return true;
  const ts = Date.parse(nextAt);
  if (Number.isNaN(ts)) return true;
  return Date.now() >= ts;
}

async function ingestPage(items: Awaited<ReturnType<typeof listRelations>>["items"]): Promise<{
  upserted: number;
  inserted: number;
  accepted: number;
}> {
  let upserted = 0;
  let inserted = 0;
  let accepted = 0;

  for (const rel of items) {
    const result = upsertConnection({
      providerId: rel.provider_id,
      publicIdentifier: rel.public_identifier,
      fullName: rel.full_name,
      headline: rel.headline,
      profileUrl: rel.public_profile_url,
      connectedAt:
        rel.created_at != null ? String(rel.created_at) : null,
      metadata: {
        member_id: rel.member_id,
      },
    });
    upserted++;
    if (result.inserted) inserted++;
    if (result.acceptedNow) accepted++;
  }

  return { upserted, inserted, accepted };
}

/**
 * Initial full backfill (paginated) or a low-frequency first-page refresh.
 * Spacing is randomized and capped per day to avoid automation patterns.
 */
export async function syncConnections(): Promise<SyncConnectionsResult> {
  if (!shouldSyncConnections()) {
    return {
      ran: false,
      mode: "skipped",
      reason: "not_due",
      pages: 0,
      upserted: 0,
      inserted: 0,
      accepted: 0,
    };
  }

  const env = getEnv();
  const backfillDone = getAgentState(CONNECTIONS_BACKFILL_DONE_KEY) === "true";
  const mode = backfillDone ? "refresh" : "backfill";

  if (env.DRY_RUN) {
    scheduleNextSync();
    if (!backfillDone) {
      setAgentState(CONNECTIONS_BACKFILL_DONE_KEY, "true");
    }
    incrementSyncCountToday();
    console.log(`[sync-connections] DRY_RUN ${mode} — skipping Unipile call`);
    return {
      ran: true,
      mode,
      pages: 0,
      upserted: 0,
      inserted: 0,
      accepted: 0,
    };
  }

  let pages = 0;
  let upserted = 0;
  let inserted = 0;
  let accepted = 0;
  let cursor: string | undefined;

  try {
    // Backfill: paginate fully. Refresh: first page only.
    for (;;) {
      const page = await listRelations({ cursor, limit: 100 });
      pages++;
      const stats = await ingestPage(page.items);
      upserted += stats.upserted;
      inserted += stats.inserted;
      accepted += stats.accepted;

      if (mode === "refresh") break;
      if (!page.cursor) break;
      cursor = page.cursor;
    }

    if (mode === "backfill") {
      setAgentState(CONNECTIONS_BACKFILL_DONE_KEY, "true");
    }
    incrementSyncCountToday();
    scheduleNextSync();

    console.log(
      `[sync-connections] ${mode}: pages=${pages} upserted=${upserted} inserted=${inserted} accepted=${accepted}`
    );

    return { ran: true, mode, pages, upserted, inserted, accepted };
  } catch (err) {
    // Still space out retries so a failure doesn't hot-loop.
    scheduleNextSync();
    throw err;
  }
}
