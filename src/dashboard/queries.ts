import Database from "better-sqlite3";
import { getDbPath, getEnv } from "../config/env.js";
import { ensureDbSchema } from "../db/migrate.js";
import { JOB_STRONG_MATCH_SCORE } from "../config/jobs.js";
import {
  type ActionType,
  getDailyCap,
  LIMITS,
  isPostDay,
} from "../config/limits.js";
import { readPidFile, isAgentRunning } from "../agent/lifecycle.js";
import {
  LAST_PUBLISHED_POST_ID_KEY,
  POST_BOOST_UNTIL_KEY,
} from "../actions/create-post.js";
import {
  CONNECTIONS_BACKFILL_DONE_KEY,
  CONNECTIONS_NEXT_SYNC_AT_KEY,
  CONNECTIONS_SYNC_COUNT_DATE_KEY,
  CONNECTIONS_SYNC_COUNT_KEY,
} from "../actions/sync-connections.js";
import { getLocalDateString } from "../config/local-time.js";
import { ES_NEXT_INVITE_AT_KEY } from "../actions/es-invite.js";

/** Liveness from DB heartbeat: works across containers where PIDs aren't visible. */
function isHeartbeatFresh(statusKey: string, heartbeatKey: string): boolean {
  if (getAgentState(statusKey) !== "running") return false;
  const hb = getAgentState(heartbeatKey);
  return !!hb && Date.now() - new Date(hb).getTime() < 15 * 60_000;
}

let db: Database.Database | null = null;

function getReadOnlyDb(): Database.Database {
  if (!db) {
    ensureDbSchema();
    db = new Database(getDbPath(), { readonly: true, fileMustExist: true });
  }
  return db;
}

function getAgentState(key: string): string | null {
  const row = getReadOnlyDb()
    .prepare("SELECT value FROM agent_state WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function getAccountAgeDaysReadOnly(): number {
  const row = getReadOnlyDb()
    .prepare("SELECT value FROM account_meta WHERE key = 'first_run_at'")
    .get() as { value: string } | undefined;

  if (!row) return 0;

  const firstRun = new Date(row.value);
  const diffMs = Date.now() - firstRun.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function getQuotaCount(actionType: ActionType, date: string): number {
  const row = getReadOnlyDb()
    .prepare(
      "SELECT count FROM quota_usage WHERE action_type = ? AND date = ?"
    )
    .get(actionType, date) as { count: number } | undefined;
  return row?.count ?? 0;
}

function getQuotaRemaining(): Record<string, { used: number; cap: number }> {
  const accountAge = getAccountAgeDaysReadOnly();
  const today = getLocalDateString();
  const actionTypes: ActionType[] = [
    "like_post",
    "like_comment",
    "comment_post",
    "reply_comment",
    "send_invite",
    "withdraw_invite",
    "create_post",
    "search",
    "profile_audit",
    "view_profile",
    "discover_jobs",
    "send_dm",
    "dm_followup",
    "es_lookup",
    "es_invite",
  ];

  return Object.fromEntries(
    actionTypes.map((type) => {
      const cap = getDailyCap(type, accountAge);
      const used = getQuotaCount(type, today);
      return [type, { used, cap }];
    })
  );
}

function getActiveBackoffs(): {
  action_type: string;
  blocked_until: string;
  reason: string;
  retry_count: number;
}[] {
  const now = new Date().toISOString();
  return getReadOnlyDb()
    .prepare(
      `SELECT action_type, blocked_until, reason, retry_count
       FROM backoff_state
       WHERE blocked_until > ?
       ORDER BY blocked_until ASC`
    )
    .all(now) as {
    action_type: string;
    blocked_until: string;
    reason: string;
    retry_count: number;
  }[];
}

function startOfWeekMonday(d = new Date()): Date {
  const date = new Date(d);
  const day = date.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function expectedPostDaysSoFarThisWeek(): number {
  const start = startOfWeekMonday();
  const now = new Date();
  let count = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    if (d > now) break;
    if (isPostDay(d)) count++;
  }
  return count;
}

function getPostHealth(database: Database.Database): DashboardOverview["postHealth"] {
  const weekStart = startOfWeekMonday().toISOString();
  const postsThisWeek = database
    .prepare(
      `SELECT COUNT(*) as count FROM posts WHERE published_at >= ?`
    )
    .get(weekStart) as { count: number };

  const originalsThisWeek = database
    .prepare(
      `SELECT COUNT(*) as count FROM posts
       WHERE published_at >= ? AND (format IS NULL OR format = 'text')`
    )
    .get(weekStart) as { count: number };

  const repostsThisWeek = database
    .prepare(
      `SELECT COUNT(*) as count FROM posts
       WHERE published_at >= ? AND format = 'repost'`
    )
    .get(weekStart) as { count: number };

  const lastPost = database
    .prepare(
      `SELECT published_at, format FROM posts ORDER BY published_at DESC LIMIT 1`
    )
    .get() as { published_at: string; format: string | null } | undefined;

  const boostUntil = getAgentState(POST_BOOST_UNTIL_KEY);
  const boostActive = !!boostUntil && Date.now() < new Date(boostUntil).getTime();

  return {
    postsThisWeek: postsThisWeek.count,
    originalsThisWeek: originalsThisWeek.count,
    repostsThisWeek: repostsThisWeek.count,
    expectedThisWeek: expectedPostDaysSoFarThisWeek(),
    weeklyTarget: LIMITS.weeklyPostDays.length,
    lastPublishedAt: lastPost?.published_at ?? null,
    lastFormat: lastPost?.format ?? null,
    boostActive,
    boostUntil: boostUntil,
    lastPostId: getAgentState(LAST_PUBLISHED_POST_ID_KEY),
  };
}

function getIcpQuality(database: Database.Database): DashboardOverview["icpQuality"] {
  const passedRow = database
    .prepare(
      `SELECT COUNT(*) as count FROM targets
       WHERE status != 'filtered'
         AND discovered_at >= datetime('now', '-7 days')`
    )
    .get() as { count: number };

  const filteredRow = database
    .prepare(
      `SELECT COUNT(*) as count FROM targets
       WHERE status = 'filtered'
         AND discovered_at >= datetime('now', '-7 days')`
    )
    .get() as { count: number };

  const total = passedRow.count + filteredRow.count;
  const hitRate =
    total > 0 ? Math.round((passedRow.count / total) * 1000) / 10 : null;

  const outreachScores = database
    .prepare(
      `SELECT t.relevance_score as score
       FROM actions a
       JOIN targets t ON t.target_id = a.target_id
       WHERE a.action_type IN ('comment_post', 'send_invite')
         AND a.result IN ('success', 'dry_run')
         AND a.created_at >= datetime('now', '-7 days')`
    )
    .all() as { score: number }[];

  let avgScore: number | null = null;
  let pctAboveThreshold: number | null = null;
  if (outreachScores.length > 0) {
    const sum = outreachScores.reduce((s, r) => s + (r.score ?? 0), 0);
    avgScore = Math.round((sum / outreachScores.length) * 10) / 10;
    const above = outreachScores.filter(
      (r) => (r.score ?? 0) >= LIMITS.minRelevanceScore
    ).length;
    pctAboveThreshold =
      Math.round((above / outreachScores.length) * 1000) / 10;
  }

  return {
    passed7d: passedRow.count,
    filtered7d: filteredRow.count,
    hitRatePct: hitRate,
    outreachAvgScore: avgScore,
    outreachPctAbove70: pctAboveThreshold,
    outreachSampleSize: outreachScores.length,
    minRelevanceThreshold: LIMITS.minRelevanceScore,
  };
}

export interface DashboardOverview {
  process: { running: boolean; pid: number | null };
  agent: {
    status: string | null;
    lastHeartbeat: string | null;
    lastAction: string | null;
    halted: boolean;
    haltReason: string | null;
  };
  quotas: Record<string, { used: number; cap: number }>;
  actionsToday: Record<string, number>;
  followerHistory: { count: number; recorded_at: string }[];
  recentActions: {
    id: number;
    action_type: string;
    target_id: string;
    content: string | null;
    result: string;
    error_type: string | null;
    created_at: string;
  }[];
  targets: {
    counts: Record<string, number>;
    sequenceStages: Record<string, number>;
    pending: {
      id: number;
      target_type: string;
      target_id: string;
      author_name: string | null;
      author_headline: string | null;
      content_preview: string | null;
      relevance_score: number;
      status: string;
      sequence_stage: string | null;
      discovered_at: string;
    }[];
  };
  posts: {
    id: number;
    post_id: string | null;
    content: string;
    pillar: string | null;
    format: string | null;
    source_post_id: string | null;
    published_at: string;
  }[];
  backoffs: {
    action_type: string;
    blocked_until: string;
    reason: string;
    retry_count: number;
  }[];
  outreach: {
    inviteReady: number;
    invitedTotal: number;
    peopleTotal: number;
    postTargets: number;
    repostsPublished: number;
  };
  nurture: {
    connectionsTotal: number;
    fromInvite: number;
    accepted7d: number;
    accepted14d: number;
    pendingNurturePosts: number;
    likesToday: number;
    commentsToday: number;
    backfillDone: boolean;
    nextSyncAt: string | null;
    syncsToday: number;
    syncMaxPerDay: number;
    recentAccepts: {
      provider_id: string;
      full_name: string | null;
      headline: string | null;
      accepted_at: string | null;
      from_invite: number;
    }[];
  };
  inviteReadyPeople: {
    target_id: string;
    author_name: string | null;
    author_headline: string | null;
    person_source: string | null;
    relevance_score: number;
    sequence_stage: string | null;
  }[];
  inviteReadyTotal: number;
  pendingTargetsTotal: number;
  esPipeline: EsPipelineOverview;
  postHealth: {
    postsThisWeek: number;
    originalsThisWeek: number;
    repostsThisWeek: number;
    expectedThisWeek: number;
    weeklyTarget: number;
    lastPublishedAt: string | null;
    lastFormat: string | null;
    boostActive: boolean;
    boostUntil: string | null;
    lastPostId: string | null;
  };
  icpQuality: {
    passed7d: number;
    filtered7d: number;
    hitRatePct: number | null;
    outreachAvgScore: number | null;
    outreachPctAbove70: number | null;
    outreachSampleSize: number;
    minRelevanceThreshold: number;
  };
  opportunities: {
    total: number;
    strong: number;
    new7d: number;
    applied: number;
    strongThreshold: number;
    jobDiscoveryEnabled: boolean;
    items: {
      id: number;
      title: string;
      company: string | null;
      url: string | null;
      location: string | null;
      job_type: string | null;
      role_family: string | null;
      match_score: number;
      match_reasons: string[];
      match_gaps: string[];
      pitch: string | null;
      status: string;
      posted_at: string | null;
      discovered_at: string;
    }[];
  };
  dms: {
    dmEnabled: boolean;
    pendingApproval: number;
    sentTotal: number;
    repliedTotal: number;
    pending: {
      id: number;
      provider_id: string;
      full_name: string | null;
      headline: string | null;
      kind: string;
      draft_text: string;
      created_at: string;
    }[];
    recent: {
      id: number;
      full_name: string | null;
      kind: string;
      status: string;
      draft_text: string;
      sent_at: string | null;
      created_at: string;
    }[];
  };
}

const SEQUENCE_ORDER = [
  "discovered",
  "liked",
  "commented",
  "viewed",
  "invite_ready",
  "invited",
  "withdrawn",
  "connected",
  "messaged",
  "replied",
] as const;

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

function getOpportunities(
  database: Database.Database
): DashboardOverview["opportunities"] {
  const one = (sql: string, ...params: unknown[]): number =>
    (database.prepare(sql).get(...params) as { c: number }).c;

  const rows = database
    .prepare(
      `SELECT id, title, company, url, location, job_type, role_family,
              match_score, match_reasons, match_gaps, pitch, status,
              posted_at, discovered_at
       FROM opportunities
       WHERE status NOT IN ('filtered', 'dismissed')
       ORDER BY match_score DESC, discovered_at DESC
       LIMIT 30`
    )
    .all() as (Omit<
    DashboardOverview["opportunities"]["items"][number],
    "match_reasons" | "match_gaps"
  > & { match_reasons: string | null; match_gaps: string | null })[];

  return {
    total: one(
      "SELECT COUNT(*) as c FROM opportunities WHERE status != 'filtered'"
    ),
    strong: one(
      `SELECT COUNT(*) as c FROM opportunities
       WHERE status NOT IN ('filtered','dismissed') AND match_score >= ?`,
      JOB_STRONG_MATCH_SCORE
    ),
    new7d: one(
      `SELECT COUNT(*) as c FROM opportunities
       WHERE status != 'filtered' AND discovered_at >= datetime('now', '-7 days')`
    ),
    applied: one(
      "SELECT COUNT(*) as c FROM opportunities WHERE status = 'applied'"
    ),
    strongThreshold: JOB_STRONG_MATCH_SCORE,
    jobDiscoveryEnabled: getEnv().ENABLE_JOB_DISCOVERY,
    items: rows.map((r) => ({
      ...r,
      match_reasons: parseJsonArray(r.match_reasons),
      match_gaps: parseJsonArray(r.match_gaps),
    })),
  };
}

function getDms(database: Database.Database): DashboardOverview["dms"] {
  const one = (sql: string, ...params: unknown[]): number =>
    (database.prepare(sql).get(...params) as { c: number }).c;

  const pending = database
    .prepare(
      `SELECT id, provider_id, full_name, headline, kind, draft_text, created_at
       FROM dm_queue WHERE status = 'pending_approval'
       ORDER BY created_at ASC LIMIT 20`
    )
    .all() as DashboardOverview["dms"]["pending"];

  const recent = database
    .prepare(
      `SELECT id, full_name, kind, status, draft_text, sent_at, created_at
       FROM dm_queue WHERE status IN ('sent', 'rejected', 'failed')
       ORDER BY COALESCE(sent_at, created_at) DESC LIMIT 20`
    )
    .all() as DashboardOverview["dms"]["recent"];

  return {
    dmEnabled: getEnv().ENABLE_DM,
    pendingApproval: one(
      "SELECT COUNT(*) as c FROM dm_queue WHERE status = 'pending_approval'"
    ),
    sentTotal: one("SELECT COUNT(*) as c FROM dm_queue WHERE status = 'sent'"),
    repliedTotal: one(
      `SELECT COUNT(*) as c FROM targets
       WHERE target_type = 'person' AND sequence_stage = 'replied'`
    ),
    pending,
    recent,
  };
}

export function getDashboardOverview(): DashboardOverview {
  const database = getReadOnlyDb();
  const today = new Date().toISOString().slice(0, 10);
  const pid = readPidFile();
  const running =
    (pid ? isAgentRunning(pid) : false) ||
    isHeartbeatFresh("status", "last_heartbeat");

  const actionsToday = database
    .prepare(
      `SELECT action_type, COUNT(*) as count FROM actions
       WHERE date(created_at) = ? GROUP BY action_type`
    )
    .all(today) as { action_type: string; count: number }[];

  const followerHistory = database
    .prepare(
      "SELECT count, recorded_at FROM follower_history ORDER BY recorded_at ASC LIMIT 30"
    )
    .all() as { count: number; recorded_at: string }[];

  const recentActions = database
    .prepare(
      `SELECT id, action_type, target_id, content, result, error_type, created_at
       FROM actions ORDER BY created_at DESC LIMIT 50`
    )
    .all() as DashboardOverview["recentActions"];

  const targetCounts = database
    .prepare(
      "SELECT status, COUNT(*) as count FROM targets GROUP BY status"
    )
    .all() as { status: string; count: number }[];

  const sequenceStages = database
    .prepare(
      `SELECT sequence_stage, COUNT(*) as count FROM targets
       WHERE target_type = 'person' AND status != 'filtered'
       GROUP BY sequence_stage`
    )
    .all() as { sequence_stage: string | null; count: number }[];

  const pendingTargets = database
    .prepare(
      `SELECT id, target_type, target_id, author_name, author_headline,
              content_preview, relevance_score, status, sequence_stage, discovered_at
       FROM targets
       WHERE status = 'pending'
       ORDER BY relevance_score DESC LIMIT 20`
    )
    .all() as DashboardOverview["targets"]["pending"];

  const posts = database
    .prepare(
      `SELECT id, post_id, content, pillar, format, source_post_id, published_at
       FROM posts ORDER BY published_at DESC LIMIT 20`
    )
    .all() as DashboardOverview["posts"];

  const inviteReadyRow = database
    .prepare(
      `SELECT COUNT(*) as count FROM targets
       WHERE target_type = 'person' AND sequence_stage = 'invite_ready' AND status = 'pending'`
    )
    .get() as { count: number };

  const invitedTotalRow = database
    .prepare(
      `SELECT COUNT(*) as count FROM targets
       WHERE target_type = 'person' AND (status = 'invited' OR sequence_stage = 'invited')`
    )
    .get() as { count: number };

  const peopleTotalRow = database
    .prepare(
      `SELECT COUNT(*) as count FROM targets
       WHERE target_type = 'person' AND status != 'filtered'`
    )
    .get() as { count: number };

  const postTargetsRow = database
    .prepare(
      `SELECT COUNT(*) as count FROM targets WHERE target_type = 'post' AND status = 'pending'`
    )
    .get() as { count: number };

  const repostsRow = database
    .prepare(
      `SELECT COUNT(*) as count FROM posts WHERE format = 'repost'`
    )
    .get() as { count: number };

  const inviteReadyPeople = database
    .prepare(
      `SELECT target_id, author_name, author_headline, person_source, relevance_score, sequence_stage
       FROM targets
       WHERE target_type = 'person' AND sequence_stage = 'invite_ready' AND status = 'pending'
       ORDER BY relevance_score DESC LIMIT 10`
    )
    .all() as DashboardOverview["inviteReadyPeople"];

  let connectionsTotal = 0;
  let fromInvite = 0;
  let accepted7d = 0;
  let accepted14d = 0;
  let recentAccepts: DashboardOverview["nurture"]["recentAccepts"] = [];
  try {
    connectionsTotal = (
      database.prepare("SELECT COUNT(*) as c FROM connections").get() as {
        c: number;
      }
    ).c;
    fromInvite = (
      database
        .prepare("SELECT COUNT(*) as c FROM connections WHERE from_invite = 1")
        .get() as { c: number }
    ).c;
    accepted7d = (
      database
        .prepare(
          `SELECT COUNT(*) as c FROM connections
           WHERE accepted_at IS NOT NULL
             AND accepted_at >= datetime('now', '-7 days')`
        )
        .get() as { c: number }
    ).c;
    accepted14d = (
      database
        .prepare(
          `SELECT COUNT(*) as c FROM connections
           WHERE accepted_at IS NOT NULL
             AND accepted_at >= datetime('now', '-14 days')`
        )
        .get() as { c: number }
    ).c;
    recentAccepts = database
      .prepare(
        `SELECT provider_id, full_name, headline, accepted_at, from_invite
         FROM connections
         WHERE accepted_at IS NOT NULL
         ORDER BY accepted_at DESC
         LIMIT 10`
      )
      .all() as DashboardOverview["nurture"]["recentAccepts"];
  } catch {
    // connections table may not exist yet on very old DBs mid-migration
  }

  const pendingTargetsTotal = (
    database
      .prepare(
        `SELECT COUNT(*) as c FROM targets WHERE status = 'pending'`
      )
      .get() as { c: number }
  ).c;

  const todayLocal = getLocalDateString();
  const syncCountDate = getAgentState(CONNECTIONS_SYNC_COUNT_DATE_KEY);
  const syncCountRaw = getAgentState(CONNECTIONS_SYNC_COUNT_KEY);
  const syncsToday =
    syncCountDate === todayLocal && syncCountRaw
      ? Number.parseInt(syncCountRaw, 10) || 0
      : 0;

  const pendingNurturePosts = (
    database
      .prepare(
        `SELECT COUNT(*) as c FROM targets
         WHERE target_type = 'post'
           AND status = 'pending'
           AND json_extract(metadata, '$.nurture') = 1`
      )
      .get() as { c: number }
  ).c;

  const nurtureLikesToday = (
    database
      .prepare(
        `SELECT COUNT(*) as c FROM actions a
         JOIN targets t ON t.target_id = a.target_id OR t.social_id = a.target_id
         WHERE a.action_type = 'like_post'
           AND a.result IN ('success', 'dry_run')
           AND date(a.created_at) = ?
           AND json_extract(t.metadata, '$.nurture') = 1`
      )
      .get(today) as { c: number }
  ).c;

  const nurtureCommentsToday = (
    database
      .prepare(
        `SELECT COUNT(*) as c FROM actions a
         JOIN targets t ON t.target_id = a.target_id OR t.social_id = a.target_id
         WHERE a.action_type = 'comment_post'
           AND a.result IN ('success', 'dry_run')
           AND date(a.created_at) = ?
           AND json_extract(t.metadata, '$.nurture') = 1`
      )
      .get(today) as { c: number }
  ).c;

  const stageCounts = Object.fromEntries(
    sequenceStages.map((r) => [r.sequence_stage ?? "discovered", r.count])
  );

  // Ensure all pipeline stages appear (even at 0) for consistent funnel UI
  const sequenceStagesOrdered = Object.fromEntries(
    SEQUENCE_ORDER.map((stage) => [stage, stageCounts[stage] ?? 0])
  );

  return {
    process: { running, pid },
    agent: {
      status: getAgentState("status"),
      lastHeartbeat: getAgentState("last_heartbeat"),
      lastAction: getAgentState("last_action"),
      halted: getAgentState("halted") === "true",
      haltReason: getAgentState("halt_reason"),
    },
    quotas: getQuotaRemaining(),
    actionsToday: Object.fromEntries(
      actionsToday.map((r) => [r.action_type, r.count])
    ),
    followerHistory,
    recentActions,
    targets: {
      counts: Object.fromEntries(
        targetCounts.map((r) => [r.status, r.count])
      ),
      sequenceStages: sequenceStagesOrdered,
      pending: pendingTargets,
    },
    posts,
    backoffs: getActiveBackoffs(),
    outreach: {
      inviteReady: inviteReadyRow.count,
      invitedTotal: invitedTotalRow.count,
      peopleTotal: peopleTotalRow.count,
      postTargets: postTargetsRow.count,
      repostsPublished: repostsRow.count,
    },
    nurture: {
      connectionsTotal,
      fromInvite,
      accepted7d,
      accepted14d,
      pendingNurturePosts,
      likesToday: nurtureLikesToday,
      commentsToday: nurtureCommentsToday,
      backfillDone: getAgentState(CONNECTIONS_BACKFILL_DONE_KEY) === "true",
      nextSyncAt: getAgentState(CONNECTIONS_NEXT_SYNC_AT_KEY),
      syncsToday,
      syncMaxPerDay: LIMITS.nurture.syncMaxPerDay,
      recentAccepts,
    },
    inviteReadyPeople,
    inviteReadyTotal: inviteReadyRow.count,
    pendingTargetsTotal,
    esPipeline: getEsPipelineOverview(database),
    postHealth: getPostHealth(database),
    icpQuality: getIcpQuality(database),
    opportunities: getOpportunities(database),
    dms: getDms(database),
  };
}

export interface EsPipelineOverview {
  enabled: boolean;
  agent: {
    running: boolean;
    status: string | null;
    lastHeartbeat: string | null;
    lastAction: string | null;
  };
  nextInviteAt: string | null;
  totals: {
    queued: number;
    invited: number;
    connected: number;
    skipped: number;
    failed: number;
    withdrawn: number;
  };
  byCountry: {
    country: string;
    queued: number;
    invited: number;
    invited24h: number;
    connected: number;
  }[];
  bySegment: { segment: string; invited: number; connected: number }[];
  recentInvites: {
    full_name: string | null;
    job_title: string | null;
    company: string | null;
    country: string;
    segment: string;
    linkedin_url: string | null;
    invite_note: string | null;
    status: string;
    invited_at: string;
  }[];
}

function getEsPipelineOverview(database: Database.Database): EsPipelineOverview {
  const statusRows = database
    .prepare(`SELECT status, COUNT(*) AS n FROM es_candidates GROUP BY status`)
    .all() as { status: string; n: number }[];
  const byStatus = Object.fromEntries(statusRows.map((r) => [r.status, r.n]));
  const n = (key: string) => (byStatus[key] as number | undefined) ?? 0;

  const byCountry = (
    database
      .prepare(
        `SELECT country,
           SUM(CASE WHEN status IN ('queued', 'resolved') THEN 1 ELSE 0 END) AS queued,
           SUM(CASE WHEN invited_at IS NOT NULL THEN 1 ELSE 0 END) AS invited,
           SUM(CASE WHEN invited_at >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS invited24h,
           SUM(CASE WHEN status = 'connected' THEN 1 ELSE 0 END) AS connected
         FROM es_candidates GROUP BY country ORDER BY country`
      )
      .all() as EsPipelineOverview["byCountry"]
  );

  const bySegment = database
    .prepare(
      `SELECT segment,
         SUM(CASE WHEN invited_at IS NOT NULL THEN 1 ELSE 0 END) AS invited,
         SUM(CASE WHEN status = 'connected' THEN 1 ELSE 0 END) AS connected
       FROM es_candidates GROUP BY segment ORDER BY invited DESC`
    )
    .all() as EsPipelineOverview["bySegment"];

  const recentInvites = database
    .prepare(
      `SELECT full_name, job_title, company, country, segment, linkedin_url,
         invite_note, status, invited_at
       FROM es_candidates
       WHERE invited_at IS NOT NULL
       ORDER BY invited_at DESC
       LIMIT 20`
    )
    .all() as EsPipelineOverview["recentInvites"];

  return {
    enabled: getEnv().ES_PIPELINE_ENABLED,
    agent: {
      running: isHeartbeatFresh("es_status", "es_last_heartbeat"),
      status: getAgentState("es_status"),
      lastHeartbeat: getAgentState("es_last_heartbeat"),
      lastAction: getAgentState("es_last_action"),
    },
    nextInviteAt: getAgentState(ES_NEXT_INVITE_AT_KEY),
    totals: {
      queued: n("queued") + n("resolved"),
      invited: n("invited") + n("connected") + n("withdrawn"),
      connected: n("connected"),
      skipped: n("skipped"),
      failed: n("failed"),
      withdrawn: n("withdrawn"),
    },
    byCountry,
    bySegment,
    recentInvites,
  };
}
