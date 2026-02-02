import { describe, it, expect } from 'vitest';
import {
  ToolPermissionChecker,
  formatPermissionError,
  type PermissionResult,
} from './toolPermissions.js';
import { ToolProxy } from './toolProxy.js';
import type { TenantContext } from '../auth/tenantContext.js';
import type { SkillManifest } from '../skills/skillManifest.js';

describe('ToolPermissions', () => {
  // Create a mock ToolProxy
  const mockToolProxy = {
    execute: async () => ({
      toolCallId: 'call-1',
      success: true,
      result: { data: 'test' },
      durationMs: 100,
    }),
  } as unknown as ToolProxy;

  const checker = new ToolPermissionChecker({
    toolProxy: mockToolProxy,
  });

  const baseTenantContext: TenantContext = {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    permissions: {
      tools: ['read_ticket', 'write_ticket'],
    },
    raw: {},
  };

  const baseSkillManifest: SkillManifest = {
    name: 'ticket_skill',
    version: '1.0.0',
    description: 'Test skill',
    instructions: 'Test instructions',
    permissions: {
      tools: ['read_ticket'],
    },
  };

  describe('checkSkillPermission', () => {
    it('should allow tool in skill manifest', () => {
      const result = checker.checkSkillPermission('read_ticket', baseSkillManifest);

      expect(result.allowed).toBe(true);
    });

    it('should deny tool not in skill manifest', () => {
      const result = checker.checkSkillPermission('delete_ticket', baseSkillManifest);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('not_in_skill_manifest');
    });

    it('should allow with wildcard permission', () => {
      const skill: SkillManifest = {
        ...baseSkillManifest,
        permissions: { tools: ['*'] },
      };
      const result = checker.checkSkillPermission('any_tool', skill);

      expect(result.allowed).toBe(true);
    });

    it('should allow with namespace wildcard', () => {
      const skill: SkillManifest = {
        ...baseSkillManifest,
        permissions: { tools: ['tickets:*'] },
      };
      const result = checker.checkSkillPermission('tickets:read', skill);

      expect(result.allowed).toBe(true);
    });

    it('should allow if no skill provided', () => {
      const result = checker.checkSkillPermission('any_tool', undefined);

      expect(result.allowed).toBe(true);
    });

    it('should deny if skill has empty tools list', () => {
      const skill: SkillManifest = {
        ...baseSkillManifest,
        permissions: { tools: [] },
      };
      const result = checker.checkSkillPermission('read_ticket', skill);

      expect(result.allowed).toBe(false);
    });
  });

  describe('checkTenantPermission', () => {
    it('should allow tool in tenant permissions', () => {
      const result = checker.checkTenantPermission('read_ticket', baseTenantContext);

      expect(result.allowed).toBe(true);
    });

    it('should deny tool not in tenant permissions', () => {
      const result = checker.checkTenantPermission('delete_ticket', baseTenantContext);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('not_in_tenant_permissions');
    });

    it('should allow with wildcard tenant permission', () => {
      const context: TenantContext = {
        ...baseTenantContext,
        permissions: { tools: ['*'] },
      };
      const result = checker.checkTenantPermission('any_tool', context);

      expect(result.allowed).toBe(true);
    });
  });

  describe('checkPermission', () => {
    it('should require both skill and tenant permission', () => {
      const result = checker.checkPermission(
        'read_ticket',
        baseTenantContext,
        baseSkillManifest
      );

      expect(result.allowed).toBe(true);
    });

    it('should deny if skill denies', () => {
      const result = checker.checkPermission(
        'write_ticket', // allowed by tenant, not by skill
        baseTenantContext,
        baseSkillManifest
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('not_in_skill_manifest');
    });

    it('should deny if tenant denies', () => {
      const skill: SkillManifest = {
        ...baseSkillManifest,
        permissions: { tools: ['delete_ticket'] },
      };
      const result = checker.checkPermission(
        'delete_ticket', // allowed by skill, not by tenant
        baseTenantContext,
        skill
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('not_in_tenant_permissions');
    });
  });

  describe('preValidate', () => {
    it('should validate multiple tools at once', () => {
      const results = checker.preValidate(
        ['read_ticket', 'write_ticket', 'delete_ticket'],
        baseTenantContext,
        baseSkillManifest
      );

      expect(results.get('read_ticket')?.allowed).toBe(true);
      expect(results.get('write_ticket')?.allowed).toBe(false); // not in skill
      expect(results.get('delete_ticket')?.allowed).toBe(false); // not in skill or tenant
    });
  });

  describe('getAllowedTools', () => {
    it('should filter to allowed tools only', () => {
      const allTools = ['read_ticket', 'write_ticket', 'delete_ticket', 'list_tickets'];
      
      const skillWithMultiple: SkillManifest = {
        ...baseSkillManifest,
        permissions: { tools: ['read_ticket', 'write_ticket'] },
      };

      const allowed = checker.getAllowedTools(
        allTools,
        baseTenantContext,
        skillWithMultiple
      );

      expect(allowed).toEqual(['read_ticket', 'write_ticket']);
    });
  });

  describe('formatPermissionError', () => {
    it('should format skill manifest error', () => {
      const result: PermissionResult = {
        allowed: false,
        reason: 'not_in_skill_manifest',
      };
      const message = formatPermissionError(result);

      expect(message).toBe('This tool is not permitted by the current skill');
    });

    it('should format tenant permission error', () => {
      const result: PermissionResult = {
        allowed: false,
        reason: 'not_in_tenant_permissions',
      };
      const message = formatPermissionError(result);

      expect(message).toBe('Your account does not have permission to use this tool');
    });

    it('should return granted for allowed', () => {
      const result: PermissionResult = {
        allowed: true,
      };
      const message = formatPermissionError(result);

      expect(message).toBe('Permission granted');
    });
  });
});
