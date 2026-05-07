import { z } from 'zod';

const CapabilityEnum = z.enum([
  'chat', 'reasoning', 'vision', 'agent', 'embedding', 'voice',
  'image-gen', 'function-calling', 'long-context', 'code',
]);

export const RoutingRequestSchema = z.object({
  requiredCapabilities: z.array(CapabilityEnum).min(1),
  estimatedInputTokens: z.number().int().min(0),
  estimatedOutputTokens: z.number().int().min(0),
  optimization: z.enum(['quality', 'cost', 'latency', 'balanced']),
  excludeModelIds: z.array(z.string()).optional(),
  excludeProviders: z.array(z.string()).optional(),
  maxLatencyMs: z.number().min(0).optional(),
  maxCostUsd: z.number().min(0).optional(),
  minQualityScore: z.number().min(0).max(100).optional(),
  preferredOnly: z.boolean().optional(),
});

export const RouteWithFallbackSchema = z.object({
  request: RoutingRequestSchema,
  maxChainLength: z.number().int().min(1).max(5).optional(),
  requireProviderDiversity: z.boolean().optional(),
});

export const CircuitOutcomeSchema = z.object({
  modelId: z.string().min(1),
  ok: z.boolean(),
  latencyMs: z.number().min(0).optional(),
  errorCode: z.string().optional(),
  at: z.number().int().min(0).optional(), // defaults to Date.now() if absent
});

const RoutingDecisionSchema = z.object({
  decisionId: z.string().min(1),
  timestamp: z.string().min(1),
  tenantId: z.string().min(1),
  selectedModelId: z.string().min(1),
  selectedProvider: z.string().min(1),
  optimization: z.string().min(1),
  estimatedCostUsd: z.number().min(0),
  estimatedLatencyMs: z.number().min(0),
  qualifiedCount: z.number().int().min(0),
  totalCandidates: z.number().int().min(0),
  fellBackTo: z.string().optional(),
});

export const TelemetrySummarySchema = z.object({
  decisions: z.array(RoutingDecisionSchema).min(1),
});
