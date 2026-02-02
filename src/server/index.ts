import Fastify from "fastify";
import { z } from "zod";
import { v7 as uuidv7 } from "uuid";
// Core
import { config, requireEnv } from "../lib/core/config.js";
import { initDatabase, getDatabaseStats } from "../lib/core/db.js";
// Auth
import { parseSessionKey, buildAgentToken } from "../lib/auth/agentAuth.js";
// Providers
import { generateAgentReply, compactHistory, runLLMTask, type AgentReplyResult } from "../lib/providers/openaiClient.js";
import { streamAgentReply } from "../lib/providers/streaming.js";
// Integrations
import { listTasks, createTask, postMessage, postDocument } from "../lib/integrations/missionControl.js";
import { fireWebhook, buildCompletionPayload, type WebhookConfig } from "../lib/integrations/webhooks.js";
import { getUsageTracker } from "../lib/integrations/costs.js";
// Workspace
import { getWorkspaceLoader } from "../lib/workspace/workspace.js";
// Skills
import { getSkillsLoader } from "../lib/skills/skills.js";
import { getSkillRegistry } from "../lib/skills/skillRegistry.js";
import { SkillManifestSchema } from "../lib/skills/skillManifest.js";
import { getSkillTester } from "../lib/skills/skillTester.js";
// Tracing
import { getTraceStore } from "../lib/tracing/traceStore.js";
// Governance
import { getAuditLog } from "../lib/governance/auditLog.js";
import { getBudgetManager } from "../lib/governance/budgetManager.js";
// Evals
import { getEvalRunner, type EvalDataset, type EvalOptions } from "../lib/evals/evals.js";

// Extend Fastify types for trace ID
declare module 'fastify' {
  interface FastifyRequest {
    traceId: string;
  }
}

/**
 * Message in conversation history.
 * Following OpenAI's message format for compatibility.
 */
const MessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string()
});

/**
 * Webhook configuration schema.
 */
const WebhookSchema = z.object({
  url: z.string().url(),
  secret: z.string().optional(),
  headers: z.record(z.string()).optional()
});

export function buildApp() {
  const app = Fastify({ logger: true });

  // Initialize database
  try {
    initDatabase();
    app.log.info("Database initialized");
  } catch (err) {
    app.log.error({ err }, "Failed to initialize database");
  }

  // ============================================================================
  // Trace ID Hook - Every request gets a trace ID for correlation
  // ============================================================================
  app.addHook('onRequest', async (request, reply) => {
    // Use existing trace ID from header or generate a new one
    const existingTraceId = request.headers['x-trace-id'];
    request.traceId = typeof existingTraceId === 'string' ? existingTraceId : uuidv7();
    
    // Add trace ID to response headers
    reply.header('x-trace-id', request.traceId);
  });

  const SendSchema = z.object({
    user_id: z.string(),
    session_key: z.string(),
    message: z.string(),
    // Conversation history (OpenClaw-inspired context management)
    // Backend can inject prior messages for multi-turn conversations
    messages: z.array(MessageSchema).optional(),
    // Task handling options (all optional for flexibility):
    // - task_id: Use this specific task (backend-owned task creation)
    // - task_title: Find or create a task with this title
    // - task_description: Description for auto-created tasks
    // - task_metadata: Metadata for auto-created tasks
    task_id: z.string().optional(),
    task_title: z.string().optional(),
    task_description: z.string().optional(),
    task_metadata: z.record(z.any()).optional(),
    metadata: z.record(z.any()).optional(),
    // Webhook callback (optional)
    webhook: WebhookSchema.optional(),
    // Streaming mode (optional)
    stream: z.boolean().optional()
  });

  /**
   * Compact history endpoint.
   * Summarizes conversation history to reduce token usage.
   * Following OpenClaw's compaction pattern.
   */
  const CompactSchema = z.object({
    messages: z.array(MessageSchema).min(1),
    instructions: z.string().optional(),
    keep_recent: z.number().int().min(0).default(2)
  });

  app.post("/compact", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = CompactSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const { messages, instructions, keep_recent } = parsed.data;

    try {
      const result = await compactHistory({
        messages,
        instructions,
        keepRecent: keep_recent
      });

      return reply.send({
        status: "ok",
        compacted_messages: result.compactedMessages,
        usage: result.usage,
        original_count: messages.length,
        compacted_count: result.compactedMessages.length
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Compaction failed";
      return reply.status(500).send({ error: message });
    }
  });

  /**
   * LLM Task endpoint for structured JSON output.
   * Following OpenClaw's llm-task pattern for workflow engines.
   */
  const LLMTaskSchema = z.object({
    prompt: z.string(),
    input: z.any().optional(),
    schema: z.record(z.any()).optional(),
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().int().positive().optional()
  });

  app.post("/llm-task", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = LLMTaskSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    try {
      const result = await runLLMTask(parsed.data);
      return reply.send({
        status: "ok",
        output: result.output,
        usage: result.usage,
        cost: result.cost,
        validated: result.validated
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "LLM task failed";
      return reply.status(500).send({ error: message });
    }
  });

  /**
   * Usage stats endpoint for cost tracking.
   * Following OpenClaw's usage tracking pattern.
   */
  app.get("/usage", async () => {
    const tracker = getUsageTracker();
    return tracker.getStats();
  });

  /**
   * Enhanced health check endpoint.
   * Following OpenClaw's health check pattern with component status.
   */
  app.get("/health", async (request) => {
    const workspace = getWorkspaceLoader();
    const workspaceAccessible = workspace.isAccessible();

    // Check backend connectivity (simple fetch to health endpoint)
    let backendStatus: "ok" | "error" | "unchecked" = "unchecked";
    let backendError: string | undefined;

    // Only check backend if query param ?deep=true is passed
    const query = request.query as Record<string, string>;
    if (query.deep === "true") {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(`${config.backendUrl}/health`, {
          signal: controller.signal
        });
        clearTimeout(timeout);
        backendStatus = response.ok ? "ok" : "error";
      } catch (err) {
        backendStatus = "error";
        backendError = err instanceof Error ? err.message : "Unknown error";
      }
    }

    // Check database status
    let databaseStatus: "ok" | "error" = "ok";
    let databaseError: string | undefined;
    try {
      getDatabaseStats();
    } catch (err) {
      databaseStatus = "error";
      databaseError = err instanceof Error ? err.message : "Unknown error";
    }

    const overallStatus = workspaceAccessible && backendStatus !== "error" && databaseStatus === "ok" ? "ok" : "degraded";

    // Get skills info
    const skillsLoader = getSkillsLoader();
    const skillsContext = skillsLoader.load();

    return {
      status: overallStatus,
      workspace: {
        path: workspace.getWorkspacePath(),
        status: workspaceAccessible ? "ok" : "missing",
        maxCharsPerFile: workspace.getMaxChars(),
        bootComplete: workspace.isBootComplete()
      },
      skills: {
        enabled: skillsContext.enabledCount,
        total: skillsContext.totalCount
      },
      backend: {
        url: config.backendUrl,
        status: backendStatus,
        ...(backendError && { error: backendError })
      },
      database: {
        status: databaseStatus,
        ...(databaseError && { error: databaseError })
      },
      config: {
        port: config.port,
        defaultTask: config.defaultTaskTitle || "(not set)",
        model: config.openaiModelDefault,
        fallbackModel: config.openaiModelFallback || "(not set)"
      }
    };
  });

  /**
   * Context stats endpoint for prompt size visibility.
   * Following OpenClaw's /context pattern.
   */
  app.get("/context", async (request) => {
    const query = request.query as Record<string, string>;
    const role = query.role;
    const workspace = getWorkspaceLoader();
    return workspace.getContextStats(role);
  });

  /**
   * Skills endpoint for listing available skills.
   * Following OpenClaw's skills pattern.
   */
  app.get("/skills", async () => {
    const loader = getSkillsLoader();
    const context = loader.load();
    return {
      enabled: context.enabledCount,
      total: context.totalCount,
      skills: context.skills.map((s) => ({
        name: s.name,
        description: s.description,
        enabled: s.enabled,
        gateReason: s.gateReason,
        location: s.location,
        metadata: s.metadata
      }))
    };
  });

  /**
   * Boot status endpoint.
   * Checks if BOOT.md has been run.
   */
  app.get("/boot", async () => {
    const workspace = getWorkspaceLoader();
    const bootContent = workspace.loadBoot();
    const isComplete = workspace.isBootComplete();

    return {
      hasBoot: bootContent !== null,
      isComplete,
      content: isComplete ? null : bootContent
    };
  });

  /**
   * Mark boot as complete.
   */
  app.post("/boot/complete", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const workspace = getWorkspaceLoader();
    workspace.markBootComplete();

    return { status: "ok" };
  });

  // ============================================================================
  // Trace Endpoints - Agent observability
  // ============================================================================

  /**
   * List traces with filtering and pagination.
   * Requires tenant_id query parameter.
   */
  const TraceListQuerySchema = z.object({
    tenant_id: z.string(),
    workspace_id: z.string().optional(),
    agent_role: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0)
  });

  app.get("/traces", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = TraceListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query parameters", details: parsed.error.flatten() });
    }

    const query = parsed.data;
    const traceStore = getTraceStore();

    const result = traceStore.list({
      tenantId: query.tenant_id,
      workspaceId: query.workspace_id,
      agentRole: query.agent_role,
      startDate: query.start_date,
      endDate: query.end_date,
      limit: query.limit,
      offset: query.offset
    });

    return reply.send({
      traces: result.traces,
      total: result.total,
      has_more: result.hasMore,
      limit: query.limit,
      offset: query.offset
    });
  });

  /**
   * Get a single trace by ID.
   * Requires tenant_id query parameter for authorization.
   */
  app.get("/traces/:id", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const { id } = request.params as { id: string };
    const query = request.query as { tenant_id?: string };

    if (!query.tenant_id) {
      return reply.status(400).send({ error: "tenant_id query parameter is required" });
    }

    const traceStore = getTraceStore();
    const trace = traceStore.getForTenant(id, query.tenant_id);

    if (!trace) {
      return reply.status(404).send({ error: "Trace not found" });
    }

    return reply.send({ trace });
  });

  /**
   * Get trace statistics for a tenant.
   */
  app.get("/traces/stats", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const query = request.query as { tenant_id?: string; start_date?: string; end_date?: string };

    if (!query.tenant_id) {
      return reply.status(400).send({ error: "tenant_id query parameter is required" });
    }

    const traceStore = getTraceStore();
    const stats = traceStore.getStats(query.tenant_id, query.start_date, query.end_date);

    return reply.send({ stats });
  });

  /**
   * Replay a trace with different configuration.
   * Returns comparison between original and replayed execution.
   */
  const ReplaySchema = z.object({
    model: z.string().optional(),
    skill_version: z.string().optional()
  });

  app.post("/traces/:id/replay", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const { id } = request.params as { id: string };
    const parsed = ReplaySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const traceStore = getTraceStore();
    const replayContext = traceStore.getReplayContext(id);

    if (!replayContext) {
      return reply.status(404).send({ error: "Trace not found" });
    }

    // TODO: Implement full replay with different model/skill version
    // For now, return the replay context
    return reply.send({
      status: "pending",
      message: "Replay functionality coming soon",
      original_trace: replayContext.trace,
      replay_config: parsed.data
    });
  });

  /**
   * Database stats endpoint for monitoring.
   */
  app.get("/db/stats", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    try {
      const stats = getDatabaseStats();
      return reply.send({ stats });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to get database stats";
      return reply.status(500).send({ error: message });
    }
  });

  // ============================================================================
  // Skill Registry Endpoints
  // ============================================================================

  /**
   * Publish a skill to the registry.
   */
  app.post("/skills/publish", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    try {
      const manifest = SkillManifestSchema.parse(request.body);
      const registry = getSkillRegistry();
      const published = registry.publish(manifest);

      return reply.status(201).send({
        status: "ok",
        skill: {
          name: published.name,
          version: published.version,
          checksum: published.checksum,
          published_at: published.publishedAt
        }
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: "Invalid manifest", details: err.flatten() });
      }
      const message = err instanceof Error ? err.message : "Failed to publish skill";
      return reply.status(400).send({ error: message });
    }
  });

  /**
   * Get a skill by name (optionally with version).
   */
  app.get("/skills/registry/:name", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const { name } = request.params as { name: string };
    const query = request.query as { version?: string };

    const registry = getSkillRegistry();
    const skill = registry.get(name, query.version);

    if (!skill) {
      return reply.status(404).send({ error: "Skill not found" });
    }

    return reply.send({ skill });
  });

  /**
   * List all versions of a skill.
   */
  app.get("/skills/registry/:name/versions", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const { name } = request.params as { name: string };
    const registry = getSkillRegistry();
    const versions = registry.listVersions(name);

    return reply.send({ name, versions });
  });

  /**
   * Search skills in the registry.
   */
  const SkillSearchQuerySchema = z.object({
    q: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0)
  });

  app.get("/skills/registry", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = SkillSearchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query", details: parsed.error.flatten() });
    }

    const { q, limit, offset } = parsed.data;
    const registry = getSkillRegistry();
    const result = registry.search(q || '', { limit, offset });

    return reply.send({
      skills: result.skills.map(s => ({
        name: s.name,
        version: s.version,
        description: s.description,
        checksum: s.checksum,
        published_at: s.publishedAt
      })),
      total: result.total,
      has_more: result.hasMore
    });
  });

  /**
   * Run tests for a skill.
   */
  const SkillTestOptionsSchema = z.object({
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    mock_tools: z.boolean().optional(),
    timeout: z.number().int().positive().optional()
  });

  app.post("/skills/registry/:name/test", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const { name } = request.params as { name: string };
    const query = request.query as { version?: string };

    const parsed = SkillTestOptionsSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid options", details: parsed.error.flatten() });
    }

    const registry = getSkillRegistry();
    const skill = registry.get(name, query.version);

    if (!skill) {
      return reply.status(404).send({ error: "Skill not found" });
    }

    if (!skill.manifest.tests || skill.manifest.tests.length === 0) {
      return reply.status(400).send({ error: "Skill has no tests defined" });
    }

    try {
      const tester = getSkillTester();
      const result = await tester.runTests(skill, {
        model: parsed.data.model,
        temperature: parsed.data.temperature,
        mockTools: parsed.data.mock_tools,
        timeout: parsed.data.timeout
      });

      return reply.send({
        status: result.passRate === 1 ? "passed" : "failed",
        result: {
          skill_name: result.skillName,
          skill_version: result.skillVersion,
          model: result.model,
          pass_count: result.passCount,
          fail_count: result.failCount,
          pass_rate: result.passRate,
          total_duration_ms: result.totalDurationMs,
          total_cost: result.totalCost,
          results: result.results
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Test execution failed";
      return reply.status(500).send({ error: message });
    }
  });

  // ============================================================================
  // Audit Log Endpoints
  // ============================================================================

  /**
   * Query the audit log.
   */
  const AuditQuerySchema = z.object({
    tenant_id: z.string(),
    workspace_id: z.string().optional(),
    trace_id: z.string().optional(),
    event_type: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(100),
    offset: z.coerce.number().int().min(0).default(0)
  });

  app.get("/audit", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = AuditQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query", details: parsed.error.flatten() });
    }

    const query = parsed.data;
    const auditLog = getAuditLog();

    const result = auditLog.query({
      tenantId: query.tenant_id,
      workspaceId: query.workspace_id,
      traceId: query.trace_id,
      eventType: query.event_type as any,
      startDate: query.start_date,
      endDate: query.end_date,
      limit: query.limit,
      offset: query.offset
    });

    return reply.send({
      entries: result.entries,
      total: result.total,
      has_more: result.hasMore
    });
  });

  /**
   * Get audit log statistics.
   */
  app.get("/audit/stats", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const query = request.query as { tenant_id?: string; start_date?: string; end_date?: string };

    if (!query.tenant_id) {
      return reply.status(400).send({ error: "tenant_id query parameter is required" });
    }

    const auditLog = getAuditLog();
    const stats = auditLog.getStats(query.tenant_id, query.start_date, query.end_date);

    return reply.send({ stats });
  });

  // ============================================================================
  // Budget Endpoints
  // ============================================================================

  /**
   * Get budget for a tenant.
   */
  app.get("/budget", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const query = request.query as { tenant_id?: string };

    if (!query.tenant_id) {
      return reply.status(400).send({ error: "tenant_id query parameter is required" });
    }

    const budgetManager = getBudgetManager();
    const budget = budgetManager.getBudget(query.tenant_id);

    if (!budget) {
      return reply.status(404).send({ error: "No budget set for this tenant" });
    }

    const stats = budgetManager.getStats(query.tenant_id);

    return reply.send({ budget, stats });
  });

  /**
   * Set or update budget for a tenant.
   */
  const SetBudgetSchema = z.object({
    tenant_id: z.string(),
    budget_usd: z.number().positive(),
    period_start: z.string().optional(),
    period_end: z.string().optional(),
    hard_limit: z.boolean().optional(),
    alert_threshold: z.number().min(0).max(1).optional()
  });

  app.post("/budget", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = SetBudgetSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const data = parsed.data;
    const budgetManager = getBudgetManager();

    const budget = budgetManager.setBudget(data.tenant_id, {
      budgetUsd: data.budget_usd,
      periodStart: data.period_start,
      periodEnd: data.period_end,
      hardLimit: data.hard_limit,
      alertThreshold: data.alert_threshold
    });

    return reply.send({ status: "ok", budget });
  });

  /**
   * Check if a request is within budget.
   */
  app.get("/budget/check", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const query = request.query as { tenant_id?: string; estimated_cost?: string };

    if (!query.tenant_id) {
      return reply.status(400).send({ error: "tenant_id query parameter is required" });
    }

    const estimatedCost = query.estimated_cost ? parseFloat(query.estimated_cost) : 0;
    const budgetManager = getBudgetManager();
    const result = budgetManager.checkBudget(query.tenant_id, estimatedCost);

    return reply.send(result);
  });

  // ============================================================================
  // Evaluation Endpoints
  // ============================================================================

  /**
   * Run an evaluation.
   */
  const EvalCaseSchema = z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    input: z.string(),
    expected_output: z.string().optional(),
    expected_tool_calls: z.array(z.string()).optional(),
    acceptable_outputs: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional()
  });

  const RunEvalSchema = z.object({
    dataset: z.object({
      name: z.string(),
      description: z.string().optional(),
      cases: z.array(EvalCaseSchema).min(1)
    }),
    options: z.object({
      model: z.string(),
      skill_name: z.string().optional(),
      skill_version: z.string().optional(),
      temperature: z.number().min(0).max(2).optional(),
      timeout: z.number().int().positive().optional(),
      mock_tools: z.boolean().optional()
    })
  });

  app.post("/evals/run", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = RunEvalSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const { dataset: rawDataset, options: rawOptions } = parsed.data;

    // Convert to internal format
    const dataset: EvalDataset = {
      name: rawDataset.name,
      description: rawDataset.description,
      cases: rawDataset.cases.map(c => ({
        id: c.id,
        name: c.name,
        input: c.input,
        expectedOutput: c.expected_output,
        expectedToolCalls: c.expected_tool_calls,
        acceptableOutputs: c.acceptable_outputs,
        tags: c.tags
      }))
    };

    const options: EvalOptions = {
      model: rawOptions.model,
      skillName: rawOptions.skill_name,
      skillVersion: rawOptions.skill_version,
      temperature: rawOptions.temperature,
      timeout: rawOptions.timeout,
      mockTools: rawOptions.mock_tools
    };

    try {
      const evalRunner = getEvalRunner();
      const result = await evalRunner.run(dataset, options);

      return reply.send({
        status: result.scores.passRate === 1 ? "passed" : "failed",
        result: {
          id: result.id,
          dataset_name: result.datasetName,
          model: result.model,
          skill_name: result.skillName,
          skill_version: result.skillVersion,
          scores: result.scores,
          case_count: result.cases.length,
          pass_count: result.cases.filter(c => c.passed).length,
          duration_ms: result.durationMs
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Evaluation failed";
      return reply.status(500).send({ error: message });
    }
  });

  /**
   * Get evaluation result by ID.
   */
  app.get("/evals/:id", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const { id } = request.params as { id: string };
    const evalRunner = getEvalRunner();
    const result = evalRunner.getResult(id);

    if (!result) {
      return reply.status(404).send({ error: "Evaluation result not found" });
    }

    return reply.send({ result });
  });

  /**
   * List evaluation results.
   */
  const EvalListQuerySchema = z.object({
    dataset_name: z.string().optional(),
    skill_name: z.string().optional(),
    model: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0)
  });

  app.get("/evals", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = EvalListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query", details: parsed.error.flatten() });
    }

    const query = parsed.data;
    const evalRunner = getEvalRunner();
    const result = evalRunner.listResults({
      datasetName: query.dataset_name,
      skillName: query.skill_name,
      model: query.model,
      limit: query.limit,
      offset: query.offset
    });

    return reply.send({
      results: result.results.map(r => ({
        id: r.id,
        dataset_name: r.datasetName,
        model: r.model,
        skill_name: r.skillName,
        scores: r.scores,
        started_at: r.startedAt
      })),
      total: result.total
    });
  });

  /**
   * Streaming endpoint for real-time responses.
   * Returns Server-Sent Events (SSE).
   */
  const StreamSchema = z.object({
    user_id: z.string(),
    session_key: z.string(),
    message: z.string(),
    messages: z.array(MessageSchema).optional(),
    metadata: z.record(z.any()).optional()
  });

  app.post("/api/agents/stream", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = StreamSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const payload = parsed.data;
    const { role } = parseSessionKey(payload.session_key);

    await streamAgentReply(reply, {
      role,
      userMessage: payload.message,
      messages: payload.messages,
      metadata: payload.metadata
    });
  });

  app.post("/api/agents/send", async (request, reply) => {
    const daemonKey = config.daemonKey;
    const headerKey = request.headers["x-agent-daemon-key"];
    if (daemonKey && headerKey !== daemonKey) {
      return reply.status(403).send({ error: "Invalid daemon key" });
    }

    const parsed = SendSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const payload = parsed.data;
    const { userId, role } = parseSessionKey(payload.session_key);
    if (userId !== payload.user_id) {
      return reply.status(400).send({ error: "user_id does not match session_key" });
    }

    requireEnv("AGENT_JWT_SECRET", config.agentJwtSecret);
    const agentToken = await buildAgentToken(payload.user_id, role);

    // Resolve task_id with flexible options:
    // 1. Use provided task_id directly (backend-owned)
    // 2. Find/create by task_title from request
    // 3. Find/create by WOMBAT_DEFAULT_TASK env var
    // 4. Error if none of the above
    let taskId: string | null = payload.task_id || null;

    if (!taskId) {
      // Determine task title: request > env > none
      const taskTitle = payload.task_title || config.defaultTaskTitle;

      if (!taskTitle) {
        return reply.status(400).send({
          error: "Task not specified. Provide task_id, task_title, or set WOMBAT_DEFAULT_TASK env var."
        });
      }

      // Look for existing task with this title
      const tasks = await listTasks(agentToken);
      const existing = tasks.find((task) => task.title === taskTitle);

      if (existing) {
        taskId = existing.id;
      } else {
        // Auto-create the task (any role can create now)
        const created = await createTask(agentToken, {
          title: taskTitle,
          description: payload.task_description || `Agent thread: ${taskTitle}`,
          status: "in_progress",
          metadata: payload.task_metadata || { type: "agent_thread" }
        });
        taskId = created.id;
      }
    }

    if (!taskId) {
      return reply.status(500).send({ error: "Failed to resolve task_id" });
    }

    // Handle streaming mode
    if (payload.stream) {
      await streamAgentReply(reply, {
        role,
        userMessage: payload.message,
        messages: payload.messages,
        metadata: payload.metadata
      });
      return;
    }

    // Generate agent reply with optional conversation history
    const result: AgentReplyResult = await generateAgentReply({
      role,
      userMessage: payload.message,
      messages: payload.messages,
      metadata: payload.metadata
    });

    await postMessage(agentToken, {
      task_id: taskId,
      content: result.response,
      actor_type: "agent",
      agent_role: role
    });

    if (payload.metadata?.kickoff_plan) {
      await postDocument(agentToken, {
        task_id: taskId,
        title: payload.metadata.plan_title || "Plan",
        content: result.response,
        doc_type: "plan"
      });
    }

    // Build response with token usage, cost, and context info
    const response: Record<string, unknown> = {
      status: "ok",
      task_id: taskId,
      trace_id: request.traceId,
      response: result.response,
      usage: result.usage,
      cost: result.cost
    };

    // Add context warning if approaching limit
    if (result.contextWarning) {
      response.context_warning = result.contextWarning;
    }

    // Fire webhook if configured (async, doesn't block response)
    if (payload.webhook) {
      fireWebhook(
        payload.webhook as WebhookConfig,
        buildCompletionPayload({
          taskId,
          userId: payload.user_id,
          role,
          response: result.response,
          usage: result.usage,
          cost: result.cost,
          metadata: payload.metadata
        }),
        app.log
      );
    }

    return reply.send(response);
  });

  return app;
}

if (process.env.WOMBAT_TEST_MODE !== "true") {
  const app = buildApp();
  app.listen({ port: config.port, host: "0.0.0.0" }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
