import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { initDatabase, resetDatabase } from '../core/db.js';
import { evaluatePolicy } from './policyEngine.js';
import { upsertPolicy } from '../policy/policyStore.js';

beforeEach(() => {
  process.env.CLASPER_DB_PATH = ':memory:';
  resetDatabase();
  initDatabase();
});

afterEach(() => {
  resetDatabase();
  delete process.env.CLASPER_DB_PATH;
});

describe('Policy engine', () => {
  it('allows by default when no policy matches', () => {
    const result = evaluatePolicy({ tool: 'filesystem.write', tenant_id: 't1' });
    expect(result.decision).toBe('allow');
  });

  it('allows when a matching rule exists', () => {
    upsertPolicy({
      tenantId: 't1',
      policy: {
        policy_id: 'allow_fs_write',
        scope: { tenant_id: 't1' },
        subject: { type: 'tool', name: 'filesystem.write' },
        effect: { decision: 'allow' },
      },
    });
    const result = evaluatePolicy({ tool: 'filesystem.write', tenant_id: 't1' });
    expect(result.decision).toBe('allow');
    expect(result.matched_policies).toContain('allow_fs_write');
  });

  it('requires approval when rule demands it', () => {
    upsertPolicy({
      tenantId: 't1',
      policy: {
        policy_id: 'prod_fs_write',
        scope: { tenant_id: 't1', environment: 'prod' },
        subject: { type: 'tool', name: 'filesystem.write' },
        effect: { decision: 'require_approval' },
      },
    });
    const result = evaluatePolicy({
      environment: 'prod',
      tool: 'filesystem.write',
      tenant_id: 't1',
    });
    expect(result.decision).toBe('require_approval');
  });

  it('matches capability, intent, context, and provenance conditions', () => {
    upsertPolicy({
      tenantId: 't1',
      policy: {
        policy_id: 'deny_marketplace_shell_exec_network',
        scope: { tenant_id: 't1' },
        subject: { type: 'adapter' },
        conditions: {
          capability: 'shell.exec',
          intent: 'install_dependency',
          context: {
            external_network: true,
          },
          provenance: {
            source: 'marketplace',
          },
        },
        effect: { decision: 'deny' },
      },
    });

    const result = evaluatePolicy({
      tenant_id: 't1',
      adapter_id: 'openclaw',
      requested_capabilities: ['shell.exec'],
      intent: 'install_dependency',
      context: { external_network: true },
      provenance: { source: 'marketplace' },
    });

    expect(result.decision).toBe('deny');
    expect(result.matched_policies).toContain('deny_marketplace_shell_exec_network');
  });

  it('does not match when context is missing (unknown)', () => {
    upsertPolicy({
      tenantId: 't1',
      policy: {
        policy_id: 'deny_shell_exec_network',
        scope: { tenant_id: 't1' },
        subject: { type: 'adapter' },
        conditions: {
          capability: 'shell.exec',
          context: {
            external_network: true,
          },
        },
        effect: { decision: 'deny' },
      },
    });

    const result = evaluatePolicy({
      tenant_id: 't1',
      adapter_id: 'openclaw',
      requested_capabilities: ['shell.exec'],
    });

    expect(result.decision).toBe('allow');
    expect(result.matched_policies).not.toContain('deny_shell_exec_network');
  });
});
