import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { getDataDir, getDbPath, getEnv } from "../config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getSchemaPath(): string {
  const besideModule = path.join(__dirname, "schema.sql");
  if (fs.existsSync(besideModule)) return besideModule;
  return path.resolve(__dirname, "../../src/db/schema.sql");
}

function hasColumn(
  database: Database.Database,
  table: string,
  column: string
): boolean {
  const rows = database
    .prepare(`PRAGMA table_info(${table})`)
    .all() as { name: string }[];
  return rows.some((r) => r.name === column);
}

function addColumnIfMissing(
  database: Database.Database,
  table: string,
  column: string,
  definition: string
): void {
  if (!hasColumn(database, table, column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function runMigrations(database: Database.Database): void {
  addColumnIfMissing(
    database,
    "targets",
    "sequence_stage",
    "TEXT DEFAULT 'discovered'"
  );
  addColumnIfMissing(database, "targets", "author_provider_id", "TEXT");
  addColumnIfMissing(database, "targets", "author_public_id", "TEXT");
  addColumnIfMissing(database, "targets", "source_post_id", "TEXT");
  addColumnIfMissing(database, "targets", "person_source", "TEXT");
  addColumnIfMissing(database, "targets", "posted_at", "TEXT");
  addColumnIfMissing(database, "posts", "format", "TEXT DEFAULT 'text'");
  addColumnIfMissing(database, "posts", "source_post_id", "TEXT");

  if (hasColumn(database, "targets", "sequence_stage")) {
    database.exec(
      "CREATE INDEX IF NOT EXISTS idx_targets_sequence ON targets(target_type, sequence_stage, status)"
    );
  }

  // Ensure connections table exists on DBs created before nurture support.
  database.exec(`
    CREATE TABLE IF NOT EXISTS connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id TEXT NOT NULL UNIQUE,
      public_identifier TEXT,
      full_name TEXT,
      headline TEXT,
      profile_url TEXT,
      connected_at TEXT,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      from_invite INTEGER NOT NULL DEFAULT 0,
      accepted_at TEXT,
      last_engaged_at TEXT,
      metadata TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_connections_accepted
      ON connections(accepted_at DESC);
    CREATE INDEX IF NOT EXISTS idx_connections_engaged
      ON connections(last_engaged_at);
  `);

  // Job / freelance pivot: opportunity pipeline and approval-gated DM queue.
  database.exec(`
    CREATE TABLE IF NOT EXISTS opportunities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      company TEXT,
      company_url TEXT,
      url TEXT,
      location TEXT,
      presence TEXT,
      job_type TEXT,
      role_family TEXT,
      posted_at TEXT,
      description TEXT,
      match_score INTEGER DEFAULT 0,
      match_reasons TEXT,
      match_gaps TEXT,
      pitch TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      notified INTEGER NOT NULL DEFAULT 0,
      metadata TEXT,
      discovered_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_opportunities_score
      ON opportunities(status, match_score DESC);
    CREATE INDEX IF NOT EXISTS idx_opportunities_discovered
      ON opportunities(discovered_at DESC);

    CREATE TABLE IF NOT EXISTS dm_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id TEXT NOT NULL,
      full_name TEXT,
      headline TEXT,
      opportunity_id INTEGER,
      kind TEXT NOT NULL DEFAULT 'first_touch',
      draft_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_approval',
      chat_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved_at TEXT,
      sent_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_dm_queue_status
      ON dm_queue(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_dm_queue_provider
      ON dm_queue(provider_id);
  `);

  runJobSearchPivot(database);

  runIndiaGeoRestore(database);

  // Filter the account owner's own LinkedIn profile out of the outreach pool.
  const ownProviderId = getEnv().OWN_PROVIDER_ID?.trim();
  if (ownProviderId) {
    database
      .prepare(
        `UPDATE targets
         SET status = 'filtered',
             relevance_score = 0,
             metadata = json_set(
               COALESCE(metadata, '{}'),
               '$.icp_reject_reason',
               'own profile (self)'
             )
         WHERE status = 'pending'
           AND target_type = 'person'
           AND (
             provider_id = ?
             OR target_id = ?
             OR target_id = ?
             OR COALESCE(json_extract(metadata, '$.resolved_provider_id'), '') = ?
           )`
      )
      .run(
        ownProviderId,
        ownProviderId,
        `person:${ownProviderId}`,
        ownProviderId
      );
  }
}

const PIVOT_MARKER_KEY = "icp_pivot_job_search_at";

/**
 * The pending pool was built for Scrummer.ai lead-gen: VP Engineering buyers,
 * with recruiters and talent acquisition explicitly excluded. Under the job
 * and freelance ICP those judgements are inverted, so retire the old pool once.
 *
 * Guarded by a marker row: this must never run twice, or it would keep
 * discarding legitimately discovered targets on every startup.
 */
function runJobSearchPivot(database: Database.Database): void {
  const done = database
    .prepare("SELECT value FROM account_meta WHERE key = ?")
    .get(PIVOT_MARKER_KEY) as { value: string } | undefined;
  if (done) return;

  // Targets scored against the old brand no longer reflect the new goal.
  const retired = database
    .prepare(
      `UPDATE targets
       SET status = 'filtered',
           metadata = json_set(
             COALESCE(metadata, '{}'),
             '$.icp_reject_reason',
             'retired: scored under Scrummer lead-gen ICP'
           )
       WHERE status = 'pending'`
    )
    .run();

  /*
   * Recruiters and talent acquisition were rejected as noise and are now the
   * primary audience. Delete those rows rather than flipping them to pending:
   * their relevance_score is 0, and inventing a score would be worse than
   * letting research rediscover and score them honestly. hasRecentTarget
   * dedups on target_id, so removal is what makes rediscovery possible.
   */
  const restored = database
    .prepare(
      `DELETE FROM targets
       WHERE status = 'filtered'
         AND target_type = 'person'
         AND (
           lower(COALESCE(json_extract(metadata, '$.icp_reject_reason'), ''))
             LIKE '%recruiter%'
           OR lower(COALESCE(json_extract(metadata, '$.icp_reject_reason'), ''))
             LIKE '%talent acquisition%'
         )`
    )
    .run();

  database
    .prepare(
      "INSERT OR REPLACE INTO account_meta (key, value) VALUES (?, ?)"
    )
    .run(PIVOT_MARKER_KEY, new Date().toISOString());

  console.log(
    `[db] Job search pivot: retired ${retired.changes} stale pending target(s), ` +
      `cleared ${restored.changes} wrongly-excluded recruiter row(s) for rediscovery`
  );
}

const INDIA_MARKER_KEY = "geo_india_included_at";

/**
 * India was previously a hard geo exclusion and is now in scope, remote only.
 * Delete the rows rejected under the old rule so research can rediscover and
 * score them honestly, matching the recruiter-restore reasoning above: their
 * relevance_score is 0 and inventing one would be worse.
 */
function runIndiaGeoRestore(database: Database.Database): void {
  const done = database
    .prepare("SELECT value FROM account_meta WHERE key = ?")
    .get(INDIA_MARKER_KEY) as { value: string } | undefined;
  if (done) return;

  const cleared = database
    .prepare(
      `DELETE FROM targets
       WHERE status = 'filtered'
         AND (
           lower(COALESCE(json_extract(metadata, '$.icp_reject_reason'), ''))
             LIKE '%india%'
           OR lower(COALESCE(json_extract(metadata, '$.icp_reject_reason'), ''))
             LIKE '%bengaluru%'
           OR lower(COALESCE(json_extract(metadata, '$.icp_reject_reason'), ''))
             LIKE '%bangalore%'
           OR lower(COALESCE(json_extract(metadata, '$.icp_reject_reason'), ''))
             LIKE '%hyderabad%'
           OR lower(COALESCE(json_extract(metadata, '$.icp_reject_reason'), ''))
             LIKE '%mumbai%'
           OR lower(COALESCE(json_extract(metadata, '$.icp_reject_reason'), ''))
             LIKE '%delhi%'
           OR lower(COALESCE(json_extract(metadata, '$.icp_reject_reason'), ''))
             LIKE '%pune%'
           OR lower(COALESCE(json_extract(metadata, '$.icp_reject_reason'), ''))
             LIKE '%chennai%'
           OR lower(COALESCE(json_extract(metadata, '$.icp_reject_reason'), ''))
             LIKE '%karnataka%'
           OR lower(COALESCE(json_extract(metadata, '$.icp_reject_reason'), ''))
             LIKE '%telangana%'
           OR lower(COALESCE(json_extract(metadata, '$.icp_reject_reason'), ''))
             LIKE '%maharashtra%'
         )`
    )
    .run();

  // Non-remote India opportunities were stored as filtered under the old rule.
  // Remote is still required, so those stay filtered; only the geo reason goes.
  const opportunities = database
    .prepare(
      `DELETE FROM opportunities
       WHERE status = 'filtered'
         AND lower(COALESCE(json_extract(metadata, '$.filter_reason'), ''))
           LIKE '%location%'`
    )
    .run();

  database
    .prepare("INSERT OR REPLACE INTO account_meta (key, value) VALUES (?, ?)")
    .run(INDIA_MARKER_KEY, new Date().toISOString());

  console.log(
    `[db] India now in scope (remote only): cleared ${cleared.changes} geo-rejected ` +
      `target(s) and ${opportunities.changes} geo-rejected opportunity row(s) for rediscovery`
  );
}

export function ensureDbSchema(): void {
  const dataDir = getDataDir();
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const schemaPath = getSchemaPath();
  const database = new Database(getDbPath());
  try {
    database.pragma("journal_mode = WAL");
    try {
      database.exec(fs.readFileSync(schemaPath, "utf-8"));
    } catch (err) {
      console.warn("[db] Schema replay warning:", err);
    }
    runMigrations(database);
  } finally {
    database.close();
  }
}
