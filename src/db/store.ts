import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { getDataDir, getDbPath } from "../config/env.js";
import { isOwnProviderId } from "../config/identity.js";
import {
  type ActionType,
  getDailyCap,
  LIMITS,
} from "../config/limits.js";
import { JOB_STRONG_MATCH_SCORE } from "../config/jobs.js";
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
import { getLocalDateString } from "../config/local-time.js";

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

/** True when we already succeeded or dry-ran this action on the target. */
export function hasCompletedAction(
  actionType: ActionType,
  targetId: string,
  withinDays: number
): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM actions
       WHERE action_type = ? AND target_id = ?
         AND result IN ('success', 'dry_run')
         AND created_at >= datetime('now', ?)
       LIMIT 1`
    )
    .get(actionType, targetId, `-${withinDays} days`) as { 1: number } | undefined;
  return !!row;
}

/** Count failed attempts for an action+target with a specific error type. */
export function countFailedActions(
  actionType: ActionType,
  targetId: string,
  errorType: string
): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) as count FROM actions
       WHERE action_type = ? AND target_id = ?
         AND result = 'failed' AND error_type = ?`
    )
    .get(actionType, targetId, errorType) as { count: number } | undefined;
  return row?.count ?? 0;
}

/**
 * Mark a pending target as skipped so it is not selected again.
 * Matches by target_id, social_id, or provider_id (action logs may use any of these).
 */
export function markTargetSkipped(actionTargetId: string): number {
  const result = getDb()
    .prepare(
      `UPDATE targets
       SET status = 'skipped', last_engaged_at = datetime('now')
       WHERE status = 'pending'
         AND (target_id = ? OR social_id = ? OR provider_id = ?)`
    )
    .run(actionTargetId, actionTargetId, actionTargetId);
  return result.changes;
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
  personSource?: PersonSource;
}): string | null {
  const personId =
    params.providerId ??
    (params.publicId ? `person:${params.publicId}` : null);
  if (!personId) return null;

  const personSource = params.personSource ?? "post";

  if (isOwnProviderId(params.providerId) || isOwnProviderId(personId)) {
    upsertTarget({
      target_type: "person",
      target_id: personId,
      provider_id: params.providerId ?? null,
      author_name: params.name ?? null,
      author_headline: params.headline ?? null,
      author_public_id: params.publicId ?? null,
      source_post_id: params.sourcePostId,
      person_source: personSource,
      relevance_score: 0,
      status: "filtered",
      sequence_stage: "discovered",
      metadata: JSON.stringify({
        location: params.location ?? undefined,
        icp_reject_reason: "own profile (self)",
      }),
    });
    return null;
  }

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
    person_source: personSource,
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

  const providerId =
    getResolvedProviderId(person) ??
    person.provider_id ??
    person.target_id.replace(/^person:/, "");
  if (isOwnProviderId(providerId) || isOwnProviderId(person.provider_id)) {
    updateTargetStatus(person.target_id, "filtered");
    return;
  }

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
           AND (
             ? != 'post'
             OR COALESCE(json_extract(metadata, '$.nurture'), 0) != 1
           )
         ORDER BY relevance_score DESC
         LIMIT 8
       )
       ORDER BY RANDOM() LIMIT 1`
    )
    .get(targetType, minScore, targetType) as Target | undefined;
  return row ?? null;
}

export function getFreshPostTargetForEngagement(): Target | null {
  const minScore = LIMITS.minEngagementRelevanceScore;
  const row = getDb()
    .prepare(
      `SELECT * FROM targets
       WHERE target_type = 'post' AND status = 'pending' AND relevance_score >= ?
       AND COALESCE(json_extract(metadata, '$.nurture'), 0) != 1
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
  const rows = getDb()
    .prepare(
      `SELECT * FROM targets
       WHERE target_type = 'person'
         AND status = 'pending'
         AND sequence_stage = 'invite_ready'
       ORDER BY relevance_score DESC, RANDOM() LIMIT 20`
    )
    .all() as Target[];

  for (const row of rows) {
    const providerId =
      getResolvedProviderId(row) ??
      row.provider_id ??
      row.target_id.replace(/^person:/, "");
    if (isOwnProviderId(providerId) || isOwnProviderId(row.provider_id)) {
      console.warn(
        `[store] Filtering own profile from invite queue (${providerId})`
      );
      updateTargetStatus(row.target_id, "filtered");
      continue;
    }
    return row;
  }
  return null;
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

  // Search discoveries and people who commented on our posts: view → invite_ready.
  const warmPerson = getDb()
    .prepare(
      `SELECT * FROM targets
       WHERE target_type = 'person'
         AND status = 'pending'
         AND sequence_stage = 'discovered'
         AND person_source IN ('search', 'comment')
       ORDER BY relevance_score DESC, RANDOM() LIMIT 1`
    )
    .get() as Target | undefined;
  return warmPerson ?? null;
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

export function markInviteWithdrawn(personId: string): void {
  getDb()
    .prepare(
      `UPDATE targets SET status = 'withdrawn', sequence_stage = 'withdrawn',
       last_engaged_at = datetime('now') WHERE target_id = ?`
    )
    .run(personId);
}

export function findPersonByProviderId(providerId: string): Target | null {
  if (!providerId) return null;
  const row = getDb()
    .prepare(
      `SELECT * FROM targets
       WHERE target_type = 'person'
         AND (
           provider_id = ?
           OR json_extract(metadata, '$.resolved_provider_id') = ?
         )
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(providerId, providerId) as Target | undefined;
  return row ?? null;
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

export interface OwnPostRow {
  id: number;
  post_id: string;
  content: string;
  pillar: string | null;
  format: string;
  source_post_id: string | null;
  published_at: string;
}

/** Own published posts with a LinkedIn post_id, newest first. */
export function getRecentOwnPosts(withinHours = 48): OwnPostRow[] {
  return getDb()
    .prepare(
      `SELECT id, post_id, content, pillar, format, source_post_id, published_at
       FROM posts
       WHERE post_id IS NOT NULL AND TRIM(post_id) != ''
         AND published_at >= datetime('now', ?)
       ORDER BY published_at DESC`
    )
    .all(`-${withinHours} hours`) as OwnPostRow[];
}

export function hasRecentOwnPosts(withinHours = 48): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM posts
       WHERE post_id IS NOT NULL AND TRIM(post_id) != ''
         AND published_at >= datetime('now', ?)
       LIMIT 1`
    )
    .get(`-${withinHours} hours`) as { 1: number } | undefined;
  return !!row;
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

// --- First-degree connections / nurture ---

export interface ConnectionRow {
  id: number;
  provider_id: string;
  public_identifier: string | null;
  full_name: string | null;
  headline: string | null;
  profile_url: string | null;
  connected_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  from_invite: number;
  accepted_at: string | null;
  last_engaged_at: string | null;
  metadata: string | null;
}

export interface UpsertConnectionInput {
  providerId: string;
  publicIdentifier?: string | null;
  fullName?: string | null;
  headline?: string | null;
  profileUrl?: string | null;
  /** LinkedIn connection timestamp (ISO or unix seconds). */
  connectedAt?: string | null;
  metadata?: Record<string, unknown>;
}

export function isNurtureTarget(target: Target): boolean {
  const meta = parseMetadata(target.metadata);
  return meta.nurture === true;
}

export function getConnectionByProviderId(
  providerId: string
): ConnectionRow | null {
  if (!providerId) return null;
  const row = getDb()
    .prepare("SELECT * FROM connections WHERE provider_id = ? LIMIT 1")
    .get(providerId) as ConnectionRow | undefined;
  return row ?? null;
}

export function isKnownConnection(providerId: string | null | undefined): boolean {
  if (!providerId) return false;
  return !!getConnectionByProviderId(providerId);
}

function toIsoTimestamp(value: string | number | null | undefined): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const asNum = Number(value);
  if (!Number.isNaN(asNum) && /^\d+$/.test(String(value).trim())) {
    return toIsoTimestamp(asNum);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Upsert a first-degree relation. Returns whether this row is newly inserted
 * and whether it was correlated with a prior invite we sent.
 */
export function upsertConnection(input: UpsertConnectionInput): {
  inserted: boolean;
  fromInvite: boolean;
  acceptedNow: boolean;
} {
  const providerId = input.providerId.trim();
  if (!providerId || isOwnProviderId(providerId)) {
    return { inserted: false, fromInvite: false, acceptedNow: false };
  }

  const existing = getConnectionByProviderId(providerId);
  const connectedAt =
    toIsoTimestamp(input.connectedAt) ?? existing?.connected_at ?? null;

  const invitedPerson = findPersonByProviderId(providerId);
  const inviteAction = getDb()
    .prepare(
      `SELECT 1 FROM actions
       WHERE action_type IN ('send_invite', 'es_invite')
         AND result = 'success'
         AND (target_id = ? OR target_id = ?)
       LIMIT 1`
    )
    .get(providerId, invitedPerson?.target_id ?? providerId) as
    | { 1: number }
    | undefined;

  const wasInvited =
    !!inviteAction ||
    (!!invitedPerson &&
      (invitedPerson.status === "invited" ||
        invitedPerson.sequence_stage === "invited" ||
        invitedPerson.status === "connected" ||
        invitedPerson.sequence_stage === "connected"));

  const fromInvite = existing?.from_invite === 1 || wasInvited;
  let acceptedNow = false;
  let acceptedAt = existing?.accepted_at ?? null;

  if (!existing) {
    // New relation: if we previously invited them, this is an acceptance.
    if (wasInvited) {
      acceptedAt = connectedAt ?? new Date().toISOString();
      acceptedNow = true;
    }
    getDb()
      .prepare(
        `INSERT INTO connections (
           provider_id, public_identifier, full_name, headline, profile_url,
           connected_at, from_invite, accepted_at, metadata
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        providerId,
        input.publicIdentifier ?? null,
        input.fullName ?? null,
        input.headline ?? null,
        input.profileUrl ?? null,
        connectedAt,
        fromInvite ? 1 : 0,
        acceptedAt,
        JSON.stringify(input.metadata ?? {})
      );
  } else {
    // Existing row: if invite correlation newly applies, mark accept.
    if (wasInvited && !existing.accepted_at) {
      acceptedAt = connectedAt ?? new Date().toISOString();
      acceptedNow = true;
    }
    getDb()
      .prepare(
        `UPDATE connections SET
           public_identifier = COALESCE(?, public_identifier),
           full_name = COALESCE(?, full_name),
           headline = COALESCE(?, headline),
           profile_url = COALESCE(?, profile_url),
           connected_at = COALESCE(?, connected_at),
           last_seen_at = datetime('now'),
           from_invite = CASE WHEN ? THEN 1 ELSE from_invite END,
           accepted_at = COALESCE(accepted_at, ?),
           metadata = COALESCE(?, metadata)
         WHERE provider_id = ?`
      )
      .run(
        input.publicIdentifier ?? null,
        input.fullName ?? null,
        input.headline ?? null,
        input.profileUrl ?? null,
        connectedAt,
        fromInvite ? 1 : 0,
        acceptedAt,
        input.metadata ? JSON.stringify(input.metadata) : null,
        providerId
      );
  }

  if (acceptedNow || (wasInvited && invitedPerson)) {
    markPersonConnected(providerId, acceptedAt ?? new Date().toISOString());
  }

  return {
    inserted: !existing,
    fromInvite,
    acceptedNow,
  };
}

export function markPersonConnected(
  providerId: string,
  acceptedAt: string
): void {
  setEsCandidateStatusByProviderId(providerId, "connected");
  const person = findPersonByProviderId(providerId);
  if (!person) return;

  getDb()
    .prepare(
      `UPDATE targets SET
         status = 'connected',
         sequence_stage = 'connected',
         last_engaged_at = datetime('now'),
         metadata = json_set(
           COALESCE(metadata, '{}'),
           '$.accepted_at',
           ?,
           '$.connected',
           json('true')
         )
       WHERE target_id = ?`
    )
    .run(acceptedAt, person.target_id);
}

export function touchConnectionEngaged(providerId: string): void {
  if (!providerId) return;
  getDb()
    .prepare(
      `UPDATE connections SET last_engaged_at = datetime('now')
       WHERE provider_id = ?`
    )
    .run(providerId);
}

export function getConnectionStats(): {
  total: number;
  fromInvite: number;
  accepted7d: number;
  accepted14d: number;
} {
  const database = getDb();
  const total = (
    database.prepare("SELECT COUNT(*) as c FROM connections").get() as {
      c: number;
    }
  ).c;
  const fromInvite = (
    database
      .prepare("SELECT COUNT(*) as c FROM connections WHERE from_invite = 1")
      .get() as { c: number }
  ).c;
  const accepted7d = (
    database
      .prepare(
        `SELECT COUNT(*) as c FROM connections
         WHERE accepted_at IS NOT NULL
           AND accepted_at >= datetime('now', '-7 days')`
      )
      .get() as { c: number }
  ).c;
  const accepted14d = (
    database
      .prepare(
        `SELECT COUNT(*) as c FROM connections
         WHERE accepted_at IS NOT NULL
           AND accepted_at >= datetime('now', '-14 days')`
      )
      .get() as { c: number }
  ).c;
  return { total, fromInvite, accepted7d, accepted14d };
}

/**
 * Pick a pending nurture post, preferring recent accepts and respecting
 * per-connection cooldowns.
 */
export function getNurturePostTargetForEngagement(): Target | null {
  const recentDays = LIMITS.nurture.recentAcceptDays;
  const cooldownDays = LIMITS.nurture.connectionCooldownDays;

  const row = getDb()
    .prepare(
      `SELECT t.* FROM targets t
       WHERE t.target_type = 'post'
         AND t.status = 'pending'
         AND json_extract(t.metadata, '$.nurture') = 1
         AND (t.posted_at IS NULL OR t.posted_at >= datetime('now', '-2 days'))
         AND (
           t.posted_at >= datetime('now', '-6 hours')
           OR COALESCE(json_extract(t.metadata, '$.reaction_counter'), 0)
              + 2 * COALESCE(json_extract(t.metadata, '$.comment_counter'), 0)
              >= ?
         )
         AND (
           t.author_provider_id IS NULL
           OR NOT EXISTS (
             SELECT 1 FROM connections c
             WHERE c.provider_id = t.author_provider_id
               AND c.last_engaged_at IS NOT NULL
               AND c.last_engaged_at >= datetime('now', ?)
           )
         )
       ORDER BY
         CASE
           WHEN EXISTS (
             SELECT 1 FROM connections c
             WHERE c.provider_id = t.author_provider_id
               AND c.accepted_at IS NOT NULL
               AND c.accepted_at >= datetime('now', ?)
           ) THEN 0
           ELSE 1
         END,
         COALESCE(json_extract(t.metadata, '$.reaction_counter'), 0)
           + 2 * COALESCE(json_extract(t.metadata, '$.comment_counter'), 0) DESC,
         t.posted_at DESC,
         t.relevance_score DESC
       LIMIT 1`
    )
    .get(
      LIMITS.minPostReactions,
      `-${cooldownDays} days`,
      `-${recentDays} days`
    ) as Target | undefined;

  return row ?? null;
}

export function countNurtureActionsToday(): {
  likes: number;
  comments: number;
} {
  const today = new Date().toISOString().slice(0, 10);
  const likes = (
    getDb()
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
  const comments = (
    getDb()
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
  return { likes, comments };
}

export function countPendingNurturePosts(): number {
  return (
    getDb()
      .prepare(
        `SELECT COUNT(*) as c FROM targets
         WHERE target_type = 'post'
           AND status = 'pending'
           AND json_extract(metadata, '$.nurture') = 1`
      )
      .get() as { c: number }
  ).c;
}

// --- Remote job / freelance opportunities ---

export type OpportunityStatus =
  | "new"
  | "filtered"
  | "shortlisted"
  | "applied"
  | "dismissed";

export interface OpportunityRow {
  id: number;
  job_id: string;
  title: string;
  company: string | null;
  company_url: string | null;
  url: string | null;
  location: string | null;
  presence: string | null;
  job_type: string | null;
  role_family: string | null;
  posted_at: string | null;
  description: string | null;
  match_score: number;
  match_reasons: string | null;
  match_gaps: string | null;
  pitch: string | null;
  status: string;
  notified: number;
  metadata: string | null;
  discovered_at: string;
}

export interface UpsertOpportunityInput {
  jobId: string;
  title: string;
  company?: string | null;
  companyUrl?: string | null;
  url?: string | null;
  location?: string | null;
  presence?: string | null;
  jobType?: string | null;
  roleFamily?: string | null;
  postedAt?: string | null;
  description?: string | null;
  matchScore?: number;
  matchReasons?: string[];
  matchGaps?: string[];
  pitch?: string | null;
  status?: OpportunityStatus;
  metadata?: Record<string, unknown>;
}

export function hasRecentOpportunity(
  jobId: string,
  withinDays: number
): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM opportunities
       WHERE job_id = ?
         AND discovered_at >= datetime('now', ?)
       LIMIT 1`
    )
    .get(jobId, `-${withinDays} days`) as { 1: number } | undefined;
  return !!row;
}

export function upsertOpportunity(input: UpsertOpportunityInput): void {
  getDb()
    .prepare(
      `INSERT INTO opportunities (
         job_id, title, company, company_url, url, location, presence,
         job_type, role_family, posted_at, description, match_score,
         match_reasons, match_gaps, pitch, status, metadata
       ) VALUES (
         @job_id, @title, @company, @company_url, @url, @location, @presence,
         @job_type, @role_family, @posted_at, @description, @match_score,
         @match_reasons, @match_gaps, @pitch, @status, @metadata
       )
       ON CONFLICT(job_id) DO UPDATE SET
         title = excluded.title,
         company = COALESCE(excluded.company, opportunities.company),
         company_url = COALESCE(excluded.company_url, opportunities.company_url),
         url = COALESCE(excluded.url, opportunities.url),
         location = COALESCE(excluded.location, opportunities.location),
         presence = COALESCE(excluded.presence, opportunities.presence),
         job_type = COALESCE(excluded.job_type, opportunities.job_type),
         role_family = COALESCE(excluded.role_family, opportunities.role_family),
         posted_at = COALESCE(excluded.posted_at, opportunities.posted_at),
         description = COALESCE(excluded.description, opportunities.description),
         match_score = excluded.match_score,
         match_reasons = excluded.match_reasons,
         match_gaps = excluded.match_gaps,
         pitch = excluded.pitch,
         metadata = COALESCE(excluded.metadata, opportunities.metadata)`
    )
    .run({
      job_id: input.jobId,
      title: input.title,
      company: input.company ?? null,
      company_url: input.companyUrl ?? null,
      url: input.url ?? null,
      location: input.location ?? null,
      presence: input.presence ?? null,
      job_type: input.jobType ?? null,
      role_family: input.roleFamily ?? null,
      posted_at: input.postedAt ?? null,
      description: input.description ?? null,
      match_score: input.matchScore ?? 0,
      match_reasons: JSON.stringify(input.matchReasons ?? []),
      match_gaps: JSON.stringify(input.matchGaps ?? []),
      pitch: input.pitch ?? null,
      status: input.status ?? "new",
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    });
}

export function markOpportunityNotified(jobId: string): void {
  getDb()
    .prepare("UPDATE opportunities SET notified = 1 WHERE job_id = ?")
    .run(jobId);
}

export function setOpportunityStatus(
  id: number,
  status: OpportunityStatus
): void {
  getDb()
    .prepare("UPDATE opportunities SET status = ? WHERE id = ?")
    .run(status, id);
}

export function getTopOpportunities(limit = 25): OpportunityRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM opportunities
       WHERE status NOT IN ('filtered', 'dismissed')
       ORDER BY match_score DESC, discovered_at DESC
       LIMIT ?`
    )
    .all(limit) as OpportunityRow[];
}

export function getOpportunityStats(): {
  total: number;
  strong: number;
  new7d: number;
  applied: number;
} {
  const database = getDb();
  const one = (sql: string, ...params: unknown[]): number =>
    (database.prepare(sql).get(...params) as { c: number }).c;

  return {
    total: one(
      "SELECT COUNT(*) as c FROM opportunities WHERE status != 'filtered'"
    ),
    strong: one(
      "SELECT COUNT(*) as c FROM opportunities WHERE status NOT IN ('filtered','dismissed') AND match_score >= ?",
      JOB_STRONG_MATCH_SCORE
    ),
    new7d: one(
      `SELECT COUNT(*) as c FROM opportunities
       WHERE status != 'filtered' AND discovered_at >= datetime('now', '-7 days')`
    ),
    applied: one(
      "SELECT COUNT(*) as c FROM opportunities WHERE status = 'applied'"
    ),
  };
}

// --- Approval-gated DM queue ---

export type DmStatus =
  | "pending_approval"
  | "approved"
  | "rejected"
  | "sent"
  | "failed";

export interface DmQueueRow {
  id: number;
  provider_id: string;
  full_name: string | null;
  headline: string | null;
  opportunity_id: number | null;
  kind: string;
  draft_text: string;
  status: string;
  chat_id: string | null;
  error: string | null;
  created_at: string;
  approved_at: string | null;
  sent_at: string | null;
}

export function enqueueDm(input: {
  providerId: string;
  fullName?: string | null;
  headline?: string | null;
  opportunityId?: number | null;
  kind?: "first_touch" | "followup";
  draftText: string;
}): number {
  const result = getDb()
    .prepare(
      `INSERT INTO dm_queue (
         provider_id, full_name, headline, opportunity_id, kind, draft_text
       ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.providerId,
      input.fullName ?? null,
      input.headline ?? null,
      input.opportunityId ?? null,
      input.kind ?? "first_touch",
      input.draftText
    );
  return Number(result.lastInsertRowid);
}

/** True when this person already has any DM queued, sent, or rejected. */
export function hasDmForProvider(providerId: string): boolean {
  if (!providerId) return false;
  const row = getDb()
    .prepare(
      `SELECT 1 FROM dm_queue
       WHERE provider_id = ? AND status != 'failed'
       LIMIT 1`
    )
    .get(providerId) as { 1: number } | undefined;
  return !!row;
}

export function getDmQueue(status?: DmStatus, limit = 50): DmQueueRow[] {
  if (status) {
    return getDb()
      .prepare(
        `SELECT * FROM dm_queue WHERE status = ?
         ORDER BY created_at ASC LIMIT ?`
      )
      .all(status, limit) as DmQueueRow[];
  }
  return getDb()
    .prepare("SELECT * FROM dm_queue ORDER BY created_at DESC LIMIT ?")
    .all(limit) as DmQueueRow[];
}

export function getDmById(id: number): DmQueueRow | null {
  const row = getDb()
    .prepare("SELECT * FROM dm_queue WHERE id = ?")
    .get(id) as DmQueueRow | undefined;
  return row ?? null;
}

/** Oldest approved DM waiting to go out. */
export function getNextApprovedDm(): DmQueueRow | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM dm_queue WHERE status = 'approved'
       ORDER BY approved_at ASC LIMIT 1`
    )
    .get() as DmQueueRow | undefined;
  return row ?? null;
}

export function countPendingDmApprovals(): number {
  return (
    getDb()
      .prepare(
        "SELECT COUNT(*) as c FROM dm_queue WHERE status = 'pending_approval'"
      )
      .get() as { c: number }
  ).c;
}

/** Approve a pending DM, optionally replacing the draft with edited text. */
export function approveDm(id: number, editedText?: string): boolean {
  const result = getDb()
    .prepare(
      `UPDATE dm_queue
       SET status = 'approved',
           approved_at = datetime('now'),
           draft_text = COALESCE(?, draft_text)
       WHERE id = ? AND status = 'pending_approval'`
    )
    .run(editedText ?? null, id);
  return result.changes > 0;
}

export function rejectDm(id: number): boolean {
  const result = getDb()
    .prepare(
      `UPDATE dm_queue SET status = 'rejected'
       WHERE id = ? AND status IN ('pending_approval', 'approved')`
    )
    .run(id);
  return result.changes > 0;
}

export function markDmSent(id: number, chatId: string | null): void {
  getDb()
    .prepare(
      `UPDATE dm_queue
       SET status = 'sent', sent_at = datetime('now'), chat_id = ?, error = NULL
       WHERE id = ?`
    )
    .run(chatId, id);
}

/** Attach the thread a queued follow-up should be sent into. */
export function setDmChatId(id: number, chatId: string): void {
  getDb().prepare("UPDATE dm_queue SET chat_id = ? WHERE id = ?").run(chatId, id);
}

export function markDmFailed(id: number, error: string): void {
  getDb()
    .prepare("UPDATE dm_queue SET status = 'failed', error = ? WHERE id = ?")
    .run(error.slice(0, 500), id);
}

/**
 * Accepted connections who look like they can hire, have no DM yet, and have
 * been connected long enough that a message does not look automated.
 */
export function getConnectionForDm(params: {
  minHoursSinceAccept: number;
  maxDaysSinceAccept: number;
}): ConnectionRow | null {
  const row = getDb()
    .prepare(
      `SELECT c.* FROM connections c
       WHERE c.accepted_at IS NOT NULL
         AND c.accepted_at <= datetime('now', ?)
         AND c.accepted_at >= datetime('now', ?)
         AND NOT EXISTS (
           SELECT 1 FROM dm_queue d
           WHERE d.provider_id = c.provider_id AND d.status != 'failed'
         )
       ORDER BY c.accepted_at ASC
       LIMIT 1`
    )
    .get(
      `-${params.minHoursSinceAccept} hours`,
      `-${params.maxDaysSinceAccept} days`
    ) as ConnectionRow | undefined;
  return row ?? null;
}

export function markPersonMessaged(providerId: string): void {
  const person = findPersonByProviderId(providerId);
  if (!person) return;
  advanceSequenceStage(person.target_id, "messaged");
}

export function markPersonReplied(providerId: string): void {
  const person = findPersonByProviderId(providerId);
  if (!person) return;
  advanceSequenceStage(person.target_id, "replied");
}

/**
 * Sent first-touch DMs with a chat we can read, where no follow-up has been
 * queued yet. Oldest first so nobody waits indefinitely.
 */
export function getSentDmsAwaitingFollowup(limit = 5): DmQueueRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM dm_queue d
       WHERE d.status = 'sent'
         AND d.kind = 'first_touch'
         AND d.chat_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM dm_queue f
           WHERE f.provider_id = d.provider_id
             AND f.kind = 'followup'
             AND f.status != 'failed'
         )
       ORDER BY d.sent_at ASC
       LIMIT ?`
    )
    .all(limit) as DmQueueRow[];
}

export { stageRank, checkInviteReady };

// --- Elasticsearch invite pipeline ---

export interface EsCandidate {
  id: number;
  es_id: string;
  linkedin_username: string;
  linkedin_url: string | null;
  full_name: string | null;
  job_title: string | null;
  company: string | null;
  headline: string | null;
  country: string;
  segment: string;
  provider_id: string | null;
  status: string;
  skip_reason: string | null;
  invite_attempts: number;
}

export function insertEsCandidates(
  people: {
    esId: string;
    linkedinUsername: string;
    linkedinUrl: string | null;
    fullName: string | null;
    jobTitle: string | null;
    company: string | null;
    headline: string | null;
    country: string;
  }[],
  segment: string
): number {
  const stmt = getDb().prepare(
    `INSERT OR IGNORE INTO es_candidates (
       es_id, linkedin_username, linkedin_url, full_name, job_title,
       company, headline, country, segment
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let inserted = 0;
  const tx = getDb().transaction(() => {
    for (const p of people) {
      const res = stmt.run(
        p.esId,
        p.linkedinUsername.toLowerCase(),
        p.linkedinUrl,
        p.fullName,
        p.jobTitle,
        p.company,
        p.headline,
        p.country,
        segment
      );
      inserted += res.changes;
    }
  });
  tx();
  return inserted;
}

/** Candidates still waiting for a lookup or an invite (or only resolved ones). */
export function countEsQueue(country?: string, resolvedOnly = false): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM es_candidates
       WHERE status IN ('queued', 'resolved')
         AND (? = 0 OR status = 'resolved')
         AND (? IS NULL OR country = ?)`
    )
    .get(resolvedOnly ? 1 : 0, country ?? null, country ?? null) as { n: number };
  return row.n;
}

/** Rolling 24h, used only to balance countries. */
export function countEsInvited24h(country: string): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM es_candidates
       WHERE country = ? AND invited_at >= datetime('now', '-1 day')`
    )
    .get(country) as { n: number };
  return row.n;
}

/** Next candidate for a country: already-resolved first, then oldest queued. */
export function getNextEsCandidate(
  country: string,
  resolvedOnly = false
): EsCandidate | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM es_candidates
       WHERE status IN ('queued', 'resolved') AND country = ?
         AND (? = 0 OR status = 'resolved')
       ORDER BY CASE status WHEN 'resolved' THEN 0 ELSE 1 END, RANDOM()
       LIMIT 1`
    )
    .get(country, resolvedOnly ? 1 : 0) as EsCandidate | undefined;
  return row ?? null;
}

export function markEsCandidateResolved(
  id: number,
  providerId: string,
  headline: string | null
): void {
  getDb()
    .prepare(
      `UPDATE es_candidates SET status = 'resolved', provider_id = ?,
         headline = COALESCE(?, headline), resolved_at = datetime('now'),
         updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(providerId, headline, id);
}

export function markEsCandidateSkipped(
  id: number,
  reason: string,
  providerId?: string | null
): void {
  getDb()
    .prepare(
      `UPDATE es_candidates SET status = 'skipped', skip_reason = ?,
         provider_id = COALESCE(?, provider_id), updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(reason, providerId ?? null, id);
}

export function markEsCandidateInvited(id: number, note: string | null): void {
  getDb()
    .prepare(
      `UPDATE es_candidates SET status = 'invited', invite_note = ?,
         invite_attempts = invite_attempts + 1,
         invited_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(note, id);
}

/** Count a failed invite; give up after maxAttempts. */
export function recordEsInviteFailure(
  id: number,
  errorType: string,
  maxAttempts: number
): void {
  getDb()
    .prepare(
      `UPDATE es_candidates SET
         invite_attempts = invite_attempts + 1,
         skip_reason = ?,
         status = CASE WHEN invite_attempts + 1 >= ? THEN 'failed' ELSE status END,
         updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(errorType.slice(0, 200), maxAttempts, id);
}

export function setEsCandidateStatusByProviderId(
  providerId: string,
  status: "connected" | "withdrawn"
): void {
  if (!providerId) return;
  getDb()
    .prepare(
      `UPDATE es_candidates SET status = ?, updated_at = datetime('now')
       WHERE provider_id = ? AND status IN ('invited', 'resolved', 'queued')`
    )
    .run(status, providerId);
}

/**
 * True if this person was already invited, connected, or is in the
 * warm-outreach pipeline, so the ES pipeline must not touch them.
 */
export function isAlreadyEngagedPerson(providerId: string): boolean {
  if (isKnownConnection(providerId)) return true;
  const person = findPersonByProviderId(providerId);
  if (person && person.status !== "filtered" && person.status !== "skipped") {
    return true;
  }
  const row = getDb()
    .prepare(
      `SELECT 1 FROM actions
       WHERE action_type IN ('send_invite', 'es_invite')
         AND result = 'success' AND target_id = ?
       LIMIT 1`
    )
    .get(providerId);
  return !!row;
}

export function getEsStats(): {
  byStatus: Record<string, number>;
  byCountry: Record<string, { queued: number; invited: number; invited24h: number }>;
} {
  const statusRows = getDb()
    .prepare(`SELECT status, COUNT(*) AS n FROM es_candidates GROUP BY status`)
    .all() as { status: string; n: number }[];
  const countryRows = getDb()
    .prepare(
      `SELECT country,
         SUM(CASE WHEN status IN ('queued', 'resolved') THEN 1 ELSE 0 END) AS queued,
         SUM(CASE WHEN invited_at IS NOT NULL THEN 1 ELSE 0 END) AS invited,
         SUM(CASE WHEN invited_at >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS invited24h
       FROM es_candidates GROUP BY country`
    )
    .all() as { country: string; queued: number; invited: number; invited24h: number }[];

  return {
    byStatus: Object.fromEntries(statusRows.map((r) => [r.status, r.n])),
    byCountry: Object.fromEntries(
      countryRows.map((r) => [
        r.country,
        { queued: r.queued, invited: r.invited, invited24h: r.invited24h },
      ])
    ),
  };
}
