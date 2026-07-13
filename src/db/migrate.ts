import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { getDataDir, getDbPath } from "../config/env.js";

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

  // One-shot: drop pending India / South Asia targets already in the pool.
  database
    .prepare(
      `UPDATE targets
       SET status = 'filtered',
           relevance_score = 0,
           metadata = json_set(
             COALESCE(metadata, '{}'),
             '$.icp_reject_reason',
             'excluded location: India/South Asia (geo refresh)'
           )
       WHERE status = 'pending'
         AND (
           lower(COALESCE(json_extract(metadata, '$.location'), '')) LIKE '%india%'
           OR lower(COALESCE(json_extract(metadata, '$.location'), '')) LIKE '%bengaluru%'
           OR lower(COALESCE(json_extract(metadata, '$.location'), '')) LIKE '%bangalore%'
           OR lower(COALESCE(json_extract(metadata, '$.location'), '')) LIKE '%hyderabad%'
           OR lower(COALESCE(json_extract(metadata, '$.location'), '')) LIKE '%mumbai%'
           OR lower(COALESCE(json_extract(metadata, '$.location'), '')) LIKE '%delhi%'
           OR lower(COALESCE(json_extract(metadata, '$.location'), '')) LIKE '%pune%'
           OR lower(COALESCE(json_extract(metadata, '$.location'), '')) LIKE '%chennai%'
           OR lower(COALESCE(author_headline, '')) LIKE '%india%'
         )`
    )
    .run();
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
