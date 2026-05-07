import { Router } from 'express';
import {
  RoutingRequestSchema,
  RouteWithFallbackSchema,
  CircuitOutcomeSchema,
  TelemetrySummarySchema,
} from '../schemas/validation-schemas';
import { MODEL_REGISTRY, findBackend } from '../governance/model-registry';
import { scoreRoutes } from '../governance/route-scorer';
import { buildFallbackChain } from '../governance/fallback-chain';
import { CircuitBreakerRegistry } from '../governance/circuit-breaker';
import { summarizeTelemetry } from '../governance/telemetry';
import { ROUTING_DECISIONS } from '../data/decisions';

// Process-wide circuit breaker registry. In production this would be a
// shared store backed by Redis/etc; in-memory is fine for the demo router.
const breakers = new CircuitBreakerRegistry();

export const modelsRouter = Router();

modelsRouter.get('/', (_req, res) => {
  res.json({ catalogSize: MODEL_REGISTRY.length, models: MODEL_REGISTRY });
});

modelsRouter.get('/:modelId', (req, res) => {
  const m = findBackend(req.params.modelId);
  if (!m) { res.status(404).json({ error: `Model ${req.params.modelId} not found.` }); return; }
  res.json(m);
});

export const routeRouter = Router();

routeRouter.post('/score', (req, res) => {
  const parsed = RoutingRequestSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', details: parsed.error.issues }); return; }

  // Filter by circuit-breaker availability before scoring
  const available = MODEL_REGISTRY.filter((m) => breakers.isAvailable(m.modelId));
  const result = scoreRoutes(parsed.data, available);
  res.json(result);
});

routeRouter.post('/decide', (req, res) => {
  // Same as score but returns the single selected backend + fallback chain
  const parsed = RouteWithFallbackSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', details: parsed.error.issues }); return; }

  const available = MODEL_REGISTRY.filter((m) => breakers.isAvailable(m.modelId));
  const scoring = scoreRoutes(parsed.data.request, available);
  const chain = buildFallbackChain(scoring.candidates, {
    maxChainLength: parsed.data.maxChainLength,
    requireProviderDiversity: parsed.data.requireProviderDiversity,
  });

  res.json({
    selected: scoring.selected,
    fallbackChain: chain,
    qualifiedCandidates: scoring.qualifiedCandidates,
    totalCandidates: scoring.totalCandidates,
    optimization: scoring.optimization,
  });
});

export const breakersRouter = Router();

breakersRouter.get('/', (_req, res) => {
  res.json({ snapshot: breakers.snapshot() });
});

breakersRouter.post('/outcome', (req, res) => {
  const parsed = CircuitOutcomeSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', details: parsed.error.issues }); return; }
  const at = parsed.data.at ?? Date.now();
  const state = breakers.recordOutcome({
    modelId: parsed.data.modelId,
    ok: parsed.data.ok,
    latencyMs: parsed.data.latencyMs,
    errorCode: parsed.data.errorCode,
    at,
  });
  res.json({ modelId: parsed.data.modelId, state });
});

breakersRouter.delete('/:modelId', (req, res) => {
  breakers.reset(req.params.modelId);
  res.json({ modelId: req.params.modelId, reset: true });
});

export const telemetryRouter = Router();

telemetryRouter.get('/', (_req, res) => {
  res.json(summarizeTelemetry(ROUTING_DECISIONS));
});

telemetryRouter.post('/summarize', (req, res) => {
  const parsed = TelemetrySummarySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', details: parsed.error.issues }); return; }
  res.json(summarizeTelemetry(parsed.data.decisions));
});

export const dashboardRouter = Router();

dashboardRouter.get('/summary', (_req, res) => {
  res.json({
    capturedAt: new Date().toISOString(),
    catalog: { size: MODEL_REGISTRY.length, models: MODEL_REGISTRY },
    breakers: breakers.snapshot(),
    telemetry: summarizeTelemetry(ROUTING_DECISIONS),
  });
});
