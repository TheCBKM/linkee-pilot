import Database from "better-sqlite3";
import { getDbPath } from "../config/env.js";
import {
  type ActionType,
  getDailyCap,
} from "../config/limits.js";
import { readPidFile, isProcessRunning } from "../agent/lifecycle.js";

let db: Database.Database | null = null;

function getReadOnlyDb(): Database.Database {
  if (!db) {
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
  const today = new Date().toISOString().slice(0, 10);
  const actionTypes: ActionType[] = [
    "like_post",
    "like_comment",
    "comment_post",
    "send_invite",
    "create_post",
    "search",
    "profile_audit",
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
    pending: {
      id: number;
      target_type: string;
      target_id: string;
      author_name: string | null;
      author_headline: string | null;
      content_preview: string | null;
      relevance_score: number;
      status: string;
      discovered_at: string;
    }[];
  };
  posts: {
    id: number;
    post_id: string | null;
    content: string;
    pillar: string | null;
    published_at: string;
  }[];
  backoffs: {
    action_type: string;
    blocked_until: string;
    reason: string;
    retry_count: number;
  }[];
}

export function getDashboardOverview(): DashboardOverview {
  const database = getReadOnlyDb();
  const today = new Date().toISOString().slice(0, 10);
  const pid = readPidFile();
  const running = pid ? isProcessRunning(pid) : false;

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

  const pendingTargets = database
    .prepare(
      `SELECT id, target_type, target_id, author_name, author_headline,
              content_preview, relevance_score, status, discovered_at
       FROM targets
       WHERE status = 'pending'
       ORDER BY relevance_score DESC LIMIT 20`
    )
    .all() as DashboardOverview["targets"]["pending"];

  const posts = database
    .prepare(
      "SELECT id, post_id, content, pillar, published_at FROM posts ORDER BY published_at DESC LIMIT 20"
    )
    .all() as DashboardOverview["posts"];

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
      pending: pendingTargets,
    },
    posts,
    backoffs: getActiveBackoffs(),
  };
}
