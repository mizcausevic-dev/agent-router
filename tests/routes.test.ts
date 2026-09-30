import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_REGISTRY } from '../src/governance/model-registry';
import { TelemetrySummarySchema } from '../src/schemas/validation-schemas';
import { CircuitBreakerRegistry } from '../src/governance/circuit-breaker';
import { recordKnownModelOutcome } from '../src/governance/record-outcome';

test('breaker outcome rejects unknown models and uses server time', () => {
  const registry = new CircuitBreakerRegistry();
  assert.equal(recordKnownModelOutcome(registry, { modelId: 'not-in-registry', ok: false }), null);
  assert.equal(registry.snapshot().length, 0);
  const modelId = MODEL_REGISTRY[0].modelId;
  assert.equal(recordKnownModelOutcome(registry, { modelId, ok: false, at: 1 } as any), 'closed');
  assert.equal(registry.snapshot().find((entry) => entry.modelId === modelId)?.failureCount, 1);
});

test('telemetry summary rejects unbounded batches', () => {
  const decision = {
    decisionId: 'd', timestamp: '2026-01-01T00:00:00Z', tenantId: 'synthetic',
    selectedModelId: 'model', selectedProvider: 'provider', optimization: 'cost',
    estimatedCostUsd: 0, estimatedLatencyMs: 0, qualifiedCount: 1, totalCandidates: 1,
  };
  assert.equal(TelemetrySummarySchema.safeParse({ decisions: Array(1001).fill(decision) }).success, false);
});
