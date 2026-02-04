# Plugin Architecture Ideas

> **Status:** Future consideration  
> **Created:** 2026-02-04  
> **Priority:** Low — revisit when demand emerges

---

## Context

Clasper is currently a monolithic service with no formal plugin system. This document captures ideas for future extensibility if/when the need arises.

### Current Extension Points

Clasper has limited but functional extension mechanisms:

| Mechanism | Purpose |
|-----------|---------|
| Fastify hooks | Request lifecycle (`onRequest`, `onResponse`) |
| Webhooks | Completion callbacks to external systems |
| Skills | Workspace-based prompt/tool configuration |
| Control Plane Contract | Backend integration via HTTP API |

These cover most use cases, but don't support injecting custom logic into the LLM request pipeline.

---

## Potential Use Cases

### 1. LLM Firewall / Guardrails (e.g., PromptGuard)

External services like [PromptGuard](https://promptguard.co/) offer:
- ML-powered prompt injection detection (vs our regex-based approach)
- Jailbreak prevention
- Smart response caching (40%+ cost savings)
- Red team testing suites

**Integration model:** Proxy-based — change `base_url` to route LLM calls through firewall.

### 2. Custom PII Detection

Enterprise customers may need:
- Industry-specific PII patterns (HIPAA, PCI-DSS)
- Custom redaction strategies
- Integration with DLP systems

### 3. Observability Integrations

Send traces/metrics to external systems:
- Datadog, New Relic, Honeycomb
- Custom analytics pipelines
- Cost attribution systems

### 4. Custom Tool Providers

Allow plugins to register additional tools beyond the Control Plane Contract.

---

## Implementation Options

### Option 1: LLM Base URL Override (Minimal)

Add a single env var to support proxy-based integrations.

```bash
# .env
LLM_BASE_URL=https://api.promptguard.co/api/v1
LLM_PROXY_HEADERS=X-API-Key:pg-xxx
```

**Effort:** ~30 minutes  
**Scope:** LLM proxy only  
**Pros:** Simple, reversible  
**Cons:** All-or-nothing, no per-tenant control

### Option 2: LLM Middleware Layer

Add pre/post hooks around LLM calls.

```typescript
// src/lib/providers/middleware/index.ts
interface LLMMiddleware {
  name: string;
  beforeRequest?: (req: LLMRequest) => Promise<LLMRequest>;
  afterResponse?: (res: LLMResponse) => Promise<LLMResponse>;
  onError?: (err: Error) => Promise<void>;
}

// Usage
registerMiddleware({
  name: 'promptguard',
  beforeRequest: async (req) => {
    // Scan for injection, redact PII, etc.
    return req;
  }
});
```

**Effort:** 1-2 days  
**Scope:** LLM pipeline only  
**Pros:** Flexible, composable  
**Cons:** Only covers LLM calls

### Option 3: Full Plugin System

Formal plugin architecture with lifecycle management.

```typescript
// src/lib/plugins/types.ts
interface ClasperPlugin {
  name: string;
  version: string;
  
  // Lifecycle
  init: (ctx: PluginContext) => Promise<void>;
  destroy?: () => Promise<void>;
  
  // Hooks
  hooks?: {
    'llm:beforeRequest'?: (req: LLMRequest) => Promise<LLMRequest>;
    'llm:afterResponse'?: (res: LLMResponse) => Promise<LLMResponse>;
    'trace:beforeStore'?: (trace: Trace) => Promise<Trace>;
    'tool:beforeCall'?: (call: ToolCall) => Promise<ToolCall>;
  };
  
  // Config schema (validated at load time)
  configSchema?: ZodSchema;
}

// Plugin manifest (plugins/promptguard/manifest.yaml)
name: promptguard
version: 1.0.0
description: ML-powered prompt injection firewall
config:
  apiKey: ${PROMPTGUARD_API_KEY}
  mode: block | warn
hooks:
  - llm:beforeRequest
```

**Effort:** 1-2 weeks  
**Scope:** Full system  
**Pros:** Future-proof, clean separation  
**Cons:** Significant investment, may be overkill

---

## Recommendation

**Start with Option 1 when first needed**, then evolve to Option 2 if multiple LLM-layer integrations emerge. Only build Option 3 if plugins become a core product feature.

### Decision Triggers

Revisit this when:
- [ ] Audit logs show prompt injection attempts bypassing regex patterns
- [ ] Customer explicitly requests PromptGuard or similar
- [ ] Cost optimization becomes a priority (caching benefit)
- [ ] 2+ integrations need the same hook points

---

## Current Security Coverage

For reference, Clasper already has these security features:

| Feature | Implementation | Location |
|---------|---------------|----------|
| Prompt injection sanitization | Regex-based (~15 patterns) | `src/lib/security/index.ts` |
| PII redaction | Regex-based (email, SSN, CC, phone, API keys) | `src/lib/governance/redaction.ts` |
| Tool permissions | Two-layer (skill + tenant) | `src/lib/tools/toolProxy.ts` |
| Path traversal prevention | Validation + sanitization | `src/lib/security/index.ts` |
| SSRF prevention | URL allowlist | `src/lib/security/index.ts` |
| Audit logging | Immutable append-only | `src/lib/governance/audit.ts` |
| Budget controls | Per-tenant limits | `src/lib/governance/budgets.ts` |
| Risk scoring | Multi-factor scoring | `src/lib/governance/risk.ts` |

These cover the common cases. ML-powered detection would be an enhancement, not a critical gap.

---

## References

- [PromptGuard](https://promptguard.co/) — LLM firewall service
- [Rebuff](https://github.com/protectai/rebuff) — Open-source prompt injection detection
- [LLM Guard](https://llm-guard.com/) — Open-source LLM security toolkit
- [NeMo Guardrails](https://github.com/NVIDIA/NeMo-Guardrails) — NVIDIA's guardrails framework
