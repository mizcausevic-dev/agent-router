import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreRoutes } from '../src/governance/route-scorer';
import { MODEL_REGISTRY } from '../src/governance/model-registry';

test('scoreRoutes: cost optimization picks cheapest qualifying model', () => {
  const r = scoreRoutes({
    requiredCapabilities: ['chat'],
    estimatedInputTokens: 10000,
    estimatedOutputTokens: 5000,
    optimization: 'cost',
  }, MODEL_REGISTRY);
  assert.ok(r.selected);
  // GPT-4o Mini or Groq are typical cost winners
  assert.ok(['gpt-4o-mini', 'groq-llama-3.3-70b', 'gemini-2.5-flash'].includes(r.selected!.backend.modelId));
});

test('scoreRoutes: quality optimization picks highest-quality model', () => {
  const r = scoreRoutes({
    requiredCapabilities: ['reasoning'],
    estimatedInputTokens: 50000,
    estimatedOutputTokens: 10000,
    optimization: 'quality',
  }, MODEL_REGISTRY);
  assert.ok(r.selected);
  assert.ok(r.selected!.backend.qualityScore >= 88);
});

test('scoreRoutes: latency optimization picks fastest model', () => {
  const r = scoreRoutes({
    requiredCapabilities: ['chat'],
    estimatedInputTokens: 1000,
    estimatedOutputTokens: 500,
    optimization: 'latency',
  }, MODEL_REGISTRY);
  assert.ok(r.selected);
  assert.ok(r.selected!.backend.observedP95LatencyMs <= 700);
});

test('scoreRoutes: capability filter excludes incompatible backends', () => {
  const r = scoreRoutes({
    requiredCapabilities: ['vision', 'function-calling'],
    estimatedInputTokens: 10000,
    estimatedOutputTokens: 2000,
    optimization: 'balanced',
  }, MODEL_REGISTRY);
  // Only models with both vision AND function-calling qualify
  for (const c of r.candidates.filter((c) => !c.disqualified)) {
    assert.ok(c.backend.capabilities.includes('vision'));
    assert.ok(c.backend.capabilities.includes('function-calling'));
  }
});

test('scoreRoutes: context-overflow disqualifies', () => {
  const r = scoreRoutes({
    requiredCapabilities: ['chat'],
    estimatedInputTokens: 500_000, // larger than most context windows
    estimatedOutputTokens: 0,
    optimization: 'balanced',
  }, MODEL_REGISTRY);
  // Only Gemini models with 1M context should qualify
  for (const c of r.candidates.filter((c) => !c.disqualified)) {
    assert.ok(c.backend.maxContextTokens >= 500_000);
  }
});

test('scoreRoutes: maxLatencyMs cap respected', () => {
  const r = scoreRoutes({
    requiredCapabilities: ['chat'],
    estimatedInputTokens: 1000,
    estimatedOutputTokens: 500,
    optimization: 'balanced',
    maxLatencyMs: 700,
  }, MODEL_REGISTRY);
  for (const c of r.candidates.filter((c) => !c.disqualified)) {
    assert.ok(c.backend.observedP95LatencyMs <= 700);
  }
});

test('scoreRoutes: maxCostUsd cap respected', () => {
  const r = scoreRoutes({
    requiredCapabilities: ['chat'],
    estimatedInputTokens: 100_000,
    estimatedOutputTokens: 20_000,
    optimization: 'balanced',
    maxCostUsd: 0.05,
  }, MODEL_REGISTRY);
  for (const c of r.candidates.filter((c) => !c.disqualified)) {
    assert.ok(c.estimatedCostUsd <= 0.05);
  }
});

test('scoreRoutes: minQualityScore floor respected', () => {
  const r = scoreRoutes({
    requiredCapabilities: ['chat'],
    estimatedInputTokens: 1000,
    estimatedOutputTokens: 500,
    optimization: 'balanced',
    minQualityScore: 90,
  }, MODEL_REGISTRY);
  for (const c of r.candidates.filter((c) => !c.disqualified)) {
    assert.ok(c.backend.qualityScore >= 90);
  }
});

test('scoreRoutes: excludeProviders filter applied', () => {
  const r = scoreRoutes({
    requiredCapabilities: ['chat'],
    estimatedInputTokens: 1000,
    estimatedOutputTokens: 500,
    optimization: 'balanced',
    excludeProviders: ['Anthropic'],
  }, MODEL_REGISTRY);
  for (const c of r.candidates.filter((c) => !c.disqualified)) {
    assert.notEqual(c.backend.provider, 'Anthropic');
  }
});

test('scoreRoutes: excludeModelIds filter applied', () => {
  const r = scoreRoutes({
    requiredCapabilities: ['chat'],
    estimatedInputTokens: 1000,
    estimatedOutputTokens: 500,
    optimization: 'balanced',
    excludeModelIds: ['claude-opus-4.7', 'gpt-5'],
  }, MODEL_REGISTRY);
  for (const c of r.candidates.filter((c) => !c.disqualified)) {
    assert.notEqual(c.backend.modelId, 'claude-opus-4.7');
    assert.notEqual(c.backend.modelId, 'gpt-5');
  }
});

test('scoreRoutes: preferredOnly filters non-preferred', () => {
  const r = scoreRoutes({
    requiredCapabilities: ['chat'],
    estimatedInputTokens: 1000,
    estimatedOutputTokens: 500,
    optimization: 'balanced',
    preferredOnly: true,
  }, MODEL_REGISTRY);
  for (const c of r.candidates.filter((c) => !c.disqualified)) {
    assert.equal(c.backend.preferred, true);
  }
});

test('scoreRoutes: no qualifying candidates → selected is null', () => {
  const r = scoreRoutes({
    requiredCapabilities: ['voice', 'reasoning', 'image-gen'], // unlikely combo
    estimatedInputTokens: 1000,
    estimatedOutputTokens: 500,
    optimization: 'balanced',
  }, MODEL_REGISTRY);
  assert.equal(r.selected, null);
  assert.equal(r.qualifiedCandidates, 0);
});

test('scoreRoutes: rationale populated for qualified candidates', () => {
  const r = scoreRoutes({
    requiredCapabilities: ['chat'],
    estimatedInputTokens: 1000,
    estimatedOutputTokens: 500,
    optimization: 'quality',
  }, MODEL_REGISTRY);
  assert.ok(r.selected);
  assert.ok(r.selected!.rationale.length >= 3);
});
