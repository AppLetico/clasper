import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  extractTenantFromPayload,
  createSystemTenantContext,
  canUseTool,
  canUseModel,
  canUseSkill,
  hasBudget,
  withinTokenLimit,
  TenantAuthError,
  runWithTenant,
  getCurrentTenant,
  tryGetCurrentTenant,
  type TenantContext,
} from './tenantContext.js';

describe('TenantContext', () => {
  describe('extractTenantFromPayload', () => {
    it('should extract tenant from valid payload', () => {
      const payload = {
        tenant_id: 'tenant-123',
        workspace_id: 'workspace-456',
        user_id: 'user-789',
        agent_role: 'assistant',
        allowed_tools: ['read', 'write'],
        max_tokens: 4000,
      };

      const context = extractTenantFromPayload(payload);

      expect(context.tenantId).toBe('tenant-123');
      expect(context.workspaceId).toBe('workspace-456');
      expect(context.userId).toBe('user-789');
      expect(context.agentRole).toBe('assistant');
      expect(context.permissions.tools).toEqual(['read', 'write']);
      expect(context.permissions.maxTokens).toBe(4000);
    });

    it('should use tenant_id as workspace_id if not provided', () => {
      const payload = {
        tenant_id: 'tenant-123',
      };

      const context = extractTenantFromPayload(payload);

      expect(context.workspaceId).toBe('tenant-123');
    });

    it('should throw if tenant_id is missing', () => {
      const payload = {
        user_id: 'user-123',
      };

      expect(() => extractTenantFromPayload(payload)).toThrow(TenantAuthError);
    });
  });

  describe('createSystemTenantContext', () => {
    it('should create system context with all permissions', () => {
      const context = createSystemTenantContext('system-tenant');

      expect(context.tenantId).toBe('system-tenant');
      expect(context.userId).toBe('system');
      expect(context.permissions.tools).toContain('*');
    });

    it('should use custom workspace_id if provided', () => {
      const context = createSystemTenantContext('system-tenant', 'custom-workspace');

      expect(context.workspaceId).toBe('custom-workspace');
    });
  });

  describe('canUseTool', () => {
    it('should allow tool in permissions', () => {
      const context: TenantContext = {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        permissions: {
          tools: ['read_ticket', 'write_ticket'],
        },
        raw: {},
      };

      expect(canUseTool(context, 'read_ticket')).toBe(true);
      expect(canUseTool(context, 'delete_ticket')).toBe(false);
    });

    it('should allow all tools with wildcard', () => {
      const context: TenantContext = {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        permissions: {
          tools: ['*'],
        },
        raw: {},
      };

      expect(canUseTool(context, 'any_tool')).toBe(true);
    });
  });

  describe('canUseModel', () => {
    it('should allow any model if no restriction', () => {
      const context: TenantContext = {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        permissions: { tools: [] },
        raw: {},
      };

      expect(canUseModel(context, 'gpt-4o')).toBe(true);
    });

    it('should check against allowed models', () => {
      const context: TenantContext = {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        permissions: {
          tools: [],
          allowedModels: ['gpt-4o', 'claude-3'],
        },
        raw: {},
      };

      expect(canUseModel(context, 'gpt-4o')).toBe(true);
      expect(canUseModel(context, 'gpt-3.5')).toBe(false);
    });

    it('should support provider wildcards', () => {
      const context: TenantContext = {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        permissions: {
          tools: [],
          allowedModels: ['openai/*'],
        },
        raw: {},
      };

      expect(canUseModel(context, 'openai/gpt-4o')).toBe(true);
    });
  });

  describe('canUseSkill', () => {
    it('should allow any skill if no restriction', () => {
      const context: TenantContext = {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        permissions: { tools: [] },
        raw: {},
      };

      expect(canUseSkill(context, 'any_skill')).toBe(true);
    });

    it('should check against allowed skills', () => {
      const context: TenantContext = {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        permissions: {
          tools: [],
          allowedSkills: ['summarize', 'analyze'],
        },
        raw: {},
      };

      expect(canUseSkill(context, 'summarize')).toBe(true);
      expect(canUseSkill(context, 'delete')).toBe(false);
    });
  });

  describe('hasBudget', () => {
    it('should return true if no budget restriction', () => {
      const context: TenantContext = {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        permissions: { tools: [] },
        raw: {},
      };

      expect(hasBudget(context, 100)).toBe(true);
    });

    it('should check against budget remaining', () => {
      const context: TenantContext = {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        permissions: {
          tools: [],
          budgetRemaining: 50,
        },
        raw: {},
      };

      expect(hasBudget(context, 25)).toBe(true);
      expect(hasBudget(context, 100)).toBe(false);
    });
  });

  describe('withinTokenLimit', () => {
    it('should return true if no token limit', () => {
      const context: TenantContext = {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        permissions: { tools: [] },
        raw: {},
      };

      expect(withinTokenLimit(context, 100000)).toBe(true);
    });

    it('should check against max tokens', () => {
      const context: TenantContext = {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        permissions: {
          tools: [],
          maxTokens: 4000,
        },
        raw: {},
      };

      expect(withinTokenLimit(context, 2000)).toBe(true);
      expect(withinTokenLimit(context, 5000)).toBe(false);
    });
  });

  describe('runWithTenant / getCurrentTenant', () => {
    it('should provide tenant context within run', () => {
      const context: TenantContext = {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        permissions: { tools: [] },
        raw: {},
      };

      runWithTenant(context, () => {
        const current = getCurrentTenant();
        expect(current.tenantId).toBe('tenant-1');
      });
    });

    it('should throw if getCurrentTenant called outside context', () => {
      expect(() => getCurrentTenant()).toThrow(TenantAuthError);
    });

    it('should return undefined for tryGetCurrentTenant outside context', () => {
      expect(tryGetCurrentTenant()).toBeUndefined();
    });
  });
});
