import { z } from 'zod';

export type AdapterRiskClass = 'low' | 'medium' | 'high' | 'critical';

export const AdapterRiskClassSchema = z.enum(['low', 'medium', 'high', 'critical']);

export interface AdapterRegistration {
  adapter_id: string;
  display_name: string;
  risk_class: AdapterRiskClass;
  capabilities: string[];
  version: string;
  enabled: boolean;
}

export const AdapterRegistrationSchema = z.object({
  adapter_id: z.string(),
  display_name: z.string(),
  risk_class: AdapterRiskClassSchema,
  capabilities: z.array(z.string()),
  version: z.string(),
  enabled: z.boolean(),
});

export interface AdapterToken {
  adapter_id: string;
  tenant_id: string;
  workspace_id: string;
  allowed_capabilities: string[];
  expires_at: string;
}

export const AdapterTokenSchema = z.object({
  adapter_id: z.string(),
  tenant_id: z.string(),
  workspace_id: z.string(),
  allowed_capabilities: z.array(z.string()),
  expires_at: z.string(),
});
