import { readFileSync, existsSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { config } from '../core/config.js';

export type PolicyDecision = 'allow' | 'deny' | 'require_approval';

export interface PolicyRule {
  policy_id: string;
  if?: {
    environment?: string;
    tool?: string;
    adapter_risk_class?: string;
    skill_state?: string;
    tenant_id?: string;
  };
  then: {
    allow?: boolean;
    deny?: boolean;
    require_approval?: boolean;
  };
}

export interface PolicyContext {
  environment?: string;
  tool?: string;
  adapter_risk_class?: string;
  skill_state?: string;
  tenant_id?: string;
}

export interface PolicyEvaluation {
  decision: PolicyDecision;
  policy_id?: string;
  matched: PolicyRule[];
}

export function loadPolicies(): PolicyRule[] {
  const path = config.policyPath;
  if (!existsSync(path)) {
    return [];
  }

  const content = readFileSync(path, 'utf-8');
  const parsed = parseYaml(content) as { policies?: PolicyRule[] } | undefined;
  if (!parsed || !Array.isArray(parsed.policies)) {
    return [];
  }

  return parsed.policies.filter((rule) => !!rule && !!rule.policy_id && !!rule.then);
}

function matches(rule: PolicyRule, ctx: PolicyContext): boolean {
  if (!rule.if) return true;

  const conditions = rule.if;
  if (conditions.environment && conditions.environment !== ctx.environment) return false;
  if (conditions.tool && conditions.tool !== ctx.tool) return false;
  if (conditions.adapter_risk_class && conditions.adapter_risk_class !== ctx.adapter_risk_class)
    return false;
  if (conditions.skill_state && conditions.skill_state !== ctx.skill_state) return false;
  if (conditions.tenant_id && conditions.tenant_id !== ctx.tenant_id) return false;

  return true;
}

function decisionFromRule(rule: PolicyRule): PolicyDecision {
  if (rule.then.deny) return 'deny';
  if (rule.then.require_approval) return 'require_approval';
  if (rule.then.allow) return 'allow';
  return 'deny';
}

export function evaluatePolicy(ctx: PolicyContext): PolicyEvaluation {
  const policies = loadPolicies();
  const matched: PolicyRule[] = [];

  for (const rule of policies) {
    if (matches(rule, ctx)) {
      matched.push(rule);
      const decision = decisionFromRule(rule);
      return { decision, policy_id: rule.policy_id, matched };
    }
  }

  return { decision: 'deny', matched };
}
