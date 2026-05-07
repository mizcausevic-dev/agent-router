// Routing decision telemetry. Aggregates routing decisions over a window
// to produce: total decisions, per-model selection share, per-tenant
// distribution, p95/p50 estimated cost + latency, fallback usage rate.

export interface RoutingDecision {
  decisionId: string;
  timestamp: string;
  tenantId: string;
  selectedModelId: string;
  selectedProvider: string;
  optimization: string;
  estimatedCostUsd: number;
  estimatedLatencyMs: number;
  qualifiedCount: number;
  totalCandidates: number;
  fellBackTo?: string; // populated when actual exec fell back to a non-primary
}

export interface TelemetrySummary {
  windowSize: number;
  totalDecisions: number;
  uniqueTenants: number;
  uniqueModelsSelected: number;
  fallbackUsageRate: number; // 0-100
  topModels: Array<{ modelId: string; provider: string; count: number; sharePct: number }>;
  topTenants: Array<{ tenantId: string; count: number; sharePct: number }>;
  optimizationMix: Record<string, number>;
  costStats: { p50: number; p95: number; total: number };
  latencyStats: { p50: number; p95: number };
  averageQualifiedCount: number;
}

function percentile(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * pct));
  return sorted[idx];
}

export function summarizeTelemetry(decisions: RoutingDecision[]): TelemetrySummary {
  const windowSize = decisions.length;
  if (windowSize === 0) {
    return {
      windowSize: 0,
      totalDecisions: 0,
      uniqueTenants: 0,
      uniqueModelsSelected: 0,
      fallbackUsageRate: 0,
      topModels: [],
      topTenants: [],
      optimizationMix: {},
      costStats: { p50: 0, p95: 0, total: 0 },
      latencyStats: { p50: 0, p95: 0 },
      averageQualifiedCount: 0,
    };
  }

  const tenants = new Set<string>();
  const modelCount = new Map<string, { provider: string; count: number }>();
  const tenantCount = new Map<string, number>();
  const optimizations: Record<string, number> = {};
  const costs: number[] = [];
  const latencies: number[] = [];
  let fallbacks = 0;
  let qualifiedSum = 0;
  let totalCost = 0;

  for (const d of decisions) {
    tenants.add(d.tenantId);
    const cur = modelCount.get(d.selectedModelId) || { provider: d.selectedProvider, count: 0 };
    cur.count++;
    modelCount.set(d.selectedModelId, cur);
    tenantCount.set(d.tenantId, (tenantCount.get(d.tenantId) || 0) + 1);
    optimizations[d.optimization] = (optimizations[d.optimization] || 0) + 1;
    costs.push(d.estimatedCostUsd);
    latencies.push(d.estimatedLatencyMs);
    qualifiedSum += d.qualifiedCount;
    totalCost += d.estimatedCostUsd;
    if (d.fellBackTo) fallbacks++;
  }

  const topModels = Array.from(modelCount.entries())
    .map(([modelId, v]) => ({
      modelId,
      provider: v.provider,
      count: v.count,
      sharePct: Math.round((v.count / windowSize) * 1000) / 10,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const topTenants = Array.from(tenantCount.entries())
    .map(([tenantId, count]) => ({
      tenantId,
      count,
      sharePct: Math.round((count / windowSize) * 1000) / 10,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    windowSize,
    totalDecisions: windowSize,
    uniqueTenants: tenants.size,
    uniqueModelsSelected: modelCount.size,
    fallbackUsageRate: Math.round((fallbacks / windowSize) * 1000) / 10,
    topModels,
    topTenants,
    optimizationMix: optimizations,
    costStats: {
      p50: Math.round(percentile(costs, 0.5) * 1_000_000) / 1_000_000,
      p95: Math.round(percentile(costs, 0.95) * 1_000_000) / 1_000_000,
      total: Math.round(totalCost * 100) / 100,
    },
    latencyStats: {
      p50: Math.round(percentile(latencies, 0.5)),
      p95: Math.round(percentile(latencies, 0.95)),
    },
    averageQualifiedCount: Math.round((qualifiedSum / windowSize) * 100) / 100,
  };
}
