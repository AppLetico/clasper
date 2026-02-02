/**
 * Trace Store
 *
 * SQLite-backed storage for agent execution traces.
 * Provides CRUD operations and querying capabilities.
 */

import { getDatabase } from '../core/db.js';
import type { AgentTrace, TraceStep, ToolCallTrace } from './trace.js';

// ============================================================================
// Types
// ============================================================================

export interface TraceListOptions {
  tenantId: string;
  workspaceId?: string;
  agentRole?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export interface TraceListResult {
  traces: AgentTrace[];
  total: number;
  hasMore: boolean;
}

export interface ReplayContext {
  trace: AgentTrace;
  inputMessage: string;
  workspaceHash?: string;
  skillVersions: Record<string, string>;
}

// ============================================================================
// Trace Store Class
// ============================================================================

export class TraceStore {
  /**
   * Save a trace to the database
   */
  save(trace: AgentTrace): void {
    const db = getDatabase();

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO traces (
        id, tenant_id, workspace_id, agent_role,
        started_at, completed_at, duration_ms,
        model, provider, workspace_hash,
        input_message, input_message_count,
        output_message, input_tokens, output_tokens, total_cost,
        steps, tool_calls, skill_versions, redacted_prompt, error
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
    `);

    stmt.run(
      trace.id,
      trace.tenantId,
      trace.workspaceId,
      trace.agentRole || null,
      trace.startedAt,
      trace.completedAt || null,
      trace.durationMs || null,
      trace.model,
      trace.provider,
      trace.workspaceHash || null,
      trace.input.message,
      trace.input.messageHistory,
      trace.output?.message || null,
      trace.usage.inputTokens,
      trace.usage.outputTokens,
      trace.usage.totalCost,
      JSON.stringify(trace.steps),
      JSON.stringify(trace.output?.toolCalls || []),
      JSON.stringify(trace.skillVersions),
      trace.redactedPrompt || null,
      trace.error || null
    );
  }

  /**
   * Get a trace by ID
   */
  get(id: string): AgentTrace | null {
    const db = getDatabase();

    const row = db
      .prepare('SELECT * FROM traces WHERE id = ?')
      .get(id) as TraceRow | undefined;

    if (!row) return null;

    return this.rowToTrace(row);
  }

  /**
   * Get a trace by ID, ensuring it belongs to the specified tenant
   */
  getForTenant(id: string, tenantId: string): AgentTrace | null {
    const db = getDatabase();

    const row = db
      .prepare('SELECT * FROM traces WHERE id = ? AND tenant_id = ?')
      .get(id, tenantId) as TraceRow | undefined;

    if (!row) return null;

    return this.rowToTrace(row);
  }

  /**
   * List traces with filtering and pagination
   */
  list(options: TraceListOptions): TraceListResult {
    const db = getDatabase();
    const limit = options.limit || 50;
    const offset = options.offset || 0;

    // Build WHERE clause
    const conditions: string[] = ['tenant_id = ?'];
    const params: unknown[] = [options.tenantId];

    if (options.workspaceId) {
      conditions.push('workspace_id = ?');
      params.push(options.workspaceId);
    }

    if (options.agentRole) {
      conditions.push('agent_role = ?');
      params.push(options.agentRole);
    }

    if (options.startDate) {
      conditions.push('started_at >= ?');
      params.push(options.startDate);
    }

    if (options.endDate) {
      conditions.push('started_at <= ?');
      params.push(options.endDate);
    }

    const whereClause = conditions.join(' AND ');

    // Get total count
    const countRow = db
      .prepare(`SELECT COUNT(*) as count FROM traces WHERE ${whereClause}`)
      .get(...params) as { count: number };

    const total = countRow.count;

    // Get traces
    const rows = db
      .prepare(
        `
        SELECT * FROM traces 
        WHERE ${whereClause}
        ORDER BY started_at DESC
        LIMIT ? OFFSET ?
      `
      )
      .all(...params, limit, offset) as TraceRow[];

    const traces = rows.map((row) => this.rowToTrace(row));

    return {
      traces,
      total,
      hasMore: offset + traces.length < total,
    };
  }

  /**
   * Get context needed for replaying a trace
   */
  getReplayContext(id: string): ReplayContext | null {
    const trace = this.get(id);
    if (!trace) return null;

    return {
      trace,
      inputMessage: trace.input.message,
      workspaceHash: trace.workspaceHash,
      skillVersions: trace.skillVersions,
    };
  }

  /**
   * Delete a trace by ID
   */
  delete(id: string): boolean {
    const db = getDatabase();

    const result = db.prepare('DELETE FROM traces WHERE id = ?').run(id);

    return result.changes > 0;
  }

  /**
   * Delete traces older than a certain date
   */
  deleteOlderThan(date: string, tenantId?: string): number {
    const db = getDatabase();

    let stmt;
    if (tenantId) {
      stmt = db.prepare(
        'DELETE FROM traces WHERE started_at < ? AND tenant_id = ?'
      );
      return stmt.run(date, tenantId).changes;
    } else {
      stmt = db.prepare('DELETE FROM traces WHERE started_at < ?');
      return stmt.run(date).changes;
    }
  }

  /**
   * Get trace statistics for a tenant
   */
  getStats(
    tenantId: string,
    startDate?: string,
    endDate?: string
  ): {
    totalTraces: number;
    totalTokens: number;
    totalCost: number;
    avgDurationMs: number;
    errorRate: number;
  } {
    const db = getDatabase();

    const conditions: string[] = ['tenant_id = ?'];
    const params: unknown[] = [tenantId];

    if (startDate) {
      conditions.push('started_at >= ?');
      params.push(startDate);
    }

    if (endDate) {
      conditions.push('started_at <= ?');
      params.push(endDate);
    }

    const whereClause = conditions.join(' AND ');

    const row = db
      .prepare(
        `
        SELECT 
          COUNT(*) as total_traces,
          SUM(input_tokens + output_tokens) as total_tokens,
          SUM(total_cost) as total_cost,
          AVG(duration_ms) as avg_duration_ms,
          SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) as error_count
        FROM traces
        WHERE ${whereClause}
      `
      )
      .get(...params) as {
      total_traces: number;
      total_tokens: number | null;
      total_cost: number | null;
      avg_duration_ms: number | null;
      error_count: number;
    };

    return {
      totalTraces: row.total_traces,
      totalTokens: row.total_tokens || 0,
      totalCost: row.total_cost || 0,
      avgDurationMs: row.avg_duration_ms || 0,
      errorRate:
        row.total_traces > 0 ? row.error_count / row.total_traces : 0,
    };
  }

  /**
   * Convert a database row to an AgentTrace
   */
  private rowToTrace(row: TraceRow): AgentTrace {
    const steps: TraceStep[] = JSON.parse(row.steps || '[]');
    const toolCalls: ToolCallTrace[] = JSON.parse(row.tool_calls || '[]');
    const skillVersions: Record<string, string> = JSON.parse(
      row.skill_versions || '{}'
    );

    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      agentRole: row.agent_role || undefined,
      startedAt: row.started_at,
      completedAt: row.completed_at || undefined,
      durationMs: row.duration_ms || undefined,
      model: row.model,
      provider: row.provider,
      workspaceHash: row.workspace_hash || undefined,
      skillVersions,
      input: {
        message: row.input_message,
        messageHistory: row.input_message_count,
      },
      steps,
      output: row.output_message
        ? {
            message: row.output_message,
            toolCalls,
          }
        : undefined,
      usage: {
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        totalCost: row.total_cost,
      },
      redactedPrompt: row.redacted_prompt || undefined,
      error: row.error || undefined,
    };
  }
}

// ============================================================================
// Types for Database Rows
// ============================================================================

interface TraceRow {
  id: string;
  tenant_id: string;
  workspace_id: string;
  agent_role: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  model: string;
  provider: string;
  workspace_hash: string | null;
  input_message: string;
  input_message_count: number;
  output_message: string | null;
  input_tokens: number;
  output_tokens: number;
  total_cost: number;
  steps: string;
  tool_calls: string;
  skill_versions: string;
  redacted_prompt: string | null;
  error: string | null;
}

// ============================================================================
// Singleton Instance
// ============================================================================

let traceStoreInstance: TraceStore | null = null;

/**
 * Get or create the TraceStore instance
 */
export function getTraceStore(): TraceStore {
  if (!traceStoreInstance) {
    traceStoreInstance = new TraceStore();
  }
  return traceStoreInstance;
}

/**
 * Reset the trace store instance (for testing)
 */
export function resetTraceStore(): void {
  traceStoreInstance = null;
}
