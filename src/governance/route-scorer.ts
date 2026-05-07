// Route scoring engine. Given a request (capabilities needed, context size,
// optimization preference, optional excludes) and a list of candidate
// backends, score each one against the routing policy and return ranked
// candidates with rationale.

import type { ModelBackend, Capability } from './model-registry';

export type Optimization = 'quality' | 'cost' | 'latency' | 'balanced';

export interface RoutingRequest {
  requiredCapabilities: Capability[];
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  optimization: Optimization;
  excludeModelIds?: string[];
  excludeProviders?: string[];
  maxLatencyMs?: number;
  maxCostUsd?: number;
  minQualityScore?: number;
  preferredOnly?: boolean;
}

export interface ScoredCandidate {
  backend: ModelBackend;
  score: number; // 0-100
  estimatedCostUsd: number;
  estimatedLatencyMs: number;
  fitsContext: boolean;
  capabilityMatch: boolean;
  rationale: string[];
  disqualified: boolean;
  disqualificationReasons: string[];
}

export interface ScoringResult {
  candidates: ScoredCandidate[];
  selected: ScoredCandidate | null;
  totalCandidates: number;
  qualifiedCandidates: number;
  optimization: Optimization;
}

const WEIGHTS: Record<Optimization, { quality: number; cost: number; latency: number }> = {
  quality:   { quality: 0.70, cost: 0.10, latency: 0.20 },
  cost:      { quality: 0.20, cost: 0.65, latency: 0.15 },
  latency:   { quality: 0.20, cost: 0.10, latency: 0.70 },
  balanced:  { quality: 0.40, cost: 0.30, latency: 0.30 },
};

function computeCost(backend: ModelBackend, inputTokens: number, outputTokens: number): number {
  const inCost = (inputTokens / 1_000_000) * backend.inputUsdPer1M;
  const outCost = (outputTokens / 1_000_000) * backend.outputUsdPer1M;
  return inCost + outCost;
}

function normalizeAcrossSet(values: number[], invert: boolean): number[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 50);
  return values.map((v) => {
    const norm = ((v - min) / (max - min)) * 100;
    return invert ? 100 - norm : norm;
  });
}

export function scoreRoutes(
  request: RoutingRequest,
  backends: ModelBackend[]
): ScoringResult {
  const totalCandidates = backends.length;
  const exclusions = {
    models: new Set(request.excludeModelIds ?? []),
    providers: new Set(request.excludeProviders ?? []),
  };

  // Phase 1 — qualification (filter out non-eligible backends)
  const annotated = backends.map((backend) => {
    const reasons: string[] = [];
    const rationale: string[] = [];

    if (exclusions.models.has(backend.modelId)) {
      reasons.push(`Model ${backend.modelId} explicitly excluded.`);
    }
    if (exclusions.providers.has(backend.provider)) {
      reasons.push(`Provider ${backend.provider} excluded.`);
    }

    const requiredCaps = request.requiredCapabilities;
    const supported = new Set(backend.capabilities);
    const missingCaps = requiredCaps.filter((c) => !supported.has(c));
    const capabilityMatch = missingCaps.length === 0;
    if (!capabilityMatch) {
      reasons.push(`Missing required capabilities: ${missingCaps.join(', ')}.`);
    } else {
      rationale.push(`Supports all ${requiredCaps.length} required capability/-ies.`);
    }

    const fitsContext = request.estimatedInputTokens + request.estimatedOutputTokens <= backend.maxContextTokens;
    if (!fitsContext) {
      reasons.push(`Context (${request.estimatedInputTokens + request.estimatedOutputTokens}) exceeds max ${backend.maxContextTokens}.`);
    }

    if (request.preferredOnly && !backend.preferred) {
      reasons.push('Not on preferred list.');
    }

    if (request.minQualityScore !== undefined && backend.qualityScore < request.minQualityScore) {
      reasons.push(`Quality ${backend.qualityScore} below floor ${request.minQualityScore}.`);
    }

    if (request.maxLatencyMs !== undefined && backend.observedP95LatencyMs > request.maxLatencyMs) {
      reasons.push(`p95 latency ${backend.observedP95LatencyMs}ms exceeds cap ${request.maxLatencyMs}ms.`);
    }

    const estimatedCostUsd = computeCost(backend, request.estimatedInputTokens, request.estimatedOutputTokens);
    if (request.maxCostUsd !== undefined && estimatedCostUsd > request.maxCostUsd) {
      reasons.push(`Estimated cost $${estimatedCostUsd.toFixed(5)} exceeds cap $${request.maxCostUsd.toFixed(5)}.`);
    }

    return {
      backend,
      reasons,
      rationale,
      estimatedCostUsd,
      estimatedLatencyMs: backend.observedP95LatencyMs,
      fitsContext,
      capabilityMatch,
    };
  });

  const qualified = annotated.filter((a) => a.reasons.length === 0);
  const w = WEIGHTS[request.optimization];

  // Phase 2 — score qualified backends with normalized metrics
  const qualityScores = qualified.map((q) => q.backend.qualityScore);
  const costScores = qualified.map((q) => q.estimatedCostUsd);
  const latencyScores = qualified.map((q) => q.estimatedLatencyMs);

  const normQuality = normalizeAcrossSet(qualityScores, false);
  const normCost = normalizeAcrossSet(costScores, true); // lower cost = higher score
  const normLatency = normalizeAcrossSet(latencyScores, true); // lower latency = higher score

  const scored: ScoredCandidate[] = annotated.map((a) => {
    if (a.reasons.length > 0) {
      return {
        backend: a.backend,
        score: 0,
        estimatedCostUsd: Math.round(a.estimatedCostUsd * 1_000_000) / 1_000_000,
        estimatedLatencyMs: a.estimatedLatencyMs,
        fitsContext: a.fitsContext,
        capabilityMatch: a.capabilityMatch,
        rationale: a.rationale,
        disqualified: true,
        disqualificationReasons: a.reasons,
      };
    }
    const idx = qualified.indexOf(a);
    const composite =
      normQuality[idx] * w.quality +
      normCost[idx] * w.cost +
      normLatency[idx] * w.latency;

    const rationale = [...a.rationale,
      `Quality ${a.backend.qualityScore} weighted at ${(w.quality * 100).toFixed(0)}%.`,
      `Cost $${a.estimatedCostUsd.toFixed(5)} weighted at ${(w.cost * 100).toFixed(0)}%.`,
      `Latency p95 ${a.estimatedLatencyMs}ms weighted at ${(w.latency * 100).toFixed(0)}%.`,
    ];
    if (a.backend.preferred) rationale.push('Preferred backend bonus applied.');

    // Preferred backends get a small bump
    const preferredBonus = a.backend.preferred ? 3 : 0;
    const score = Math.min(100, Math.max(0, composite + preferredBonus));

    return {
      backend: a.backend,
      score: Math.round(score * 100) / 100,
      estimatedCostUsd: Math.round(a.estimatedCostUsd * 1_000_000) / 1_000_000,
      estimatedLatencyMs: a.estimatedLatencyMs,
      fitsContext: a.fitsContext,
      capabilityMatch: a.capabilityMatch,
      rationale,
      disqualified: false,
      disqualificationReasons: [],
    };
  });

  // Sort: qualified first by score desc, then disqualified
  scored.sort((a, b) => {
    if (a.disqualified && !b.disqualified) return 1;
    if (!a.disqualified && b.disqualified) return -1;
    return b.score - a.score;
  });

  const selected = scored.find((c) => !c.disqualified) ?? null;

  return {
    candidates: scored,
    selected,
    totalCandidates,
    qualifiedCandidates: qualified.length,
    optimization: request.optimization,
  };
}
