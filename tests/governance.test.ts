import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreakerRegistry } from '../src/governance/circuit-breaker';
import { buildFallbackChain } from '../src/governance/fallback-chain';
import { scoreRoutes } from '../src/governance/route-scorer';
import { MODEL_REGISTRY } from '../src/governance/model-registry';
import { summarizeTelemetry, type RoutingDecision } from '../src/governance/telemetry';

const NOW = 1_000_000;

test('circuit-breaker: starts closed', () => {
  const cb = new CircuitBreakerRegistry();
  assert.equal(cb.getState('test-model'), 'closed');
  assert.equal(cb.isAvailable('test-model'), true);
});

test('circuit-breaker: trips open after threshold failures', () => {
  const cb = new CircuitBreakerRegistry();
  for (let i = 0; i < 5; i++) {
    cb.recordOutcome({ modelId: 'm', ok: false, errorCode: '500', at: NOW + i });
  }
  assert.equal(cb.getState('m', NOW + 100), 'open');
  assert.equal(cb.isAvailable('m', NOW + 100), false);
});

test('circuit-breaker: stays closed below threshold', () => {
  const cb = new CircuitBreakerRegistry();
  for (let i = 0; i < 4; i++) {
    cb.recordOutcome({ modelId: 'm', ok: false, errorCode: '500', at: NOW + i });
  }
  assert.equal(cb.getState('m', NOW + 100), 'closed');
});

test('circuit-breaker: transitions to half-open after cooldown', () => {
  const cb = new CircuitBreakerRegistry();
  for (let i = 0; i < 5; i++) {
    cb.recordOutcome({ modelId: 'm', ok: false, at: NOW + i });
  }
  assert.equal(cb.getState('m', NOW + 100), 'open');
  // Default cooldown 30s → past it
  assert.equal(cb.getState('m', NOW + 31_000), 'half-open');
});

test('circuit-breaker: half-open closes after enough successes', () => {
  const cb = new CircuitBreakerRegistry();
  for (let i = 0; i < 5; i++) {
    cb.recordOutcome({ modelId: 'm', ok: false, at: NOW + i });
  }
  // Move past cooldown
  cb.recordOutcome({ modelId: 'm', ok: true, at: NOW + 31_000 });
  assert.equal(cb.getState('m', NOW + 31_001), 'half-open');
  cb.recordOutcome({ modelId: 'm', ok: true, at: NOW + 31_002 });
  cb.recordOutcome({ modelId: 'm', ok: true, at: NOW + 31_003 });
  // Three successes meets default halfOpenSampleCount
  assert.equal(cb.getState('m', NOW + 31_004), 'closed');
});

test('circuit-breaker: half-open re-opens on failure', () => {
  const cb = new CircuitBreakerRegistry();
  for (let i = 0; i < 5; i++) {
    cb.recordOutcome({ modelId: 'm', ok: false, at: NOW + i });
  }
  cb.recordOutcome({ modelId: 'm', ok: false, at: NOW + 31_000 });
  assert.equal(cb.getState('m', NOW + 31_100), 'open');
});

test('circuit-breaker: snapshot returns telemetry', () => {
  const cb = new CircuitBreakerRegistry();
  cb.recordOutcome({ modelId: 'a', ok: true, at: NOW });
  cb.recordOutcome({ modelId: 'a', ok: false, at: NOW + 1 });
  cb.recordOutcome({ modelId: 'b', ok: true, at: NOW + 2 });
  const snap = cb.snapshot(NOW + 100);
  assert.equal(snap.length, 2);
  const a = snap.find((s) => s.modelId === 'a')!;
  assert.equal(a.failureRate, 50);
});

test('circuit-breaker: reset clears state', () => {
  const cb = new CircuitBreakerRegistry();
  for (let i = 0; i < 5; i++) cb.recordOutcome({ modelId: 'm', ok: false, at: NOW + i });
  assert.equal(cb.getState('m', NOW + 100), 'open');
  cb.reset('m');
  assert.equal(cb.getState('m', NOW + 100), 'closed');
});

test('fallback-chain: empty candidates produces empty chain', () => {
  const chain = buildFallbackChain([]);
  assert.equal(chain.totalAttempts, 0);
  assert.equal(chain.primary, '');
});

test('fallback-chain: primary always at rank 1', () => {
  const r = scoreRoutes({
    requiredCapabilities: ['chat'],
    estimatedInputTokens: 1000,
    estimatedOutputTokens: 500,
    optimization: 'balanced',
  }, MODEL_REGISTRY);
  const chain = buildFallbackChain(r.candidates);
  assert.equal(chain.attempts[0].rank, 1);
  assert.equal(chain.attempts[0].role, 'primary');
  assert.equal(chain.primary, chain.attempts[0].modelId);
});

test('fallback-chain: cross-provider failover preferred', () => {
  const r = scoreRoutes({
    requiredCapabilities: ['chat'],
    estimatedInputTokens: 1000,
    estimatedOutputTokens: 500,
    optimization: 'balanced',
  }, MODEL_REGISTRY);
  const chain = buildFallbackChain(r.candidates, { requireProviderDiversity: true });
  if (chain.attempts.length >= 2) {
    assert.notEqual(chain.attempts[0].provider, chain.attempts[1].provider);
  }
});

test('fallback-chain: respects maxChainLength', () => {
  const r = scoreRoutes({
    requiredCapabilities: ['chat'],
    estimatedInputTokens: 1000,
    estimatedOutputTokens: 500,
    optimization: 'balanced',
  }, MODEL_REGISTRY);
  const chain = buildFallbackChain(r.candidates, { maxChainLength: 2 });
  assert.ok(chain.attempts.length <= 2);
});

test('fallback-chain: disqualified candidates excluded', () => {
  const r = scoreRoutes({
    requiredCapabilities: ['voice'], // most don't support
    estimatedInputTokens: 1000,
    estimatedOutputTokens: 500,
    optimization: 'balanced',
  }, MODEL_REGISTRY);
  const chain = buildFallbackChain(r.candidates);
  // Either zero attempts (none qualify) or only qualified ones
  for (const a of chain.attempts) {
    const c = r.candidates.find((x) => x.backend.modelId === a.modelId);
    assert.ok(c && !c.disqualified);
  }
});

test('telemetry: empty decisions returns empty summary', () => {
  const t = summarizeTelemetry([]);
  assert.equal(t.totalDecisions, 0);
  assert.equal(t.uniqueTenants, 0);
});

test('telemetry: aggregates correctly', () => {
  const decisions: RoutingDecision[] = [
    { decisionId: '1', timestamp: '2026-05-07T10:00:00Z', tenantId: 't1', selectedModelId: 'm1', selectedProvider: 'P1', optimization: 'cost', estimatedCostUsd: 0.01, estimatedLatencyMs: 800, qualifiedCount: 4, totalCandidates: 10 },
    { decisionId: '2', timestamp: '2026-05-07T10:01:00Z', tenantId: 't1', selectedModelId: 'm1', selectedProvider: 'P1', optimization: 'cost', estimatedCostUsd: 0.012, estimatedLatencyMs: 850, qualifiedCount: 4, totalCandidates: 10 },
    { decisionId: '3', timestamp: '2026-05-07T10:02:00Z', tenantId: 't2', selectedModelId: 'm2', selectedProvider: 'P2', optimization: 'quality', estimatedCostUsd: 0.05, estimatedLatencyMs: 1500, qualifiedCount: 3, totalCandidates: 10, fellBackTo: 'm3' },
  ];
  const t = summarizeTelemetry(decisions);
  assert.equal(t.totalDecisions, 3);
  assert.equal(t.uniqueTenants, 2);
  assert.equal(t.uniqueModelsSelected, 2);
  assert.equal(t.fallbackUsageRate, 33.3);
  assert.equal(t.topModels[0].modelId, 'm1');
  assert.equal(t.topModels[0].count, 2);
});

test('telemetry: optimization mix tracked', () => {
  const decisions: RoutingDecision[] = [
    { decisionId: '1', timestamp: '2026-05-07T10:00:00Z', tenantId: 't1', selectedModelId: 'm1', selectedProvider: 'P', optimization: 'cost', estimatedCostUsd: 0.01, estimatedLatencyMs: 800, qualifiedCount: 4, totalCandidates: 10 },
    { decisionId: '2', timestamp: '2026-05-07T10:01:00Z', tenantId: 't1', selectedModelId: 'm1', selectedProvider: 'P', optimization: 'cost', estimatedCostUsd: 0.012, estimatedLatencyMs: 850, qualifiedCount: 4, totalCandidates: 10 },
    { decisionId: '3', timestamp: '2026-05-07T10:02:00Z', tenantId: 't1', selectedModelId: 'm1', selectedProvider: 'P', optimization: 'quality', estimatedCostUsd: 0.05, estimatedLatencyMs: 1500, qualifiedCount: 3, totalCandidates: 10 },
  ];
  const t = summarizeTelemetry(decisions);
  assert.equal(t.optimizationMix.cost, 2);
  assert.equal(t.optimizationMix.quality, 1);
});
