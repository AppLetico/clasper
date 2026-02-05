import { z } from 'zod';

export interface ExecutionRequest {
  execution_id: string;
  adapter_id: string;
  tenant_id: string;
  workspace_id: string;
  skill_id?: string;
  requested_capabilities: string[];
  estimated_cost?: number;
}

export const ExecutionRequestSchema = z.object({
  execution_id: z.string(),
  adapter_id: z.string(),
  tenant_id: z.string(),
  workspace_id: z.string(),
  skill_id: z.string().optional(),
  requested_capabilities: z.array(z.string()),
  estimated_cost: z.number().optional(),
});

export interface ExecutionScope {
  capabilities: string[];
  max_steps: number;
  max_cost: number;
  expires_at: string;
}

export const ExecutionScopeSchema = z.object({
  capabilities: z.array(z.string()),
  max_steps: z.number(),
  max_cost: z.number(),
  expires_at: z.string(),
});

export interface ExecutionDecision {
  allowed: boolean;
  execution_id: string;
  granted_scope?: ExecutionScope;
  blocked_reason?: string;
  requires_approval?: boolean;
}

export const ExecutionDecisionSchema = z.object({
  allowed: z.boolean(),
  execution_id: z.string(),
  granted_scope: ExecutionScopeSchema.optional(),
  blocked_reason: z.string().optional(),
  requires_approval: z.boolean().optional(),
});
