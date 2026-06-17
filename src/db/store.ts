import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { getDataDir, getDbPath } from "../config/env.js";
import {
  type ActionType,
  getDailyCap,
} from "../config/limits.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const dataDir = getDataDir();
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    db = new Database(getDbPath());
    db.pragma("journal_mode = WAL");
    const schemaPath = path.join(__dirname, "schema.sql");
    db.exec(fs.readFileSync(schemaPath, "utf-8"));
  }
  return db;
}

export interface Target {
  id: number;
  target_type: "post" | "person";
  target_id: string;
  provider_id: string | null;
  social_id: string | null;
  author_name: string | null;
  author_headline: string | null;
  content_preview: string | null;
  relevance_score: number;
  status: string;
  metadata: string | null;
}

export function getAccountAgeDays(): number {
  const database = getDb();
  const row = database
    .prepare("SELECT value FROM account_meta WHERE key = 'first_run_at'")
    .get() as { value: string } | undefined;

  if (!row) {
    const now = new Date().toISOString();
    database
      .prepare("INSERT OR IGNORE INTO account_meta (key, value) VALUES (?, ?)")
      .run("first_run_at", now);
    return 0;
  }

  const firstRun = new Date(row.value);
  const diffMs = Date.now() - firstRun.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export function getQuotaCount(actionType: ActionType, date: string): number {
  const row = getDb()
    .prepare(
      "SELECT count FROM quota_usage WHERE action_type = ? AND date = ?"
    )
    .get(actionType, date) as { count: number } | undefined;
  return row?.count ?? 0;
}

export function incrementQuota(actionType: ActionType, date: string): void {
  getDb()
    .prepare(
      `INSERT INTO quota_usage (action_type, date, count) VALUES (?, ?, 1)
       ON CONFLICT(action_type, date) DO UPDATE SET count = count + 1`
    )
    .run(actionType, date);
}

export function logAction(params: {
  actionType: ActionType;
  targetId: string;
  content?: string;
  result: "success" | "skipped" | "failed" | "dry_run";
  errorType?: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO actions (action_type, target_id, content, result, error_type)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      params.actionType,
      params.targetId,
      params.content ?? null,
      params.result,
      params.errorType ?? null
    );
}

export function hasRecentAction(
  actionType: ActionType,
  targetId: string,
  withinDays: number
): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM actions
       WHERE action_type = ? AND target_id = ?
       AND created_at >= datetime('now', ?)
       LIMIT 1`
    )
    .get(actionType, targetId, `-${withinDays} days`) as { 1: number } | undefined;
  return !!row;
}

export function hasRecentTarget(targetId: string, withinDays: number): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM targets
       WHERE target_id = ?
       AND (last_engaged_at >= datetime('now', ?) OR discovered_at >= datetime('now', ?))
       LIMIT 1`
    )
    .get(targetId, `-${withinDays} days`, `-${withinDays} days`) as
    | { 1: number }
    | undefined;
  return !!row;
}

export function upsertTarget(target: Omit<Target, "id"> & { target_id: string }): void {
  getDb()
    .prepare(
      `INSERT INTO targets (target_type, target_id, provider_id, social_id, author_name,
        author_headline, content_preview, relevance_score, status, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(target_id) DO UPDATE SET
         relevance_score = MAX(relevance_score, excluded.relevance_score),
         content_preview = COALESCE(excluded.content_preview, content_preview),
         metadata = COALESCE(excluded.metadata, metadata)`
    )
    .run(
      target.target_type,
      target.target_id,
      target.provider_id,
      target.social_id,
      target.author_name,
      target.author_headline,
      target.content_preview,
      target.relevance_score,
      target.status,
      target.metadata
    );
}

export function getPendingTargets(
  targetType: "post" | "person",
  limit = 10
): Target[] {
  return getDb()
    .prepare(
      `SELECT * FROM targets
       WHERE target_type = ? AND status = 'pending' AND relevance_score >= 70
       ORDER BY relevance_score DESC LIMIT ?`
    )
    .all(targetType, limit) as Target[];
}

export function getRandomPendingTarget(
  targetType: "post" | "person"
): Target | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM targets
       WHERE target_type = ? AND status = 'pending' AND relevance_score >= 70
       ORDER BY RANDOM() LIMIT 1`
    )
    .get(targetType) as Target | undefined;
  return row ?? null;
}

export function updateTargetStatus(
  targetId: string,
  status: string
): void {
  getDb()
    .prepare(
      `UPDATE targets SET status = ?, last_engaged_at = datetime('now') WHERE target_id = ?`
    )
    .run(status, targetId);
}

export function setAgentState(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO agent_state (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    )
    .run(key, value);
}

export function getAgentState(key: string): string | null {
  const row = getDb()
    .prepare("SELECT value FROM agent_state WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function recordFollowerCount(count: number): void {
  const today = new Date().toISOString().slice(0, 10);
  const existing = getDb()
    .prepare(
      "SELECT id FROM follower_history WHERE date(recorded_at) = ?"
    )
    .get(today) as { id: number } | undefined;

  if (!existing) {
    getDb()
      .prepare("INSERT INTO follower_history (count) VALUES (?)")
      .run(count);
  }
}

export function saveProfileSnapshot(params: {
  headline: string | null;
  about: string | null;
  followerCount: number | null;
  suggestions: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO profile_snapshots (headline, about, follower_count, suggestions)
       VALUES (?, ?, ?, ?)`
    )
    .run(
      params.headline,
      params.about,
      params.followerCount,
      params.suggestions
    );
}

export function savePost(content: string, pillar: string, postId?: string): void {
  getDb()
    .prepare(
      "INSERT INTO posts (post_id, content, pillar) VALUES (?, ?, ?)"
    )
    .run(postId ?? null, content, pillar);
}

export function hasContentHash(hash: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM content_history
       WHERE content_hash = ? AND created_at >= datetime('now', '-30 days')`
    )
    .get(hash) as { 1: number } | undefined;
  return !!row;
}

export function saveContentHash(hash: string, contentType: string): void {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO content_history (content_hash, content_type) VALUES (?, ?)"
    )
    .run(hash, contentType);
}

export function setBackoff(
  actionType: ActionType,
  blockedUntil: Date,
  reason: string
): void {
  getDb()
    .prepare(
      `INSERT INTO backoff_state (action_type, blocked_until, reason, retry_count)
       VALUES (?, ?, ?, 0)
       ON CONFLICT(action_type) DO UPDATE SET
         blocked_until = excluded.blocked_until,
         reason = excluded.reason,
         retry_count = retry_count + 1`
    )
    .run(actionType, blockedUntil.toISOString(), reason);
}

export function setGlobalHalt(reason: string): void {
  setAgentState("halted", "true");
  setAgentState("halt_reason", reason);
}

export function isHalted(): boolean {
  return getAgentState("halted") === "true";
}

export function getBackoff(actionType: ActionType): {
  blocked_until: string;
  reason: string;
} | null {
  const row = getDb()
    .prepare(
      "SELECT blocked_until, reason FROM backoff_state WHERE action_type = ?"
    )
    .get(actionType) as { blocked_until: string; reason: string } | undefined;

  if (!row) return null;
  if (new Date(row.blocked_until) <= new Date()) {
    getDb()
      .prepare("DELETE FROM backoff_state WHERE action_type = ?")
      .run(actionType);
    return null;
  }
  return row;
}

export function getStatsSummary(): {
  actionsToday: Record<string, number>;
  followerHistory: { count: number; recorded_at: string }[];
  lastHeartbeat: string | null;
  halted: boolean;
  haltReason: string | null;
} {
  const today = new Date().toISOString().slice(0, 10);
  const actionsToday = getDb()
    .prepare(
      `SELECT action_type, COUNT(*) as count FROM actions
       WHERE date(created_at) = ? GROUP BY action_type`
    )
    .all(today) as { action_type: string; count: number }[];

  const followerHistory = getDb()
    .prepare(
      "SELECT count, recorded_at FROM follower_history ORDER BY recorded_at DESC LIMIT 30"
    )
    .all() as { count: number; recorded_at: string }[];

  return {
    actionsToday: Object.fromEntries(
      actionsToday.map((r) => [r.action_type, r.count])
    ),
    followerHistory,
    lastHeartbeat: getAgentState("last_heartbeat"),
    halted: isHalted(),
    haltReason: getAgentState("halt_reason"),
  };
}

export function getRecentContent(limit = 50): string[] {
  const rows = getDb()
    .prepare(
      `SELECT content FROM actions
       WHERE content IS NOT NULL AND result = 'success'
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(limit) as { content: string }[];
  return rows.map((r) => r.content);
}

export function getQuotaRemaining(): Record<string, { used: number; cap: number }> {
  const accountAge = getAccountAgeDays();
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
