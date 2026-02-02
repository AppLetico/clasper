/**
 * Tenant Context
 *
 * Extracts tenant information from JWT tokens for multi-tenancy support.
 * Every request must carry tenant context for proper isolation.
 */

import { jwtVerify, JWTPayload } from 'jose';
import { z } from 'zod';
import { config } from '../core/config.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Permissions that can be granted to a tenant/user
 */
export interface TenantPermissions {
  tools: string[];
  maxTokens?: number;
  budgetRemaining?: number;
  allowedModels?: string[];
  allowedSkills?: string[];
}

/**
 * Tenant context extracted from JWT
 */
export interface TenantContext {
  tenantId: string;
  workspaceId: string;
  userId: string;
  agentRole?: string;
  permissions: TenantPermissions;
  raw: JWTPayload;
}

/**
 * JWT payload schema for validation
 */
export const TenantJWTPayloadSchema = z.object({
  // Standard claims
  sub: z.string().optional(),
  iss: z.string().optional(),
  aud: z.union([z.string(), z.array(z.string())]).optional(),
  exp: z.number().optional(),
  iat: z.number().optional(),
  
  // Tenant claims (required)
  tenant_id: z.string(),
  workspace_id: z.string().optional(),
  user_id: z.string().optional(),
  
  // Agent claims
  agent_role: z.string().optional(),
  type: z.string().optional(),
  
  // Permission claims
  allowed_tools: z.array(z.string()).optional(),
  max_tokens: z.number().int().positive().optional(),
  budget_remaining: z.number().optional(),
  allowed_models: z.array(z.string()).optional(),
  allowed_skills: z.array(z.string()).optional(),
});

export type TenantJWTPayload = z.infer<typeof TenantJWTPayloadSchema>;

// ============================================================================
// Extraction Functions
// ============================================================================

/**
 * Extract tenant context from a JWT token
 */
export async function extractTenantFromJWT(token: string): Promise<TenantContext> {
  const secret = config.agentJwtSecret;
  
  if (!secret) {
    throw new TenantAuthError('JWT secret not configured', 'config_error');
  }
  
  try {
    const encoder = new TextEncoder();
    const secretKey = encoder.encode(secret);
    
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: [config.agentJwtAlgorithm],
    });
    
    return extractTenantFromPayload(payload);
  } catch (error) {
    if (error instanceof TenantAuthError) {
      throw error;
    }
    
    if (error instanceof Error) {
      if (error.message.includes('expired')) {
        throw new TenantAuthError('Token expired', 'token_expired');
      }
      if (error.message.includes('signature')) {
        throw new TenantAuthError('Invalid token signature', 'invalid_signature');
      }
    }
    
    throw new TenantAuthError('Token verification failed', 'verification_failed');
  }
}

/**
 * Extract tenant context from an already-verified JWT payload
 */
export function extractTenantFromPayload(payload: JWTPayload): TenantContext {
  // Validate payload structure
  const parsed = TenantJWTPayloadSchema.safeParse(payload);
  
  if (!parsed.success) {
    // Check for minimum required fields
    const tenantId = payload.tenant_id as string || payload.tid as string;
    
    if (!tenantId) {
      throw new TenantAuthError('Missing tenant_id in token', 'missing_tenant');
    }
    
    // Build context with available fields
    return {
      tenantId,
      workspaceId: (payload.workspace_id as string) || (payload.wid as string) || tenantId,
      userId: (payload.user_id as string) || (payload.sub as string) || 'unknown',
      agentRole: payload.agent_role as string,
      permissions: {
        tools: (payload.allowed_tools as string[]) || [],
        maxTokens: payload.max_tokens as number,
        budgetRemaining: payload.budget_remaining as number,
        allowedModels: payload.allowed_models as string[],
        allowedSkills: payload.allowed_skills as string[],
      },
      raw: payload,
    };
  }
  
  const data = parsed.data;
  
  return {
    tenantId: data.tenant_id,
    workspaceId: data.workspace_id || data.tenant_id,
    userId: data.user_id || data.sub || 'unknown',
    agentRole: data.agent_role,
    permissions: {
      tools: data.allowed_tools || [],
      maxTokens: data.max_tokens,
      budgetRemaining: data.budget_remaining,
      allowedModels: data.allowed_models,
      allowedSkills: data.allowed_skills,
    },
    raw: payload,
  };
}

/**
 * Create a tenant context for internal/system use
 */
export function createSystemTenantContext(
  tenantId: string,
  workspaceId?: string
): TenantContext {
  return {
    tenantId,
    workspaceId: workspaceId || tenantId,
    userId: 'system',
    permissions: {
      tools: ['*'], // All tools allowed for system context
    },
    raw: {
      tenant_id: tenantId,
      workspace_id: workspaceId || tenantId,
      user_id: 'system',
      type: 'system',
    },
  };
}

// ============================================================================
// Authorization Helpers
// ============================================================================

/**
 * Check if tenant has permission to use a specific tool
 */
export function canUseTool(context: TenantContext, toolName: string): boolean {
  const { tools } = context.permissions;
  
  // Wildcard allows all tools
  if (tools.includes('*')) {
    return true;
  }
  
  return tools.includes(toolName);
}

/**
 * Check if tenant has permission to use a specific model
 */
export function canUseModel(context: TenantContext, modelName: string): boolean {
  const { allowedModels } = context.permissions;
  
  // No restriction if not specified
  if (!allowedModels || allowedModels.length === 0) {
    return true;
  }
  
  // Check for exact match or provider wildcard
  const provider = modelName.split('/')[0];
  return (
    allowedModels.includes(modelName) ||
    allowedModels.includes(`${provider}/*`)
  );
}

/**
 * Check if tenant has permission to use a specific skill
 */
export function canUseSkill(context: TenantContext, skillName: string): boolean {
  const { allowedSkills } = context.permissions;
  
  // No restriction if not specified
  if (!allowedSkills || allowedSkills.length === 0) {
    return true;
  }
  
  return allowedSkills.includes(skillName) || allowedSkills.includes('*');
}

/**
 * Check if tenant has remaining budget
 */
export function hasBudget(context: TenantContext, estimatedCost: number = 0): boolean {
  const { budgetRemaining } = context.permissions;
  
  // No restriction if not specified
  if (budgetRemaining === undefined) {
    return true;
  }
  
  return budgetRemaining >= estimatedCost;
}

/**
 * Check if request is within token limits
 */
export function withinTokenLimit(context: TenantContext, tokenCount: number): boolean {
  const { maxTokens } = context.permissions;
  
  // No restriction if not specified
  if (maxTokens === undefined) {
    return true;
  }
  
  return tokenCount <= maxTokens;
}

// ============================================================================
// Error Types
// ============================================================================

export type TenantAuthErrorCode =
  | 'config_error'
  | 'missing_token'
  | 'missing_tenant'
  | 'token_expired'
  | 'invalid_signature'
  | 'verification_failed'
  | 'permission_denied';

export class TenantAuthError extends Error {
  code: TenantAuthErrorCode;
  
  constructor(message: string, code: TenantAuthErrorCode) {
    super(message);
    this.name = 'TenantAuthError';
    this.code = code;
  }
}

// ============================================================================
// Request Context Management
// ============================================================================

/**
 * Async local storage for request-scoped tenant context
 * This allows accessing tenant context anywhere in the request lifecycle
 */
import { AsyncLocalStorage } from 'async_hooks';

const tenantStorage = new AsyncLocalStorage<TenantContext>();

/**
 * Run a function with tenant context available
 */
export function runWithTenant<T>(
  context: TenantContext,
  fn: () => T
): T {
  return tenantStorage.run(context, fn);
}

/**
 * Get the current tenant context (throws if not in request context)
 */
export function getCurrentTenant(): TenantContext {
  const context = tenantStorage.getStore();
  if (!context) {
    throw new TenantAuthError('No tenant context available', 'missing_tenant');
  }
  return context;
}

/**
 * Get the current tenant context (returns undefined if not available)
 */
export function tryGetCurrentTenant(): TenantContext | undefined {
  return tenantStorage.getStore();
}
