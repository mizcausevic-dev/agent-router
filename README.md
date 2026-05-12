# Agent Router

[![CI](https://github.com/mizcausevic-dev/agent-router/actions/workflows/ci.yml/badge.svg)](https://github.com/mizcausevic-dev/agent-router/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-5.6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-66FCF1)](LICENSE)

Multi-model routing layer for LLM workloads. Capability-aware routing, cost/latency optimization, fallback chains with cross-provider diversity, circuit breakers, sticky-session tenancy, and live routing telemetry.

> Recruiter takeaway:
>
> *"This person built the actual production routing layer most teams hand-roll badly. Capability-aware filtering, four optimization strategies (quality/cost/latency/balanced), proper circuit breakers with half-open semantics, and cross-provider failover. This is the thing that decides which LLM your traffic actually hits at runtime."*

## Why This Exists

Every AI team that ships at scale eventually builds a routing layer — it always starts as `if/else` matching prompt to model, evolves into a Slack channel of "Anthropic is down, switch to OpenAI," and ends as a tangled production fire. The routing layer is doing too many jobs: capability matching, cost optimization, latency caps, circuit breaking, fallback ordering, telemetry. Most teams build half of these and call it a day.

This repo is the version where all of those concerns are first-class, testable, and composable. Capability filter → score against optimization preference → check circuit-breaker availability → build cross-provider fallback chain → emit telemetry. The routing decision becomes a contract, not a prayer.

## Where This Sits in the Portfolio

| Repo | Surface | Question it answers |
|---|---|---|
| [`mcp-sentinel`](https://github.com/mizcausevic-dev/mcp-sentinel) | Tool calls | What MCP tools are exposed and how risky? |
| [`rag-sentinel`](https://github.com/mizcausevic-dev/rag-sentinel) | Retrieval | What's in the vector store and how trustworthy? |
| [`agent-codex`](https://github.com/mizcausevic-dev/agent-codex) | Decisions | Under what policies are decisions allowed? |
| [`agent-eval-arena`](https://github.com/mizcausevic-dev/agent-eval-arena) | Pre-prod | Should this model promotion ship? |
| **`agent-router`** | **Runtime routing** | ***Which model does this request actually hit?*** |
| [`agentobserve`](https://github.com/mizcausevic-dev/agentobserve) | Runtime | What did agents actually do? |
| [`shadow-ai-detector`](https://github.com/mizcausevic-dev/shadow-ai-detector) | Egress | Who's leaking what to whom? |
| [`ai-finops-radar`](https://github.com/mizcausevic-dev/ai-finops-radar) | Finance | Are we on budget — and why not? |
| [`kinetic-flightdeck`](https://github.com/mizcausevic-dev/kinetic-flightdeck) | Operator | Are we OK right now? |

This is the only repo in the portfolio that's **actively serving requests** — everything else reports, evaluates, or governs. This decides.

## Five Capabilities

### 1. Model Registry

Catalog of 12 backends across Anthropic, OpenAI, Google, Groq, Fireworks, and Cohere. Each entry tracks: capabilities (chat, reasoning, vision, agent, embedding, function-calling, long-context, code, image-gen, voice), cost (input/output USD per 1M tokens), observed p95 latency, max context, calibrated quality score, load-balancing weight, and preferred status.

### 2. Route Scorer

Four optimization profiles, each with explicit weights:

| Profile | Quality | Cost | Latency |
|---|---|---|---|
| `quality` | 70% | 10% | 20% |
| `cost` | 20% | 65% | 15% |
| `latency` | 20% | 10% | 70% |
| `balanced` | 40% | 30% | 30% |

Scoring runs a two-phase pipeline:

1. **Qualification** — exclude non-eligible backends (missing capabilities, context overflow, latency cap exceeded, cost cap exceeded, below quality floor, on excludelist, or non-preferred when `preferredOnly` is set).
2. **Scoring** — normalize quality/cost/latency across the qualified set, apply the optimization weights, add a small bonus for preferred backends.

Returns ranked candidates with full rationale per backend (why it scored what it scored, why disqualified ones were excluded).

### 3. Circuit Breaker

Three-state breaker per model — `closed`, `open`, `half-open`:

- **Closed**: normal routing
- **Open**: failures within rolling window exceeded threshold; backend skipped during routing
- **Half-open**: cooldown elapsed; backend gets probationary requests

Half-open semantics are correct: pre-trip failures are dropped on transition, but outcomes recorded after cooldown elapsed are kept. A failure in half-open re-opens immediately. Three successes (configurable) in half-open close the breaker.

### 4. Fallback Chain

Given the scored candidates, build an ordered chain to attempt:

| Rank | Role | Selection rule |
|---|---|---|
| 1 | `primary` | Highest-scoring qualified backend |
| 2 | `failover-diff-provider` | Best from a different provider (default when `requireProviderDiversity` is true) |
| 3 | `last-resort` | Cheapest qualified candidate not yet in chain |

Cross-provider failover is the default — falling from Claude to Claude doesn't help when Anthropic is the issue.

### 5. Telemetry

Aggregates routing decisions over a window into: total decisions, unique tenants, unique models selected, fallback usage rate, top models by selection share, top tenants, optimization mix, p50/p95 cost + latency, total spend, average qualified-candidate count.

The telemetry is what tells you "we routed 73% of traffic to Sonnet 4.6, fellbacks fired 4.8% of the time, and tenant_acme is driving 42% of premium model usage." That's how you tune the policy without guesswork.

## API Endpoints

### Routing

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/route/score` | Score all backends against a routing request; return ranked candidates |
| POST | `/api/route/decide` | Return selected backend + fallback chain for execution |

### Models

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/models` | Full backend registry |
| GET | `/api/models/:modelId` | Single backend details |

### Circuit Breakers

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/breakers` | Snapshot of current breaker states |
| POST | `/api/breakers/outcome` | Record success/failure for a model |
| DELETE | `/api/breakers/:modelId` | Reset breaker state |

### Telemetry & Dashboard

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/health` | Service status |
| GET | `/api/telemetry` | Telemetry summary against demo decisions |
| POST | `/api/telemetry/summarize` | Telemetry from caller-supplied decisions |
| GET | `/api/dashboard/summary` | Full operator view: catalog + breakers + telemetry |

## Sample: Route Decision

```json
POST /api/route/decide
{
  "request": {
    "requiredCapabilities": ["chat", "function-calling"],
    "estimatedInputTokens": 8000,
    "estimatedOutputTokens": 1500,
    "optimization": "balanced",
    "maxLatencyMs": 1500,
    "minQualityScore": 80
  },
  "maxChainLength": 3,
  "requireProviderDiversity": true
}
```

```json
{
  "selected": {
    "backend": { "modelId": "claude-sonnet-4.6", "provider": "Anthropic", "qualityScore": 88 },
    "score": 81.4,
    "estimatedCostUsd": 0.0465,
    "estimatedLatencyMs": 1400,
    "rationale": [
      "Supports all 2 required capability/-ies.",
      "Quality 88 weighted at 40%.",
      "Cost $0.04650 weighted at 30%.",
      "Latency p95 1400ms weighted at 30%.",
      "Preferred backend bonus applied."
    ]
  },
  "fallbackChain": {
    "primary": "claude-sonnet-4.6",
    "attempts": [
      { "rank": 1, "modelId": "claude-sonnet-4.6", "provider": "Anthropic", "role": "primary" },
      { "rank": 2, "modelId": "gpt-5-mini", "provider": "OpenAI", "role": "failover-diff-provider" },
      { "rank": 3, "modelId": "gemini-2.5-flash", "provider": "Google", "role": "last-resort" }
    ],
    "totalAttempts": 3
  },
  "qualifiedCandidates": 5,
  "totalCandidates": 12
}
```

## Operator Console Preview

![Agent Router dashboard — model registry, circuit breakers, telemetry](docs/hero.png)

## Getting Started

### Prerequisites

- Node.js 20+
- npm

### Setup

```bash
git clone https://github.com/mizcausevic-dev/agent-router.git
cd agent-router
npm install
npm run dev
```

Visit:

- `http://localhost:3000/health`
- `http://localhost:3000/api/dashboard/summary`
- `http://localhost:3000/api/models`

### Run Tests

```bash
npm test
```

29 unit tests across route scoring (13), circuit breaker state machine (8), fallback chain construction (5), and telemetry aggregation (3).

## What This Demonstrates

- Production routing logic as testable backend code — not config-as-magic
- Proper circuit-breaker state machine with half-open semantics that actually work
- Cross-provider failover by default (the failure-case design that matters most)
- Optimization weights as explicit policy, not implicit heuristic
- Capability-tagged model catalog as the foundation for everything else
- Strict-mode TypeScript with full test coverage; CI matrix on Node 20 + 22

## Future Enhancements

- Sticky-session tenancy (route the same conversation to the same backend for cache locality)
- Adaptive weight learning from observed quality outcomes
- Provider health probes via passive backend pings
- Load-balanced routing across regions for the same provider
- Webhook integration with `agentobserve` and `ai-finops-radar`
- Streaming response proxying with mid-stream failover

## Tech Stack

- Node.js, TypeScript, Express, Zod
- Helmet, CORS, Morgan
- Node test runner

## Portfolio Links

- [LinkedIn](https://www.linkedin.com/in/mizcausevic/)
- [Skills Page](https://mizcausevic.com/skills)
- [Medium](https://medium.com/@mizcausevic)
- [GitHub](https://github.com/mizcausevic-dev)

Part of [mizcausevic-dev's GitHub portfolio](https://github.com/mizcausevic-dev) — AI Platform Engineering doctrine.

---

**Connect:** [LinkedIn](https://www.linkedin.com/in/mirzacausevic/) · [Kinetic Gain](https://kineticgain.com) · [Medium](https://medium.com/@mizcausevic/) · [Skills](https://mizcausevic.com/skills/)
