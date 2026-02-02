/**
 * Wombat Ops Library
 *
 * Organized into logical modules:
 * - core: Database, config
 * - tracing: Trace model and storage
 * - skills: Skill manifest, registry, testing
 * - auth: Authentication and tenant context
 * - tools: Tool proxy and permissions
 * - governance: Audit, redaction, budgets
 * - providers: LLM providers and contracts
 * - workspace: Workspace management
 * - evals: Evaluation framework
 * - integrations: External integrations
 */

// Re-export modules - use named imports to avoid conflicts
export * from './core/index.js';
export * from './tracing/index.js';
export * from './skills/index.js';
export * from './auth/index.js';
export { ToolProxy, ToolPermissionChecker, getToolProxy, getToolPermissionChecker } from './tools/index.js';
export * from './governance/index.js';
export { llmComplete, llmStream, llmTask, llmCompact, ProviderContractError, parseProviderError } from './providers/index.js';
export * from './workspace/index.js';
export * from './evals/index.js';
export { listTasks, createTask, postMessage, postDocument, fireWebhook, getUsageTracker } from './integrations/index.js';
