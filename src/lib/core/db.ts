/**
 * SQLite Database Infrastructure
 *
 * Provides a single-file SQLite database for:
 * - Traces (agent execution traces)
 * - Audit log (immutable event log)
 * - Skill registry (versioned skills)
 * - Tenant budgets (cost controls)
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// Database singleton
let db: Database.Database | null = null;

/**
 * Get the database path from environment or default
 */
function getDbPath(): string {
  return process.env.WOMBAT_DB_PATH || './wombat.db';
}

/**
 * Get or create the database connection
 */
export function getDatabase(): Database.Database {
  if (db) return db;

  const dbPath = getDbPath();

  // Ensure directory exists
  const dir = dirname(dbPath);
  if (dir !== '.' && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);

  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  return db;
}

/**
 * Initialize all database tables
 */
export function initDatabase(): void {
  const db = getDatabase();

  // Traces table - stores agent execution traces
  db.exec(`
    CREATE TABLE IF NOT EXISTS traces (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      agent_role TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      duration_ms INTEGER,
      model TEXT,
      provider TEXT,
      workspace_hash TEXT,
      input_message TEXT,
      input_message_count INTEGER DEFAULT 0,
      output_message TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      total_cost REAL DEFAULT 0,
      steps JSON,
      tool_calls JSON,
      skill_versions JSON,
      redacted_prompt TEXT,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_traces_tenant
      ON traces(tenant_id, started_at DESC);

    CREATE INDEX IF NOT EXISTS idx_traces_workspace
      ON traces(workspace_id, started_at DESC);
  `);

  // Audit log table - immutable event log
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      workspace_id TEXT,
      trace_id TEXT,
      event_type TEXT NOT NULL,
      event_data JSON NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_audit_tenant
      ON audit_log(tenant_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_audit_type
      ON audit_log(event_type, created_at DESC);
  `);

  // Skill registry table - versioned skills
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_registry (
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      description TEXT,
      manifest JSON NOT NULL,
      instructions TEXT NOT NULL,
      checksum TEXT,
      published_at TEXT DEFAULT (datetime('now')),
      published_by TEXT,
      PRIMARY KEY (name, version)
    );

    CREATE INDEX IF NOT EXISTS idx_skills_name
      ON skill_registry(name, published_at DESC);
  `);

  // Tenant budgets table - cost controls
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenant_budgets (
      tenant_id TEXT PRIMARY KEY,
      budget_usd REAL NOT NULL,
      spent_usd REAL DEFAULT 0,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      hard_limit BOOLEAN DEFAULT 1,
      alert_threshold REAL DEFAULT 0.8,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Workspace versions table - for workspace versioning
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_versions (
      hash TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      files JSON NOT NULL,
      message TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_workspace_versions
      ON workspace_versions(workspace_id, created_at DESC);
  `);

  // Eval results table - for evaluation framework
  db.exec(`
    CREATE TABLE IF NOT EXISTS eval_results (
      id TEXT PRIMARY KEY,
      dataset_name TEXT NOT NULL,
      skill_name TEXT,
      skill_version TEXT,
      model TEXT NOT NULL,
      scores JSON NOT NULL,
      cases JSON NOT NULL,
      drift JSON,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_eval_results
      ON eval_results(dataset_name, created_at DESC);
  `);
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Run a database migration (for future schema changes)
 */
export function runMigration(version: number, sql: string): void {
  const db = getDatabase();

  // Create migrations table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Check if migration already applied
  const applied = db
    .prepare('SELECT version FROM migrations WHERE version = ?')
    .get(version);

  if (!applied) {
    db.exec(sql);
    db.prepare('INSERT INTO migrations (version) VALUES (?)').run(version);
  }
}

/**
 * Get database stats for health checks
 */
export function getDatabaseStats(): {
  path: string;
  sizeBytes: number;
  tables: { name: string; rowCount: number }[];
} {
  const db = getDatabase();
  const dbPath = getDbPath();

  // Get table row counts
  const tables = db
    .prepare(
      `
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
  `
    )
    .all() as { name: string }[];

  const tableStats = tables.map((t) => {
    const count = db
      .prepare(`SELECT COUNT(*) as count FROM "${t.name}"`)
      .get() as { count: number };
    return { name: t.name, rowCount: count.count };
  });

  // Get file size
  let sizeBytes = 0;
  try {
    const { statSync } = require('fs');
    const stats = statSync(dbPath);
    sizeBytes = stats.size;
  } catch {
    // File might not exist yet
  }

  return {
    path: dbPath,
    sizeBytes,
    tables: tableStats,
  };
}

export { db };
