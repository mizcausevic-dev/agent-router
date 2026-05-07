// Fallback chain construction. Given the routing scoring result, build
// an ordered chain of backends to attempt. The chain respects the
// optimization preference but ensures provider diversity (don't fall
// back from Claude → Claude when the issue might be Anthropic-wide).

import type { ScoredCandidate } from './route-scorer';

export interface FallbackChain {
  primary: string;
  attempts: Array<{
    rank: number;
    modelId: string;
    provider: string;
    score: number;
    estimatedCostUsd: number;
    estimatedLatencyMs: number;
    role: 'primary' | 'failover-same-provider' | 'failover-diff-provider' | 'last-resort';
  }>;
  totalAttempts: number;
}

export interface FallbackOptions {
  maxChainLength?: number;
  requireProviderDiversity?: boolean;
}

export function buildFallbackChain(
  candidates: ScoredCandidate[],
  options: FallbackOptions = {}
): FallbackChain {
  const maxLen = options.maxChainLength ?? 3;
  const requireDiversity = options.requireProviderDiversity ?? true;

  const qualified = candidates.filter((c) => !c.disqualified);
  if (qualified.length === 0) {
    return { primary: '', attempts: [], totalAttempts: 0 };
  }

  const chain: FallbackChain['attempts'] = [];
  const usedProviders = new Set<string>();
  const primary = qualified[0];
  chain.push({
    rank: 1,
    modelId: primary.backend.modelId,
    provider: primary.backend.provider,
    score: primary.score,
    estimatedCostUsd: primary.estimatedCostUsd,
    estimatedLatencyMs: primary.estimatedLatencyMs,
    role: 'primary',
  });
  usedProviders.add(primary.backend.provider);

  // Step 2 — find best from a different provider for cross-provider failover
  const diffProviderBest = qualified.find((c) => !usedProviders.has(c.backend.provider));
  if (diffProviderBest && chain.length < maxLen) {
    chain.push({
      rank: chain.length + 1,
      modelId: diffProviderBest.backend.modelId,
      provider: diffProviderBest.backend.provider,
      score: diffProviderBest.score,
      estimatedCostUsd: diffProviderBest.estimatedCostUsd,
      estimatedLatencyMs: diffProviderBest.estimatedLatencyMs,
      role: 'failover-diff-provider',
    });
    usedProviders.add(diffProviderBest.backend.provider);
  } else if (!requireDiversity) {
    // Same-provider failover (next-best from same provider)
    const sameProviderNext = qualified.find((c, i) => i > 0 && c.backend.provider === primary.backend.provider);
    if (sameProviderNext && chain.length < maxLen) {
      chain.push({
        rank: chain.length + 1,
        modelId: sameProviderNext.backend.modelId,
        provider: sameProviderNext.backend.provider,
        score: sameProviderNext.score,
        estimatedCostUsd: sameProviderNext.estimatedCostUsd,
        estimatedLatencyMs: sameProviderNext.estimatedLatencyMs,
        role: 'failover-same-provider',
      });
    }
  }

  // Step 3 — last-resort = cheapest qualified candidate not yet in chain
  if (chain.length < maxLen) {
    const inChainIds = new Set(chain.map((c) => c.modelId));
    const cheapest = [...qualified]
      .filter((c) => !inChainIds.has(c.backend.modelId))
      .sort((a, b) => a.estimatedCostUsd - b.estimatedCostUsd)[0];
    if (cheapest) {
      chain.push({
        rank: chain.length + 1,
        modelId: cheapest.backend.modelId,
        provider: cheapest.backend.provider,
        score: cheapest.score,
        estimatedCostUsd: cheapest.estimatedCostUsd,
        estimatedLatencyMs: cheapest.estimatedLatencyMs,
        role: 'last-resort',
      });
    }
  }

  return {
    primary: primary.backend.modelId,
    attempts: chain,
    totalAttempts: chain.length,
  };
}
