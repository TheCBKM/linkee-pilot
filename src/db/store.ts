import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { getDataDir, getDbPath } from "../config/env.js";
import {
  type ActionType,
  getDailyCap,
  LIMITS,
} from "../config/limits.js";
import {
  checkInviteReady,
  maxStage,
  type PersonSource,
  type PersonTouch,
  type SequenceStage,
  stageRank,
} from "../config/sequence.js";
import { runMigrations, getSchemaPath } from "./migrate.js";
import { passesIcpFilter } from "../ai/icp-filter.js";

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
    const schemaPath = getSchemaPath();
    try {
      db.exec(fs.readFileSync(schemaPath, "utf-8"));
    } catch (err) {
      console.warn("[db] Schema replay warning:", err);
    }
    runMigrations(db);
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
  sequence_stage: string | null;
  author_provider_id: string | null;
  author_public_id: string | null;
  source_post_id: string | null;
  person_source: string | null;
  posted_at: string | null;
}

export interface UpsertTargetInput {
  target_type: "post" | "person";
  target_id: string;
  provider_id?: string | null;
  social_id?: string | null;
  author_name?: string | null;
  author_headline?: string | null;
  content_preview?: string | null;
  relevance_score?: number;
  status?: string;
  metadata?: string | null;
  sequence_stage?: string | null;
  author_provider_id?: string | null;
  author_public_id?: string | null;
  source_post_id?: string | null;
  person_source?: string | null;
  posted_at?: string | null;
}

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
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

export function upsertTarget(target: UpsertTargetInput): void {
  getDb()
    .prepare(
      `INSERT INTO targets (target_type, target_id, provider_id, social_id, author_name,
        author_headline, content_preview, relevance_score, status, metadata, sequence_stage,
        author_provider_id, author_public_id, source_post_id, person_source, posted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(target_id) DO UPDATE SET
         relevance_score = MAX(relevance_score, excluded.relevance_score),
         content_preview = COALESCE(excluded.content_preview, content_preview),
         metadata = COALESCE(excluded.metadata, metadata),
         author_provider_id = COALESCE(excluded.author_provider_id, author_provider_id),
         author_public_id = COALESCE(excluded.author_public_id, author_public_id),
         posted_at = COALESCE(excluded.posted_at, posted_at),
         author_headline = COALESCE(excluded.author_headline, author_headline),
         author_name = COALESCE(excluded.author_name, author_name),
         person_source = COALESCE(excluded.person_source, person_source),
         source_post_id = COALESCE(excluded.source_post_id, source_post_id)`
    )
    .run(
      target.target_type,
      target.target_id,
      target.provider_id ?? null,
      target.social_id ?? null,
      target.author_name ?? null,
      target.author_headline ?? null,
      target.content_preview ?? null,
      target.relevance_score ?? 0,
      target.status ?? "pending",
      target.metadata ?? null,
      target.sequence_stage ?? "discovered",
      target.author_provider_id ?? null,
      target.author_public_id ?? null,
      target.source_post_id ?? null,
      target.person_source ?? null,
      target.posted_at ?? null
    );
}

export function upsertPersonFromPostAuthor(params: {
  providerId?: string | null;
  publicId?: string | null;
  name?: string | null;
  headline?: string | null;
  sourcePostId: string;
  relevanceScore?: number;
  location?: string | null;
}): string | null {
  const personId =
    params.providerId ??
    (params.publicId ? `person:${params.publicId}` : null);
  if (!personId) return null;

  const icp = passesIcpFilter({
    targetType: "person",
    headline: params.headline,
    location: params.location,
    requirePreferredGeo: false,
  });

  upsertTarget({
    target_type: "person",
    target_id: personId,
    provider_id: params.providerId ?? null,
    author_name: params.name ?? null,
    author_headline: params.headline ?? null,
    author_public_id: params.publicId ?? null,
    source_post_id: params.sourcePostId,
    person_source: "post",
    relevance_score: icp.pass ? (params.relevanceScore ?? 0) : 0,
    status: icp.pass ? "pending" : "filtered",
    sequence_stage: "discovered",
    metadata: JSON.stringify({
      location: params.location ?? undefined,
      ...(icp.pass ? {} : { icp_reject_reason: icp.reason }),
    }),
  });

  return icp.pass ? personId : null;
}

export function getPersonTargetById(personId: string): Target | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM targets WHERE target_type = 'person' AND target_id = ? LIMIT 1`
    )
    .get(personId) as Target | undefined;
  return row ?? null;
}

export function getPersonForPostTarget(post: Target): Target | null {
  if (post.author_provider_id) {
    const byProvider = getPersonTargetById(post.author_provider_id);
    if (byProvider) return byProvider;
  }
  if (post.author_public_id) {
    const byPublic = getPersonTargetById(`person:${post.author_public_id}`);
    if (byPublic) return byPublic;
  }
  return null;
}

function getPersonTouches(person: Target): Partial<Record<PersonTouch, boolean>> {
  const metadata = parseMetadata(person.metadata);
  const touches = metadata.touches;
  if (touches && typeof touches === "object") {
    return touches as Partial<Record<PersonTouch, boolean>>;
  }
  return {};
}

function recordPersonTouch(personId: string, touch: PersonTouch): void {
  const person = getPersonTargetById(personId);
  if (!person) return;

  const metadata = parseMetadata(person.metadata);
  const touches = getPersonTouches(person);
  touches[touch] = true;
  metadata.touches = touches;

  getDb()
    .prepare(
      `UPDATE targets SET metadata = ?, last_engaged_at = datetime('now')
       WHERE target_id = ? AND target_type = 'person'`
    )
    .run(JSON.stringify(metadata), personId);
}

export function advanceSequenceStage(
  personId: string,
  newStage: SequenceStage
): void {
  const person = getPersonTargetById(personId);
  if (!person) return;

  const current = (person.sequence_stage ?? "discovered") as SequenceStage;
  const next = maxStage(current, newStage);

  if (newStage === "liked") recordPersonTouch(personId, "liked");
  if (newStage === "commented") recordPersonTouch(personId, "commented");
  if (newStage === "viewed") recordPersonTouch(personId, "viewed");

  getDb()
    .prepare(
      `UPDATE targets SET sequence_stage = ?, last_engaged_at = datetime('now')
       WHERE target_id = ? AND target_type = 'person'`
    )
    .run(next, personId);

  maybePromoteToInviteReady(personId);
}

function maybePromoteToInviteReady(personId: string): void {
  const person = getPersonTargetById(personId);
  if (!person || person.status === "invited") return;

  const ready = checkInviteReady({
    sequenceStage: person.sequence_stage,
    source: (person.person_source as PersonSource | null) ?? null,
    touches: getPersonTouches(person),
  });

  if (ready && person.sequence_stage !== "invite_ready") {
    getDb()
      .prepare(
        `UPDATE targets SET sequence_stage = 'invite_ready'
         WHERE target_id = ? AND target_type = 'person'`
      )
      .run(personId);
  }
}

export function cacheProviderId(
  personId: string,
  providerId: string
): void {
  const person = getPersonTargetById(personId);
  if (!person) return;

  const metadata = parseMetadata(person.metadata);
  metadata.resolved_provider_id = providerId;

  getDb()
    .prepare(
      `UPDATE targets SET provider_id = ?, metadata = ?
       WHERE target_id = ? AND target_type = 'person'`
    )
    .run(providerId, JSON.stringify(metadata), personId);
}

export function getResolvedProviderId(person: Target): string | null {
  if (person.provider_id) return person.provider_id;
  const metadata = parseMetadata(person.metadata);
  const cached = metadata.resolved_provider_id;
  return typeof cached === "string" ? cached : null;
}

export function getPersonIdentifier(person: Target): string | null {
  return (
    getResolvedProviderId(person) ??
    person.author_public_id ??
    (person.target_id.startsWith("person:")
      ? person.target_id.slice("person:".length)
      : person.target_id)
  );
}

export function getPendingTargets(
  targetType: "post" | "person",
  limit = 10
): Target[] {
  const minScore =
    targetType === "post"
      ? LIMITS.minEngagementRelevanceScore
      : LIMITS.minRelevanceScore;
  return getDb()
    .prepare(
      `SELECT * FROM targets
       WHERE target_type = ? AND status = 'pending' AND relevance_score >= ?
       ORDER BY relevance_score DESC LIMIT ?`
    )
    .all(targetType, minScore, limit) as Target[];
}

export function getRandomPendingTarget(
  targetType: "post" | "person"
): Target | null {
  const minScore =
    targetType === "post"
      ? LIMITS.minEngagementRelevanceScore
      : LIMITS.minRelevanceScore;
  const row = getDb()
    .prepare(
      `SELECT * FROM (
         SELECT * FROM targets
         WHERE target_type = ? AND status = 'pending' AND relevance_score >= ?
         ORDER BY relevance_score DESC
         LIMIT 8
       )
       ORDER BY RANDOM() LIMIT 1`
    )
    .get(targetType, minScore) as Target | undefined;
  return row ?? null;
}

export function getFreshPostTargetForEngagement(): Target | null {
  const minScore = LIMITS.minEngagementRelevanceScore;
  const row = getDb()
    .prepare(
      `SELECT * FROM targets
       WHERE target_type = 'post' AND status = 'pending' AND relevance_score >= ?
       AND (posted_at IS NULL OR posted_at >= datetime('now', '-2 days'))
       AND (
         posted_at >= datetime('now', '-6 hours')
         OR COALESCE(json_extract(metadata, '$.reaction_counter'), 0)
            + 2 * COALESCE(json_extract(metadata, '$.comment_counter'), 0)
            >= ?
       )
       ORDER BY
         COALESCE(json_extract(metadata, '$.reaction_counter'), 0)
           + 2 * COALESCE(json_extract(metadata, '$.comment_counter'), 0) DESC,
         relevance_score DESC,
         posted_at DESC
       LIMIT 1`
    )
    .get(minScore, LIMITS.minPostReactions) as Target | undefined;
  return row ?? null;
}

export function getPersonForInvite(): Target | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM targets
       WHERE target_type = 'person'
         AND status = 'pending'
         AND sequence_stage = 'invite_ready'
       ORDER BY relevance_score DESC, RANDOM() LIMIT 1`
    )
    .get() as Target | undefined;
  return row ?? null;
}

export function getPersonForProfileView(): Target | null {
  const commented = getDb()
    .prepare(
      `SELECT * FROM targets
       WHERE target_type = 'person'
         AND status = 'pending'
         AND sequence_stage = 'commented'
         AND person_source = 'post'
       ORDER BY relevance_score DESC, RANDOM() LIMIT 1`
    )
    .get() as Target | undefined;
  if (commented) return commented;

  const postPath = getDb()
    .prepare(
      `SELECT * FROM targets
       WHERE target_type = 'person'
         AND status = 'pending'
         AND sequence_stage IN ('discovered', 'liked')
         AND person_source = 'post'
       ORDER BY relevance_score DESC, RANDOM() LIMIT 1`
    )
    .get() as Target | undefined;
  if (postPath) return postPath;

  const searchPerson = getDb()
    .prepare(
      `SELECT * FROM targets
       WHERE target_type = 'person'
         AND status = 'pending'
         AND sequence_stage = 'discovered'
         AND person_source = 'search'
       ORDER BY relevance_score DESC, RANDOM() LIMIT 1`
    )
    .get() as Target | undefined;
  return searchPerson ?? null;
}

export function getRepostCandidate(): Target | null {
  const row = getDb()
    .prepare(
      `SELECT t.* FROM targets t
       WHERE t.target_type = 'post'
         AND t.status = 'pending'
         AND t.relevance_score >= 85
         AND t.social_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM posts p WHERE p.source_post_id = t.social_id
         )
       ORDER BY t.relevance_score DESC, RANDOM() LIMIT 1`
    )
    .get() as Target | undefined;
  return row ?? null;
}

export function getTopPendingPostPreviews(limit = 12): {
  author_name: string | null;
  author_headline: string | null;
  content_preview: string | null;
  relevance_score: number;
}[] {
  return getDb()
    .prepare(
      `SELECT author_name, author_headline, content_preview, relevance_score
       FROM targets
       WHERE target_type = 'post'
         AND status = 'pending'
         AND content_preview IS NOT NULL
         AND length(trim(content_preview)) > 40
         AND relevance_score >= ?
       ORDER BY relevance_score DESC, discovered_at DESC
       LIMIT ?`
    )
    .all(LIMITS.minRelevanceScore, limit) as {
    author_name: string | null;
    author_headline: string | null;
    content_preview: string | null;
    relevance_score: number;
  }[];
}

export function getSequenceStageCounts(): Record<string, number> {
  const rows = getDb()
    .prepare(
      `SELECT sequence_stage, COUNT(*) as count FROM targets
       WHERE target_type = 'person' AND status != 'filtered'
       GROUP BY sequence_stage`
    )
    .all() as { sequence_stage: string | null; count: number }[];

  return Object.fromEntries(
    rows.map((r) => [r.sequence_stage ?? "discovered", r.count])
  );
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

export function markPersonInvited(personId: string): void {
  getDb()
    .prepare(
      `UPDATE targets SET status = 'invited', sequence_stage = 'invited',
       last_engaged_at = datetime('now') WHERE target_id = ?`
    )
    .run(personId);
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

export function savePost(params: {
  content: string;
  pillar: string;
  postId?: string;
  format?: string;
  sourcePostId?: string;
}): void {
  getDb()
    .prepare(
      "INSERT INTO posts (post_id, content, pillar, format, source_post_id) VALUES (?, ?, ?, ?, ?)"
    )
    .run(
      params.postId ?? null,
      params.content,
      params.pillar,
      params.format ?? "text",
      params.sourcePostId ?? null
    );
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
    "view_profile",
  ];

  return Object.fromEntries(
    actionTypes.map((type) => {
      const cap = getDailyCap(type, accountAge);
      const used = getQuotaCount(type, today);
      return [type, { used, cap }];
    })
  );
}

export { stageRank, checkInviteReady };
