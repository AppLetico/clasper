# Clasper Ops

<p align="center">
  <img src="clasper-banner.png" alt="Clasper" width="100%" />
</p>

<h2 align="center">Governance Authority for AI Execution</h2>

<p align="center">
  <b>Governance first. Execution optional.</b>
  <br />
  <i>Decide what AI is allowed to do — and prove what actually happened. Safe, explainable, and shippable for multi-tenant SaaS.</i>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/version-1.2.1-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/built_with-TypeScript-blue.svg" alt="TypeScript">
  <img src="https://img.shields.io/badge/status-Beta-yellow.svg" alt="Status">
</p>

---

**Clasper** is a **governance-first control plane** for AI agent execution. It decides whether execution is allowed, under what constraints, and produces **evidence** you can stand behind — trust status on traces, verifiable exports, policy-as-data, and async human approvals. **Execution is optional**: you can run governance-only (your systems or external adapters execute) or add Clasper’s built-in stateless runtime for LLM execution. Either way, OS and browser actions stay in your backend.

Inspired by [OpenClaw](https://openclaw.ai/)'s workspace pattern, Clasper adapts these ideas into a **multi-tenant, API-first governance platform** with optional execution.

> *"AI agents are not demos. They are production systems."*
> Read the [Clasper Manifesto](https://clasper.ai/docs/manifesto/)

---

## Two Ways to Deploy

Clasper is the same product with the same guarantees; you choose how much execution lives inside Clasper:

| Mode | Description |
|------|--------------|
| **Governance-only** | Use Clasper for policy, audit, traces, cost/risk, and the Ops Console. Execution stays in **your backend** or in **external execution adapters** that request permission from Clasper and ingest telemetry back. No LLM runtime inside Clasper unless you add it. |
| **Governance + managed execution** | Add Clasper’s **built-in stateless runtime** so Clasper also runs LLM execution via `POST /api/agents/send`. Governance (RBAC, budgets, risk, approvals) still runs first; the runtime executes only within granted scope. All OS/browser/data actions remain in your backend. |

Start governance-first, then add the runtime if you want one place to run both governance and LLM calls. See [Architecture](https://clasper.ai/docs/architecture/) and [Integration](https://clasper.ai/docs/integration/) in the docs.

---

## What Clasper Is

- **Governance core** — policy, RBAC, risk, cost/budgets, audit, decision explainability, async approvals
- **Observability** — full traces, replay/diff, annotations, retention, verifiable export bundles
- **Control Plane Contract** — Clasper ↔ your backend (tasks, messages, documents)
- **Adapter Contract** — Clasper ↔ execution adapters (optional; decision + telemetry ingest)
- **Optional stateless HTTP runtime** — built-in adapter for LLM execution (`/api/agents/send`, `/api/agents/stream`)
- **Workspace-driven config** (SOUL.md, AGENTS.md, HEARTBEAT.md, skills)
- **Skill registry** with versioning, lifecycle states, and testing
- **Smart context selection** (optional relevance-based skills + memory)

## What Clasper Is Not

- A daemon for OS/browser automation (no shell access, no file system)
- A personal agent chatbot (designed for backend integration, not direct chat)
- A general automation framework like OpenClaw (stateless, no persistent sessions)
- A replacement for your backend (your system remains the source of truth; execution can stay entirely in your systems)

---

## How Clasper Works With Your Backend

When you use **Governance + managed execution**, Clasper has a **bidirectional relationship** with your SaaS backend:

```
┌─────────────┐                              ┌─────────────┐
│   Your      │ ────── (1) send message ───▶ │   Clasper    │ ──▶ OpenAI
│   Backend   │                              │   Daemon    │
│             │ ◀── (2) agent calls APIs ─── │             │
└─────────────┘                              └─────────────┘
     │                                              │
     │  Source of truth:                            │  Stateless:
     │  • Users, auth                               │  • Loads workspace config
     │  • Tasks, messages                           │  • Builds prompts
     │  • Conversations                             │  • Routes LLM calls
     │  • Documents                                 │  • Mints agent JWTs
     └──────────────────────────────────────────────┘
```

1. **Your backend sends messages** to Clasper (`POST /api/agents/send`)
2. **Clasper calls an LLM** with workspace-configured prompts (personas, rules, skills)
3. **The agent response may call your APIs** to create tasks, post messages, etc.
4. **Your backend remains the source of truth** — Clasper is stateless

This means you can run multiple Clasper instances behind a load balancer with no sticky sessions.

In **governance-only** mode, your backend (or external adapters) call Clasper only for execution decisions and telemetry ingest; see the [Adapter Contract](https://clasper.ai/docs/adapter-contract/) and [Integration](https://clasper.ai/docs/integration/) docs.

See the [Integration guide](https://clasper.ai/docs/integration/) for full backend and adapter integration patterns.

---

## Core Pillars

| Pillar | Description |
|--------|-------------|
| **Agent Observability** | Full execution traces with replay, diff, annotations & retention policies |
| **Skill Runtime** | Versioned YAML manifests with lifecycle states and testing |
| **Governance & Safety** | Tenant isolation, permissions, audit logs, redaction, risk scoring |
| **Provider Abstraction** | Normalized interface across LLM providers |
| **Operational Tooling** | Budget controls, cost forecasting, workspace pinning, environments, impact analysis |

**Stack**: TypeScript + Fastify + SQLite | Multi-provider LLM | Full tracing | Budget controls | Risk scoring

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client / UI                              │
└─────────────────────────────┬───────────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────────┐
│                     Clasper Ops API                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ Agent API   │  │ Ops Console │  │ Governance              │  │
│  │ /api/agents │  │ /ops        │  │ RBAC, Budgets, Risk     │  │
│  └──────┬──────┘  └──────┬──────┘  └────────────┬────────────┘  │
│         │                │                      │               │
│  ┌──────▼────────────────▼──────────────────────▼────────────┐  │
│  │                    Trace Store                            │  │
│  │           (SQLite: traces, audit, retention)              │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────┬───────────────────────────────────┘
                              │ Control Plane Contract (HTTP)
┌─────────────────────────────▼───────────────────────────────────┐
│                      Your Backend                               │
│              (Tasks, Documents, Notifications)                  │
└─────────────────────────────────────────────────────────────────┘
```

Clasper integrates with your backend via the **Control Plane Contract** — a standardized HTTP API for tasks, messages, and documents. Your backend remains the source of truth. In governance-only mode, Clasper only decides and records; in governance + runtime mode, Clasper also runs the LLM execution step.

**Control Plane vs Ops Console:** The **Control Plane** is *your backend’s* API (the contract Clasper calls for tasks, messages, documents). The **Ops Console** is *Clasper’s* operator UI at `/ops` (traces, audit, policies, dashboards)—separate from your backend.

---

## Execution Modes (when using the built-in runtime)

When the built-in runtime adapter is enabled, you get:

| Mode | Endpoint | Description |
|------|----------|-------------|
| **Request/Response** | `POST /api/agents/send` | Synchronous agent execution |
| **Streaming (SSE)** | `POST /api/agents/stream` | Real-time streaming responses |
| **LLM Task** | `POST /llm-task` | Structured JSON-only output |
| **Trace Replay** | `GET /traces/:id/replay` | Reproduce past executions |
| **Ops Console** | `/ops/*` | OIDC-protected operational UI |

Governance (traces, audit, Ops Console, decision APIs) is always available regardless of whether the built-in runtime is enabled.

---

## Operational Features

These are first-class capabilities, not afterthoughts:

### Execution Traces
- Full trace model with LLM calls, tool calls, costs, timing
- Trace diff API for debugging regressions
- Labels & annotations for trace organization
- Entity linking (task → trace → document)
- Per-tenant retention policies

### Role-Based Access Control (RBAC)
- Action-level permissions with enforced scopes
- Resolved permissions at `/ops/api/me`
- Tenant isolation via JWT claims
- Non-admin users never receive raw prompt/tool payloads

### Override Model
- Structured overrides with `reason_code` + `justification`
- All overrides audited as `ops_override_used`
- Break-glass workflow for emergency access

### Cost & Risk Controls
- Per-tenant budget controls (hard/soft limits)
- Pre-execution cost forecasting
- Risk scoring based on tool breadth, skill maturity, temperature, data sensitivity
- Optional execution context signals for high-risk capabilities (`intent`, `context`, `provenance`) to improve policy decisions and approvals
- Dashboards with coverage metadata

### Environment & Promotion
- Workspace versioning with rollback
- Workspace pinning per environment (dev/staging/prod)
- Environment promotion flows with impact analysis
- Safe promotions with pre-flight checks

### Audit & Compliance
- Tamper-evident audit logs for all actions
- Hash-chained audit exports for offline verification
- PII redaction with configurable patterns
- Retention enforcement with cleanup
- Audit API with pagination (`GET /ops/api/audit`)

### Trust & Enforcement (v2.1)
- Signed telemetry envelopes (adapter receipts with signature + payload hash)
- Hash-chained trace steps for tamper detection
- Tool authorization tokens (short-lived, single-use)
- Policy engine with dry-run evaluation

---

## Quickstart

### Fastest Start (One Command)

```bash
make setup
# Then edit .env (BACKEND_URL, AGENT_JWT_SECRET, LLM API keys) and run: make dev
```

`make setup` installs dependencies, copies `.env.example` to `.env` if missing, and scaffolds a workspace from the built-in template.

### Step-by-Step

#### 1) Install

```bash
npm install
cp .env.example .env
```

#### 2) Create a Workspace

Scaffold a workspace from the built-in template:

```bash
npm run init-workspace
# or: make workspace
# or: npx clasper init
```

#### 3) Configure Environment

```bash
# Required
BACKEND_URL=http://localhost:8000
AGENT_JWT_SECRET=your-secret

# LLM Provider
LLM_PROVIDER=openai  # openai, anthropic, google, xai, groq, mistral, openrouter
LLM_MODEL_DEFAULT=gpt-4o-mini

# API Keys
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...

# Workspace
CLASPER_WORKSPACE=./workspace

# Trust & Enforcement (v2.1)
CLASPER_TELEMETRY_SIGNATURE_MODE=warn   # off | warn | enforce
CLASPER_TELEMETRY_MAX_SKEW_SECONDS=300
CLASPER_TOOL_TOKEN_SECRET=your-secret
CLASPER_TOOL_AUTH_MODE=warn             # off | warn | enforce
CLASPER_POLICY_PATH=./config/policies.yaml

# Adapter auth (optional; required for external execution adapters)
ADAPTER_JWT_SECRET=your-secret

# Async approvals (optional; required for pending decisions + decision tokens)
CLASPER_DECISION_TOKEN_SECRET=your-secret

# Database (optional, defaults to ./clasper.db)
CLASPER_DB_PATH=./clasper.db

# Smart context (optional)
CLASPER_SMART_CONTEXT=true
CLASPER_SMART_CONTEXT_MAX_SKILLS=5
CLASPER_SMART_CONTEXT_MAX_MEMORY=3
CLASPER_SMART_CONTEXT_MAX_TOKENS=0
CLASPER_EMBEDDING_PROVIDER=none  # none | local | openai
CLASPER_EMBEDDING_MODEL=Xenova/all-MiniLM-L6-v2
```

#### 4) Run

```bash
# Dev
npm run dev

# Prod
npm run build && npm start
```

#### 5) Configure Ops Console (Optional)

The Operations Console is served at `/ops` and is protected by OIDC + RBAC. For local dev without OIDC, you can set `OPS_DEV_NO_AUTH=true` (and ensure `NODE_ENV` is not `production`); never set in production.

Required env vars:

```
OPS_OIDC_ISSUER=
OPS_OIDC_AUDIENCE=
OPS_OIDC_JWKS_URL=
OPS_RBAC_CLAIM=roles
OPS_TENANT_CLAIM=tenant_id
OPS_WORKSPACE_CLAIM=workspace_id
OPS_ALLOWED_TENANTS_CLAIM=allowed_tenants
```

Optional env vars:

```
# Deep link templates (use {id} placeholder)
DEEP_LINK_TASK_TEMPLATE=
DEEP_LINK_DOC_TEMPLATE=
DEEP_LINK_MSG_TEMPLATE=
```

---

## Clasper vs OpenClaw

Clasper was inspired by OpenClaw's workspace pattern but evolved for a different context: **multi-tenant SaaS backends** with **production governance requirements**.

| Feature | OpenClaw | Clasper |
|---------|----------|--------|
| **Deployment** | Persistent daemon | Stateless HTTP service |
| **Target context** | Single user / personal assistant | Multi-tenant SaaS backends |
| **Tools access** | High-privilege (shell, browser, filesystem) | API-scoped, safe tools via Control Plane |
| **Traceability** | Log history | Full trace model + replay + diff |
| **Governance** | Optional / user-controlled | Core enforced (RBAC, budgets, audit) |
| **RBAC** | Not natively supported | Built-in action-level permissions |
| **Cost controls** | Manual | Forecast + budgets + hard limits |
| **Risk visibility** | N/A | Risk scoring + dashboards |
| **Memory** | Local filesystem | Backend database via Control Plane |
| **Suitability** | Personal assistants | Production backend integrations |

### What Clasper Adopts from OpenClaw

| Pattern | Description |
|---------|-------------|
| `AGENTS.md` | Operating rules and safety guidelines |
| `SOUL.md` / `souls/<role>.md` | Agent personas (single or multi-agent) |
| `HEARTBEAT.md` | Periodic check-in checklist |
| `IDENTITY.md` | Agent branding and identity |
| `TOOLS.md` | Tool usage notes |
| `skills/*/SKILL.md` | OpenClaw-compatible skill format |
| `HEARTBEAT_OK` contract | Silent acknowledgment pattern |

### What Clasper Does Differently

| Pattern | OpenClaw | Clasper |
|---------|----------|--------|
| `memory/` directory | Local filesystem | Optional workspace memory files |
| Session persistence | Persistent daemon state | Stateless (no sessions) |
| Self-modifying prompts | Agent can edit workspace | Workspace is read-only |
| Shell/browser access | Full system access | API-only via Control Plane |
| Cron jobs | Built-in scheduler | Backend handles scheduling |

---

## Control Plane Integration

Clasper integrates with your backend via the **Control Plane Contract v1** — a standardized HTTP API.

### Adoption Checklist

When integrating Clasper with a new backend:

- [ ] Implement the **Control Plane Contract v1** endpoints
- [ ] Ensure `X-Agent-Token` JWTs validate and enforce `user_id` scoping
- [ ] Support `idempotency_key` on create endpoints
- [ ] Run conformance: `CONTROL_PLANE_URL=<backend> AGENT_TOKEN=<jwt> npm run conformance`
- [ ] Optional: add notifications, SSE events, heartbeat/standup

### Required Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/mission-control/capabilities` | Feature discovery |
| `GET /api/mission-control/tasks` | List tasks |
| `POST /api/mission-control/tasks` | Create task |
| `POST /api/mission-control/messages` | Post message |
| `POST /api/mission-control/documents` | Create document |

### Optional Endpoints

| Feature | Endpoints |
|---------|-----------|
| Notifications | `GET /dispatch/undelivered`, `POST /dispatch/.../deliver` |
| Realtime (SSE) | `GET /events` |
| Heartbeat/Standup | `POST /heartbeat`, `POST /standup` |
| Tool approvals | `POST/GET/PATCH /tool-requests` |

See:
- [Control Plane Contract](https://clasper.ai/docs/control-plane-contract/)
- [Getting Started](https://clasper.ai/docs/getting-started/)
- [examples/mission-control-lite/](examples/mission-control-lite/)

---

## API Reference

### Core Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /api/agents/send` | Main request/response endpoint |
| `POST /api/agents/stream` | Streaming responses over SSE |
| `POST /compact` | Summarize conversation history |
| `POST /llm-task` | Structured JSON-only LLM tasks |
| `GET /health` | Component health + database status |

### Tracing & Observability

| Endpoint | Purpose |
|----------|---------|
| `GET /traces` | List traces with filtering |
| `GET /traces/:id` | Get full trace details |
| `GET /traces/:id/replay` | Get replay context for a trace |
| `GET /traces/stats` | Trace statistics |
| `POST /traces/diff` | Compare two traces |
| `POST /traces/:id/label` | Add labels to traces |
| `POST /traces/:id/annotate` | Add annotations |
| `GET /traces/by-label` | Find traces by label |
| `GET /traces/by-entity` | Find traces by entity link |

### Skills & Registry

| Endpoint | Purpose |
|----------|---------|
| `POST /skills/publish` | Publish a skill to the registry |
| `GET /skills/registry/:name` | Get skill from registry |
| `GET /skills/registry/:name/versions` | List all versions of a skill |
| `POST /skills/registry/:name/test` | Run skill tests |
| `GET /skills` | List loaded workspace skills |
| `POST /skills/:name/:version/promote` | Promote skill lifecycle state |
| `GET /skills/:name/:version/state` | Get skill state |
| `GET /skills/by-state` | List skills by state |

### Governance

| Endpoint | Purpose |
|----------|---------|
| `GET /audit` | Query audit logs |
| `GET /audit/stats` | Audit statistics |
| `GET /ops/api/audit` | Ops audit log (OIDC + RBAC) |
| `GET /ops/api/audit-chain/export` | Export + verify audit hash chain |
| `GET /budget` | Get tenant budget |
| `POST /budget` | Set tenant budget |
| `POST /budget/check` | Check if spend is within budget |
| `POST /cost/forecast` | Pre-execution cost estimate |
| `POST /risk/score` | Calculate execution risk score |
| `POST /api/governance/tool/authorize` | Tool authorization (token mint) |
| `POST /api/policy/evaluate` | Policy evaluation |
| `POST /api/policy/dry-run` | Policy evaluation (ops) |

For **governance-only** and **adapter** flows (execution request, pending decisions, ingest), see the [Adapter Contract](https://clasper.ai/docs/adapter-contract/) and [Governance](https://clasper.ai/docs/governance/) docs. Key endpoints: `POST /api/execution/request`, `GET /api/decisions/:id`, `POST /api/decisions/:id/consume`, `POST /api/ingest/*`.

### Retention

| Endpoint | Purpose |
|----------|---------|
| `POST /retention/policy` | Set tenant retention policy |
| `GET /retention/policy` | Get retention policy |
| `POST /retention/enforce` | Enforce retention (cleanup old traces) |
| `GET /retention/stats` | Retention statistics |

### Workspace

| Endpoint | Purpose |
|----------|---------|
| `POST /workspace/pin` | Pin workspace version |
| `GET /workspace/pin` | Get workspace pin |
| `GET /workspace/:id/pins` | List all pins for workspace |
| `POST /workspace/envs` | Create/update environment |
| `GET /workspace/envs` | List environments |
| `POST /workspace/envs/promote` | Promote between environments |
| `POST /workspace/envs/init` | Initialize standard environments |
| `POST /workspace/impact` | Analyze change impact |

### Evaluations

| Endpoint | Purpose |
|----------|---------|
| `POST /evals/run` | Run an evaluation dataset |
| `GET /evals/:id` | Get evaluation result |
| `GET /evals` | List evaluation results |

Full details in the [API Reference](https://clasper.ai/docs/api-reference/).

---

## Multi-Provider LLM Support

Clasper supports multiple LLM providers via [pi-ai](https://github.com/badlogic/pi-mono):

| Provider | Models | API Key Env Var |
|----------|--------|-----------------|
| **OpenAI** | GPT-4o, GPT-4.1, etc. | `OPENAI_API_KEY` |
| **Anthropic** | Claude 4, Claude 3.5, etc. | `ANTHROPIC_API_KEY` |
| **Google** | Gemini 2.5, Gemini 2.0, etc. | `GEMINI_API_KEY` |
| **xAI** | Grok 2, Grok 2 Mini | `XAI_API_KEY` |
| **Groq** | Llama 3.3, Mixtral | `GROQ_API_KEY` |
| **Mistral** | Mistral Large, Codestral | `MISTRAL_API_KEY` |
| **OpenRouter** | Multiple providers | `OPENROUTER_API_KEY` |

---

## Library Structure

```
src/lib/
├── adapters/       # Execution contract, ingest, registry, signed telemetry
├── auth/           # Agent auth, ops auth, permissions, tenant context
├── context/        # Context selection, embeddings, vector store
├── core/           # Database, config
├── evals/          # Evaluation framework
├── exports/        # Verifiable export bundles, verify CLI
├── governance/     # Audit logs, decisions, redaction, budgets, risk, tool tokens
├── integrations/   # Control Plane client, webhooks, costs
├── ops/            # Ops schema, dashboards, trace views, skill ops
├── policy/         # Policy engine, schema, store (data-driven policies)
├── providers/      # LLM providers, contracts
├── security/       # SHA-256, stable JSON
├── skills/         # Skill manifest, registry, testing, lifecycle
├── tools/          # Tool proxy, permissions
├── tracing/        # Trace model, store, diff, annotations, retention, trust status
└── workspace/      # Workspace mgmt, versioning, pins, environments, impact
```

---

## CLI

```bash
npm run build
npm link
clasper init [dir]     # Create workspace from template
clasper serve          # Start the daemon server
clasper dispatcher     # Run notification dispatcher
clasper heartbeat      # Run heartbeat check
```

A **Makefile** is provided for common tasks: `make setup`, `make dev`, `make test`, `make conformance`.

---

## Documentation

Full documentation is available at **[clasper.ai/docs](https://clasper.ai/docs/)**.

| Document | Description |
|----------|-------------|
| [Getting Started](https://clasper.ai/docs/getting-started/) | Quickstart: governance + optional built-in runtime |
| [Architecture](https://clasper.ai/docs/architecture/) | Governance core, adapters, deployment profiles |
| [Integration](https://clasper.ai/docs/integration/) | Backend (Control Plane) and adapter integration |
| [Control Plane Contract](https://clasper.ai/docs/control-plane-contract/) | Backend API contract (tasks, messages, documents) |
| [Adapter Contract](https://clasper.ai/docs/adapter-contract/) | Execution adapters: decision request + telemetry ingest |
| [Workspace](https://clasper.ai/docs/workspace/) | SOUL, AGENTS, skills, workspace config |
| [Governance](https://clasper.ai/docs/governance/) | Default-deny, policy, async approvals, audit |
| [Operations](https://clasper.ai/docs/operations/) | Tracing, Ops Console, adapter visibility |
| [Trust & Enforcement](https://clasper.ai/docs/trust-enforcement/) | Signed telemetry, tool tokens, integrity |
| [Configuration](https://clasper.ai/docs/configuration/) | Environment variables and toggles |
| [API Reference](https://clasper.ai/docs/api-reference/) | Full endpoint reference |
| [Manifesto](https://clasper.ai/docs/manifesto/) | Philosophy and principles |

---

## License

MIT
